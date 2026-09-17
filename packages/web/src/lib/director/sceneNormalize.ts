import type { DirectorSceneState, DirectorObject } from "@/types/director-scene";
import type { DirectorPanoramaSettings } from "@jumeng-canvas/shared";
import { createDefaultDirectorScene, DEFAULT_DIRECTOR_SCENE_SETTINGS } from "@/types/director-scene";
import { createDefaultCameraTrack } from "@/lib/director/cameraTrack";
import { createDefaultBonePose } from "@/lib/director/poseRig";
import { rotationFromPositionLookAt } from "@/lib/director/shotPreview";

function reconcileCameraObject(obj: DirectorObject): DirectorObject {
  if (obj.kind !== "camera") return obj;

  const lookAt = obj.lookAt ?? [0, 1, 0];
  const position = obj.transform.position;

  return {
    ...obj,
    lookAt,
    fov: obj.fov ?? 45,
    transform: {
      ...obj.transform,
      rotation: rotationFromPositionLookAt(position, lookAt),
    },
  };
}

function isMannequinObject(obj: DirectorObject): boolean {
  return (
    obj.kind === "character" &&
    (obj.builtinModelId === "mannequin_male" ||
      obj.builtinModelId === "mannequin_female" ||
      obj.builtinModelId === "humanoid_robot")
  );
}

function reconcileCharacterObject(obj: DirectorObject): DirectorObject {
  if (obj.kind !== "character") return obj;

  let next = obj;

  if (obj.builtinModelId === "humanoid_robot") {
    next = {
      ...obj,
      builtinModelId: "mannequin_male",
      gender: "male",
      bonePose: obj.bonePose ?? createDefaultBonePose("male"),
    };
  }

  if (next.builtinModelId?.startsWith("mannequin_") && !next.bonePose) {
    const gender = next.builtinModelId === "mannequin_female" ? "female" : "male";
    next = { ...next, gender: next.gender ?? gender, bonePose: createDefaultBonePose(gender) };
  }

  // 人模脚底对齐场地：y 过低会陷进地面导致看不见
  if (isMannequinObject(next) && next.transform.position[1] < 0) {
    const [x, , z] = next.transform.position;
    next = {
      ...next,
      transform: {
        ...next.transform,
        position: [x, 0, z],
      },
    };
  }

  return next;
}

/** 旧版 verticalOffset 迁移为 sphereRadius（默认 80） */
function normalizePanoramaSettings(raw: unknown): DirectorPanoramaSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<DirectorPanoramaSettings> & { verticalOffset?: number };
  if (!p.assetId) return null;
  return {
    assetId: p.assetId,
    horizontalRotation: p.horizontalRotation ?? 0,
    sphereRadius: p.sphereRadius ?? 80,
  };
}

/** Migrate persisted scenes to the latest schema. */
export function normalizeDirectorScene(raw: unknown): DirectorSceneState {
  if (!raw || typeof raw !== "object") {
    return createDefaultDirectorScene();
  }
  const data = raw as Partial<DirectorSceneState> & { version?: string };
  const defaults = createDefaultDirectorScene();

  const camera = data.camera ?? defaults.camera;
  const objects = Array.isArray(data.objects) ? data.objects : defaults.objects;

  const base: DirectorSceneState = {
    version: "1.2",
    objects: objects.map((obj) => {
      const withDefaults = {
        ...obj,
        pose: obj.kind === "character" ? (obj.pose ?? "standing") : obj.pose,
        modelAssetId: obj.kind === "character" ? obj.modelAssetId : undefined,
        modelScale: obj.kind === "character" ? (obj.modelScale ?? 1) : undefined,
        lookAt: obj.kind === "camera" ? (obj.lookAt ?? [0, 1, 0]) : obj.lookAt,
        lookAtMode: obj.kind === "camera" ? (obj.lookAtMode ?? "manual") : obj.lookAtMode,
        lookAtObjectId: obj.kind === "camera" ? (obj.lookAtObjectId ?? null) : obj.lookAtObjectId,
        fov: obj.kind === "camera" ? (obj.fov ?? 45) : obj.fov,
        screenshots: obj.kind === "camera" ? (obj.screenshots ?? []) : obj.screenshots,
      };
      return reconcileCameraObject(reconcileCharacterObject(withDefaults));
    }),
    camera: {
      position: camera.position ?? defaults.camera.position,
      target: camera.target ?? defaults.camera.target,
      fov: camera.fov ?? defaults.camera.fov,
    },
    shotCameras: Array.isArray(data.shotCameras) ? data.shotCameras : [],
    viewMode: data.viewMode === "shot" ? "shot" : "director",
    activeShotCameraId: data.activeShotCameraId ?? null,
    lighting: {
      preset: data.lighting?.preset ?? "classic_three_point",
    },
    cameraTrack: data.cameraTrack ?? null,
    sceneSettings: {
      ...DEFAULT_DIRECTOR_SCENE_SETTINGS,
      ...(data.sceneSettings ?? {}),
      ground: {
        ...DEFAULT_DIRECTOR_SCENE_SETTINGS.ground,
        ...(data.sceneSettings?.ground ?? {}),
      },
      panorama: normalizePanoramaSettings(data.sceneSettings?.panorama),
    },
  };

  if (base.viewMode === "shot" && base.activeShotCameraId) {
    const exists = base.shotCameras.some((c) => c.id === base.activeShotCameraId);
    if (!exists) {
      base.viewMode = "director";
      base.activeShotCameraId = null;
    }
  }

  if (base.cameraTrack && !Array.isArray(base.cameraTrack.keyframes)) {
    base.cameraTrack = createDefaultCameraTrack();
  }

  return base;
}
