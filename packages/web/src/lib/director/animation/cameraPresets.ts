/**
 * 相机运镜预设：生成 Catmull 路径点，供时间轴相机轨绑定。
 */

import type { DirectorCameraState, DirectorMotionPath } from "@jumeng-canvas/shared";
import { createMotionPath } from "./createTimeline";

export type CameraMotionPresetId =
  | "orbit"
  | "half_arc"
  | "dolly_in"
  | "dolly_out"
  | "crane_up"
  | "truck"
  | "helix";

export const CAMERA_MOTION_PRESETS: {
  id: CameraMotionPresetId;
  label: string;
  hint: string;
}[] = [
  { id: "orbit", label: "环绕", hint: "绕目标水平一圈" },
  { id: "half_arc", label: "半弧", hint: "绕目标水平 180°" },
  { id: "dolly_in", label: "推进", hint: "沿视线前推" },
  { id: "dolly_out", label: "拉远", hint: "沿视线后拉" },
  { id: "crane_up", label: "升镜", hint: "相机升高" },
  { id: "truck", label: "横移", hint: "沿右向量平移" },
  { id: "helix", label: "螺旋升", hint: "绕目标上升螺旋" },
];

export type CameraPresetParams = {
  /** 环绕/半弧/螺旋半径，默认取当前相机到目标水平距离 */
  radius?: number;
  /** 升镜/螺旋额外高度 */
  height?: number;
  /** 推进/拉远/横移距离 */
  distance?: number;
  /** 路径采样点数 */
  samples?: number;
};

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function lenXZ(v: [number, number, number]): number {
  return Math.hypot(v[0], v[2]) || 1;
}

function normalizeXZ(v: [number, number, number]): [number, number, number] {
  const l = lenXZ(v);
  return [v[0] / l, 0, v[2] / l];
}

function crossY(fwdXZ: [number, number, number]): [number, number, number] {
  // right = cross(up, forward) with up=(0,1,0) → (forward.z, 0, -forward.x) wait
  // right = normalize(cross(worldUp, lookDir))
  const fx = fwdXZ[0];
  const fz = fwdXZ[2];
  const rx = fz;
  const rz = -fx;
  const l = Math.hypot(rx, rz) || 1;
  return [rx / l, 0, rz / l];
}

/**
 * 根据当前相机与注视点生成运镜路径。
 * target：环绕中心；缺省用 camera.target。
 */
export function buildCameraMotionPath(
  preset: CameraMotionPresetId,
  camera: DirectorCameraState,
  opts?: CameraPresetParams & { target?: [number, number, number]; name?: string }
): DirectorMotionPath {
  const center = opts?.target ?? ([...camera.target] as [number, number, number]);
  const pos = [...camera.position] as [number, number, number];
  const samples = Math.max(4, opts?.samples ?? 16);
  const heightLift = opts?.height ?? 2;
  const distance = opts?.distance ?? 3;

  const offset = sub(pos, center);
  const radius = Math.max(0.5, opts?.radius ?? lenXZ(offset));
  const baseY = pos[1];
  const startAngle = Math.atan2(offset[0], offset[2]);
  const fwd = normalizeXZ(sub(center, pos)); // 朝向目标的水平方向
  const lookFwd = normalizeXZ(sub(camera.target, pos));
  const right = crossY(lookFwd);

  const points: [number, number, number][] = [];

  switch (preset) {
    case "orbit": {
      for (let i = 0; i <= samples; i++) {
        const a = startAngle + (i / samples) * Math.PI * 2;
        points.push([
          center[0] + Math.sin(a) * radius,
          baseY,
          center[2] + Math.cos(a) * radius,
        ]);
      }
      break;
    }
    case "half_arc": {
      for (let i = 0; i <= samples; i++) {
        const a = startAngle + (i / samples) * Math.PI;
        points.push([
          center[0] + Math.sin(a) * radius,
          baseY,
          center[2] + Math.cos(a) * radius,
        ]);
      }
      break;
    }
    case "dolly_in": {
      points.push(pos);
      points.push(add(pos, scale(lookFwd, distance)));
      break;
    }
    case "dolly_out": {
      points.push(pos);
      points.push(add(pos, scale(lookFwd, -distance)));
      break;
    }
    case "crane_up": {
      points.push(pos);
      points.push([pos[0], pos[1] + heightLift, pos[2]]);
      break;
    }
    case "truck": {
      points.push(pos);
      points.push(add(pos, scale(right, distance)));
      break;
    }
    case "helix": {
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const a = startAngle + t * Math.PI * 2;
        points.push([
          center[0] + Math.sin(a) * radius,
          baseY + t * heightLift,
          center[2] + Math.cos(a) * radius,
        ]);
      }
      break;
    }
    default:
      points.push(pos, add(pos, scale(fwd, distance)));
  }

  const label = CAMERA_MOTION_PRESETS.find((p) => p.id === preset)?.label ?? preset;
  return createMotionPath(points, opts?.name ?? `运镜·${label}`);
}
