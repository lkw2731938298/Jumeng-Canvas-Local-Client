/**
 * AI 对话「引用画布节点」：序列化 / 反序列化，对齐附件行格式。
 * 消息前缀：`[节点:名称|nodeId=xxx|type=image_input]`
 */

import type { Node } from "@xyflow/react";
import { NODE_REGISTRY } from "@/types/node-registry";
import type { WorkflowNodeData } from "@/types/workflow";
import { urlParamKeyForNodeType } from "@/lib/canvas/resolveNodeMedia";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";

/** 聊天框内展示的节点引用整块 */
export type AgentNodeRef = {
  nodeId: string;
  label: string;
  nodeType: string;
  /** 缩略图预览（可能为空） */
  thumbUrl?: string;
  /** 已挂素材 id（若有） */
  assetId?: string;
  /** 是否有媒体 */
  hasMedia?: boolean;
};

const NODE_REF_RE =
  /\[节点:([^\]|]*)\|nodeId=([0-9a-zA-Z_-]{1,128})(?:\|type=([0-9a-zA-Z_-]+))?(?:\|assetId=([0-9a-zA-Z_-]{1,128}))?\]/gi;

export function typeLabelForNode(type: string): string {
  return NODE_REGISTRY[type]?.label || type || "节点";
}

/** 从画布节点构造引用整块（含缩略图 URL 猜测） */
export function buildAgentNodeRef(
  node: Node,
  lookup?: (assetId: string) => { fileUrl?: string; thumbnailUrl?: string } | undefined
): AgentNodeRef {
  const data = node.data as WorkflowNodeData | undefined;
  const params = (data?.params || {}) as Record<string, unknown>;
  const label = String(data?.label || typeLabelForNode(node.type || "")).trim() || "节点";
  const nodeType = String(node.type || "");
  const assetId = String(params.assetId ?? "").trim() || undefined;
  const urlKey = urlParamKeyForNodeType(nodeType);
  let thumbUrl = "";
  if (assetId && lookup) {
    const asset = lookup(assetId);
    thumbUrl = ensureHttpsOssUrl(asset?.thumbnailUrl || asset?.fileUrl || "") || "";
  }
  if (!thumbUrl && urlKey) {
    thumbUrl = ensureHttpsOssUrl(String(params[urlKey] ?? "").trim()) || "";
  }
  const hasMedia = Boolean(assetId || thumbUrl);
  return {
    nodeId: node.id,
    label,
    nodeType,
    thumbUrl: thumbUrl || undefined,
    assetId,
    hasMedia,
  };
}

/** 序列化为一行（发给 Agent） */
export function serializeAgentNodeRef(ref: AgentNodeRef): string {
  const name = ref.label.replace(/[|\]]/g, " ").trim() || "节点";
  const type = (ref.nodeType || "").replace(/[|\]]/g, "") || "unknown";
  const asset = (ref.assetId || "").replace(/[|\]]/g, "").trim();
  const assetBit = asset ? `|assetId=${asset}` : "";
  return `[节点:${name}|nodeId=${ref.nodeId}|type=${type}${assetBit}]`;
}

export function serializeAgentNodeRefs(refs: AgentNodeRef[]): string {
  return refs.map(serializeAgentNodeRef).join("\n");
}

/** 从用户消息解析节点引用 */
export function parseAgentNodeRefsFromText(text: string): AgentNodeRef[] {
  const out: AgentNodeRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(NODE_REF_RE)) {
    const nodeId = (m[2] || "").trim();
    if (!nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);
    out.push({
      nodeId,
      label: (m[1] || "").trim() || "节点",
      nodeType: (m[3] || "").trim() || "unknown",
      assetId: (m[4] || "").trim() || undefined,
    });
  }
  return out;
}

/** 拼进发送文案：引用行在上，正文在下 */
export function buildMessageWithNodeRefs(text: string, refs: AgentNodeRef[]): string {
  const body = text.trim();
  if (!refs.length) return body;
  const lines = serializeAgentNodeRefs(refs);
  return body ? `${lines}\n${body}` : lines;
}
