import { apiFetch } from "./client";

export interface CanvasVoiceItem {
  id: string;
  name: string;
  voiceId: string;
  lang: string;
  gender: string;
  kind: "library" | "cloned";
  ttsModel: string;
  cloneId?: string;
  favorite?: boolean;
}

export interface VoicesListResponse {
  library: CanvasVoiceItem[];
  mine: CanvasVoiceItem[];
  voices: CanvasVoiceItem[];
}

/** 拉取音色库 / 我的复刻音色 */
export function listVoices(tab?: "library" | "mine" | "favorite" | "all") {
  const qs = tab && tab !== "all" ? `?tab=${encodeURIComponent(tab)}` : "";
  return apiFetch<VoicesListResponse>(`/api/v1/voices${qs}`);
}

/** 百炼声音复刻 */
export function cloneVoice(body: {
  audioUrl?: string;
  displayName: string;
  prefix?: string;
  language?: string;
  gender?: string;
  sourceAssetId?: string;
  projectId?: string;
}) {
  return apiFetch<CanvasVoiceItem>("/api/v1/voices/clone", {
    method: "POST",
    body: JSON.stringify({
      audioUrl: body.audioUrl,
      displayName: body.displayName,
      prefix: body.prefix,
      language: body.language ?? "zh",
      gender: body.gender,
      sourceAssetId: body.sourceAssetId,
      projectId: body.projectId,
    }),
  });
}

export function setVoiceFavorite(cloneId: string | number, favorite: boolean) {
  return apiFetch(`/api/v1/voices/mine/${cloneId}/favorite`, {
    method: "PATCH",
    body: JSON.stringify({ favorite }),
  });
}

export function deleteVoiceClone(cloneId: string | number) {
  return apiFetch(`/api/v1/voices/mine/${cloneId}`, { method: "DELETE" });
}
