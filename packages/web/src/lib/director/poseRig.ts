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

export const DEFAULT_STAND_POSE: BonePose = {
  LeftArm: [-0.0814029132580002, -0.039179738326426884, -1.2640469415310904],
  RightArm: [0.04361134538599179, 0.009705345683335469, 1.4185980867761463],
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
      { label: "外展", axis: 2, min: -45, max: 90 },
      { label: "扭转", axis: 1, min: -45, max: 45 },
    ],
  },
  {
    label: "左膝",
    bones: ["LeftLeg"],
    axes: [
      { label: "弯曲", axis: 0, min: -145, max: 45 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
      { label: "侧摆", axis: 2, min: -145, max: 45 },
    ],
  },
  {
    label: "右膝",
    bones: ["RightLeg"],
    axes: [
      { label: "弯曲", axis: 0, min: -145, max: 45 },
      { label: "扭转", axis: 1, min: -90, max: 90 },
      { label: "侧摆", axis: 2, min: -145, max: 45 },
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

export const SIT_REFERENCE_POSE: BonePose = {
  Spine: [-0.20943951023931956, 0, 0],
  Spine1: [-0.13962634015954636, 0, 0],
  Neck: [0.17453292519943295, 0, 0],
  LeftArm: [0, 0, -1.5707963267948966],
  RightArm: [0.12802488457155545, 0.1640164780646209, 1.3119109974168885],
  LeftForeArm: [1.0471975511965976, 0, 0],
  RightForeArm: [1.046841197225411, -0.011992554652527826, -0.001083598807176783],
  LeftUpLeg: [0.03840969276012091, 0.07133277731628322, 1.4141743380006457],
  RightUpLeg: [-0.06924913512026107, 0.08082361607461405, 1.2137023349813503],
  LeftLeg: [-0.19235659672903957, 0.5778433068474167, -1.4270952033432525],
  RightLeg: [0.3378145461147919, 0.4026329234902384, -1.8223332686034608],
  LeftFoot: [0.2617993877991494, 0, 0],
  RightFoot: [0.2617993877991494, 0, 0],
};

export interface PosePreset {
  id: string;
  label: string;
  pose: BonePose;
}

export const POSE_PRESETS: PosePreset[] = [
  { id: "stand", label: "站立", pose: structuredClone(DEFAULT_STAND_POSE) },
  { id: "tpose", label: "T 型", pose: {} },
  {
    id: "walk",
    label: "行走",
    pose: {
      Spine: [3 * DEG, 0, 0],
      Spine1: [2 * DEG, 0, 0],
      LeftArm: [-25 * DEG, 0, -90 * DEG],
      RightArm: [25 * DEG, 0, 90 * DEG],
      LeftForeArm: [15 * DEG, 0, 0],
      RightForeArm: [15 * DEG, 0, 0],
      LeftUpLeg: [-25 * DEG, 0, 0],
      RightUpLeg: [15 * DEG, 0, 0],
      LeftLeg: [-20 * DEG, 0, 0],
      RightLeg: [-5 * DEG, 0, 0],
    },
  },
  {
    id: "run",
    label: "跑步",
    pose: {
      Spine: [0.13962634015954636, 0, 0],
      Spine1: [0.08726646259971647, 0, 0],
      Neck: [-0.08726646259971647, 0, 0],
      LeftArm: [-0.6981317007977318, 0, -1.5707963267948966],
      RightArm: [0.6981317007977318, 0, 1.5707963267948966],
      LeftForeArm: [0.6981317007977318, 0, 0],
      RightForeArm: [0.7853981633974483, 0, 0],
      LeftUpLeg: [-0.6457718232379019, 0.3665191429188092, 0.3141592653589793],
      RightUpLeg: [0.6277734752973522, 0.08726646259971647, -0.10112598005045041],
      LeftLeg: [0, 0.2163973939920538, -0.44731043546539095],
      RightLeg: [0, 0, 0],
    },
  },
  { id: "sit", label: "坐姿", pose: structuredClone(SIT_REFERENCE_POSE) },
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
  return preset ? structuredClone(preset.pose) : {};
}
