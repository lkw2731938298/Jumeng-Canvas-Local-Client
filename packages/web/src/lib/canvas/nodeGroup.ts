/**
 * 画布节点成组：几何常量、AABB、快照序列化（组库保存 / 拖回）。
 */
import type { Edge, Node, XYPosition } from "@xyflow/react";
import type { WorkflowNodeData } from "@/types/workflow";
import { resolveNodeSize, resolveNodeSizeUnbounded } from "@/lib/canvas/nodeSizing";
import { NODE_REGISTRY } from "@/types/node-registry";

export type AppNode = Node<WorkflowNodeData>;

/** 组框水平内边距（含左右） */
export const GROUP_PAD_X = 28;
/** 组框顶部内边距（含标题条） */
export const GROUP_PAD_TOP = 44;
/** 组框底部内边距 */
export const GROUP_PAD_BOTTOM = 28;

/** 一期禁止入组的节点类型（嵌套组允许 node_group 作为成员） */
export const GROUP_BLACKLIST = new Set<string>([]);

/** 折叠后组框高度（仅标题条） */
export const GROUP_COLLAPSED_HEIGHT = 44;

export interface GroupSnapshotNode {
  tempId: string;
  type: string;
  position: XYPosition;
  width?: number;
  height?: number;
  data: WorkflowNodeData;
  parentTempId?: string;
}

export interface GroupSnapshotEdge {
  sourceTempId: string;
  targetTempId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface GroupSnapshotAsset {
  assetId: string;
  category?: string;
  title?: string;
  subcategory?: string;
}

/** 组库 OSS 快照结构 */
export interface GroupSnapshot {
  version: 1;
  title: string;
  group: {
    label: string;
    width: number;
    height: number;
    padding: { x: number; top: number; bottom: number };
  };
  groupNode: GroupSnapshotNode;
  nodes: GroupSnapshotNode[];
  edges: GroupSnapshotEdge[];
  assets: GroupSnapshotAsset[];
}

export function isGroupNode(node: AppNode | undefined | null): boolean {
  return node?.type === "node_group";
}

/**
 * React Flow 要求父节点出现在子节点之前，否则 parentId 子流失效。
 * 按嵌套深度稳定排序（同深度保持原相对顺序）。
 */
export function sortNodesParentsFirst(nodes: AppNode[]): AppNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached != null) return cached;
    const seen = new Set<string>();
    let d = 0;
    let pid = byId.get(id)?.parentId;
    while (pid && byId.has(pid) && !seen.has(pid)) {
      seen.add(pid);
      d += 1;
      pid = byId.get(pid)?.parentId;
    }
    depthCache.set(id, d);
    return d;
  };
  return nodes
    .map((n, index) => ({ n, index }))
    .sort((a, b) => {
      const dd = depthOf(a.n.id) - depthOf(b.n.id);
      return dd !== 0 ? dd : a.index - b.index;
    })
    .map(({ n }) => n);
}

export function getNodeSize(node: AppNode): { width: number; height: number } {
  if (node.type === "storyboard_grid" || node.type === "node_group") {
    return resolveNodeSizeUnbounded(node.width, node.height);
  }
  return resolveNodeSize(node.width, node.height);
}

/** 将节点坐标解算为世界坐标（支持一层 parentId） */
export function getAbsolutePosition(node: AppNode, nodes: AppNode[]): XYPosition {
  if (!node.parentId) return { ...node.position };
  const parent = nodes.find((n) => n.id === node.parentId);
  if (!parent) return { ...node.position };
  const pp = getAbsolutePosition(parent, nodes);
  return { x: node.position.x + pp.x, y: node.position.y + pp.y };
}

