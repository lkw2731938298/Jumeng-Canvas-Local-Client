/**
 * 分镜表上游解析：识别已连接的文本 / 图片 / 视频节点，供「提取分镜」分流。
 * 优先级：视频 > 图片 > 文本（多类型同时连接时取最高优先级）。
 */

import type { Edge, Node } from "@xyflow/react";
import { isReferenceTargetHandle } from "@/lib/canvas/referencePort";
import { resolveUpstreamScriptContent } from "@/lib/canvas/resolveUpstreamScript";
import type { WorkflowNodeData } from "@/types/workflow";

export type StoryboardUpstreamKind = "text" | "image" | "video" | "none";

export type StoryboardUpstreamMedia = {
  nodeId: string;
  assetId: string;
  fileUrl: string;
  label: string;
};

export type StoryboardUpstreamResolve = {
  kind: StoryboardUpstreamKind;
  /** 文本剧本内容（kind=text） */
  textContent: string;
  textSourceNodeId: string | null;
  videos: StoryboardUpstreamMedia[];
  images: StoryboardUpstreamMedia[];
};

function incomingSourceNodes(
  gridNodeId: string,
  edges: Edge[],
  nodes: Node[]
): Node[] {
  const ids = new Set<string>();
  for (const e of edges) {
    if (e.target !== gridNodeId) continue;
    // 优先参考口；也接受任意连到本节点的媒体/文本边
    if (!isReferenceTargetHandle(e.targetHandle) && e.targetHandle) {
      // 非参考口仍允许（兼容旧连线）
    }
    ids.add(e.source);
  }
  return nodes.filter((n) => ids.has(n.id));
}

function mediaFromNode(node: Node): StoryboardUpstreamMedia | null {
  const params = (node.data as WorkflowNodeData | undefined)?.params ?? {};
  const assetId = String(params.assetId ?? "").trim();
  const fileUrl = String(
    params.fileUrl ?? params.imageUrl ?? params.videoUrl ?? params.url ?? ""
  ).trim();
  if (!assetId && !fileUrl) return null;
  const label =
    String((node.data as WorkflowNodeData | undefined)?.label ?? "").trim() ||
    (node.type === "video_input" ? "参考视频" : "参考图");
  return {
    nodeId: node.id,
    assetId,
    fileUrl,
    label,
  };
}

/** 同步探测上游类型（不含拉 OSS 文本）；用于顶栏算力报价切换 */
export function detectStoryboardUpstreamKind(
  gridNodeId: string,
  edges: Edge[],
  nodes: Node[]
): StoryboardUpstreamKind {
  const sources = incomingSourceNodes(gridNodeId, edges, nodes);
  if (sources.some((n) => n.type === "video_input")) return "video";
  if (sources.some((n) => n.type === "image_input" || n.type === "director_stage")) {
    return "image";
  }
  if (
    sources.some((n) =>
      ["text_input", "prompt", "llm_text", "storyboard_grid"].includes(n.type ?? "")
    )
  ) {
    return "text";
  }
  return "none";
}

/** 解析分镜表上游：文 / 图 / 视频 */
export async function resolveStoryboardUpstream(
  projectId: string,
  gridNodeId: string,
  edges: Edge[],
  nodes: Node[]
): Promise<StoryboardUpstreamResolve> {
  const sources = incomingSourceNodes(gridNodeId, edges, nodes);
  const videos: StoryboardUpstreamMedia[] = [];
  const images: StoryboardUpstreamMedia[] = [];

  for (const n of sources) {
    if (n.type === "video_input") {
      const m = mediaFromNode(n);
      if (m) videos.push(m);
      continue;
    }
    if (n.type === "image_input" || n.type === "director_stage") {
      const m = mediaFromNode(n);
      if (m) images.push(m);
    }
  }

  if (videos.length > 0) {
    return {
      kind: "video",
      textContent: "",
      textSourceNodeId: null,
      videos,
      images,
    };
  }

  if (images.length > 0) {
    return {
      kind: "image",
      textContent: "",
      textSourceNodeId: null,
      videos,
      images,
    };
  }

  const text = await resolveUpstreamScriptContent(projectId, gridNodeId, edges, nodes);
  if (text.content.trim()) {
    return {
      kind: "text",
      textContent: text.content.trim(),
      textSourceNodeId: text.sourceNodeId,
      videos,
      images,
    };
  }

  return {
    kind: "none",
    textContent: "",
    textSourceNodeId: null,
    videos,
    images,
  };
}
