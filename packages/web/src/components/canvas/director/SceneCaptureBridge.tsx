"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { PerspectiveCamera, WebGLRenderer } from "three";
import { captureAllChannels, captureRgbOnly, captureRgbPreview } from "@/lib/director/multiChannelCapture";
import type { DirectorCaptureOptions } from "@/lib/director/multiChannelCapture";
import type { DirectorCameraState, DirectorObject } from "@/types/director-scene";

export type { DirectorCaptureResult, DirectorCaptureOptions } from "@/lib/director/multiChannelCapture";

export interface DirectorCaptureApi {
  capture: (
    cameraState?: DirectorCameraState,
    objects?: DirectorObject[],
    options?: DirectorCaptureOptions
  ) => ReturnType<typeof captureAllChannels>;
  captureRgb: (cameraState?: DirectorCameraState, options?: DirectorCaptureOptions) => string;
  captureRgbPreview: (cameraState: DirectorCameraState, hideObjectIds?: string[]) => string;
  getCurrentCamera: () => DirectorCameraState;
}

export function SceneCaptureBridge({
  onReady,
  editorTarget,
  objects,
}: {
  onReady: (api: DirectorCaptureApi) => void;
  editorTarget: [number, number, number];
  objects: DirectorObject[];
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const readyRef = useRef(onReady);
  const targetRef = useRef(editorTarget);
  const objectsRef = useRef(objects);
  readyRef.current = onReady;
  targetRef.current = editorTarget;
  objectsRef.current = objects;

  useEffect(() => {
    const renderer = gl as WebGLRenderer;
    const liveCamera = camera as PerspectiveCamera;

    readyRef.current({
      getCurrentCamera: () => {
        const cam = liveCamera;
        return {
          position: [cam.position.x, cam.position.y, cam.position.z],
          target: [...targetRef.current],
          fov: cam.fov,
        };
      },
      capture: (cameraState, objectList, options) => {
        const state: DirectorCameraState = cameraState ?? {
          position: [liveCamera.position.x, liveCamera.position.y, liveCamera.position.z],
          target: [...targetRef.current],
          fov: liveCamera.fov,
        };
        try {
          return captureAllChannels(
            renderer,
            scene,
            liveCamera,
            state,
            objectList ?? objectsRef.current,
            options
          );
        } finally {
          // 触发 View.Port 重绘，恢复主视口与镜头旁路预览
          invalidate();
        }
      },
      captureRgb: (cameraState, options) => {
        const state: DirectorCameraState = cameraState ?? {
          position: [liveCamera.position.x, liveCamera.position.y, liveCamera.position.z],
          target: [...targetRef.current],
          fov: liveCamera.fov,
        };
        try {
          return captureRgbOnly(renderer, scene, liveCamera, state, options);
        } finally {
          invalidate();
        }
      },
      captureRgbPreview: (cameraState, hideObjectIds = []) => {
        try {
          return captureRgbPreview(renderer, scene, cameraState, 320, 180, hideObjectIds);
        } finally {
          invalidate();
        }
      },
    });
  }, [gl, scene, camera, objects, invalidate]);

  return null;
}
