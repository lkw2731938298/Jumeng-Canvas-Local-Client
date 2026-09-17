/**
 * AI 会话旁白：进度文案 / 生成素材回传到聊天框（skill_progress）。
 */

import {
  postAgentSessionMessage,
  type MediaAssetItem,
  type MediaAssetsArtifact,
} from "@/lib/api/agentSessions";
import { getEditorConfig, isEditorNodeType } from "@/lib/canvas/nodeEditorConfig";
import { useCanvasStore } from "@/stores/canvasStore";

/** 从画布节点读取可展示素材（assetId + 预览 URL） */
export function collectNodeMediaItem(nodeId: string): MediaAssetItem | null {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const params = (node.data?.params ?? {}) as Record<string, unknown>;
  const assetId = String(params.assetId ?? "").trim();
  const config = isEditorNodeType(node.type) ? getEditorConfig(node.type) : null;
  const urlKey = config?.urlParamKey || "";
  const urlFromKey = urlKey ? String(params[urlKey] ?? "").trim() : "";
  const imageUrl = String(params.imageUrl ?? "").trim();
  const videoUrl = String(params.videoUrl ?? "").trim();
  const audioUrl = String(params.audioUrl ?? "").trim();
  const url = urlFromKey || imageUrl || videoUrl || audioUrl;
  if (!assetId && !url) return null;

  let category: MediaAssetItem["category"] = "image";
  if (node.type === "video_input" || Boolean(videoUrl) || urlKey === "videoUrl") {
    category = "video";
  } else if (node.type === "audio_input" || Boolean(audioUrl) || urlKey === "audioUrl") {
    category = "audio";
  }

  const name = String(node.data?.label ?? "").trim() || undefined;
  return {
    assetId: assetId || undefined,
    url: url || undefined,
    category,
    title: name,
    nodeId,
    nodeName: name,
  };
}

/** 批量从节点 ID 收集素材 */
export function collectNodeMediaItems(nodeIds: string[]): MediaAssetItem[] {
  const out: MediaAssetItem[] = [];
  const seen = new Set<string>();
  for (const id of nodeIds) {
    const item = collectNodeMediaItem(id);
    if (!item) continue;
    const key = item.assetId || item.url || item.nodeId || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 通知面板立刻刷新会话消息 */
function bumpAgentSession(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  window.dispatchEvent(
    new CustomEvent("agent-session-invalidate", { detail: { sessionId } })
  );
}

/** 向会话追加助手旁白（可带 media_assets） */
export async function narrateAgentSession(
  sessionId: string,
  content: string,
  opts?: {
    done?: boolean;
    mediaItems?: MediaAssetItem[];
  }
): Promise<void> {
  const text = (content || "").trim();
  const items = (opts?.mediaItems || []).filter(
    (it) => Boolean(it?.assetId || it?.url)
  );
  if (!sessionId || (!text && items.length === 0)) return;

  const artifacts: MediaAssetsArtifact[] | undefined =
    items.length > 0
      ? [{ kind: "media_assets", items }]
      : undefined;

  try {
    await postAgentSessionMessage(sessionId, {
      message: text || (items.length > 0 ? "已生成素材" : ""),
      action: opts?.done ? "skill_done" : "skill_progress",
      artifacts,
    });
    bumpAgentSession(sessionId);
  } catch {
    /* 旁白失败不阻断主流程 */
  }
}
