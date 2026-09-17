"use client";

import { useCanvasStore } from "@/stores/canvasStore";

/** Whether hover/selection should drive video preview playback. */
export function canPreviewMediaPlayback(
  hovered: boolean,
  selected: boolean,
  framePickActive: boolean,
  isCanvasDragging: boolean
): boolean {
  if (isCanvasDragging || framePickActive) return false;
  return hovered || selected;
}

/** Reactive hook wrapper for components that already track hover in state. */
export function useMediaNodeActive(selected: boolean, hovered: boolean, framePickActive: boolean): boolean {
  const isCanvasDragging = useCanvasStore((s) => s.isCanvasDragging);
  return canPreviewMediaPlayback(hovered, selected, framePickActive, isCanvasDragging);
}
