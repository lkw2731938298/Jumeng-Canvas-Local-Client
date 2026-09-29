/**
 * 机位取景几何：给定主体位置/朝向/身高，按景别·角度·方位角算出机位世界位姿。
 * 供智能分镜、构图医生与 AI ops 共用同一套计量（单位米，Y 朝上）。
 *
 * 约定：人物默认朝向 +Z；方位角 0° = 站在正前方拍脸。
 * 落库时用 manual 注视点（胸口/头），禁止跟脚底。
 */

import { rotationFromPositionLookAt } from "@/lib/director/shotPreview";
import type { DirectorObject } from "@/types/director-scene";

export type FramingShot = "close" | "medium" | "full" | "wide";
export type FramingAngle = "eye" | "high" | "low" | "top";

export type Vec3 = [number, number, number];

const HUMAN_HEIGHT = 1.75;
const DEG = Math.PI / 180;

/** 景别：画面内应覆盖的身体高度比例（相对全身） */
const SHOT_COVERAGE: Record<FramingShot, number> = {
  close: 0.34,
  medium: 0.58,
  full: 1.08,
  wide: 1.9,
};

/** 注视点相对身高：近景眼鼻、中景胸口、远景躯干中心 */
const SHOT_FOCUS_RATIO: Record<FramingShot, number> = {
  close: 0.93,
  medium: 0.68,
  full: 0.5,
  wide: 0.4,
};

/** 平视时相机高度相对身高 */
const SHOT_CAM_HEIGHT_RATIO: Record<FramingShot, number> = {
  close: 0.93,
  medium: 0.9,
  full: 0.52,
  wide: 0.45,
};

const SHOT_FOV: Record<FramingShot, number> = {
  close: 32,
  medium: 40,
  full: 45,
  wide: 55,
};

const ANGLE_ELEV: Record<FramingAngle, number> = {
  eye: 0,
  high: 28,
  low: -24,
  top: 78,
};

export function objectHeightMeters(obj: DirectorObject): number {
  if (obj.kind === "character") return HUMAN_HEIGHT * (obj.modelScale ?? 1) * obj.transform.scale[1];
  if (obj.shape === "model") return (obj.modelScale ?? 1) * obj.transform.scale[1];
  return obj.transform.scale[1];
}

/** 取景焦点：近景偏头部，中景胸口，远景中心 */
export function focusPointOnObject(obj: DirectorObject, shot: FramingShot = "medium"): Vec3 {
  const [x, y, z] = obj.transform.position;
  if (obj.kind === "character") {
    const h = objectHeightMeters(obj);
    return [x, y + h * SHOT_FOCUS_RATIO[shot], z];
  }
  if (obj.shape === "model") return [x, y + objectHeightMeters(obj) / 2, z];
  return [x, y, z];
}

