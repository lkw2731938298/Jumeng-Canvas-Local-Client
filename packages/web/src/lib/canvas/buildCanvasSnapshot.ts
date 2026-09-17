/**
 * 构建发给 Agent 的画布快照：全量目录（无正文）+ 焦点节点短正文。
 * 另附 liveParams 供后端 inspect 读未保存的 prompt/content，不注入 LLM 目录。
 */

import type { Edge, Node } from "@xyflow/react";

import type {
  CanvasSnapshot,
  CanvasSnapshotFocusedContent,
} from "@/lib/api/agentSessions";
import { getAgentCanvasMediaModels } from "@/lib/canvas/agentCanvasMediaModels";
import { useCanvasStore } from "@/stores/canvasStore";
import { parseTableRowsParam } from "@/types/storyboard-table";

/** 目录尽量全量；焦点节点永远保留，即使超过此上限 */
const MAX_NODES = 800;
const MAX_EDGES = 1200;
/** 焦点 prompt/content 各最多约 1500 字；文档/长文本 2k */
const FOCUSED_TEXT_MAX = 1500;
const FOCUSED_DOC_TEXT_MAX = 2000;
const DOC_FOCUS_TYPES = new Set(["document_input", "text_input"]);
/** liveParams 总预算，避免大图把请求体撑爆 */
const MAX_LIVE_CHARS = 100000;
const SHOT_PREVIEW_ROWS = 6;
const SHOT_FIELD_MAX = 160;
const MAX_DIAG = 12;

function focusedTextMax(type: string): number {
  return DOC_FOCUS_TYPES.has(type) ? FOCUSED_DOC_TEXT_MAX : FOCUSED_TEXT_MAX;
}

function truncatePreview(raw: string, max: number): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function isStoryboardNode(n: Node, label: string): boolean {
  if (String(n.type || "") === "storyboard_grid") return true;
  return (
    label.includes("故事板") ||
    label.includes("调度故事板") ||
    /storyboard/i.test(label)
  );
}

function compactGenerationOptions(
  rawGo: unknown
): Record<string, string> | undefined {
  if (!rawGo || typeof rawGo !== "object" || Array.isArray(rawGo)) return undefined;
  const go: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawGo as Record<string, unknown>).slice(0, 16)) {
    if (v == null) continue;
    const key = String(k).trim();
    if (!key) continue;
    go[key] = String(v).trim();
  }
  return Object.keys(go).length > 0 ? go : undefined;
}

function shotCountOf(params: Record<string, unknown>, isBoard: boolean): number | undefined {
  const rows = parseTableRowsParam(params.shots);
  if (rows.length > 0) return rows.length;
  if (!isBoard) return undefined;
  const n = Number(params.shotCount);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return undefined;
}

function mapOneNode(
  n: Node,
  focused: boolean
): CanvasSnapshot["nodes"][number] {
  const data = (n.data || {}) as Record<string, unknown>;
  const params = (data.params || {}) as Record<string, unknown>;
  const assetId = String(params.assetId || "").trim();
  const hasMedia = Boolean(
    params.imageUrl || params.videoUrl || params.audioUrl || assetId
  );
  const model = String(params.model || "").trim();
  const generationOptions = compactGenerationOptions(params.generationOptions);
  const label = String(data.label || "");
  const isBoard = isStoryboardNode(n, label);
  const shotCount = shotCountOf(params, isBoard);
  const status = String(data.status || "").trim() || undefined;
  const lastError =
    truncatePreview(String(params.lastError || ""), 160) || undefined;

  const x = Number.isFinite(n.position?.x) ? Math.round(n.position.x) : undefined;
  const y = Number.isFinite(n.position?.y) ? Math.round(n.position.y) : undefined;

  return {
    id: n.id,
    type: String(n.type || ""),
    label,
    ...(x != null ? { x } : {}),
    ...(y != null ? { y } : {}),
    hasMedia,
    assetId: assetId || undefined,
    model: model || undefined,
    generationOptions,
    status,
    lastError,
    ...(shotCount != null ? { shotCount } : {}),
    ...(focused ? { focused: true } : {}),
    ...(isBoard ? { role: "storyboard_sheet" as const } : {}),
  };
}

