/**
 * 导演台 AI 协议：场景快照（相当于 mcp-for-blender 的 get_scene_info）+ 系统提示词 + 回复解析。
 * 模型每轮拿到最新场景文本，用 ```ops JSON 代码块下发操作，由 sceneOps 执行。
 */

import { LIGHTING_PRESETS } from "@/lib/director/lightingPresets";
import { POSE_PRESETS, resolvePresetPose } from "@/lib/director/poseRig";
import { parseAgentReply } from "@/lib/local/agent/protocol";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import type { DirectorObject, DirectorSceneState } from "@/types/director-scene";
import type { DirectorOp } from "./sceneOps";

const DEG = 180 / Math.PI;

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function vec(v: readonly number[]) {
  return `(${v.map(r2).join(", ")})`;
}

/** 识别当前骨骼姿态是否等于某个预设 */
function poseLabel(obj: DirectorObject): string {
  if (obj.kind !== "character" || !obj.builtinModelId?.startsWith("mannequin_")) return "";
  const cur = JSON.stringify(obj.bonePose ?? {});
  for (const p of POSE_PRESETS) {
    if (JSON.stringify(resolvePresetPose(p.id, obj.gender ?? "male")) === cur) return p.id;
  }
  return "自定义";
}

export type DirectorAssetBrief = { id: string; title: string };

