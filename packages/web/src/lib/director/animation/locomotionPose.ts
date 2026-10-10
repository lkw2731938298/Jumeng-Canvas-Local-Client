import type { DirectorAnimMotion, DirectorBonePose } from "@jumeng-canvas/shared";
import { DEFAULT_STAND_POSE, type BonePose } from "@/lib/director/poseRig";

const DEG = Math.PI / 180;

function e(x = 0, y = 0, z = 0): [number, number, number] {
  return [x * DEG, y * DEG, z * DEG];
}

/** 一整步态周期对应的路程（米）：左右脚各迈一次 */
export function locomotionStrideMeters(motion: DirectorAnimMotion): number {
  if (motion === "run") return 1.8;
  if (motion === "walk") return 1.25;
  return 1;
}

/**
 * 按步态相位生成骨骼欧拉（相对 Mixamo bind）。
 * 只驱动髋/躯干/腿/脚；肩臂手完整保留 base（用户摆好的姿势沿轨迹保持不动）。
 * 腿轴：UpLeg.X 负=前抬；Leg.X 正=屈膝。
 */
export function sampleLocomotionBonePose(
  motion: DirectorAnimMotion,
  phase01: number,
  base?: BonePose | null
): DirectorBonePose {
  const stand: BonePose = { ...DEFAULT_STAND_POSE, ...(base ?? {}) };
  if (motion === "idle") return stand;

  const run = motion === "run";
  const amp = run ? 1.35 : 1;
  const phase = ((phase01 % 1) + 1) % 1;
  const φ = phase * Math.PI * 2;
  const swing = Math.sin(φ);
  const knee = Math.max(0, Math.sin(φ));
  const kneeOpp = Math.max(0, Math.sin(φ + Math.PI));
  const hipSway = Math.sin(φ * 2) * (run ? 6 : 4);
  const lean = run ? 12 : 4;

  return {
    ...stand,
    Hips: e(0, hipSway, 0),
    Spine: e(lean, 0, 0),
    Spine1: e(lean * 0.7, 0, 0),
    Neck: e(run ? -8 : -2, 0, 0),
    LeftUpLeg: e(-30 * amp * swing, 0, 4),
    RightUpLeg: e(30 * amp * swing, 0, -4),
    LeftLeg: e((run ? 78 : 35) * amp * knee + 8, 0, 0),
    RightLeg: e((run ? 78 : 35) * amp * kneeOpp + 8, 0, 0),
    LeftFoot: e(8 * swing, 0, 0),
    RightFoot: e(-8 * swing, 0, 0),
  };
}

/** 由沿轨迹已走路程得到步态相位 [0,1) */
export function locomotionPhaseFromDistance(
  distanceMeters: number,
  motion: DirectorAnimMotion
): number {
  const stride = locomotionStrideMeters(motion);
  if (stride < 1e-6) return 0;
  const d = Math.max(0, distanceMeters);
  return (d % stride) / stride;
}
