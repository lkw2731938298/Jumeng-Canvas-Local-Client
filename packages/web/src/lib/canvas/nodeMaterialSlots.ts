import type { Edge, Node } from "@xyflow/react";
import { fetchNodeText } from "@/lib/api/nodeText";
import { normalizeStorageUrl } from "@/lib/api/storageUrl";
import { resolveNodeMediaUrlWithUpstream, urlParamKeyForNodeType } from "@/lib/canvas/resolveNodeMedia";
import type { WorkflowNodeData } from "@/types/workflow";
import {
  parseTableRowsParam,
  resolveSelectedRowContent,
  rowToShotRowsJson,
} from "@/types/storyboard-table";

export type MaterialSlotType = "text" | "image" | "video" | "audio" | "file" | "link";

export interface MaterialSlot {
  nodeId: string;
  nodeType: string;
  label: string;
  type: MaterialSlotType;
  source: "upstream" | "local";
}

export interface GenerationReference {
  nodeId: string;
  type: MaterialSlotType;
  label: string;
  source?: "upstream" | "local";
  content?: string;
  url?: string;
  /** 参考视频时长（秒）：与报价 inputVideoSeconds / 后端计费对齐 */
  durationSec?: number;
}

const NODE_TYPE_SLOT_TYPE: Record<string, MaterialSlotType> = {
  text_input: "text",
  image_input: "image",
  video_input: "video",
  audio_input: "audio",
  // 文档节点默认按 file；resolve 时按 resourceKind 纠正为 link
  document_input: "file",
  prompt: "text",
  llm_text: "text",
  storyboard_grid: "text",
  director_stage: "image",
};

function formatStoryboardSlotContent(params: Record<string, unknown>): string {
  const rows = parseTableRowsParam(params.shots);
  if (rows.length === 0) return "";
  const selectedId = String(params.selectedShotId ?? "");
  const selectedText = resolveSelectedRowContent(rows, selectedId);
  if (selectedText) return selectedText;
  return JSON.stringify(
    {
      shotRows: rows.map((r) => rowToShotRowsJson(r)),
    },
    null,
    2
  );
}

function nodeData(node: Node): WorkflowNodeData {
  return node.data as WorkflowNodeData;
}

/** 参考视频计费秒数：裁剪区间优先，否则 durationSec，缺省 5（与 materialUsageBilling 对齐）。 */
function estimateReferenceVideoSeconds(node: Node): number {
  const params = nodeData(node).params ?? {};
  const trim =
    (params.inlineVideoTrim as { inSec?: number; outSec?: number } | undefined) ||
    (params.videoTrim as { inSec?: number; outSec?: number } | undefined);
  if (
    trim &&
    typeof trim.inSec === "number" &&
    typeof trim.outSec === "number" &&
    trim.outSec > trim.inSec
  ) {
    return Math.max(2, Math.min(15, Math.round(trim.outSec - trim.inSec)));
  }
  const raw = params.durationSec ?? params.duration_sec ?? params.duration;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.max(2, Math.min(15, Math.round(n)));
  }
  return 5;
}

export function slotTypeForNodeType(nodeType: string): MaterialSlotType {
  return NODE_TYPE_SLOT_TYPE[nodeType] ?? "text";
}

export function getUpstreamMaterialSlots(nodeId: string, edges: Edge[], nodes: Node[]): MaterialSlot[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const slots: MaterialSlot[] = [];

  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const upstream = nodeMap.get(edge.source);
    if (!upstream || seen.has(upstream.id)) continue;
    seen.add(upstream.id);
    const data = nodeData(upstream);
    let slotType = slotTypeForNodeType(upstream.type ?? "");
    // 文档节点按当前模式区分 file / link，便于素材槽与 @ 列表展示
    if (upstream.type === "document_input") {
      slotType = String(data.params?.resourceKind || "file") === "link" ? "link" : "file";
    }
    slots.push({
      nodeId: upstream.id,
      nodeType: upstream.type ?? "",
      label: data.label || upstream.id.slice(0, 8),
      type: slotType,
      source: "upstream",
    });
  }

  return slots;
}

