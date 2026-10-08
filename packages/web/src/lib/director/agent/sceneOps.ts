/**
 * 导演台 AI 操作（借鉴 mcp-for-blender 的场景工具设计，直接作用于 three.js 导演台场景）。
 * 纯函数：输入当前场景 + 一批操作 → 输出新场景与逐条结果；截图、3D 生成等异步动作
 * 只登记为 deferred，由调用方在场景写回并渲染后再执行。
 *
 * 坐标约定（与模型说明一致）：单位米，Y 轴朝上，地面 y=0；角度一律用「度」，写入场景时转弧度。
 */

import { LIGHTING_PRESETS, type LightingPresetId } from "@/lib/director/lightingPresets";
import { POSE_PRESETS, resolvePresetPose } from "@/lib/director/poseRig";
import { rotationFromPositionLookAt } from "@/lib/director/shotPreview";
import {
  newDirectorCameraObject,
  newDirectorObject,
  type DirectorAspectRatio,
  type DirectorObject,
  type DirectorObjectShape,
  type DirectorSceneState,
} from "@/types/director-scene";

export type DirectorOp = { op: string; [key: string]: unknown };

export type DirectorOpResult = {
  op: string;
  ok: boolean;
  message: string;
  objectId?: string;
  /** read_object 等读回的详情，仅回传模型 */
  detail?: string;
};

/** 截图请求：场景写回、视口渲染后执行 */
export type DirectorCaptureRequest = { cameraId: string; cameraName: string };

/** 3D 生成请求：占位物体已放入场景，后台生成完成后替换为 GLB */
export type DirectorGenerateRequest = {
  placeholderId: string;
  name: string;
  prompt: string;
  imageAssetId?: string;
  /** 目标高度（米） */
  height: number;
};

export type ApplyDirectorOpsOutput = {
  scene: DirectorSceneState;
  results: DirectorOpResult[];
  captures: DirectorCaptureRequest[];
  generations: DirectorGenerateRequest[];
  /** 本批是否改动了场景（用于决定是否存撤销快照 / 写回） */
  changed: boolean;
};

/** 导演台 AI 支持的全部操作名 */
export const DIRECTOR_AGENT_OPS = [
  "add_character",
  "add_prop",
  "update_object",
  "delete_object",
  "clear_objects",
  "set_pose",
  "add_camera",
  "update_camera",
  "set_lighting",
  "set_scene",
  "read_object",
  "capture",
  "generate_model",
] as const;

const PRIMITIVE_SHAPES: DirectorObjectShape[] = ["box", "sphere", "cylinder", "cone", "plane"];
const ASPECT_RATIOS: DirectorAspectRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "2.35:1"];
/** 人模默认身高（米），与 CharacterGlbModel 归一化一致 */
const HUMAN_HEIGHT = 1.75;
const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 接受 [x,z]（y 取默认）、[x,y,z] 或 {x,y,z} */
function readVec3(raw: unknown, defaultY: number): Vec3 | null {
  if (Array.isArray(raw)) {
    if (raw.length === 2) return [num(raw[0], 0), defaultY, num(raw[1], 0)];
    if (raw.length >= 3) return [num(raw[0], 0), num(raw[1], defaultY), num(raw[2], 0)];
    return null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if ("x" in o || "z" in o) return [num(o.x, 0), num(o.y, defaultY), num(o.z, 0)];
  }
  return null;
}

/** 角度三元组（度）→ 弧度；也接受单个数字表示绕 Y 轴转 */
function readRotationDeg(raw: unknown): Vec3 | null {
  if (typeof raw === "number" || typeof raw === "string") return [0, num(raw, 0) * DEG, 0];
  const v = readVec3(raw, 0);
  return v ? [v[0] * DEG, v[1] * DEG, v[2] * DEG] : null;
}

function readScale(raw: unknown): Vec3 | null {
  if (typeof raw === "number" || typeof raw === "string") {
    const s = Math.max(0.01, num(raw, 1));
    return [s, s, s];
  }
  const v = readVec3(raw, 1);
  return v ? [Math.max(0.01, v[0]), Math.max(0.01, v[1]), Math.max(0.01, v[2])] : null;
}