function mapFocusedContent(n: Node): CanvasSnapshotFocusedContent {
  const data = (n.data || {}) as Record<string, unknown>;
  const params = (data.params || {}) as Record<string, unknown>;
  const label = String(data.label || "");
  const isBoard = isStoryboardNode(n, label);
  const textMax = focusedTextMax(String(n.type || ""));
  const prompt =
    truncatePreview(String(params.prompt || ""), textMax) || undefined;
  const content =
    truncatePreview(String(params.content || ""), textMax) || undefined;
  const shotCount = shotCountOf(params, isBoard);
  const rows = parseTableRowsParam(params.shots);
  const shotsPreview =
    rows.length > 0
      ? rows.slice(0, SHOT_PREVIEW_ROWS).map((r) => ({
          shotNo: r.shotNo || undefined,
          duration: r.duration || undefined,
          description: truncatePreview(r.description || "", SHOT_FIELD_MAX) || undefined,
          dialogue: truncatePreview(r.dialogue || "", SHOT_FIELD_MAX) || undefined,
        }))
      : undefined;
  const generationOptions = compactGenerationOptions(params.generationOptions);
  return {
    id: n.id,
    label: label || undefined,
    type: String(n.type || "") || undefined,
    prompt,
    content,
    ...(shotCount != null ? { shotCount } : {}),
    ...(shotsPreview?.length ? { shotsPreview } : {}),
    generationOptions,
  };
}

/** 目录节点现场正文，供 inspect 读未保存改动；不进入 LLM 目录文本。 */
function buildLiveParams(
  listed: Array<{ n: Node; focused: boolean }>
): Record<string, CanvasSnapshotFocusedContent> {
  const out: Record<string, CanvasSnapshotFocusedContent> = {};
  let used = 0;
  const ordered = [
    ...listed.filter((x) => x.focused),
    ...listed.filter((x) => !x.focused),
  ];
  for (const { n } of ordered) {
    const entry = mapFocusedContent(n);
    if (
      !entry.prompt &&
      !entry.content &&
      !entry.shotCount &&
      !(entry.shotsPreview && entry.shotsPreview.length)
    ) {
      continue;
    }
    const cost =
      (entry.prompt?.length || 0) +
      (entry.content?.length || 0) +
      JSON.stringify(entry.shotsPreview || []).length;
    if (used + cost > MAX_LIVE_CHARS && Object.keys(out).length > 0) {
      break;
    }
    out[n.id] = entry;
    used += cost;
  }
  return out;
}

function buildDiagnostics(
  nodes: Node[],
  edges: Edge[]
): Pick<CanvasSnapshot, "failedNodes" | "brokenEdges" | "missingAssetHints"> {
  const idSet = new Set(nodes.map((n) => n.id));
  const failedNodes: NonNullable<CanvasSnapshot["failedNodes"]> = [];
  const missingAssetHints: NonNullable<CanvasSnapshot["missingAssetHints"]> = [];
  const inbound = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.target) continue;
    const list = inbound.get(e.target) || [];
    list.push(e.source);
    inbound.set(e.target, list);
  }

  for (const n of nodes) {
    const data = (n.data || {}) as Record<string, unknown>;
    const params = (data.params || {}) as Record<string, unknown>;
    const label = String(data.label || "");
    const status = String(data.status || "");
    if (status === "error" && failedNodes.length < MAX_DIAG) {
      failedNodes.push({
        id: n.id,
        label: label || undefined,
        reason:
          truncatePreview(String(params.lastError || "generation_failed"), 120) ||
          "generation_failed",
      });
    }
    const type = String(n.type || "");
    const isMedia =
      type === "image_input" || type === "video_input" || type === "audio_input";
    const hasMedia = Boolean(
      params.imageUrl || params.videoUrl || params.audioUrl || params.assetId
    );
    if (
      isMedia &&
      !hasMedia &&
      missingAssetHints.length < MAX_DIAG
    ) {
      const ups = inbound.get(n.id) || [];
      const upHasMedia = ups.some((sid) => {
        const sn = nodes.find((x) => x.id === sid);
        if (!sn) return false;
        const p = ((sn.data as Record<string, unknown>)?.params ||
          {}) as Record<string, unknown>;
        return Boolean(p.imageUrl || p.videoUrl || p.audioUrl || p.assetId);
      });
      missingAssetHints.push({
        id: n.id,
        label: label || undefined,
        kind: ups.length && !upHasMedia ? "no_upstream_ref" : "no_media",
      });
    }
  }

  const brokenEdges: NonNullable<CanvasSnapshot["brokenEdges"]> = [];
  for (const e of edges) {
    if (brokenEdges.length >= MAX_DIAG) break;
    if (!idSet.has(e.source)) {
      brokenEdges.push({
        source: e.source,
        target: e.target,
        reason: "missing_source",
      });
    } else if (!idSet.has(e.target)) {
      brokenEdges.push({
        source: e.source,
        target: e.target,
        reason: "missing_target",
      });
    }
  }

  return {
    ...(failedNodes.length ? { failedNodes } : {}),
    ...(brokenEdges.length ? { brokenEdges } : {}),
    ...(missingAssetHints.length ? { missingAssetHints } : {}),
  };
}

