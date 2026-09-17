export type CharacterPoseId =
  | "standing"
  | "sitting"
  | "walking"
  | "pointing"
  | "waving"
  | "arms_crossed";

export interface CharacterPose {
  id: CharacterPoseId;
  label: string;
  /** Extra Euler rotation (radians) applied on top of user transform. */
  rotation: [number, number, number];
  /** Vertical offset for grounding. */
  yOffset: number;
}

export const CHARACTER_POSES: CharacterPose[] = [
  { id: "standing", label: "站立", rotation: [0, 0, 0], yOffset: 0 },
  { id: "sitting", label: "坐姿", rotation: [0.35, 0, 0], yOffset: -0.35 },
  { id: "walking", label: "行走", rotation: [0.12, 0.25, -0.08], yOffset: 0 },
  { id: "pointing", label: "指向", rotation: [-0.25, 0.15, 0.1], yOffset: 0 },
  { id: "waving", label: "挥手", rotation: [-0.45, -0.2, 0.15], yOffset: 0 },
  { id: "arms_crossed", label: "抱臂", rotation: [0.15, 0, -0.05], yOffset: 0 },
];

export function getCharacterPose(id: CharacterPoseId | undefined): CharacterPose {
  return CHARACTER_POSES.find((p) => p.id === id) ?? CHARACTER_POSES[0]!;
}