export function computeMembersAabb(
  memberIds: string[],
  nodes: AppNode[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hit = false;
  for (const id of memberIds) {
    const n = nodes.find((x) => x.id === id);
    if (!n) continue;
    // 嵌套组：组节点本身参与外层 AABB（不再跳过 isGroupNode）
    const abs = getAbsolutePosition(n, nodes);
    const { width, height } = getNodeSize(n);
    hit = true;
    minX = Math.min(minX, abs.x);
    minY = Math.min(minY, abs.y);
    maxX = Math.max(maxX, abs.x + width);
    maxY = Math.max(maxY, abs.y + height);
  }
  if (!hit) return null;
  return { minX, minY, maxX, maxY };
}

export function aabbToGroupGeometry(aabb: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): { position: XYPosition; width: number; height: number } {
  return {
    position: { x: aabb.minX - GROUP_PAD_X, y: aabb.minY - GROUP_PAD_TOP },
    width: aabb.maxX - aabb.minX + GROUP_PAD_X * 2,
    height: aabb.maxY - aabb.minY + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
  };
}

/** 收集成员节点上的项目素材 id */
export function collectAssetIdsFromNodes(nodes: AppNode[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const raw = n.data?.params?.assetId;
    const id = raw != null ? String(raw).trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** 收集组的直接成员 + 嵌套组内全部后代（用于快照） */
export function collectGroupSubtree(groupId: string, nodes: AppNode[]): AppNode[] {
  const direct = nodes.filter((n) => n.parentId === groupId);
  const out: AppNode[] = [...direct];
  for (const n of direct) {
    if (isGroupNode(n)) {
      out.push(...collectGroupSubtree(n.id, nodes));
    }
  }
  return out;
}

export function isGroupLocked(node: AppNode | undefined | null): boolean {
  return Boolean(node?.data?.locked);
}

export function isGroupCollapsed(node: AppNode | undefined | null): boolean {
  return Boolean(node?.data?.collapsed);
}

/** 从画布组节点构建组库快照（支持嵌套组） */
export function buildGroupSnapshot(
  groupId: string,
  nodes: AppNode[],
  edges: Edge[],
  title?: string
): GroupSnapshot | null {
  const group = nodes.find((n) => n.id === groupId && isGroupNode(n));
  if (!group) return null;
  const directIds = Array.isArray(group.data.memberIds)
    ? (group.data.memberIds as string[]).filter((id) => typeof id === "string")
    : nodes.filter((n) => n.parentId === groupId).map((n) => n.id);
  const directMembers = directIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is AppNode => Boolean(n));
  if (directMembers.length < 1) return null;

  const subtree = collectGroupSubtree(groupId, nodes);
  const label = String(group.data.label || title || "未命名组");
  const { width, height } = getNodeSize(group);

  const snapshotNodes: GroupSnapshotNode[] = subtree.map((m) => {
    const params = { ...(m.data.params ?? {}) };
    for (const key of ["imageUrl", "videoUrl", "audioUrl"] as const) {
      if (params.assetId && key in params) delete params[key];
    }
    const size = getNodeSize(m);
    const memberIds = isGroupNode(m) && Array.isArray(m.data.memberIds)
      ? (m.data.memberIds as string[])
      : undefined;
    return {
      tempId: m.id,
      type: m.type || "text_input",
      position: { ...m.position },
      width: size.width,
      height: size.height,
      data: {
        ...m.data,
        params,
        label: m.data.label,
        inputs: m.data.inputs ?? [],
        outputs: m.data.outputs ?? [],
        status: m.data.status ?? "idle",
        ...(memberIds ? { memberIds } : {}),
      },
      parentTempId: m.parentId || group.id,
    };
  });

  const subtreeIds = new Set(subtree.map((n) => n.id));
  const snapshotEdges: GroupSnapshotEdge[] = edges
    .filter((e) => subtreeIds.has(e.source) && subtreeIds.has(e.target))
    .map((e) => ({
      sourceTempId: e.source,
      targetTempId: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));

  const assets: GroupSnapshotAsset[] = collectAssetIdsFromNodes(subtree).map((assetId) => ({
    assetId,
  }));

  return {
    version: 1,
    title: title?.trim() || label,
    group: {
      label,
      width,
      height,
      padding: { x: GROUP_PAD_X, top: GROUP_PAD_TOP, bottom: GROUP_PAD_BOTTOM },
    },
    groupNode: {
      tempId: group.id,
      type: "node_group",
      position: { x: 0, y: 0 },
      width,
      height,
      data: {
        label,
        params: {},
        inputs: [],
        outputs: [],
        status: "idle",
        memberIds: directIds,
        locked: Boolean(group.data.locked),
        collapsed: Boolean(group.data.collapsed),
      },
    },
    nodes: snapshotNodes,
    edges: snapshotEdges,
    assets,
  };
}

/** 媒体类节点：保存组库时用于校验是否绑定了项目素材 */
export const GROUP_MEDIA_NODE_TYPES = new Set(["image_input", "video_input", "audio_input"]);


/** 列出组内未绑定 assetId 的媒体节点标签（保存前提示） */
export function listUnboundMediaLabels(members: AppNode[]): string[] {
  const labels: string[] = [];
  for (const n of members) {
    if (!GROUP_MEDIA_NODE_TYPES.has(n.type || "")) continue;
    const assetId = String(n.data?.params?.assetId ?? "").trim();
    if (assetId) continue;
    labels.push(String(n.data?.label || n.type || "媒体节点"));
  }
  return labels;
}

/**
 * 从官方轻量模板生成组快照（无素材，落盘后带组框）。
 * nodes 的 position 为世界坐标草稿，会归一化为相对组内坐标。
 */
export function buildOfficialTemplateSnapshot(input: {
  id: string;
  label: string;
  nodes: { type: string; position: XYPosition }[];
  edges: {
    source: number;
    target: number;
    sourceHandle?: string;
    targetHandle?: string;
  }[];
}): GroupSnapshot {
  const tempIds = input.nodes.map((_, i) => `${input.id}_n${i}`);
  const absNodes = input.nodes.map((n, i) => {
    const size = resolveNodeSize();
    return {
      tempId: tempIds[i],
      type: n.type,
      abs: n.position,
      width: size.width,
      height: size.height,
    };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of absNodes) {
    minX = Math.min(minX, n.abs.x);
    minY = Math.min(minY, n.abs.y);
    maxX = Math.max(maxX, n.abs.x + n.width);
    maxY = Math.max(maxY, n.abs.y + n.height);
  }
  const geom = aabbToGroupGeometry({ minX, minY, maxX, maxY });
  const groupTempId = `${input.id}_g0`;

  const snapshotNodes: GroupSnapshotNode[] = absNodes.map((n) => ({
    tempId: n.tempId,
    type: n.type,
    position: {
      x: n.abs.x - geom.position.x,
      y: n.abs.y - geom.position.y,
    },
    width: n.width,
    height: n.height,
    data: {
      label: NODE_REGISTRY[n.type]?.label || n.type,
      params: {},
      inputs: NODE_REGISTRY[n.type]?.inputs ?? [],
      outputs: NODE_REGISTRY[n.type]?.outputs ?? [],
      status: "idle",
    },
    parentTempId: groupTempId,
  }));

  return {
    version: 1,
    title: input.label,
    group: {
      label: input.label,
      width: geom.width,
      height: geom.height,
      padding: { x: GROUP_PAD_X, top: GROUP_PAD_TOP, bottom: GROUP_PAD_BOTTOM },
    },
    groupNode: {
      tempId: groupTempId,
      type: "node_group",
      position: { x: 0, y: 0 },
      width: geom.width,
      height: geom.height,
      data: {
        label: input.label,
        params: {},
        inputs: [],
        outputs: [],
        status: "idle",
        memberIds: tempIds,
      },
    },
    nodes: snapshotNodes,
    edges: input.edges.map((e) => ({
      sourceTempId: tempIds[e.source],
      targetTempId: tempIds[e.target],
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
    assets: [],
  };
}