function readColor(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(s) ? s : null;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** 物体高度估算（米），供取景与朝向计算 */
export function objectHeight(obj: DirectorObject): number {
  if (obj.kind === "character") return HUMAN_HEIGHT * (obj.modelScale ?? 1) * obj.transform.scale[1];
  if (obj.shape === "model") return (obj.modelScale ?? 1) * obj.transform.scale[1];
  return obj.transform.scale[1];
}

/** 取景焦点：人物取胸口/头部，道具取中心 */
function focusPoint(obj: DirectorObject, shot?: string): Vec3 {
  const [x, y, z] = obj.transform.position;
  if (obj.kind === "character") {
    const h = objectHeight(obj);
    const ratio = shot === "close" ? 0.88 : shot === "medium" ? 0.72 : 0.5;
    return [x, y + h * ratio, z];
  }
  if (obj.shape === "model") return [x, y + objectHeight(obj) / 2, z];
  return [x, y, z];
}

/** 物体正面方向（绕 Y 旋转 yaw，默认朝 +Z） */
function forwardOf(obj: DirectorObject): Vec3 {
  const yaw = obj.transform.rotation[1];
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

function yawTowards(from: Vec3, to: Vec3): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2]);
}

type Ctx = {
  scene: DirectorSceneState;
  /** 本批新建物体别名（ref → 真实 id） */
  aliases: Map<string, string>;
};

/** 按 id / 本批别名 / 名称（精确优先，其次包含）解析物体 */
function findObject(ctx: Ctx, raw: unknown, kind?: DirectorObject["kind"]): DirectorObject | null {
  const key = str(raw);
  if (!key) return null;
  const pool = kind ? ctx.scene.objects.filter((o) => o.kind === kind) : ctx.scene.objects;
  const aliased = ctx.aliases.get(key);
  const byId = pool.find((o) => o.id === (aliased || key));
  if (byId) return byId;
  const exact = pool.find((o) => o.name === key);
  if (exact) return exact;
  return pool.find((o) => o.name.includes(key) || key.includes(o.name)) ?? null;
}

function replaceObject(ctx: Ctx, next: DirectorObject) {
  ctx.scene = {
    ...ctx.scene,
    objects: ctx.scene.objects.map((o) => (o.id === next.id ? next : o)),
  };
}

function pushObject(ctx: Ctx, obj: DirectorObject, ref: string) {
  ctx.scene = { ...ctx.scene, objects: [...ctx.scene.objects, obj] };
  if (ref) ctx.aliases.set(ref, obj.id);
}

/** 通用字段：名称 / 位置 / 旋转 / 缩放 / 颜色 / 朝向 */
function applyCommonFields(ctx: Ctx, obj: DirectorObject, op: DirectorOp, defaultY: number): DirectorObject {
  const next: DirectorObject = { ...obj, transform: { ...obj.transform } };
  const name = str(op.name);
  if (name) next.name = name.slice(0, 40);
  const pos = readVec3(op.position, defaultY);
  if (pos) next.transform.position = pos;
  const rot = readRotationDeg(op.rotation);
  if (rot) next.transform.rotation = rot;
  if (op.facing !== undefined) {
    next.transform.rotation = [next.transform.rotation[0], num(op.facing, 0) * DEG, next.transform.rotation[2]];
  }
  const towards = op.faceTowards ?? op.face_towards;
  if (towards !== undefined) {
    const target = findObject(ctx, towards);
    const point = target ? target.transform.position : readVec3(towards, 0);
    if (point) {
      next.transform.rotation = [
        next.transform.rotation[0],
        yawTowards(next.transform.position, point),
        next.transform.rotation[2],
      ];
    }
  }
  const scale = readScale(op.scale);
  if (scale) next.transform.scale = scale;
  const color = readColor(op.color);
  if (color) next.color = color;
  return next;
}

function describeObj(obj: DirectorObject): string {
  const p = obj.transform.position.map(round2).join(", ");
  return `「${obj.name}」(${p})`;
}