export function getLocalMediaSlot(node: Node): MaterialSlot | null {
  const params = nodeData(node).params ?? {};
  const type = slotTypeForNodeType(node.type ?? "");
  if (type === "text") return null;

  if (node.type === "document_input") {
    const kind = String(params.resourceKind || "file") === "link" ? "link" : "file";
    const linkUrl = String(params.linkUrl || "").trim();
    const fileUrl = normalizeStorageUrl(String(params.fileUrl || ""));
    const assetId = String(params.assetId ?? "");
    if (kind === "link" && !linkUrl) return null;
    if (kind === "file" && !fileUrl && !assetId) return null;
    return {
      nodeId: node.id,
      nodeType: node.type ?? "",
      label: kind === "link" ? "网址" : "本地文档",
      type: kind,
      source: "local",
    };
  }

  const urlKey = type === "image" ? "imageUrl" : type === "video" ? "videoUrl" : "audioUrl";
  const url = normalizeStorageUrl((params[urlKey] as string) || "");
  const assetId = String(params.assetId ?? "");
  if (!url && !assetId) return null;

  return {
    nodeId: node.id,
    nodeType: node.type ?? "",
    label: "本地上传",
    type,
    source: "local",
  };
}

export function buildMaterialSlots(nodeId: string, edges: Edge[], nodes: Node[]): MaterialSlot[] {
  const node = nodes.find((n) => n.id === nodeId);
  const upstream = getUpstreamMaterialSlots(nodeId, edges, nodes);
  if (!node) return upstream;

  const local = getLocalMediaSlot(node);
  if (local && !upstream.some((s) => s.nodeId === local.nodeId)) {
    return [...upstream, local];
  }
  return upstream;
}

export async function resolveSlotReference(
  projectId: string,
  slot: MaterialSlot,
  nodes: Node[],
  edges: Edge[] = []
): Promise<GenerationReference> {
  const node = nodes.find((n) => n.id === slot.nodeId);
  const base: GenerationReference = {
    nodeId: slot.nodeId,
    type: slot.type,
    label: slot.label,
    source: slot.source,
  };

  if (!node) return base;

  const params = nodeData(node).params ?? {};

  if (slot.type === "text") {
    if (node.type === "storyboard_grid") {
      return { ...base, content: formatStoryboardSlotContent(params) };
    }
    let content =
      (params.content as string) ||
      (params.libraryPromptText as string) ||
      (params.prompt as string) ||
      "";
    if (projectId) {
      try {
        const record = await fetchNodeText(projectId, slot.nodeId);
        if (record?.content) content = record.content;
      } catch {
        /* use local params */
      }
    }
    return { ...base, content };
  }

  // 文档/链接：按节点参数区分 file（OSS）与 link（公网网址）
  if (node.type === "document_input") {
    const kind = String(params.resourceKind || "file") === "link" ? "link" : "file";
    if (kind === "link") {
      const link = String(params.linkUrl || "").trim();
      return { ...base, type: "link", url: link || undefined };
    }
    const urlKey = urlParamKeyForNodeType(node.type ?? "") ?? "fileUrl";
    const url = projectId
      ? await resolveNodeMediaUrlWithUpstream(projectId, slot.nodeId, urlKey, nodes, edges)
      : normalizeStorageUrl((params[urlKey] as string) || "");
    return { ...base, type: "file", url: url || undefined };
  }

  const urlKey =
    urlParamKeyForNodeType(node.type ?? "") ??
    (slot.type === "image" ? "imageUrl" : slot.type === "video" ? "videoUrl" : "audioUrl");
  const url = projectId
    ? await resolveNodeMediaUrlWithUpstream(projectId, slot.nodeId, urlKey, nodes, edges)
    : normalizeStorageUrl((params[urlKey] as string) || "");
  // 视频参考附带时长，避免提交时后端默认 5s 与前端报价秒数不一致触发 PRICING_CHANGED
  if (slot.type === "video") {
    return {
      ...base,
      url: url || undefined,
      durationSec: estimateReferenceVideoSeconds(node),
    };
  }
  return { ...base, url: url || undefined };
}

