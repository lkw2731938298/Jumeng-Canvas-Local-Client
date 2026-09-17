import type { CharacterPoseId } from "@/lib/director/characterPoses";
import type { LightingPresetId } from "@/lib/director/lightingPresets";
import { interpolateCameraTrack } from "@/lib/director/cameraTrack";
import { rotationFromPositionLookAt } from "@/lib/director/shotPreview";
import { createDefaultBonePose } from "@/lib/director/poseRig";
import type {
  CameraPropViewMode,
  DirectorAspectRatio,
  DirectorCameraKeyframe,
  DirectorCameraScreenshot,
  DirectorCameraState,
  DirectorCameraTrack,
  DirectorLookAtMode,
  DirectorObject as SharedDirectorObject,
  DirectorObjectKind,
  DirectorObjectShape,
  DirectorSceneSettings,
  DirectorSceneState as SharedDirectorSceneState,
  DirectorShotCamera,
  DirectorTransform,
  DirectorTransformMode,
  DirectorViewMode,
} from "@jumeng-canvas/shared";
import { DEFAULT_DIRECTOR_CAMERA, DEFAULT_DIRECTOR_SCENE_SETTINGS } from "@jumeng-canvas/shared";
import { allocateDirectorObjectName } from "@/lib/director/objectNaming";

export type DirectorObject = Omit<SharedDirectorObject, "pose" | "lighting"> & {
  pose?: CharacterPoseId;
};

export type DirectorSceneState = Omit<SharedDirectorSceneState, "objects" | "lighting"> & {
  objects: DirectorObject[];
  lighting: { preset: LightingPresetId };
};

export type {
  CameraPropViewMode,
  DirectorAspectRatio,
  DirectorCameraKeyframe,
  DirectorCameraScreenshot,
  DirectorCameraState,
  DirectorCameraTrack,
  DirectorLookAtMode,
  DirectorObjectKind,
  DirectorObjectShape,
  DirectorSceneSettings,
  DirectorShotCamera,
  DirectorTransform,
  DirectorTransformMode,
  DirectorViewMode,
};

export { DEFAULT_DIRECTOR_SCENE_SETTINGS };

export { DEFAULT_DIRECTOR_CAMERA };

export function createDefaultDirectorScene(): DirectorSceneState {
  return {
    version: "1.2",
    objects: [
      {
        id: `obj_${Date.now()}`,
        kind: "character",
        shape: "model",
        name: "角色1",
        color: "#a5b4fc",
        builtinModelId: "mannequin_male",
        gender: "male",
        bonePose: createDefaultBonePose("male"),
        modelScale: 1,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ],
    camera: { ...DEFAULT_DIRECTOR_CAMERA },
    shotCameras: [],
    viewMode: "director",
    activeShotCameraId: null,
    lighting: { preset: "classic_three_point" },
    cameraTrack: null,
    sceneSettings: { ...DEFAULT_DIRECTOR_SCENE_SETTINGS },
  };
}

export function newDirectorObject(
  kind: DirectorObjectKind,
  shape: DirectorObjectShape,
  existing: DirectorObject[]
): DirectorObject {
  const offset = existing.length * 1.5;
  if (kind === "camera") {
    return newDirectorCameraObject(existing, offset);
  }
  const resolvedShape: DirectorObjectShape = kind === "character" ? "model" : shape;
  return {
    id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    shape: resolvedShape,
    name: allocateDirectorObjectName(existing, { kind, shape: resolvedShape }),
    color: kind === "character" ? "#a5b4fc" : "#94a3b8",
    pose: kind === "character" ? "standing" : undefined,
    modelScale: kind === "character" ? 1 : undefined,
    transform: {
      position: [
        offset,
        ["sphere", "box", "cylinder", "cone", "plane"].includes(resolvedShape) ? 0.5 : 1,
        0,
      ],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };
}

export function newDirectorCameraObject(
  existing: DirectorObject[],
  offsetX = 0,
  from?: DirectorCameraState
): DirectorObject {
  const position: [number, number, number] = from
    ? [...from.position]
    : [3 + offsetX, 2, 5 + offsetX * 0.5];
  const lookAt: [number, number, number] = from ? [...from.target] : [0, 1, 0];
  const transform = {
    position,
    rotation: rotationFromPositionLookAt(position, lookAt),
    scale: [1, 1, 1] as [number, number, number],
  };
  return {
    id: `camobj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "camera",
    shape: "camera",
    name: allocateDirectorObjectName(existing, { kind: "camera", shape: "camera" }),
    color: "#f59e0b",
    lookAt,
    lookAtMode: from ? "manual" : "manual",
    lookAtObjectId: null,
    fov: from?.fov ?? 45,
    screenshots: [],
    transform,
  };
}

export function cameraObjectToState(obj: DirectorObject): DirectorCameraState | null {
  if (obj.kind !== "camera") return null;
  const lookAt = obj.lookAt ?? [0, 1, 0];
  return {
    position: [...obj.transform.position],
    target: [...lookAt],
    fov: obj.fov ?? 45,
  };
}

export function newShotCamera(index: number, from: DirectorCameraState): DirectorShotCamera {
  return {
    id: `cam_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: `机位 ${index + 1}`,
    position: [...from.position],
    target: [...from.target],
    fov: from.fov,
    aspect: "16:9",
  };
}

export function shotCameraToState(shot: DirectorShotCamera): DirectorCameraState {
  return {
    position: [...shot.position],
    target: [...shot.target],
    fov: shot.fov,
  };
}

export function resolveActiveCamera(
  scene: DirectorSceneState,
  trackTime?: number | null
): DirectorCameraState {
  if (trackTime != null && scene.cameraTrack && scene.cameraTrack.keyframes.length > 0) {
    return interpolateCameraTrack(scene.cameraTrack, trackTime);
  }
  if (scene.viewMode === "shot" && scene.activeShotCameraId) {
    const shot = scene.shotCameras.find((c) => c.id === scene.activeShotCameraId);
    if (shot) return shotCameraToState(shot);
  }
  return scene.camera;
}