/** 取景计算：给定目标、景别、机位角度、方位角，算出机位位置与看向点 */
function computeFraming(
  ctx: Ctx,
  op: DirectorOp
): { position: Vec3; lookAt: Vec3; fov: number; targetId?: string } | null {
  const overShoulder = findObject(ctx, op.overShoulderOf ?? op.over_shoulder_of);
  const target = findObject(ctx, op.lookAtTarget ?? op.target_object ?? op.subject);
  if (overShoulder && target) {
    // 过肩：机位在 A 身后偏一侧、肩高，看向 B 的头部
    const a = overShoulder.transform.position;
    const bFocus = focusPoint(target, "close");
    const dir: Vec3 = [bFocus[0] - a[0], 0, bFocus[2] - a[2]];
    const len = Math.hypot(dir[0], dir[2]) || 1;
    const fx = dir[0] / len;
    const fz = dir[2] / len;
    const side = str(op.side) === "left" ? -1 : 1;
    const shoulderY = a[1] + objectHeight(overShoulder) * 0.9;
    const position: Vec3 = [a[0] - fx * 0.7 + fz * 0.35 * side, shoulderY, a[2] - fz * 0.7 - fx * 0.35 * side];
    return { position, lookAt: bFocus, fov: num(op.fov, 40), targetId: target.id };
  }
  if (!target) return null;
  const shot = str(op.shot) || "medium";
  const dist =
    { close: 1.1, medium: 2.2, full: 3.8, wide: 6.5 }[shot] ?? num(op.distance, 2.2);
  const distance = op.distance !== undefined ? num(op.distance, dist) : dist;
  const angle = str(op.angle) || "eye";
  const elevDeg = op.elevation !== undefined
    ? num(op.elevation, 0)
    : ({ eye: 0, high: 30, low: -18, top: 80 }[angle] ?? 0);
  // 方位角：0 = 目标正前方，90 = 目标左手侧，180 = 背后（相对目标朝向）
  const azimuth = num(op.azimuth, 0) * DEG;
  const focus = focusPoint(target, shot);
  const fwd = forwardOf(target);
  const baseYaw = Math.atan2(fwd[0], fwd[2]) + azimuth;
  const elev = elevDeg * DEG;
  const horizontal = distance * Math.cos(elev);
  const position: Vec3 = [
    focus[0] + Math.sin(baseYaw) * horizontal,
    Math.max(0.1, focus[1] + distance * Math.sin(elev)),
    focus[2] + Math.cos(baseYaw) * horizontal,
  ];
  const fov = num(op.fov, shot === "close" ? 35 : shot === "wide" ? 55 : 42);
  return { position, lookAt: focus, fov, targetId: target.id };
}

function applyCameraFields(ctx: Ctx, cam: DirectorObject, op: DirectorOp): DirectorObject {
  const next: DirectorObject = { ...cam, transform: { ...cam.transform } };
  const name = str(op.name);
  if (name) next.name = name.slice(0, 40);
  const framing = computeFraming(ctx, op);
  let position = readVec3(op.position, 1.6) ?? (framing ? framing.position : next.transform.position);
  let lookAt = readVec3(op.lookAt ?? op.look_at, 1) ?? (framing ? framing.lookAt : next.lookAt ?? [0, 1, 0]);
  if (framing && !op.position) position = framing.position;
  if (framing && !(op.lookAt ?? op.look_at)) lookAt = framing.lookAt;
  next.transform.position = position;
  next.transform.rotation = rotationFromPositionLookAt(position, lookAt);
  next.lookAt = lookAt;
  // 锁定计算出的胸口/头；lookAtObjectId 仅标记主体，勿用 target→脚底
  next.lookAtMode = "manual";
  next.lookAtObjectId = framing?.targetId && !(op.lookAt ?? op.look_at) ? framing.targetId : null;
  if (op.fov !== undefined || framing) next.fov = Math.min(120, Math.max(10, num(op.fov, framing?.fov ?? next.fov ?? 45)));
  return next;
}

