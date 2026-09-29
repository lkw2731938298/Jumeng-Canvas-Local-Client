import type { DirectorBonePose, DirectorCharacterGender } from "@jumeng-canvas/shared";
import { getBoneRotation } from "./boneRig";

export type BonePose = DirectorBonePose;
export type Gender = DirectorCharacterGender;
export type BoneAxis = 0 | 1 | 2;

export interface PoseAxisDef {
  label: string;
  axis: BoneAxis;
  min: number;
  max: number;
}

export interface PoseGroupDef {
  label: string;
  bones: string[];
  axes: PoseAxisDef[];
}

const DEG = Math.PI / 180;

/** 度 → 欧拉弧度，方便手写姿势模板 */
function e(x = 0, y = 0, z = 0): [number, number, number] {
  return [x * DEG, y * DEG, z * DEG];
}

/** 自然站立：双臂垂落（相对 T 型 bind 的 Z 轴下压） */
export const DEFAULT_STAND_POSE: BonePose = {
  LeftArm: e(-5, -2, -72),
  RightArm: e(2, 1, 81),
};

export function createDefaultBonePose(_gender?: Gender): BonePose {
  return structuredClone(DEFAULT_STAND_POSE);
}

export const POSE_GROUPS: PoseGroupDef[] = [
  {
    label: "身体",
    bones: ["Hips"],
    axes: [
      { label: "前倾", axis: 0, min: -45, max: 45 },
      { label: "转身", axis: 1, min: -60, max: 60 },
      { label: "侧倾", axis: 2, min: -30, max: 30 },
    ],
  },
  {
    label: "躯干",
    bones: ["Spine", "Spine1", "Spine2"],
    axes: [
      { label: "前倾", axis: 0, min: -30, max: 30 },
      { label: "扭转", axis: 1, min: -30, max: 30 },
      { label: "侧倾", axis: 2, min: -20, max: 20 },
    ],
  },
  {
    label: "头部",
    bones: ["Neck", "Head"],
    axes: [
      { label: "点头", axis: 0, min: -40, max: 40 },
      { label: "转头", axis: 1, min: -60, max: 60 },
      { label: "歪头", axis: 2, min: -30, max: 30 },
    ],
  },
  {
    label: "左肩",
    bones: ["LeftShoulder"],
    axes: [
      { label: "上抬", axis: 0, min: -5, max: 25 },
      { label: "前伸", axis: 2, min: -20, max: 15 },
    ],
  },
  {
    label: "右肩",
    bones: ["RightShoulder"],
    axes: [
      { label: "上抬", axis: 0, min: -5, max: 25 },
      { label: "前伸", axis: 2, min: -15, max: 20 },
    ],
  },
  {
    label: "左臂",
    bones: ["LeftArm"],
    axes: [
      { label: "外展", axis: 0, min: -90, max: 90 },
      { label: "前举", axis: 2, min: -120, max: 30 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
    ],
  },
  {
    label: "右臂",
    bones: ["RightArm"],
    axes: [
      { label: "外展", axis: 0, min: -90, max: 90 },
      { label: "前举", axis: 2, min: -30, max: 120 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
    ],
  },
  {
    label: "左肘",
    bones: ["LeftForeArm"],
    axes: [
      { label: "弯曲", axis: 0, min: 0, max: 145 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
    ],
  },
  {
    label: "右肘",
    bones: ["RightForeArm"],
    axes: [
      { label: "弯曲", axis: 0, min: 0, max: 145 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
    ],
  },
  {
    label: "左手",
    bones: ["LeftHand"],
    axes: [
      { label: "弯曲", axis: 0, min: -70, max: 70 },
      { label: "偏转", axis: 2, min: -30, max: 30 },
    ],
  },
  {
    label: "右手",
    bones: ["RightHand"],
    axes: [
      { label: "弯曲", axis: 0, min: -70, max: 70 },
      { label: "偏转", axis: 2, min: -30, max: 30 },
    ],
  },
  {
    label: "左腿",
    bones: ["LeftUpLeg"],
    axes: [
      // 实测：负 X = 大腿前抬（朝 +Z）
      { label: "前抬", axis: 0, min: -120, max: 90 },
      { label: "外展", axis: 2, min: -15, max: 90 },
      { label: "扭转", axis: 1, min: -45, max: 45 },
    ],
  },
  {
    label: "右腿",
    bones: ["RightUpLeg"],
    axes: [
      { label: "前抬", axis: 0, min: -120, max: 90 },
      { label: "外展", axis: 2, min: -90, max: 15 },
      { label: "扭转", axis: 1, min: -45, max: 45 },
    ],
  },
  {
    label: "左膝",
    bones: ["LeftLeg"],
    axes: [
      // 实测：大腿前抬后，正 X 才是屈膝（小腿下压）；负 X 会反折
      { label: "弯曲", axis: 0, min: -45, max: 145 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
      { label: "侧摆", axis: 2, min: -45, max: 45 },
    ],
  },
  {
    label: "右膝",
    bones: ["RightLeg"],
    axes: [
      { label: "弯曲", axis: 0, min: -45, max: 145 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
      { label: "侧摆", axis: 2, min: -45, max: 45 },
    ],
  },
  {
    label: "左脚",
    bones: ["LeftFoot"],
    axes: [
      { label: "弯曲", axis: 0, min: -40, max: 50 },
      { label: "扭转", axis: 1, min: -20, max: 20 },
    ],
  },
  {
    label: "右脚",
    bones: ["RightFoot"],
    axes: [
      { label: "弯曲", axis: 0, min: -40, max: 50 },
      { label: "扭转", axis: 1, min: -20, max: 20 },
    ],
  },
];

/**
 * 坐姿（骨骼实测校正）：
 * - UpLeg.X 负向 = 大腿朝 +Z 前抬
 * - Leg.X 正向 = 屈膝下压（负向会反折，旧模板踩过这个坑）
 * 人模脚底仍在原点，需自备椅面高度或整体下移。
 */
export const SIT_REFERENCE_POSE: BonePose = {
  Spine: e(10, 0, 0),
  Spine1: e(6, 0, 0),
  Neck: e(-6, 0, 0),
  LeftArm: e(-8, 5, -68),
  RightArm: e(5, -5, 72),
  LeftForeArm: e(55, 0, 0),
  RightForeArm: e(55, 0, 0),
  LeftHand: e(8, 0, 0),
  RightHand: e(8, 0, 0),
  LeftUpLeg: e(-90, 0, 4),
  RightUpLeg: e(-90, 0, -4),
  LeftLeg: e(100, 0, 0),
  RightLeg: e(100, 0, 0),
  LeftFoot: e(8, 0, 0),
  RightFoot: e(8, 0, 0),
};

export interface PosePreset {
  id: string;
  label: string;
  pose: BonePose;
}

/**
 * 动作模板（相对 Mixamo bind = T 型的欧拉偏移）。
 * 腿轴（mannequin.glb 实测）：UpLeg.X 负=前抬；Leg.X 正=屈膝。
 * 臂：Arm.Z 约 ±70~80° 为自然垂落。
 */
export const POSE_PRESETS: PosePreset[] = [
  { id: "stand", label: "站立", pose: structuredClone(DEFAULT_STAND_POSE) },
  { id: "tpose", label: "T 型", pose: {} },
  {
    id: "walk",
    label: "行走",
    pose: {
      Hips: e(0, 4, 0),
      Spine: e(4, 0, 0),
      Spine1: e(3, 0, 0),
      Neck: e(-2, 0, 0),
      LeftArm: e(18, 8, -76),
      RightArm: e(-22, -6, 76),
      LeftForeArm: e(28, 0, 0),
      RightForeArm: e(38, 0, 0),
      // 左腿前迈、右腿后撑；膝用正 X 屈
      LeftUpLeg: e(-30, 0, 4),
      RightUpLeg: e(18, 0, -4),
      LeftLeg: e(35, 0, 0),
      RightLeg: e(10, 0, 0),
      LeftFoot: e(6, 0, 0),
      RightFoot: e(-4, 0, 0),
    },
  },
  {
    id: "run",
    label: "跑步",
    pose: {
      Hips: e(0, 6, 0),
      Spine: e(12, 0, 0),
      Spine1: e(8, 0, 0),
      Neck: e(-8, 0, 0),
      LeftArm: e(42, 10, -70),
      RightArm: e(-48, -8, 70),
      LeftForeArm: e(55, 0, 0),
      RightForeArm: e(70, 0, 0),
      LeftUpLeg: e(-48, 5, 6),
      RightUpLeg: e(32, -5, -6),
      LeftLeg: e(78, 0, 0),
      RightLeg: e(28, 0, 0),
      LeftFoot: e(12, 0, 0),
      RightFoot: e(-8, 0, 0),
    },
  },
  { id: "sit", label: "坐姿", pose: structuredClone(SIT_REFERENCE_POSE) },
  {
    id: "crouch",
    label: "蹲下",
    pose: {
      Spine: e(18, 0, 0),
      Spine1: e(10, 0, 0),
      Neck: e(-8, 0, 0),
      LeftArm: e(12, 0, -62),
      RightArm: e(12, 0, 62),
      LeftForeArm: e(45, 0, 0),
      RightForeArm: e(45, 0, 0),
      LeftUpLeg: e(-95, 0, 8),
      RightUpLeg: e(-95, 0, -8),
      LeftLeg: e(125, 0, 0),
      RightLeg: e(125, 0, 0),
      LeftFoot: e(20, 0, 0),
      RightFoot: e(20, 0, 0),
    },
  },
  {
    id: "kneel",
    label: "单膝跪",
    pose: {
      Spine: e(6, 0, 0),
      Neck: e(-4, 0, 0),
      LeftArm: e(-6, 0, -72),
      RightArm: e(4, 0, 78),
      LeftForeArm: e(20, 0, 0),
      RightForeArm: e(20, 0, 0),
      // 左腿前撑，右膝跪
      LeftUpLeg: e(-70, 0, 5),
      RightUpLeg: e(-20, 0, -5),
      LeftLeg: e(90, 0, 0),
      RightLeg: e(130, 0, 0),
      LeftFoot: e(8, 0, 0),
      RightFoot: e(18, 0, 0),
    },
  },
  {
    id: "wave",
    label: "挥手",
    pose: {
      ...DEFAULT_STAND_POSE,
      Spine: e(0, -8, 0),
      Neck: e(0, -10, 0),
      Head: e(0, -6, 0),
      RightShoulder: e(8, 0, 5),
      RightArm: e(-25, 25, 22),
      RightForeArm: e(55, 15, 0),
      RightHand: e(0, 0, -15),
    },
  },
  {
    id: "point",
    label: "指向",
    pose: {
      ...DEFAULT_STAND_POSE,
      Spine: e(4, -12, 0),
      Spine1: e(2, -6, 0),
      Neck: e(0, -18, 0),
      Head: e(0, -8, 0),
      RightShoulder: e(5, 0, 8),
      RightArm: e(-55, 5, 48),
      RightForeArm: e(8, 0, 0),
      RightHand: e(-10, 0, 0),
    },
  },
  {
    id: "crossed",
    label: "抱臂",
    pose: {
      Spine: e(2, 0, 0),
      LeftShoulder: e(4, 0, -6),
      RightShoulder: e(4, 0, 6),
      LeftArm: e(20, 55, -48),
      RightArm: e(20, -55, 48),
      LeftForeArm: e(105, 25, 0),
      RightForeArm: e(105, -25, 0),
      LeftHand: e(15, 0, 10),
      RightHand: e(15, 0, -10),
    },
  },
  {
    id: "think",
    label: "托腮",
    pose: {
      ...DEFAULT_STAND_POSE,
      Spine: e(4, 6, 0),
      Neck: e(12, -16, 4),
      Head: e(8, -8, 0),
      RightArm: e(-40, -30, 62),
      RightForeArm: e(112, 20, 0),
      RightHand: e(20, 0, -10),
    },
  },
  {
    id: "cheer",
    label: "欢呼",
    pose: {
      Spine: e(-6, 0, 0),
      Spine1: e(-4, 0, 0),
      Neck: e(-8, 0, 0),
      LeftShoulder: e(10, 0, -8),
      RightShoulder: e(10, 0, 8),
      LeftArm: e(-35, 10, -18),
      RightArm: e(-35, -10, 18),
      LeftForeArm: e(25, 0, 0),
      RightForeArm: e(25, 0, 0),
      LeftHand: e(-15, 0, 0),
      RightHand: e(-15, 0, 0),
    },
  },
  {
    id: "fight",
    label: "戒备",
    pose: {
      Hips: e(0, 0, 0),
      Spine: e(6, -8, 0),
      Spine1: e(4, -4, 0),
      Neck: e(0, 10, 0),
      LeftArm: e(-35, 15, -42),
      RightArm: e(-40, -10, 38),
      LeftForeArm: e(95, 0, 0),
      RightForeArm: e(100, 0, 0),
      LeftHand: e(10, 0, 0),
      RightHand: e(10, 0, 0),
      LeftUpLeg: e(-18, 0, 12),
      RightUpLeg: e(8, 0, -14),
      LeftLeg: e(28, 0, 0),
      RightLeg: e(14, 0, 0),
    },
  },
  {
    id: "lean",
    label: "前倾",
    pose: {
      ...DEFAULT_STAND_POSE,
      Hips: e(4, 0, 0),
      Spine: e(16, 0, 0),
      Spine1: e(10, 0, 0),
      Neck: e(-6, 0, 0),
      LeftArm: e(-12, 0, -70),
      RightArm: e(-12, 0, 70),
      LeftForeArm: e(30, 0, 0),
      RightForeArm: e(30, 0, 0),
    },
  },
];

export { getBoneRotation } from "./boneRig";

export function radToDeg(rad: number): number {
  return Math.round((rad * 180) / Math.PI);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function resolvePresetPose(presetId: string, gender: Gender = "male"): BonePose {
  if (presetId === "stand") return structuredClone(createDefaultBonePose(gender));
  if (presetId === "tpose") return {};
  const preset = POSE_PRESETS.find((p) => p.id === presetId);
  return preset ? structuredClone(preset.pose) : structuredClone(createDefaultBonePose(gender));
}