/** 读取导演台关联的分镜行（描述、景别、机位提示等），拼进快照供 AI 按分镜搭场景 */
export function describeLinkedShot(directorNodeId: string): string {
  const store = useCanvasStore.getState();
  const director = store.nodes.find((n) => n.id === directorNodeId);
  if (!director) return "";
  const dParams = (director.data as WorkflowNodeData | undefined)?.params ?? {};
  const gridId = String(dParams.linkedStoryboardGridId ?? "").trim();
  if (!gridId) return "";
  const grid = store.nodes.find((n) => n.id === gridId);
  if (!grid) return "";
  const gParams = (grid.data as WorkflowNodeData | undefined)?.params ?? {};
  const shots = Array.isArray(gParams.shots) ? (gParams.shots as Record<string, unknown>[]) : [];
  const shotId = String(dParams.linkedShotId ?? gParams.selectedShotId ?? "").trim();
  const idx = shots.findIndex((s) => String(s.id ?? "") === shotId);
  if (idx < 0) return "";
  const row = shots[idx];
  const fields: [string, string][] = [
    ["画面描述", "description"],
    ["景别", "shotSize"],
    ["光线", "lighting"],
    ["台词", "dialogue"],
    ["机位提示", "cameraPrompt"],
    ["视频提示", "videoPrompt"],
  ];
  const lines = fields
    .map(([label, key]) => {
      const v = String(row[key] ?? "").trim();
      return v ? `- ${label}：${v.slice(0, 400)}` : "";
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return `【关联分镜 · 第 ${idx + 1} 镜】（截图会写回这一镜的草图）\n${lines.join("\n")}`;
}

/** 场景快照文本 */
export function buildDirectorSceneSnapshot(opts: {
  scene: DirectorSceneState;
  linkedShotText?: string;
  imageAssets: DirectorAssetBrief[];
  modelAssets: DirectorAssetBrief[];
  pendingModel3d: { name: string; placeholderId: string; progress?: string }[];
}): string {
  const { scene } = opts;
  const lines: string[] = ["【导演台场景快照】（单位米，Y 轴向上，地面 y=0，角度为度）"];
  const people = scene.objects.filter((o) => o.kind === "character");
  const props = scene.objects.filter((o) => o.kind === "prop");
  const cams = scene.objects.filter((o) => o.kind === "camera");

  lines.push(`人物 ${people.length} 个：`);
  for (const o of people) {
    const model = o.modelAssetId ? `GLB素材 ${o.modelAssetId}` : o.builtinModelId ?? "人模";
    const pose = poseLabel(o);
    lines.push(
      `- id=${o.id} 「${o.name}」 ${o.gender === "female" ? "女" : "男"} 位置${vec(o.transform.position)} 朝向yaw=${r2(o.transform.rotation[1] * DEG)}° 身高≈${r2(1.75 * (o.modelScale ?? 1))}m ${model}${pose ? ` 姿态=${pose}` : ""}`
    );
  }
  lines.push(`道具 ${props.length} 个：`);
  for (const o of props) {
    const shape = o.shape === "model" ? `GLB模型 ${o.modelAssetId ?? "?"} 高≈${r2(o.modelScale ?? 1)}m` : `${o.shape} 缩放${vec(o.transform.scale)}`;
    lines.push(
      `- id=${o.id} 「${o.name}」 ${shape} 位置${vec(o.transform.position)} 旋转${vec(o.transform.rotation.map((r) => r * DEG))} 颜色${o.color}`
    );
  }
  lines.push(`摄像机 ${cams.length} 个：`);
  for (const o of cams) {
    const target = o.lookAtMode === "target" && o.lookAtObjectId
      ? `跟随「${scene.objects.find((x) => x.id === o.lookAtObjectId)?.name ?? o.lookAtObjectId}」`
      : `看向${vec(o.lookAt ?? [0, 1, 0])}`;
    lines.push(
      `- id=${o.id} 「${o.name}」 位置${vec(o.transform.position)} ${target} FOV=${r2(o.fov ?? 45)}° 已截图${o.screenshots?.length ?? 0}张`
    );
  }
  const light = LIGHTING_PRESETS.find((p) => p.id === scene.lighting.preset);
  const s = scene.sceneSettings;
  lines.push(
    `布光：${scene.lighting.preset}（${light?.label ?? ""}）；画幅 ${s.aspectRatio}；天空色 ${s.skyColor}；地面${s.ground.visible ? "显示" : "隐藏"}；全景背景 ${s.panorama?.assetId ?? "无"}`
  );
  if (opts.pendingModel3d.length) {
    lines.push(
      `3D 生成中：${opts.pendingModel3d.map((j) => `「${j.name}」(占位 id=${j.placeholderId}${j.progress ? `，${j.progress}` : ""})`).join("；")}`
    );
  }
  if (opts.linkedShotText) lines.push("", opts.linkedShotText);
  lines.push(
    "",
    `项目图片素材（可作全景背景 panoramaAssetId / 图生3D imageAssetId）${opts.imageAssets.length ? "：" : "：无"}`
  );
  for (const a of opts.imageAssets.slice(0, 40)) lines.push(`- ${a.id} ${a.title}`);
  lines.push(`项目 3D 模型素材（可用 add_prop/add_character 的 modelAssetId 直接放置）${opts.modelAssets.length ? "：" : "：无"}`);
  for (const a of opts.modelAssets.slice(0, 40)) lines.push(`- ${a.id} ${a.title}`);
  return lines.join("\n");
}

/** 系统提示词 */
export function buildDirectorSystemPrompt(opts: { model3dAvailable: boolean }): string {
  const poses = POSE_PRESETS.map((p) => `${p.id}(${p.label})`).join("、");
  const lights = LIGHTING_PRESETS.map((p) => `${p.id}(${p.label})`).join("、");
  return `你是聚梦画布「导演台」的 AI 场景助手，负责在 3D 预演场景里摆人物、道具、摄像机和灯光，帮用户把分镜变成可截图的构图。
你每轮都会收到【导演台场景快照】。需要改场景时，在回复末尾输出一个 \`\`\`ops 代码块，内容是 JSON 数组，按顺序执行。不需要改场景就只用中文回答。

坐标：单位米，Y 轴朝上，地面 y=0；人物默认身高 1.75m、默认面朝 +Z（yaw=0），yaw=90 面朝 +X；角度一律用「度」。
position 可写 [x,z]（自动贴地）或 [x,y,z]。target / camera 等引用可填物体 id、名称或本批新建时的 ref。

可用操作：
- add_character {ref?, name?, gender:"male"|"female", position, facing?(度) 或 faceTowards?(物体), pose?, height?(米), modelAssetId?}
- add_prop {ref?, name?, shape:"box"|"sphere"|"cylinder"|"cone"|"plane", position?, rotation?[度], scale?(数字或[x,y,z]), color?("#rrggbb")} —— 用于桌子、墙、柱子等简单体块；或 {modelAssetId, height} 放置已有 3D 模型素材
- update_object {target, name?, position?, rotation?, facing?, faceTowards?, scale?, color?, height?}
- delete_object {target}；clear_objects {keepCameras?:true}
- set_pose {target, preset?: ${poses}, bones?: {骨骼名:[x,y,z]度}}（骨骼名为 Mixamo：Hips、Spine、Spine1、Neck、Head、LeftArm、LeftForeArm、LeftUpLeg、LeftLeg、RightArm… 预设优先，细调再用 bones）
- add_camera {ref?, name?, 以下三选一：
    ① 自动取景 lookAtTarget(物体) + shot:"close"|"medium"|"full"|"wide" + angle:"eye"|"high"|"low"|"top" + azimuth?(度，0=目标正前方，90=目标左侧，180=背后) + distance?
    ② 过肩 overShoulderOf(前景人物) + lookAtTarget(对面人物) + side?:"left"|"right"
    ③ 手动 position:[x,y,z] + lookAt:[x,y,z]
  , fov?(度)}
- update_camera {target, 同 add_camera 字段}
- set_lighting {preset: ${lights}}
- set_scene {skyColor?, aspectRatio?:"16:9"|"9:16"|"1:1"|"4:3"|"3:4"|"21:9"|"2.35:1", ground?:{visible,opacity}, panoramaAssetId?, panoramaRotation?, clearPanorama?}
- read_object {target} —— 读回物体完整参数（含骨骼角度）
- capture {camera?} —— 用该摄像机截图，存入素材库并写回关联分镜草图
${opts.model3dAvailable
  ? `- generate_model {ref?, name, prompt(英文或中文物体描述，单个物体，不要场景), imageAssetId?(项目图片，图生3D), position, facing?, height(米)} —— 调用 3D 生成模型（1~5 分钟，花费用户 API 额度），先放占位方块，完成后自动替换。仅在简单体块明显不够、且用户需要具体造型时使用，一次最多 2 个`
  : "- （当前未选 3D 生成模型，generate_model 不可用；需要复杂造型时请提示用户在面板选择 3D 模型）"}

工作方式：
1. 先根据快照和用户需求（或参考图、关联分镜）想清楚布局：人物站位、朝向、主体关系，再放摄像机取景。
2. 摆位合理：人物间对话距离约 1~1.5m，互相 faceTowards；道具不要和人物重叠。
3. 用户要「按分镜/按参考图搭场景」时：人物、道具、景别、机位角度、画幅都要对应上，搭完再 capture。
4. 执行结果会在下一轮以【导演台操作执行结果】返回；失败就修正后重试，全部成功后用一两句话总结，不要再输出 ops。
5. 每批 ops 不超过 20 条；不要编造不存在的物体 id 或素材 id。`;
}

export type ParsedDirectorReply = { text: string; ops: DirectorOp[]; parseError?: string };

/** 解析模型回复中的 ```ops 代码块（复用本地 Agent 解析器） */
export function parseDirectorReply(raw: string): ParsedDirectorReply {
  const parsed = parseAgentReply(raw);
  return { text: parsed.text, ops: parsed.ops as unknown as DirectorOp[], parseError: parsed.parseError };
}
