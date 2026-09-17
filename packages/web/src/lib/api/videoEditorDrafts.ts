/** 项目级剪辑台时间线草稿（OSS），跨浏览器可恢复 */

import { apiFetch } from "@/lib/api/client";
import type { TimelineClip } from "@/lib/canvas/videoEditorTimeline";

export interface VideoEditorDraftRecord {
  projectId: string;
  clips: TimelineClip[];
  trackCount?: number | null;
  audioTrackCount?: number | null;
  ossKey: string;
  updatedAt: string;
}

export async function fetchVideoEditorDraft(
  projectId: string
): Promise<VideoEditorDraftRecord> {
  return apiFetch<VideoEditorDraftRecord>(
    `/api/v1/video-editor-drafts/projects/${projectId}`
  );
}

export async function saveVideoEditorDraft(
  projectId: string,
  payload: {
    clips: TimelineClip[];
    trackCount?: number;
    audioTrackCount?: number;
  }
): Promise<VideoEditorDraftRecord> {
  return apiFetch<VideoEditorDraftRecord>(
    `/api/v1/video-editor-drafts/projects/${projectId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        clips: payload.clips,
        trackCount: payload.trackCount,
        audioTrackCount: payload.audioTrackCount,
      }),
    }
  );
}

export async function deleteVideoEditorDraft(projectId: string): Promise<void> {
  await apiFetch(`/api/v1/video-editor-drafts/projects/${projectId}`, {
    method: "DELETE",
  });
}

/** 从 Project Graph 镜头骨架写入剪辑台草稿（Agent assemble_timeline） */
export async function assembleVideoEditorFromGraph(
  projectId: string,
  opts?: { replace?: boolean }
): Promise<{
  projectId: string;
  skipped: boolean;
  reason?: string;
  clipCount: number;
  videoClipCount: number;
  audioClipCount: number;
  missedShots: number;
  message: string;
  openEditor: boolean;
  updatedAt?: string;
}> {
  return apiFetch(
    `/api/v1/video-editor-drafts/projects/${projectId}/assemble-from-graph`,
    {
      method: "POST",
      body: JSON.stringify({ replace: Boolean(opts?.replace) }),
    }
  );
}