export type BuildCanvasSnapshotOptions = {
  priorityNodeIds?: Iterable<string>;
  nodes?: Node[];
  edges?: Edge[];
};

/**
 * 从当前画布（或传入 nodes/edges）生成 CanvasSnapshot。
 * 每次思考须现取；禁止把上一轮返回对象缓存后再发给后端。
 */
export function buildCanvasSnapshot(
  options: BuildCanvasSnapshotOptions = {}
): CanvasSnapshot {
  const fromStore = useCanvasStore.getState();
  const nodes = options.nodes ?? fromStore.nodes;
  const edges = options.edges ?? fromStore.edges;
  const prefs = getAgentCanvasMediaModels();

  const selectedPriority: string[] = [];
  if (fromStore.selectedNodeId) selectedPriority.push(fromStore.selectedNodeId);
  for (const id of fromStore.selectedFlowIds || []) {
    if (id) selectedPriority.push(id);
  }

  const priority = new Set<string>();
  for (const id of [...selectedPriority, ...(options.priorityNodeIds || [])]) {
    const s = String(id || "").trim();
    if (s) priority.add(s);
  }

  const indexed = nodes.map((n, i) => ({ n, i, focused: priority.has(n.id) }));
  const focusedItems = indexed.filter((x) => x.focused);
  const restItems = indexed.filter((x) => !x.focused);
  // 有焦点时：其余按与焦点质心的距离近→远，减少大图截断漏掉周边节点
  if (focusedItems.length) {
    let sx = 0;
    let sy = 0;
    for (const { n } of focusedItems) {
      sx += n.position?.x ?? 0;
      sy += n.position?.y ?? 0;
    }
    const cx = sx / focusedItems.length;
    const cy = sy / focusedItems.length;
    restItems.sort((a, b) => {
      const ax = a.n.position?.x ?? 0;
      const ay = a.n.position?.y ?? 0;
      const bx = b.n.position?.x ?? 0;
      const by = b.n.position?.y ?? 0;
      const dA = (ax - cx) ** 2 + (ay - cy) ** 2;
      const dB = (bx - cx) ** 2 + (by - cy) ** 2;
      if (dA !== dB) return dA - dB;
      return a.i - b.i;
    });
  } else {
    restItems.sort((a, b) => a.i - b.i);
  }
  // 焦点永远保留；其余填满目录上限
  const restCap = Math.max(0, MAX_NODES - focusedItems.length);
  const listed = [...focusedItems, ...restItems.slice(0, restCap)];
  const mapped = listed.map(({ n, focused }) => mapOneNode(n, focused));

  const focusedContent = focusedItems
    .map(({ n }) => mapFocusedContent(n))
    .filter((item) =>
      Boolean(
        item.prompt ||
          item.content ||
          item.shotCount ||
          (item.shotsPreview && item.shotsPreview.length)
      )
    );
  const liveParams = buildLiveParams(listed);

  const edgeIndexed = edges.map((e, i) => {
    const touch = priority.has(e.source) || priority.has(e.target);
    return { e, i, touch };
  });
  edgeIndexed.sort((a, b) => {
    if (a.touch !== b.touch) return a.touch ? -1 : 1;
    return a.i - b.i;
  });
  const listedEdges = edgeIndexed.slice(0, MAX_EDGES);

  const omittedNodes = Math.max(0, nodes.length - listed.length);
  const omittedEdges = Math.max(0, edges.length - listedEdges.length);
  const truncated = omittedNodes > 0 || omittedEdges > 0;
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    ...(truncated
      ? {
          truncated: true,
          omittedNodeCount: omittedNodes,
          omittedEdgeCount: omittedEdges,
        }
      : {}),
    nodes: mapped,
    ...(focusedContent.length ? { focusedContent } : {}),
    ...(Object.keys(liveParams).length ? { liveParams } : {}),
    edges: listedEdges.map(({ e }) => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
    preferredImageModel: prefs.imageModel,
    preferredVideoModel: prefs.videoModel,
    ...buildDiagnostics(nodes, edges),
  };
}

/**
 * 每次思考强制从 store 现取最新快照（不接受传入 nodes/edges，避免沿用缓存）。
 */
export function takeFreshCanvasSnapshot(
  options: Omit<BuildCanvasSnapshotOptions, "nodes" | "edges"> = {}
): CanvasSnapshot {
  return buildCanvasSnapshot({
    priorityNodeIds: options.priorityNodeIds,
  });
}
