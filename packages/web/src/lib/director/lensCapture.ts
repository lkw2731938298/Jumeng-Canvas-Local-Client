import type { DirectorCameraState, DirectorObject, DirectorSceneState } from "@/types/director-scene";
import { cameraObjectToState } from "@/types/director-scene";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";

/** 与侧栏镜头预览 View（aspect-video）一致 */
export const LENS_CAPTURE_ASPECT = 16 / 9;
export const LENS_CAPTURE_MAX_WIDTH = 1280;

export interface DirectorCaptureOptions {
  /** 输出宽高比，默认 16:9 */
  aspect?: number;
  /** 截图时隐藏的造具 id（镜头预览会隐藏当前摄像机造具） */
  hideObjectIds?: string[];
  /** 输出最大宽度（像素） */
  maxWidth?: number;
}

export function computeLensCaptureSize(
  canvasWidth: number,
  options: Pick<DirectorCaptureOptions, "aspect" | "maxWidth"> = {}
): { width: number; height: number } {
  const aspect = options.aspect ?? LENS_CAPTURE_ASPECT;
  const maxWidth = options.maxWidth ?? LENS_CAPTURE_MAX_WIDTH;
  const width = Math.min(maxWidth, Math.max(640, canvasWidth || maxWidth));
  const height = Math.round(width / aspect);
  return { width, height };
}

/** 截图/镜头预览时隐藏全部摄像机造具，避免其他机身入画 */
export function cameraObjectIdsToHide(
  scene: DirectorSceneState,
  _activeCameraObjectId?: string | null
): string[] {
  return scene.objects.filter((o) => o.kind === "camera").map((o) => o.id);
}

export function defaultLensCaptureOptions(
  scene: DirectorSceneState,
  activeCameraObjectId?: string | null
): DirectorCaptureOptions {
  return {
    aspect: aspectRatioToNumber(scene.sceneSettings?.aspectRatio ?? "16:9"),
    maxWidth: LENS_CAPTURE_MAX_WIDTH,
    hideObjectIds: cameraObjectIdsToHide(scene, activeCameraObjectId),
  };
}

export function resolveLensCaptureCameraState(
  scene: DirectorSceneState,
  selectedCameraObject: DirectorObject | null,
  liveCamera: DirectorCameraState | null,
  activeCamera: DirectorCameraState | null
): DirectorCameraState {
  if (selectedCameraObject?.kind === "camera") {
    return liveCamera ?? cameraObjectToState(selectedCameraObject)!;
  }
  if (activeCamera) return activeCamera;
  return scene.camera;
}
