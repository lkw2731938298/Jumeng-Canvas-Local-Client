import type { StoryboardGenStatus } from "@/types/storyboard-subjects";
import type { StoryboardSketchStatus, StoryboardTableRow } from "@/types/storyboard-table";

export function isStoryboardGenActive(status?: StoryboardGenStatus | StoryboardSketchStatus): boolean {
  return status === "running" || status === "pending";
}

export function isStoryboardRowGenerating(row: StoryboardTableRow): boolean {
  return (
    isStoryboardGenActive(row.sketchStatus) ||
    isStoryboardGenActive(row.cameraPromptStatus) ||
    isStoryboardGenActive(row.videoPromptStatus) ||
    isStoryboardGenActive(row.videoStatus)
  );
}

export const STORYBOARD_ROW_GENERATING_CLASS =
  "bg-purple-500/[0.1] shadow-[inset_0_0_0_1px_rgba(192,132,252,0.45)] animate-pulse";

export const STORYBOARD_CELL_GENERATING_OVERLAY_CLASS =
  "absolute inset-0 z-[1] flex flex-col items-center justify-center gap-0.5 bg-purple-950/75 backdrop-blur-[1px]";
