/**
 * 媒体节点类型互转（图片 / 视频 / 音频）。
 * AI 操控「用图片替换视频节点」时须先改卡片类型，再绑素材，避免视频节点上挂图片。
 */

import type { AssetCategory } from "@/lib/api/assets";
import { fetchAssetById } from "@/lib/api/assets";
import { NODE_REGISTRY } from "@/types/node-registry";
import { useCanvasStore } from "@/stores/canvasStore";
import type { Edge } from "@xyflow/react";

export type MediaNodeType = "image_input" | "video_input" | "audio_input";

const MEDIA_TYPES = new Set<string>(["image_input", "video_input", "audio_input"]);

const TYPE_BY_CATEGORY: Record<string, MediaNodeType> = {
  image: "image_input",
  video: "video_input",
  audio: "audio_input",
};

const URL_KEY: Record<MediaNodeType, string> = {
  image_input: "imageUrl",
  video_input: "videoUrl",
  audio_input: "audioUrl",
};

const SOURCE_HANDLE: Record<MediaNodeType, string> = {
  image_input: "image",
  video_input: "video",
  audio_input: "audio",
};

export function isMediaNodeType(type: string | undefined | null): type is MediaNodeType {
  return Boolean(type && MEDIA_TYPES.has(type));
}

export function mediaNodeTypeForCategory(category: AssetCategory | string): MediaNodeType | null {
  return TYPE_BY_CATEGORY[String(category || "").trim()] ?? null;
}

/** 从 params 里的 URL 字段推断目标媒体类型（键存在即视为意图，含空字符串） */
export function inferMediaTypeFromUrlKeys(params: Record<string, unknown>): MediaNodeType | null {
  if ("imageUrl" in params) return "image_input";
  if ("videoUrl" in params) return "video_input";
  if ("audioUrl" in params) return "audio_input";
  return null;
}

/**
 * 解析 Agent 写入媒体时应落到的节点类型。
 * 优先用 assetId 查素材 category（最可靠），其次看 imageUrl/videoUrl/audioUrl 键。
 */
export async function resolveTargetMediaType(
  projectId: string,
  params: Record<string, unknown>
): Promise<MediaNodeType | null> {
  const assetId = String(params.assetId ?? "").trim();
  if (assetId && projectId) {
    try {
      const asset = await fetchAssetById(projectId, assetId);
      if (asset) {
        const byCat = mediaNodeTypeForCategory(asset.category);
        if (byCat) return byCat;
      }
    } catch {
      /* 查库失败时回退 URL 键 */
    }
  }
  return inferMediaTypeFromUrlKeys(params);
}

/**
 * 将已有媒体节点改为目标类型：更新 type / 句柄 / 清理错配 URL，保留 assetId 与 prompt。
 * @returns 是否发生了类型变更
 */
export function convertMediaNodeType(nodeId: string, targetType: MediaNodeType): boolean {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const fromType = node.type || "";
  if (fromType === targetType) return false;
  if (!isMediaNodeType(fromType) || !isMediaNodeType(targetType)) return false;

  const def = NODE_REGISTRY[targetType];
  if (!def) return false;

  const oldHandle = SOURCE_HANDLE[fromType];
  const newHandle = SOURCE_HANDLE[targetType];
  const oldUrlKey = URL_KEY[fromType];
  const newUrlKey = URL_KEY[targetType];

  const prevParams = (node.data?.params || {}) as Record<string, unknown>;
  const nextParams: Record<string, unknown> = { ...prevParams };

  // 旧预览 URL 迁到新键（若新键尚无值）；再清掉其它媒体 URL 键
  const migratedUrl = String(nextParams[oldUrlKey] ?? "").trim();
  delete nextParams.imageUrl;
  delete nextParams.videoUrl;
  delete nextParams.audioUrl;
  if (migratedUrl && !String(nextParams[newUrlKey] ?? "").trim()) {
    nextParams[newUrlKey] = migratedUrl;
  }

  // 模型按品类绑定，换类型后清掉以免视频模型留在图片节点上
  delete nextParams.model;

  const nextEdges: Edge[] = store.edges.map((e) => {
    if (e.source !== nodeId) return e;
    if (e.sourceHandle === oldHandle || e.sourceHandle == null || e.sourceHandle === "") {
      return { ...e, sourceHandle: newHandle };
    }
    // 历史脏数据：源句柄写成了错误的媒体类型时一并纠正
    if (
      e.sourceHandle === "image" ||
      e.sourceHandle === "video" ||
      e.sourceHandle === "audio"
    ) {
      return { ...e, sourceHandle: newHandle };
    }
    return e;
  });

  useCanvasStore.setState({
    nodes: store.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            type: targetType,
            data: {
              ...n.data,
              params: nextParams,
              inputs: def.inputs,
              outputs: def.outputs,
            },
          }
        : n
    ),
    edges: nextEdges,
  });

  useCanvasStore.getState().scheduleAutoSave();
  return true;
}