/** 姿态：预设 + 可选单骨骼覆盖（度） */
function applyPose(obj: DirectorObject, op: DirectorOp): DirectorObject | string {
  if (obj.kind !== "character") return "只有人物可以调整姿态";
  const presetId = str(op.preset);
  let pose = { ...(obj.bonePose ?? {}) };
  if (presetId) {
    if (!POSE_PRESETS.some((p) => p.id === presetId)) {
      return `未知姿态预设 ${presetId}，可选：${POSE_PRESETS.map((p) => p.id).join(" / ")}`;
    }
    pose = resolvePresetPose(presetId, obj.gender ?? "male");
  }
  const bones = op.bones;
  if (bones && typeof bones === "object") {
    for (const [bone, raw] of Object.entries(bones as Record<string, unknown>)) {
      const v = readVec3(raw, 0);
      if (v) pose[bone] = [v[0] * DEG, v[1] * DEG, v[2] * DEG];
    }
  }
  if (!presetId && !bones) return "set_pose 需要 preset 或 bones";
  return { ...obj, bonePose: pose };
}

/** 执行一批导演台操作 */
export function applyDirectorOps(
  scene: DirectorSceneState,
  ops: DirectorOp[],
  opts?: { imageAssetIds?: Set<string>; modelAssetIds?: Set<string> }
): ApplyDirectorOpsOutput {
  const ctx: Ctx = { scene, aliases: new Map() };
  const results: DirectorOpResult[] = [];
  const captures: DirectorCaptureRequest[] = [];
  const generations: DirectorGenerateRequest[] = [];
  let changed = false;
  const ok = (op: DirectorOp, message: string, objectId?: string, detail?: string) =>
    results.push({ op: op.op, ok: true, message, objectId, detail });
  const fail = (op: DirectorOp, message: string) => results.push({ op: op.op, ok: false, message });

  for (const op of ops) {
    try {
      switch (op.op) {
        case "add_character": {
          const gender = str(op.gender) === "female" ? "female" : "male";
          const base = newDirectorObject("character", "model", ctx.scene.objects);
          const modelAssetId = str(op.modelAssetId);
          if (modelAssetId && opts?.modelAssetIds && !opts.modelAssetIds.has(modelAssetId)) {
            fail(op, `模型素材 ${modelAssetId} 不存在`);
            break;
          }
          let obj: DirectorObject = {
            ...base,
            gender,
            builtinModelId: modelAssetId ? undefined : `mannequin_${gender}`,
            modelAssetId: modelAssetId || undefined,
            bonePose: resolvePresetPose("stand", gender),
            transform: { ...base.transform, position: [base.transform.position[0], 0, base.transform.position[2]] },
          };
          obj = applyCommonFields(ctx, obj, op, 0);
          if (op.height !== undefined) obj.modelScale = Math.max(0.2, num(op.height, HUMAN_HEIGHT) / HUMAN_HEIGHT);
          if (op.pose !== undefined) {
            const posed = applyPose(obj, { op: "set_pose", preset: op.pose });
            if (typeof posed !== "string") obj = posed;
          }
          pushObject(ctx, obj, str(op.ref));
          changed = true;
          ok(op, `已添加人物${describeObj(obj)}`, obj.id);
          break;
        }
        case "add_prop": {
          const modelAssetId = str(op.modelAssetId);
          if (modelAssetId) {
            if (opts?.modelAssetIds && !opts.modelAssetIds.has(modelAssetId)) {
              fail(op, `模型素材 ${modelAssetId} 不存在`);
              break;
            }
            const base = newDirectorObject("prop", "model", ctx.scene.objects);
            let obj: DirectorObject = {
              ...base,
              shape: "model",
              modelAssetId,
              modelScale: Math.max(0.05, num(op.height, 1)),
              transform: { ...base.transform, position: [base.transform.position[0], 0, base.transform.position[2]] },
            };
            obj = applyCommonFields(ctx, obj, op, 0);
            pushObject(ctx, obj, str(op.ref));
            changed = true;
            ok(op, `已放置模型道具${describeObj(obj)}`, obj.id);
            break;
          }
          const shape = (str(op.shape) || "box") as DirectorObjectShape;
          if (!PRIMITIVE_SHAPES.includes(shape)) {
            fail(op, `不支持的形状 ${shape}，可选：${PRIMITIVE_SHAPES.join(" / ")}；复杂物体请用 generate_model`);
            break;
          }
          const scale = readScale(op.scale) ?? [1, 1, 1];
          const defaultY = shape === "plane" ? scale[1] : scale[1] / 2;
          let obj = newDirectorObject("prop", shape, ctx.scene.objects);
          obj = applyCommonFields(ctx, obj, { ...op, scale }, defaultY);
          if (!op.position) obj.transform.position = [obj.transform.position[0], defaultY, obj.transform.position[2]];
          pushObject(ctx, obj, str(op.ref));
          changed = true;
          ok(op, `已添加道具${describeObj(obj)}`, obj.id);
          break;
        }
        case "update_object": {
          const obj = findObject(ctx, op.target);
          if (!obj) {
            fail(op, `找不到物体「${str(op.target)}」`);
            break;
          }
          if (obj.kind === "camera") {
            replaceObject(ctx, applyCameraFields(ctx, obj, op));
          } else {
            const next = applyCommonFields(ctx, obj, op, obj.transform.position[1]);
            if (op.height !== undefined) {
              next.modelScale =
                obj.kind === "character"
                  ? Math.max(0.2, num(op.height, HUMAN_HEIGHT) / HUMAN_HEIGHT)
                  : Math.max(0.05, num(op.height, 1));
            }
            replaceObject(ctx, next);
          }
          changed = true;
          ok(op, `已更新${describeObj(findObject(ctx, obj.id)!)}`, obj.id);
          break;
        }
        case "delete_object": {
          const obj = findObject(ctx, op.target);
          if (!obj) {
            fail(op, `找不到物体「${str(op.target)}」`);
            break;
          }
          ctx.scene = { ...ctx.scene, objects: ctx.scene.objects.filter((o) => o.id !== obj.id) };
          changed = true;
          ok(op, `已删除「${obj.name}」`);
          break;
        }
        case "clear_objects": {
          const keepCameras = op.keepCameras !== false;
          const before = ctx.scene.objects.length;
          ctx.scene = {
            ...ctx.scene,
            objects: ctx.scene.objects.filter((o) => keepCameras && o.kind === "camera"),
          };
          changed = true;
          ok(op, `已清空场景物体 ${before - ctx.scene.objects.length} 个${keepCameras ? "（保留摄像机）" : ""}`);
          break;
        }
        case "set_pose": {
          const obj = findObject(ctx, op.target, "character");
          if (!obj) {
            fail(op, `找不到人物「${str(op.target)}」`);
            break;
          }
          const posed = applyPose(obj, op);
          if (typeof posed === "string") {
            fail(op, posed);
            break;
          }
          replaceObject(ctx, posed);
          changed = true;
          ok(op, `已调整「${obj.name}」的姿态${str(op.preset) ? `为 ${str(op.preset)}` : ""}`, obj.id);
          break;
        }
        case "add_camera": {
          const framing = computeFraming(ctx, op);
          const position = readVec3(op.position, 1.6);
          const lookAt = readVec3(op.lookAt ?? op.look_at, 1);
          if (!framing && !position) {
            fail(op, "add_camera 需要 position+lookAt，或 lookAtTarget(+shot/angle/azimuth)，或 overShoulderOf+lookAtTarget");
            break;
          }
          let cam = newDirectorCameraObject(ctx.scene.objects, 0, {
            position: position ?? framing!.position,
            target: lookAt ?? framing?.lookAt ?? [0, 1, 0],
            fov: 45,
          });
          cam = applyCameraFields(ctx, cam, op);
          pushObject(ctx, cam, str(op.ref));
          changed = true;
          ok(
            op,
            `已添加摄像机「${cam.name}」位置 (${cam.transform.position.map(round2).join(", ")})，焦距 FOV ${round2(cam.fov ?? 45)}°`,
            cam.id
          );
          break;
        }
        case "update_camera": {
          const cam = findObject(ctx, op.target, "camera");
          if (!cam) {
            fail(op, `找不到摄像机「${str(op.target)}」`);
            break;
          }
          const next = applyCameraFields(ctx, cam, op);
          replaceObject(ctx, next);
          changed = true;
          ok(op, `已调整摄像机「${next.name}」`, next.id);
          break;
        }
        case "set_lighting": {
          const preset = str(op.preset) as LightingPresetId;
          if (!LIGHTING_PRESETS.some((p) => p.id === preset)) {
            fail(op, `未知布光预设 ${preset}，可选：${LIGHTING_PRESETS.map((p) => p.id).join(" / ")}`);
            break;
          }
          const nextLighting = { ...ctx.scene.lighting, preset };
          const hasYaw = op.yawDeg !== undefined && op.yawDeg !== null && op.yawDeg !== "";
          const hasPitch = op.pitchDeg !== undefined && op.pitchDeg !== null && op.pitchDeg !== "";
          if (hasYaw) nextLighting.yawDeg = Math.min(180, Math.max(-180, num(op.yawDeg, 0)));
          if (hasPitch) nextLighting.pitchDeg = Math.min(45, Math.max(-45, num(op.pitchDeg, 0)));
          ctx.scene = { ...ctx.scene, lighting: nextLighting };
          changed = true;
          const angleNote =
            hasYaw || hasPitch
              ? `（水平 ${nextLighting.yawDeg ?? 0}° / 俯仰 ${nextLighting.pitchDeg ?? 0}°）`
              : "";
          ok(op, `布光已切换为「${LIGHTING_PRESETS.find((p) => p.id === preset)!.label}」${angleNote}`);
          break;
        }
        case "set_scene": {
          const settings = { ...ctx.scene.sceneSettings, ground: { ...ctx.scene.sceneSettings.ground } };
          const notes: string[] = [];
          const sky = readColor(op.skyColor);
          if (sky) {
            settings.skyColor = sky;
            notes.push(`天空色 ${sky}`);
          }
          const aspect = str(op.aspectRatio) as DirectorAspectRatio;
          if (aspect) {
            if (!ASPECT_RATIOS.includes(aspect)) {
              fail(op, `不支持的画幅 ${aspect}，可选：${ASPECT_RATIOS.join(" / ")}`);
              break;
            }
            settings.aspectRatio = aspect;
            notes.push(`画幅 ${aspect}`);
          }
          const ground = op.ground as Record<string, unknown> | undefined;
          if (ground && typeof ground === "object") {
            if (ground.visible !== undefined) settings.ground.visible = Boolean(ground.visible);
            if (ground.opacity !== undefined) settings.ground.opacity = Math.min(1, Math.max(0, num(ground.opacity, 0.4)));
            notes.push("地面");
          }
          if (op.showLabels !== undefined) settings.showLabels = Boolean(op.showLabels);
          const panoId = str(op.panoramaAssetId);
          if (panoId) {
            if (opts?.imageAssetIds && !opts.imageAssetIds.has(panoId)) {
              fail(op, `全景图素材 ${panoId} 不存在（须是项目内图片素材 id）`);
              break;
            }
            settings.panorama = {
              assetId: panoId,
              horizontalRotation: num(op.panoramaRotation, 0),
              sphereRadius: settings.panorama?.sphereRadius ?? 80,
            };
            notes.push("全景背景");
          } else if (op.panoramaRotation !== undefined && settings.panorama) {
            settings.panorama = { ...settings.panorama, horizontalRotation: num(op.panoramaRotation, 0) };
            notes.push("全景旋转");
          }
          if (op.clearPanorama === true) {
            settings.panorama = null;
            notes.push("移除全景");
          }
          ctx.scene = { ...ctx.scene, sceneSettings: settings };
          changed = true;
          ok(op, `场景设置已更新：${notes.join("、") || "无变化"}`);
          break;
        }
        case "read_object": {
          const obj = findObject(ctx, op.target);
          if (!obj) {
            fail(op, `找不到物体「${str(op.target)}」`);
            break;
          }
          const detail = JSON.stringify({
            ...obj,
            transform: {
              position: obj.transform.position.map(round2),
              rotationDeg: obj.transform.rotation.map((r) => round2(r / DEG)),
              scale: obj.transform.scale.map(round2),
            },
            bonePoseDeg: obj.bonePose
              ? Object.fromEntries(
                  Object.entries(obj.bonePose).map(([k, v]) => [k, v.map((r) => round2(r / DEG))])
                )
              : undefined,
            bonePose: undefined,
            screenshots: obj.screenshots?.length,
          });
          ok(op, `已读取「${obj.name}」详情`, obj.id, detail);
          break;
        }
        case "capture": {
          const cam =
            findObject(ctx, op.camera ?? op.target, "camera") ??
            ctx.scene.objects.filter((o) => o.kind === "camera").at(-1) ??
            null;
          if (!cam) {
            fail(op, "场景里还没有摄像机，请先 add_camera 再截图");
            break;
          }
          captures.push({ cameraId: cam.id, cameraName: cam.name });
          break;
        }
        case "generate_model": {
          const prompt = str(op.prompt);
          const imageAssetId = str(op.imageAssetId);
          if (!prompt && !imageAssetId) {
            fail(op, "generate_model 需要 prompt（物体描述）或 imageAssetId（参考图）");
            break;
          }
          if (imageAssetId && opts?.imageAssetIds && !opts.imageAssetIds.has(imageAssetId)) {
            fail(op, `参考图素材 ${imageAssetId} 不存在`);
            break;
          }
          const height = Math.max(0.05, num(op.height, 1));
          const name = (str(op.name) || defaultModelName(prompt) || "AI 模型").slice(0, 30);
          // 占位方块：底部贴地，生成完成后替换为 GLB（保持位置与朝向）
          const base = newDirectorObject("prop", "box", ctx.scene.objects);
          let obj: DirectorObject = {
            ...base,
            name: `生成中·${name}`,
            color: "#f59e0b",
            transform: {
              ...base.transform,
              position: [base.transform.position[0], height / 2, base.transform.position[2]],
              scale: [height * 0.6, height, height * 0.6],
            },
          };
          obj = applyCommonFields(ctx, obj, { ...op, name: undefined, scale: undefined, color: undefined }, height / 2);
          if (op.position) {
            const p = readVec3(op.position, 0)!;
            obj.transform.position = [p[0], p[1] + height / 2, p[2]];
          }
          pushObject(ctx, obj, str(op.ref));
          generations.push({ placeholderId: obj.id, name, prompt, imageAssetId: imageAssetId || undefined, height });
          changed = true;
          ok(op, `已提交 3D 生成「${name}」，先放了占位方块，生成完成（约 1~5 分钟）后自动替换为模型`, obj.id);
          break;
        }
        default:
          fail(op, `未知操作 ${op.op}`);
      }
    } catch (err) {
      fail(op, err instanceof Error ? err.message : String(err));
    }
  }

  return { scene: ctx.scene, results, captures, generations, changed };
}

