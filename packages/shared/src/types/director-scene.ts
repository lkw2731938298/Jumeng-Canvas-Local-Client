export type DirectorObjectShape =
  | "capsule"
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "plane"
  | "camera"
  | "model";
export type DirectorObjectKind = "character" | "prop" | "camera";
export type DirectorTransformMode = "translate" | "rotate" | "scale";
export type DirectorViewMode = "director" | "shot";
export type CameraPropViewMode = "firstPerson" | "thirdPerson";
export type DirectorAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" | "2.35:1";
export type DirectorLookAtMode = "manual" | "target";

export interface DirectorPanoramaSettings {
  assetId?: string;
  horizontalRotation: number;
  /** 全景内翻球半径（米），越大全景越远、越小越贴近场景 */
  sphereRadius: number;
}

export interface DirectorGroundSettings {
  visible: boolean;
  opacity: number;
  height: number;
}

export interface DirectorSceneSettings {
  zoom: number;
  pan: [number, number, number];
  rotate: [number, number, number];
  skyColor: string;
  panorama: DirectorPanoramaSettings | null;
  showLabels: boolean;
  gridSnap: boolean;
  ground: DirectorGroundSettings;
  aspectRatio: DirectorAspectRatio;
}

export interface DirectorCameraScreenshot {
  id: string;
  name: string;
  assetId: string;
  createdAt?: string;
}

export interface DirectorTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** 骨骼欧拉角偏移（弧度），键为 Mixamo 风格骨骼名 */
export type DirectorBonePose = Record<string, [number, number, number]>;

export type DirectorCharacterGender = "male" | "female";

export interface DirectorObject {
  id: string;
  kind: DirectorObjectKind;
  shape: DirectorObjectShape;
  name: string;
  transform: DirectorTransform;
  color: string;
  pose?: string;
  /** 关节骨骼姿势（预览版人模 rig） */
  bonePose?: DirectorBonePose;
  /** 内置人模性别 */
  gender?: DirectorCharacterGender;
  modelAssetId?: string;
  modelScale?: number;
  lookAt?: [number, number, number];
  lookAtMode?: DirectorLookAtMode;
  lookAtObjectId?: string | null;
  fov?: number;
  screenshots?: DirectorCameraScreenshot[];
  /** 系统内置人模标识（无 modelAssetId 时使用） */
  builtinModelId?: string;
}

export interface DirectorCameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface DirectorShotCamera {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  aspect: "16:9" | "9:16" | "1:1" | "4:3";
}

export interface DirectorCameraKeyframe {
  id: string;
  time: number;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface DirectorCameraTrack {
  id: string;
  duration: number;
  fps: number;
  keyframes: DirectorCameraKeyframe[];
}

export interface DirectorSceneState {
  version: "1.2";
  objects: DirectorObject[];
  camera: DirectorCameraState;
  shotCameras: DirectorShotCamera[];
  viewMode: DirectorViewMode;
  activeShotCameraId: string | null;
  lighting: {
    preset: string;
  };
  cameraTrack: DirectorCameraTrack | null;
  sceneSettings: DirectorSceneSettings;
}

export const DEFAULT_DIRECTOR_SCENE_SETTINGS: DirectorSceneSettings = {
  zoom: 100,
  pan: [0, 0, 0],
  rotate: [0, 0, 0],
  skyColor: "#12121c",
  panorama: null,
  showLabels: true,
  gridSnap: false,
  ground: { visible: true, opacity: 0.4, height: 0 },
  aspectRatio: "16:9",
};

export const DEFAULT_DIRECTOR_CAMERA: DirectorCameraState = {
  position: [5, 3, 5],
  target: [0, 0, 0],
  fov: 45,
};