export async function resolveAllReferences(
  projectId: string,
  slots: MaterialSlot[],
  nodes: Node[],
  edges: Edge[] = []
): Promise<GenerationReference[]> {
  return Promise.all(slots.map((slot) => resolveSlotReference(projectId, slot, nodes, edges)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalize label text for fuzzy @ matching (spaces / full-width parens). */
function normalizeMentionLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim()
    .toLowerCase();
}

function mentionBoundaryChar(char: string | undefined): boolean {
  if (!char) return true;
  // 空白/中英文标点：@标签结束
  if (/[\s、，,。;；:：!！?？@()（）\[\]{}「」『』"'“”‘’/\\|….\-]/.test(char)) {
    return true;
  }
  // 中日韩字符紧跟：如 @Mia蹲着 → 在 Mia 处结束（避免整段中文被吃进标签）
  if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(char)) {
    return true;
  }
  return false;
}

function labelsFromReferences(references: Array<{ label: string }>): string[] {
  return references.map((r) => r.label).filter(Boolean);
}

function consumeKnownLabelFromRest(rest: string, label: string): boolean {
  if (rest.startsWith(label) && mentionBoundaryChar(rest.charAt(label.length))) {
    return true;
  }

  const target = normalizeMentionLabel(label);
  for (let end = 1; end <= rest.length; end++) {
    const prefix = rest.slice(0, end);
    const normalized = normalizeMentionLabel(prefix);
    if (normalized.length > target.length) break;
    if (normalized === target && mentionBoundaryChar(rest.charAt(end))) {
      return true;
    }
  }
  return false;
}

function extractMentionLabelAt(
  prompt: string,
  atIndex: number,
  knownLabels: string[]
): string | null {
  const rest = prompt.slice(atIndex + 1);
  if (!rest) return null;

  if (knownLabels.length > 0) {
    const sorted = [...knownLabels].sort((a, b) => b.length - a.length);
    for (const label of sorted) {
      if (consumeKnownLabelFromRest(rest, label)) {
        return label;
      }
    }
  }

  const fallback = rest.match(/^([^\s@]+)/);
  return fallback ? fallback[1] : null;
}

export function extractMentionLabels(
  prompt: string,
  knownLabels: string[] = []
): string[] {
  const labels: string[] = [];
  for (let i = 0; i < prompt.length; i++) {
    if (prompt[i] !== "@") continue;
    const label = extractMentionLabelAt(prompt, i, knownLabels);
    if (label) labels.push(label);
  }
  return labels;
}

/** @labels in prompt order; duplicate labels kept only on first appearance. */
export function extractMentionLabelsInOrder(
  prompt: string,
  knownLabels: string[] = []
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < prompt.length; i++) {
    if (prompt[i] !== "@") continue;
    const label = extractMentionLabelAt(prompt, i, knownLabels);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** Match @token in prompt to a material slot / upstream reference. */
export function findReferenceByMentionLabel(
  label: string,
  references: GenerationReference[]
): GenerationReference | undefined {
  const trimmed = label.trim();
  if (!trimmed) return undefined;

  const refByLabel = new Map(references.map((r) => [r.label, r]));
  const exact = refByLabel.get(trimmed);
  if (exact) return exact;

  const normalized = normalizeMentionLabel(trimmed);
  const caseInsensitive = references.find(
    (r) => normalizeMentionLabel(r.label) === normalized
  );
  if (caseInsensitive) return caseInsensitive;

  const boundaryMatches = references.filter((r) => {
    const refLabel = r.label;
    const refNorm = normalizeMentionLabel(refLabel);
    if (refNorm === normalized) return true;
    if (!refNorm.startsWith(normalized)) return false;
    const boundary = refLabel.charAt(trimmed.length);
    return mentionBoundaryChar(boundary);
  });
  if (boundaryMatches.length === 1) return boundaryMatches[0];
  if (boundaryMatches.length > 1) {
    return boundaryMatches.sort((a, b) => a.label.length - b.label.length)[0];
  }

  return references.find(
    (r) => r.nodeId === trimmed || r.nodeId.startsWith(trimmed) || trimmed.startsWith(r.nodeId.slice(0, 8))
  );
}

/** All references @mentioned in prompt order (text + image + video). */
export function collectMentionedReferences(
  draft: string,
  references: GenerationReference[]
): GenerationReference[] {
  const result: GenerationReference[] = [];
  const seenNodeIds = new Set<string>();
  const knownLabels = labelsFromReferences(references);

  for (const label of extractMentionLabelsInOrder(draft, knownLabels)) {
    const ref = findReferenceByMentionLabel(label, references);
    if (!ref || seenNodeIds.has(ref.nodeId)) continue;
    seenNodeIds.add(ref.nodeId);
    result.push(ref);
  }

  return result;
}

export function resolveMentionsInPrompt(
  prompt: string,
  references: GenerationReference[]
): { resolvedPrompt: string; usedReferences: GenerationReference[] } {
  let resolvedPrompt = prompt;
  const usedReferences = collectMentionedReferences(prompt, references);
  const knownLabels = labelsFromReferences(references);

  for (const label of extractMentionLabelsInOrder(prompt, knownLabels)) {
    const ref = findReferenceByMentionLabel(label, references);
    if (!ref || ref.type !== "text" || !ref.content) continue;
    const pattern = new RegExp(`@${escapeRegExp(label)}`, "g");
    resolvedPrompt = resolvedPrompt.replace(pattern, ref.content);
  }

  return { resolvedPrompt, usedReferences };
}

/** Pick references for generation: @mentions first, else connected upstream image/video. */
export function collectGenerationReferences(
  draft: string,
  references: GenerationReference[]
): GenerationReference[] {
  const mentioned = collectMentionedReferences(draft, references);
  if (mentioned.length > 0) return mentioned;

  // Auto-pick only upstream-connected media; never the current node's own local upload/output.
  // 含文档 file / 网址 link，供万相 3.0 等模型参考
  const upstreamMedia = references.filter(
    (r) =>
      (r.type === "image" || r.type === "video" || r.type === "file" || r.type === "link") &&
      r.source !== "local"
  );
  if (upstreamMedia.length > 0) return upstreamMedia;

  return [];
}

function isUpstreamMediaReference(ref: GenerationReference): boolean {
  return (
    (ref.type === "image" || ref.type === "video" || ref.type === "audio") &&
    ref.source !== "local" &&
    Boolean(ref.url?.trim())
  );
}

/** 画布模型是否为多模态参考生视频（r2v）。 */
export function isVideoR2vModel(model: { category?: string; name?: string; displayName?: string; upstreamModel?: string; parameters?: Record<string, unknown> } | null | undefined): boolean {
  if (!model || model.category !== "video") return false;
  const mode = model.parameters?.videoMode;
  if (mode === "r2v") return true;
  if (mode === "t2v" || mode === "i2v") return false;
  const caps = model.parameters?.capabilities;
  if (Array.isArray(caps) && caps.map(String).includes("reference_to_video")) return true;
  const blob = `${model.name || ""} ${model.displayName || ""} ${model.upstreamModel || ""}`.toLowerCase();
  // 仅明确多模态/参考生；聚梦 minimax-h3/discount 不支持参考视频，勿误判为 r2v
  if (/_r2v|reference.?to.?video|seedance|multimodal-to-video/.test(blob)) return true;
  return false;
}

/**
 * 视频 r2v：@ 提及的参考优先，仍合并全部上游图/视频/音频。
 * 聚梦/RH/Seedance 等多模态模型需要完整 references，不能只提交 prompt 里 @ 到的那一张。
 */
export function collectVideoR2vReferences(
  draft: string,
  references: GenerationReference[]
): GenerationReference[] {
  const upstreamMedia = references.filter(isUpstreamMediaReference);
  const mentioned = collectMentionedReferences(draft, references).filter((r) =>
    Boolean(r.url?.trim())
  );
  if (upstreamMedia.length === 0) return mentioned;
  if (mentioned.length === 0) return upstreamMedia;

  const seen = new Set<string>();
  const merged: GenerationReference[] = [];
  for (const ref of [...mentioned, ...upstreamMedia]) {
    if (seen.has(ref.nodeId)) continue;
    seen.add(ref.nodeId);
    merged.push(ref);
  }
  return merged;
}

/** Validate @mentions and media URLs before submit; returns user-facing error or null. */
export function validateGenerationReferences(
  draft: string,
  allReferences: GenerationReference[],
  pickedReferences: GenerationReference[]
): string | null {
  const knownLabels = labelsFromReferences(allReferences);
  const mentionLabels = extractMentionLabelsInOrder(draft, knownLabels);
  for (const label of mentionLabels) {
    const ref = findReferenceByMentionLabel(label, allReferences);
    if (!ref) {
      return `提示词中的 @${label} 未匹配到上游节点，请用输入框 @ 列表选择`;
    }
  }

  for (const ref of pickedReferences) {
    if (
      (ref.type === "image" ||
        ref.type === "video" ||
        ref.type === "file" ||
        ref.type === "link") &&
      !ref.url?.trim()
    ) {
      return `参考「${ref.label}」暂无可用媒体地址，请确认节点已上传或填写网址`;
    }
  }

  return null;
}

function mentionTokenLengthInPrompt(prompt: string, atIndex: number, label: string): number {
  const rest = prompt.slice(atIndex + 1);
  if (rest.startsWith(label)) {
    return 1 + label.length;
  }
  const target = normalizeMentionLabel(label);
  for (let end = 1; end <= rest.length; end++) {
    if (normalizeMentionLabel(rest.slice(0, end)) === target) {
      return 1 + end;
    }
  }
  return 1 + label.length;
}

/** 仅匹配已知素材槽标签的 @mention 区间（不含尾随空格） */
export function findKnownMentionRanges(
  prompt: string,
  knownLabels: string[]
): Array<{ start: number; end: number; label: string }> {
  if (!prompt || knownLabels.length === 0) return [];
  const knownSet = new Set(knownLabels);
  const ranges: Array<{ start: number; end: number; label: string }> = [];
  let i = 0;
  while (i < prompt.length) {
    if (prompt[i] === "@") {
      const label = extractMentionLabelAt(prompt, i, knownLabels);
      if (label && knownSet.has(label)) {
        const end = i + mentionTokenLengthInPrompt(prompt, i, label);
        ranges.push({ start: i, end, label });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return ranges;
}

export type PromptMentionToken =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; label: string };

/** 将提示词拆成普通文本 + 已识别 @参考，供输入框高亮层渲染 */
export function tokenizePromptMentions(
  prompt: string,
  knownLabels: string[]
): PromptMentionToken[] {
  if (!prompt) return [];
  const ranges = findKnownMentionRanges(prompt, knownLabels);
  if (ranges.length === 0) return [{ kind: "text", text: prompt }];

  const tokens: PromptMentionToken[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      tokens.push({ kind: "text", text: prompt.slice(cursor, range.start) });
    }
    tokens.push({
      kind: "mention",
      text: prompt.slice(range.start, range.end),
      label: range.label,
    });
    cursor = range.end;
  }
  if (cursor < prompt.length) {
    tokens.push({ kind: "text", text: prompt.slice(cursor) });
  }
  return tokens;
}

/**
 * Backspace / Delete 时整段删除一个已识别的 @参考。
 * 与 insertMention 对称：尾随空格一并删掉（若存在）。
 */
export function getAtomicMentionDeleteRange(
  prompt: string,
  cursor: number,
  direction: "backward" | "forward",
  knownLabels: string[]
): { start: number; end: number } | null {
  const ranges = findKnownMentionRanges(prompt, knownLabels);
  if (ranges.length === 0) return null;

  const expandTrailingSpace = (end: number) => (prompt[end] === " " ? end + 1 : end);

  if (direction === "backward") {
    // 光标在 mention 内部或紧挨 mention 结束（含尾随空格）
    for (const range of ranges) {
      const deleteEnd = expandTrailingSpace(range.end);
      if (cursor > range.start && cursor <= deleteEnd) {
        return { start: range.start, end: deleteEnd };
      }
    }
    return null;
  }

  for (const range of ranges) {
    const deleteEnd = expandTrailingSpace(range.end);
    if (cursor >= range.start && cursor < deleteEnd) {
      return { start: range.start, end: deleteEnd };
    }
  }
  return null;
}

/** Remove @label tokens from the prompt before sending to the API. */
export function stripMentionTokens(prompt: string, references: GenerationReference[]): string {
  const knownLabels = labelsFromReferences(references);
  let result = "";
  let i = 0;

  while (i < prompt.length) {
    if (prompt[i] === "@") {
      const label = extractMentionLabelAt(prompt, i, knownLabels);
      if (label && findReferenceByMentionLabel(label, references)) {
        i += mentionTokenLengthInPrompt(prompt, i, label);
        while (prompt[i] === " ") i += 1;
        continue;
      }
    }
    result += prompt[i];
    i += 1;
  }

  return result.trim();
}

export function parseMentionQuery(
  draft: string,
  cursorPos: number
): { query: string; start: number } | null {
  const before = draft.slice(0, cursorPos);
  const match = before.match(/@([^\s@]*)$/);
  if (!match) return null;
  return { query: match[1], start: cursorPos - match[0].length };
}

export function insertMention(
  draft: string,
  start: number,
  cursorPos: number,
  label: string
): { nextDraft: string; nextCursor: number } {
  const mention = `@${label} `;
  const nextDraft = draft.slice(0, start) + mention + draft.slice(cursorPos);
  return { nextDraft, nextCursor: start + mention.length };
}

export function filterSlotsForMention(slots: MaterialSlot[], query: string): MaterialSlot[] {
  const q = query.toLowerCase();
  if (!q) return slots;
  return slots.filter(
    (s) => s.label.toLowerCase().includes(q) || s.nodeType.toLowerCase().includes(q)
  );
}
