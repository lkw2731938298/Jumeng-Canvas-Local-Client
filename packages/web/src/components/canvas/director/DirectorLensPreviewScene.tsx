"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import { PerspectiveCamera as DreiPerspectiveCamera } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import type { PerspectiveCamera } from "three";
import { cameraObjectToState } from "@/types/director-scene";
import type { DirectorCameraState, DirectorObject, DirectorSceneState } from "@/types/director-scene";
import { DirectorStageEnvironment } from "./DirectorStageEnvironment";

/** LibTV 方案：独立镜头相机，每帧同步造具位姿，仅渲染 layer 0 造具 */
function LensShotCamera({
  cameraId,
  objects,
  liveCameraRef,
}: {
  cameraId: string;
  objects: DirectorObject[];
  liveCameraRef: MutableRefObject<DirectorCameraState | null>;
}) {
  const camRef = useRef<PerspectiveCamera>(null);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  useFrame(() => {
    const obj = objectsRef.current.find((o) => o.id === cameraId);
    if (!obj) return;

    const live = liveCameraRef.current;
    const fallback = cameraObjectToState(obj);
    if (!fallback && !live) return;

    const state = live ?? fallback!;
    const cam = camRef.current;
    if (!cam) return;
    cam.position.set(...state.position);
    cam.lookAt(...state.target);
    cam.fov = state.fov;
    cam.near = 0.1;
    // 与主视口一致：全景球半径最大 500，fog≈半径×2.5
    cam.far = 1500;
    cam.layers.set(0);
    cam.updateProjectionMatrix();
  });

  return <DreiPerspectiveCamera ref={camRef} makeDefault near={0.1} far={200} fov={45} />;
}

export interface DirectorLensPreviewSceneProps {
  scene: DirectorSceneState;
  cameraId: string;
  liveCameraRef: MutableRefObject<DirectorCameraState | null>;
  resolveCharacterModelUrl?: (object: DirectorObject) => string | null;
}

export function DirectorLensPreviewScene({
  scene,
  cameraId,
  liveCameraRef,
  resolveCharacterModelUrl,
  panoramaUrl = null,
}: DirectorLensPreviewSceneProps & { panoramaUrl?: string | null }) {
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
      <LensShotCamera cameraId={cameraId} objects={scene.objects} liveCameraRef={liveCameraRef} />
      <DirectorStageEnvironment
        scene={previewScene}
        panoramaUrl={panoramaUrl}
        interactive={false}
        resolveCharacterModelUrl={resolveCharacterModelUrl}
      />
    </>
  );
}
