import * as THREE from "three";
import type { DirectorBonePose } from "@jumeng-canvas/shared";

export type BonePose = DirectorBonePose;
export type Vec3 = [number, number, number];

export function findBone(boneMap: Map<string, THREE.Bone>, name: string): THREE.Bone | undefined {
  return boneMap.get(name) ?? boneMap.get(`mixamorig${name}`) ?? boneMap.get(`mixamorig:${name}`);
}

export function extractSkeletonData(root: THREE.Object3D): {
  boneMap: Map<string, THREE.Bone>;
  bindPose: Map<string, THREE.Quaternion>;
} {
  const boneMap = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) boneMap.set(obj.name, obj as THREE.Bone);
  });
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      for (const bone of skinned.skeleton.bones) {
        if (!boneMap.has(bone.name)) boneMap.set(bone.name, bone);
      }
    }
  });
  const bindPose = new Map<string, THREE.Quaternion>();
  boneMap.forEach((bone, name) => bindPose.set(name, bone.quaternion.clone()));
  return { boneMap, bindPose };
}

/** 先恢复 bind pose，再乘以 bonePose 欧拉偏移 */
export function applyBonePose(
  boneMap: Map<string, THREE.Bone>,
  bindPose: Map<string, THREE.Quaternion>,
  bonePose: BonePose
): boolean {
  if (boneMap.size === 0 || bindPose.size === 0) return false;

  boneMap.forEach((bone, name) => {
    const bind = bindPose.get(name);
    if (bind) bone.quaternion.copy(bind);
  });

  for (const [boneName, rotation] of Object.entries(bonePose)) {
    const bone = findBone(boneMap, boneName);
    if (!bone) continue;
    const bind = bindPose.get(bone.name);
    if (!bind) continue;
    const offset = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2], "XYZ")
    );
    bone.quaternion.copy(bind).multiply(offset);
  }

  return true;
}

export function createSelectionOutlineMaterial(color = "#f97316", normalOffset = 0.002) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  if (normalOffset > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.outlineThickness = { value: normalOffset };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float outlineThickness;")
        .replace(
          "#include <project_vertex>",
          "transformed += normalize(objectNormal) * outlineThickness;\n#include <project_vertex>"
        );
    };
    mat.customProgramCacheKey = () => `selection-outline-normal-${normalOffset}`;
  }
  return mat;
}

export interface JointHandleDef {
  rotateBone: string;
  positionBone: string;
  radius: number;
}

export interface TwistHandleDef {
  bone: string;
  childBone: string;
  scale: number;
}

export const JOINT_HANDLES: JointHandleDef[] = [
  { rotateBone: "Neck", positionBone: "Head", radius: 0.055 },
  { rotateBone: "Spine", positionBone: "Spine1", radius: 0.065 },
  { rotateBone: "LeftShoulder", positionBone: "LeftArm", radius: 0.048 },
  { rotateBone: "LeftArm", positionBone: "LeftForeArm", radius: 0.048 },
  { rotateBone: "LeftForeArm", positionBone: "LeftHand", radius: 0.042 },
  { rotateBone: "RightShoulder", positionBone: "RightArm", radius: 0.048 },
  { rotateBone: "RightArm", positionBone: "RightForeArm", radius: 0.048 },
  { rotateBone: "RightForeArm", positionBone: "RightHand", radius: 0.042 },
  { rotateBone: "LeftUpLeg", positionBone: "LeftLeg", radius: 0.055 },
  { rotateBone: "LeftLeg", positionBone: "LeftFoot", radius: 0.048 },
  { rotateBone: "RightUpLeg", positionBone: "RightLeg", radius: 0.055 },
  { rotateBone: "RightLeg", positionBone: "RightFoot", radius: 0.048 },
  { rotateBone: "Hips", positionBone: "Hips", radius: 0.065 },
];

export const TWIST_HANDLES: TwistHandleDef[] = [
  { bone: "LeftArm", childBone: "LeftForeArm", scale: 0.048 },
  { bone: "RightArm", childBone: "RightForeArm", scale: 0.048 },
  { bone: "LeftUpLeg", childBone: "LeftLeg", scale: 0.055 },
  { bone: "RightUpLeg", childBone: "RightLeg", scale: 0.055 },
];

export function getBoneRotation(pose: BonePose, bone: string): Vec3 {
  const v = pose[bone];
  return v ? ([...v] as Vec3) : [0, 0, 0];
}