export function forwardOfObject(obj: DirectorObject): Vec3 {
  const yaw = obj.transform.rotation[1];
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

/** 按垂直覆盖高度与 FOV 反推机位到焦点的距离 */
export function distanceForVerticalCoverage(
  coverageMeters: number,
  fovDeg: number,
  fill = 0.78
): number {
  const half = (fovDeg * DEG) / 2;
  const tan = Math.tan(half);
  if (tan < 1e-6) return Math.max(0.4, coverageMeters);
  return Math.max(0.35, coverageMeters / fill / (2 * tan));
}

export interface FramingInput {
  target: DirectorObject;
  shot?: FramingShot;
  angle?: FramingAngle;
  /** 度：0=主体正前方，90=左侧，180=背后 */
  azimuthDeg?: number;
  distance?: number;
  fov?: number;
  /** 注视用的景别（默认同 shot；仰拍可看头） */
  lookAtShot?: FramingShot;
}

export interface FramingPose {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  targetId: string;
}

/** 相对主体自动取景 */
export function computeFramingPose(input: FramingInput): FramingPose {
  const shot = input.shot ?? "medium";
  const angle = input.angle ?? "eye";
  const fov = input.fov ?? SHOT_FOV[shot];
  const h = objectHeightMeters(input.target);
  const [bx, by, bz] = input.target.transform.position;
  const lookShot = input.lookAtShot ?? shot;
  const focus = focusPointOnObject(input.target, lookShot);

  const coverage = h * SHOT_COVERAGE[shot];
  const distance = input.distance ?? distanceForVerticalCoverage(coverage, fov);

  const fwd = forwardOfObject(input.target);
  const azimuth = (input.azimuthDeg ?? 0) * DEG;
  const baseYaw = Math.atan2(fwd[0], fwd[2]) + azimuth;

  let position: Vec3;

  if (angle === "eye") {
    // 平视：相机钉在眼高（近/中）或腰高（全身），水平距由「到焦点的斜距」推出
    const camY = by + h * SHOT_CAM_HEIGHT_RATIO[shot];
    const dy = focus[1] - camY;
    const horiz = Math.sqrt(Math.max(0.08, distance * distance - dy * dy));
    position = [
      focus[0] + Math.sin(baseYaw) * horiz,
      Math.max(0.08, camY),
      focus[2] + Math.cos(baseYaw) * horiz,
    ];
  } else if (angle === "top") {
    // 几乎正上方，略偏方位角以免完全俯视死板
    const elev = ANGLE_ELEV.top * DEG;
    const horizontal = Math.max(0.15, distance * Math.cos(elev));
    position = [
      focus[0] + Math.sin(baseYaw) * horizontal,
      Math.max(by + h * 1.6, focus[1] + distance * Math.sin(elev)),
      focus[2] + Math.cos(baseYaw) * horizontal,
    ];
  } else {
    // 仰/俯：相对焦点做仰角球坐标
    const elev = ANGLE_ELEV[angle] * DEG;
    const horizontal = distance * Math.cos(elev);
    let camY = focus[1] + distance * Math.sin(elev);
    if (angle === "low") {
      // 英雄仰拍：压到膝下，仍看向胸口/头
      camY = Math.min(camY, by + h * 0.18);
      camY = Math.max(0.08, camY);
    } else {
      camY = Math.max(by + h * 0.85, camY);
    }
    position = [
      focus[0] + Math.sin(baseYaw) * horizontal,
      camY,
      focus[2] + Math.cos(baseYaw) * horizontal,
    ];
  }

  return {
    position,
    lookAt: focus,
    fov,
    targetId: input.target.id,
  };
}

/** 过肩：机位在 A 身后偏一侧、肩高，看向 B 头部 */
export function computeOverShoulderPose(
  shoulderOf: DirectorObject,
  lookAtTarget: DirectorObject,
  side: "left" | "right" = "right",
  fov = 38
): FramingPose {
  const a = shoulderOf.transform.position;
  const hA = objectHeightMeters(shoulderOf);
  const scale = hA / HUMAN_HEIGHT;
  const bFocus = focusPointOnObject(lookAtTarget, "close");
  const dir: Vec3 = [bFocus[0] - a[0], 0, bFocus[2] - a[2]];
  const len = Math.hypot(dir[0], dir[2]) || 1;
  const fx = dir[0] / len;
  const fz = dir[2] / len;
  const sideSign = side === "left" ? -1 : 1;
  const back = 0.58 * scale;
  const lateral = 0.32 * scale;
  const shoulderY = a[1] + hA * 0.88;
  const position: Vec3 = [
    a[0] - fx * back + fz * lateral * sideSign,
    shoulderY,
    a[2] - fz * back - fx * lateral * sideSign,
  ];
  return { position, lookAt: bFocus, fov, targetId: lookAtTarget.id };
}

/**
 * 写入摄像机字段：必须用 manual 锁住计算出的胸口/头，
 * lookAtObjectId 仅作主体标记（构图医生识别），不能走 target→脚底。
 */
export function framingToCameraFields(pose: FramingPose) {
  return {
    position: pose.position,
    lookAt: pose.lookAt,
    rotation: rotationFromPositionLookAt(pose.position, pose.lookAt),
    fov: pose.fov,
    lookAtMode: "manual" as const,
    lookAtObjectId: pose.targetId,
  };
}
