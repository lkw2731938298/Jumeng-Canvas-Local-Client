"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { PerspectiveCamera as DreiPerspectiveCamera } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import { resolveDirectorCameraWorldPose } from "@/lib/director/cameraWorldPose";
import { DIRECTOR_CAMERA_FAR, DIRECTOR_CAMERA_NEAR } from "./DirectorCameraFrustum";
import type { DirectorObject, DirectorSceneState, DirectorTransform } from "@/types/director-scene";
import { DirectorStageEnvironment } from "./DirectorStageEnvironment";

/**
 * 独立镜头相机：位姿与造具视锥完全一致（rotation + 场景 group），
 * 画幅宽高比锁定为场景 aspectRatio（与截图 / 视锥一致）。
 */
function LensShotCamera({
  cameraId,
  objects,
  settings,
  liveTransformRef,
  filmAspect,
}: {
  cameraId: string;
  objects: DirectorObject[];
  settings: DirectorSceneState["sceneSettings"];
  liveTransformRef: MutableRefObject<{ id: string; transform: DirectorTransform } | null>;
  filmAspect: number;
}) {
  const camRef = useRef<PerspectiveCamera>(null);
  const objectsRef = useRef(objects);
  const settingsRef = useRef(settings);
  objectsRef.current = objects;
  settingsRef.current = settings;

  useFrame(() => {
    const cam = camRef.current;
    if (!cam) return;

    const live = liveTransformRef.current;
    const liveTransform = live?.id === cameraId ? live.transform : null;
    const pose = resolveDirectorCameraWorldPose(
      cameraId,
      objectsRef.current,
      settingsRef.current,
      liveTransform
    );
    if (!pose) return;

    cam.position.set(...pose.position);
    cam.rotation.set(...pose.rotation);
    cam.fov = pose.fov;
    // 与截图 / 视锥一致：锁定场景画幅（track 亦为同比例）
    cam.aspect = filmAspect;
    cam.near = DIRECTOR_CAMERA_NEAR;
    cam.far = Math.max(DIRECTOR_CAMERA_FAR, 1500);
    cam.layers.set(0);
    cam.updateProjectionMatrix();
  });

  return (
    <DreiPerspectiveCamera
      ref={camRef}
      makeDefault
      near={DIRECTOR_CAMERA_NEAR}
      far={1500}
      fov={45}
      aspect={filmAspect}
    />
  );
}

export interface DirectorLensPreviewSceneProps {
  scene: DirectorSceneState;
  cameraId: string;
  /** 拖拽摄像机造具时的临时 transform，保证监视器与视锥同步 */
  liveTransformRef: MutableRefObject<{ id: string; transform: DirectorTransform } | null>;
  resolveCharacterModelUrl?: (object: DirectorObject) => string | null;
  resolveColorMapUrl?: (object: DirectorObject) => string | null;
}

export function DirectorLensPreviewScene({
  scene,
  cameraId,
  liveTransformRef,
  resolveCharacterModelUrl,
  resolveColorMapUrl,
  panoramaUrl = null,
}: DirectorLensPreviewSceneProps & { panoramaUrl?: string | null }) {
  const filmAspect = aspectRatioToNumber(scene.sceneSettings?.aspectRatio ?? "16:9");
  const previewScene = useMemo(
    () => ({
      ...scene,
      // 镜头预览不渲染任何摄像机造具
      objects: scene.objects.filter((o) => o.kind !== "camera"),
    }),
    [scene]
  );

  return (
    <>
      <LensShotCamera
        cameraId={cameraId}
        objects={scene.objects}
        settings={scene.sceneSettings}
        liveTransformRef={liveTransformRef}
        filmAspect={filmAspect}
      />
      <DirectorStageEnvironment
        scene={previewScene}
        panoramaUrl={panoramaUrl}
        interactive={false}
        resolveCharacterModelUrl={resolveCharacterModelUrl}
        resolveColorMapUrl={resolveColorMapUrl}
      />
    </>
  );
}
