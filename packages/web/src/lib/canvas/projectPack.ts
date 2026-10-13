/**
 * 画布工程打包：整项目导出为 zip（结构 + 媒体），再合并导入当前项目。
 * 不含 API Key / Base URL 等敏感配置；导入一律新 ID。
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { Edge } from "@xyflow/react";
import type { AppNode } from "@/lib/canvas/nodeGroup";
import type { WorkflowNodeData } from "@/types/workflow";
import { NODE_REGISTRY } from "@/types/node-registry";
import {
  fetchProjectAssetManifest,
  notifyAssetsUpdated,
  uploadAsset,
  type Asset,
  type AssetCategory,
} from "@/lib/api/assets";
import { fetchNodeText, saveNodeText } from "@/lib/api/nodeText";
import { localStore } from "@/lib/local/store";
import { useCanvasStore } from "@/stores/canvasStore";

export const PROJECT_PACK_FORMAT = "jumeng-canvas-project-v1";
export const PROJECT_PACK_EXT = ".zip";

const EPHEMERAL_URL_KEYS = ["imageUrl", "videoUrl", "audioUrl"] as const;
const SECRET_KEY_RE =
  /^(api[_-]?key|secret|token|password|authorization|credential|access[_-]?key|private[_-]?key)$/i;

/** 媒体输入节点 → 预览 URL 字段 / 素材分类（导入补绑、导出写回 assetId） */
const MEDIA_NODE_URL_KEY: Record<string, (typeof EPHEMERAL_URL_KEYS)[number]> = {
  image_input: "imageUrl",
  video_input: "videoUrl",
  audio_input: "audioUrl",
};
const MEDIA_NODE_CATEGORY: Record<string, AssetCategory> = {
  image_input: "image",
  video_input: "video",
  audio_input: "audio",
};

/**
 * 历史本地视频落盘曾用 `{nodeId}-{ts}.mp4` 且未写回 assetId；
 * 导出时又清掉 videoUrl，导致包内有视频文件、节点 params 却为空。
 * 导入时按旧节点 ID 前缀把孤儿素材绑回去。
 */
function findOrphanAssetOldId(
  oldNodeId: string,
  category: AssetCategory | undefined,
  assetMap: Record<string, string>,
  categoryByOldId: Record<string, AssetCategory>,
  usedOldIds: Set<string>,
): string | null {
  const candidates = Object.keys(assetMap).filter((oldId) => {
    if (usedOldIds.has(oldId)) return false;
    if (!(oldId === oldNodeId || oldId.startsWith(`${oldNodeId}-`))) return false;
    const cat = categoryByOldId[oldId];
    if (category && cat && cat !== category) return false;
    return true;
  });
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

/** 导出前：无 assetId 的媒体节点按 nodeId 前缀从清单补绑，避免只剩空节点 */
function bindAssetIdsBeforeExport(
  nodes: AppNode[],
  assets: Asset[],
): AppNode[] {
  const used = new Set<string>();
  // 已有引用先占位，避免把同一素材绑给两个节点
  for (const n of nodes) {
    const aid = String(n.data?.params?.assetId ?? "").trim();
    if (aid) used.add(aid);
  }
  return nodes.map((node) => {
    const params = { ...(node.data?.params ?? {}) };
    if (String(params.assetId ?? "").trim()) return node;
    const cat = MEDIA_NODE_CATEGORY[node.type || ""];
    if (!cat) return node;
    const hits = assets
      .filter((a) => {
        if (used.has(a.id)) return false;
        if (a.category !== cat) return false;
        return a.id === node.id || a.id.startsWith(`${node.id}-`);
      })
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const hit = hits[0];
    if (!hit) return node;
    used.add(hit.id);
    return {
      ...node,
      data: {
        ...node.data,
        params: { ...params, assetId: hit.id },
      },
    } as AppNode;
  });
}

export type ProjectPackManifest = {
  format: typeof PROJECT_PACK_FORMAT;
  exportedAt: string;
  sourceProjectId: string;
  sourceProjectTitle: string;
  viewport?: { x: number; y: number; zoom: number };
  assets: Array<{
    id: string;
    file: string;
    title: string;
    category: AssetCategory;
    subcategory: string | null;
    fileType: string;
    fileSize: number;
  }>;
  texts: Array<{ nodeId: string; file: string }>;
};

type FlowPayload = {
  nodes: AppNode[];
  edges: Edge[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** 从节点参数树收集 assetId / *AssetId */
function collectAssetIdsFromNodes(nodes: AppNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [k, v] of Object.entries(value)) {
      if (
        (k === "assetId" || k.endsWith("AssetId")) &&
        typeof v === "string" &&
        v.trim()
      ) {
        ids.add(v.trim());
      } else {
        visit(v);
      }
    }
  };
  for (const node of nodes) visit(node.data?.params);
  return ids;
}

/** 去掉疑似密钥字段与临时媒体 URL */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if ((EPHEMERAL_URL_KEYS as readonly string[]).includes(k)) continue;
    if (isRecord(v)) {
      out[k] = sanitizeParams(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (isRecord(item) ? sanitizeParams(item) : item));
    } else {
      out[k] = v;
    }
  }
  return out;
}

