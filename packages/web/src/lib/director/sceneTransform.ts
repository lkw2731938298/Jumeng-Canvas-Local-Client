"use client";

import type { DirectorObject, DirectorSceneSettings, DirectorSceneState } from "@/types/director-scene";
import { rotationFromPositionLookAt } from "@/lib/director/shotPreview";

/** 导演自由视角轨道目标：场景物件中心（约人模腰部高度） */
export function computeDirectorOrbitTarget(scene: DirectorSceneState): [number, number, number] {
  const props = scene.objects.filter((o) => o.kind !== "camera");
  if (props.length === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const o of props) {
    sx += o.transform.position[0];
    sy += o.transform.position[1];
    sz += o.transform.position[2];
  }
  const n = props.length;
  return [sx / n, sy / n + 0.9, sz / n];
}

/** 根据注视目标造具同步摄像机朝向 */
export function resolveCameraLookAt(
  camera: DirectorObject,
  objects: DirectorObject[]
): [number, number, number] | null {
  if (camera.kind !== "camera") return null;
  if (camera.lookAtMode === "target" && camera.lookAtObjectId) {
    const target = objects.find((o) => o.id === camera.lookAtObjectId);
    if (target) return [...target.transform.position] as [number, number, number];
  }
  return camera.lookAt ?? null;
}

export function applyCameraLookAtTargets(objects: DirectorObject[]): DirectorObject[] {
  return objects.map((obj) => {
    if (obj.kind !== "camera" || obj.lookAtMode !== "target" || !obj.lookAtObjectId) return obj;
    const lookAt = resolveCameraLookAt(obj, objects);
    if (!lookAt) return obj;
    return {
      ...obj,
      lookAt,
      transform: {
        ...obj.transform,
        rotation: rotationFromPositionLookAt(obj.transform.position, lookAt),
      },
    };
  });
}

export function sceneGroupTransform(settings: DirectorSceneSettings) {
  const scale = (settings.zoom ?? 100) / 100;
  const [rx, ry, rz] = settings.rotate;
  return {
    position: settings.pan,
    rotation: [(rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180] as [
      number,
      number,
      number,
    ],
    scale: [scale, scale, scale] as [number, number, number],
  };
}