/** 由描述生成默认物体名：中文取前 12 字，英文按单词截到约 24 字符 */
export function defaultModelName(prompt: string): string {
  const s = prompt.trim();
  if (!s) return "";
  if (/[\u4e00-\u9fa5]/.test(s)) return s.slice(0, 12);
  if (s.length <= 24) return s;
  const cut = s.slice(0, 24);
  const space = cut.lastIndexOf(" ");
  return space > 8 ? cut.slice(0, space) : cut;
}

/** 3D 生成完成：把占位方块替换为 GLB 模型道具（保持位置 / 朝向，底部贴地） */
export function replacePlaceholderWithModel(
  scene: DirectorSceneState,
  placeholderId: string,
  opts: { assetId: string; name: string; height: number }
): DirectorSceneState | null {
  const holder = scene.objects.find((o) => o.id === placeholderId);
  if (!holder) return null;
  const [x, y, z] = holder.transform.position;
  const bottom = Math.max(0, y - holder.transform.scale[1] / 2);
  const next: DirectorObject = {
    ...holder,
    shape: "model",
    name: opts.name,
    color: "#94a3b8",
    modelAssetId: opts.assetId,
    modelScale: opts.height,
    transform: { ...holder.transform, position: [x, bottom, z], scale: [1, 1, 1] },
  };
  return { ...scene, objects: scene.objects.map((o) => (o.id === placeholderId ? next : o)) };
}

/** 3D 生成失败：占位方块改名提示失败（不删除，便于用户看到位置后重试） */
export function markPlaceholderFailed(
  scene: DirectorSceneState,
  placeholderId: string,
  name: string
): DirectorSceneState | null {
  const holder = scene.objects.find((o) => o.id === placeholderId);
  if (!holder) return null;
  const next: DirectorObject = { ...holder, name: `生成失败·${name}`, color: "#ef4444" };
  return { ...scene, objects: scene.objects.map((o) => (o.id === placeholderId ? next : o)) };
}