function remapAssetIdsInValue(
  value: unknown,
  assetMap: Record<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapAssetIdsInValue(item, assetMap));
  }
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (
      (k === "assetId" || k.endsWith("AssetId")) &&
      typeof v === "string" &&
      assetMap[v]
    ) {
      out[k] = assetMap[v];
    } else {
      out[k] = remapAssetIdsInValue(v, assetMap);
    }
  }
  return out;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function readAssetBytes(
  projectId: string,
  asset: Asset,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const list = await localStore().listAssets(projectId);
  const meta =
    list.find((m) => m.id === asset.id) ||
    list.find((m) => m.fileName === asset.id);
  if (meta?.fileName) {
    const dataUrl = await localStore().readAssetAsDataUrl(projectId, meta.fileName);
    if (dataUrl) {
      return { bytes: dataUrlToBytes(dataUrl), fileName: meta.fileName };
    }
  }
  const res = await fetch(asset.fileUrl);
  if (!res.ok) throw new Error(`读取素材失败：${asset.title || asset.id}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const ext =
    meta?.fileName?.split(".").pop() ||
    asset.fileType.split("/").pop() ||
    "bin";
  return { bytes: buf, fileName: `${asset.id}.${ext}` };
}

function genNodeId(type: string): string {
  return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function rootBBoxCenter(nodes: AppNode[]): { x: number; y: number } {
  const roots = nodes.filter((n) => !n.parentId);
  if (roots.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of roots) {
    const w = Number(n.width) || 240;
    const h = Number(n.height) || 160;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function viewportCenterFlow(): { x: number; y: number } {
  const { viewport, flowPaneSize } = useCanvasStore.getState();
  const zoom = viewport.zoom || 1;
  const w = flowPaneSize.width || 1200;
  const h = flowPaneSize.height || 800;
  return {
    x: (-viewport.x + w / 2) / zoom,
    y: (-viewport.y + h / 2) / zoom,
  };
}

/** 探测是否为本工程包 zip */
export function looksLikeProjectPackFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".zip") || name.endsWith(".jmcanvas");
}

export async function isProjectPackZip(file: File): Promise<boolean> {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const files = unzipSync(buf);
    const raw = files["manifest.json"];
    if (!raw) return false;
    const manifest = JSON.parse(strFromU8(raw)) as ProjectPackManifest;
    return manifest.format === PROJECT_PACK_FORMAT;
  } catch {
    return false;
  }
}

/** 导出当前项目为完整 zip Blob */
export async function exportCurrentProjectPack(): Promise<{
  blob: Blob;
  fileName: string;
}> {
  const state = useCanvasStore.getState();
  const projectId = state.projectId;
  if (!projectId) throw new Error("项目未加载，无法导出");

  const allAssets = await fetchProjectAssetManifest(projectId);
  // 先把「有文件无 assetId」的媒体节点补上引用，再清 ephemeral URL
  const nodesBound = bindAssetIdsBeforeExport(state.nodes, allAssets);
  const nodes = nodesBound.map((node) => {
    const params = sanitizeParams({ ...(node.data?.params ?? {}) });
    return {
      ...node,
      data: {
        ...node.data,
        params,
        status: "idle" as const,
      },
    } as AppNode;
  });
  const edges = state.edges.filter((e) => e.source && e.target && e.id);

  const manifestAssets: ProjectPackManifest["assets"] = [];
  const zipFiles: Record<string, Uint8Array> = {};

  const referenced = collectAssetIdsFromNodes(nodes);
  // 整项目：清单内全部素材 + 节点引用到但未登记的（尽量完整）
  const byId = new Map(allAssets.map((a) => [a.id, a]));
  for (const id of referenced) {
    if (!byId.has(id)) {
      // 尝试用 id 当文件名补一条空壳，读失败则跳过
    }
  }
  const toExport = allAssets.length > 0 ? allAssets : [];

  for (const asset of toExport) {
    try {
      const { bytes, fileName } = await readAssetBytes(projectId, asset);
      const zipPath = `media/${fileName}`;
      zipFiles[zipPath] = bytes;
      manifestAssets.push({
        id: asset.id,
        file: zipPath,
        title: asset.title,
        category: asset.category,
        subcategory: asset.subcategory,
        fileType: asset.fileType,
        fileSize: asset.fileSize || bytes.byteLength,
      });
    } catch (err) {
      console.warn("[projectPack] skip asset", asset.id, err);
    }
  }

  // 节点引用但未在清单中的：再试一次按 id 读
  for (const id of referenced) {
    if (manifestAssets.some((a) => a.id === id)) continue;
    try {
      const fake: Asset = {
        id,
        projectId,
        title: id,
        category: "image",
        subcategory: null,
        fileUrl: `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(id)}`,
        thumbnailUrl: "",
        fileType: "application/octet-stream",
        fileSize: 0,
        createdAt: "",
      };
      const { bytes, fileName } = await readAssetBytes(projectId, fake);
      const zipPath = `media/${fileName}`;
      zipFiles[zipPath] = bytes;
      manifestAssets.push({
        id,
        file: zipPath,
        title: id,
        category: "image",
        subcategory: null,
        fileType: "application/octet-stream",
        fileSize: bytes.byteLength,
      });
    } catch {
      /* skip missing */
    }
  }

  const texts: ProjectPackManifest["texts"] = [];
  for (const node of nodes) {
    try {
      const rec = await fetchNodeText(projectId, node.id);
      if (!rec?.content) continue;
      const path = `texts/${node.id}.json`;
      zipFiles[path] = strToU8(
        JSON.stringify({ content: rec.content, model: rec.model || "" }),
      );
      texts.push({ nodeId: node.id, file: path });
    } catch {
      /* skip */
    }
  }

  const manifest: ProjectPackManifest = {
    format: PROJECT_PACK_FORMAT,
    exportedAt: new Date().toISOString(),
    sourceProjectId: projectId,
    sourceProjectTitle: state.projectName || "未命名项目",
    viewport: state.viewport,
    assets: manifestAssets,
    texts,
  };

  const flow: FlowPayload = { nodes, edges };
  zipFiles["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  zipFiles["flow.json"] = strToU8(JSON.stringify(flow));

  const zipped = zipSync(zipFiles, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });
  const safeTitle = (state.projectName || "project")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    fileName: `${safeTitle}-${stamp}${PROJECT_PACK_EXT}`,
  };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export type ImportPackOptions = {
  /** 流程坐标锚点（包内根节点包围盒中心对齐到此点）；缺省为视口中心 */
  anchorFlow?: { x: number; y: number };
};

/** 将工程包合并进当前项目（新 ID，相对布局平移到锚点） */
export async function importProjectPackIntoCurrent(
  file: File,
  opts?: ImportPackOptions,
): Promise<{ nodeCount: number; assetCount: number }> {
  const state = useCanvasStore.getState();
  const projectId = state.projectId;
  if (!projectId) throw new Error("项目未加载，无法导入");

  const buf = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(buf);
  const manifestRaw = files["manifest.json"];
  const flowRaw = files["flow.json"];
  if (!manifestRaw || !flowRaw) throw new Error("无效的画布导出包（缺少 manifest/flow）");

  const manifest = JSON.parse(strFromU8(manifestRaw)) as ProjectPackManifest;
  if (manifest.format !== PROJECT_PACK_FORMAT) {
    throw new Error("不支持的导出包版本");
  }
  const flow = JSON.parse(strFromU8(flowRaw)) as FlowPayload;
  if (!Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    throw new Error("导出包画布数据损坏");
  }

  // 1) 写入媒体，建立旧→新 assetId（并保留 fileUrl 供节点即时预览）
  const assetMap: Record<string, string> = {};
  const assetUrlByOldId: Record<string, string> = {};
  const assetCategoryByOldId: Record<string, AssetCategory> = {};
  for (const entry of manifest.assets || []) {
    const raw = files[entry.file];
    if (!raw) continue;
    const baseName = entry.file.split("/").pop() || `${entry.id}.bin`;
    const fileObj = new File([raw], baseName, {
      type: entry.fileType || "application/octet-stream",
    });
    const category = (entry.category || "image") as AssetCategory;
    try {
      const uploaded = await uploadAsset({
        file: fileObj,
        projectId,
        category,
        subcategory: entry.subcategory,
        title: entry.title || baseName,
      });
      assetMap[entry.id] = uploaded.id;
      assetUrlByOldId[entry.id] = uploaded.fileUrl;
      assetCategoryByOldId[entry.id] = category;
    } catch (err) {
      console.warn("[projectPack] upload asset failed", entry.id, err);
    }
  }

  // 2) 节点 / 边新 ID
  const idMap: Record<string, string> = {};
  for (const n of flow.nodes) {
    const t = n.type || "node";
    idMap[n.id] = genNodeId(t);
  }

  const anchor = opts?.anchorFlow ?? viewportCenterFlow();
  const center = rootBBoxCenter(flow.nodes);
  const dx = anchor.x - center.x;
  const dy = anchor.y - center.y;

  // 已在 params 里引用的旧 assetId 先占位，孤儿补绑时跳过
  const usedOldAssetIds = new Set<string>();
  for (const n of flow.nodes) {
    const rawParams = isRecord(n.data?.params)
      ? (n.data!.params as Record<string, unknown>)
      : {};
    const aid = String(rawParams.assetId ?? "").trim();
    if (aid && assetMap[aid]) usedOldAssetIds.add(aid);
  }

  const newNodes: AppNode[] = [];
  for (const n of flow.nodes) {
    const def = NODE_REGISTRY[n.type || ""];
    if (!def && n.type !== "node_group") continue;
    const newId = idMap[n.id]!;
    const rawParams = isRecord(n.data?.params)
      ? (n.data!.params as Record<string, unknown>)
      : {};
    const params = remapAssetIdsInValue(
      sanitizeParams(rawParams),
      assetMap,
    ) as Record<string, unknown>;

    // 无 assetId 时按旧节点 ID 前缀补绑（修复广场模板包里「有视频文件、节点却空」）
    const urlKey = MEDIA_NODE_URL_KEY[n.type || ""];
    const wantCat = MEDIA_NODE_CATEGORY[n.type || ""];
    if (urlKey && !String(params.assetId ?? "").trim()) {
      const orphanOld = findOrphanAssetOldId(
        n.id,
        wantCat,
        assetMap,
        assetCategoryByOldId,
        usedOldAssetIds,
      );
      if (orphanOld) {
        usedOldAssetIds.add(orphanOld);
        params.assetId = assetMap[orphanOld];
      }
    }

    // 有 assetId 时写入本地 fileUrl，避免 manifest 未刷新前节点空白
    const newAssetId = String(params.assetId ?? "").trim();
    if (urlKey && newAssetId) {
      const oldId =
        Object.entries(assetMap).find(([, neu]) => neu === newAssetId)?.[0] || "";
      const fileUrl = oldId ? assetUrlByOldId[oldId] : "";
      if (fileUrl) params[urlKey] = fileUrl;
    }

    const parentId =
      n.parentId && idMap[n.parentId] ? idMap[n.parentId] : undefined;
    const isRoot = !n.parentId;
    const position = isRoot
      ? { x: n.position.x + dx, y: n.position.y + dy }
      : { ...n.position };

    const rawMemberIds = Array.isArray(n.data?.memberIds)
      ? (n.data!.memberIds as string[])
      : undefined;
    const remappedMembers = rawMemberIds
      ?.map((mid) => idMap[mid])
      .filter(Boolean) as string[] | undefined;

    const data: WorkflowNodeData = {
      label: n.data?.label || def?.label || "节点",
      params,
      inputs: n.type === "node_group" ? [] : def?.inputs || [],
      outputs: n.type === "node_group" ? [] : def?.outputs || [],
      status: "idle",
      ...(remappedMembers ? { memberIds: remappedMembers } : {}),
      ...(n.type === "node_group"
        ? {
            locked: Boolean(n.data?.locked),
            collapsed: Boolean(n.data?.collapsed),
          }
        : {}),
    };

    newNodes.push({
      ...n,
      id: newId,
      parentId,
      position,
      data,
      selected: false,
    } as AppNode);
  }

  const newEdges: Edge[] = [];
  for (const e of flow.edges) {
    const source = idMap[e.source];
    const target = idMap[e.target];
    if (!source || !target) continue;
    newEdges.push({
      ...e,
      id: `e_${source}_${target}_${Math.random().toString(36).slice(2, 7)}`,
      source,
      target,
      selected: false,
    });
  }

  // 3) 合并进 store
  const store = useCanvasStore.getState();
  store.pushHistory();
  useCanvasStore.setState({
    nodes: [...store.nodes, ...newNodes],
    edges: [...store.edges, ...newEdges],
    selectedFlowIds: newNodes.map((n) => n.id),
    selectedNodeId: newNodes[0]?.id ?? store.selectedNodeId,
  });
  useCanvasStore.getState().scheduleAutoSave();

  // 4) 节点长文本按新 ID 写入
  for (const t of manifest.texts || []) {
    const newNodeId = idMap[t.nodeId];
    const raw = files[t.file];
    if (!newNodeId || !raw) continue;
    try {
      const body = JSON.parse(strFromU8(raw)) as { content?: string; model?: string };
      if (body.content) {
        await saveNodeText(projectId, newNodeId, body.content, body.model || "");
      }
    } catch {
      /* skip */
    }
  }

  notifyAssetsUpdated();
  return {
    nodeCount: newNodes.length,
    assetCount: Object.keys(assetMap).length,
  };
}

/** 菜单导入：选文件 */
export function pickProjectPackFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}
