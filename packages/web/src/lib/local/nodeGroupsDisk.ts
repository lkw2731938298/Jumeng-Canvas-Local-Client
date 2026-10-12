/**
 * 本机组库：落盘 projects/{projectId}/node-groups/（不依赖云端 MySQL/OSS）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveActiveDataRoot } from "@/lib/local/dataLocation";
import type { GroupSnapshot } from "@/lib/canvas/nodeGroup";

export type LocalNodeGroupListItem = {
  id: string;
  projectId: string;
  title: string;
  coverAssetId?: string | null;
  assetIds: string[];
  tags: string[];
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LocalNodeGroupDetail = LocalNodeGroupListItem & {
  snapshot: GroupSnapshot;
};

function nowIso() {
  return new Date().toISOString();
}

function safeName(name: string) {
  const base = path.basename(name);
  if (!base || base === "." || base === "..") throw new Error("非法文件名");
  return base;
}

function groupsDir(projectId: string) {
  return path.join(resolveActiveDataRoot(), "projects", safeName(projectId), "node-groups");
}

function groupFile(projectId: string, groupId: string) {
  return path.join(groupsDir(projectId), `${safeName(groupId)}.json`);
}

function readJson<T>(fp: string, fallback: T): T {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(fp: string, value: unknown) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(value, null, 2), "utf8");
}

function toListItem(detail: LocalNodeGroupDetail): LocalNodeGroupListItem {
  const { snapshot: _s, ...rest } = detail;
  return rest;
}

export function listNodeGroupsOnDisk(
  projectId: string,
  opts?: { q?: string; tag?: string; sort?: string; order?: "asc" | "desc" }
): LocalNodeGroupListItem[] {
  const dir = groupsDir(projectId);
  if (!fs.existsSync(dir)) return [];
  const items: LocalNodeGroupDetail[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const raw = readJson<LocalNodeGroupDetail | null>(path.join(dir, name), null);
    if (!raw?.id || !raw.snapshot) continue;
    items.push(raw);
  }

  let filtered = items;
  const q = (opts?.q || "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((g) => g.title.toLowerCase().includes(q));
  }
  const tag = (opts?.tag || "").trim();
  if (tag) {
    filtered = filtered.filter((g) => (g.tags || []).includes(tag));
  }

  const sort = opts?.sort || "updated_at";
  const order = opts?.order === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    let cmp = 0;
    if (sort === "title") cmp = a.title.localeCompare(b.title, "zh");
    else if (sort === "node_count") cmp = (a.nodeCount || 0) - (b.nodeCount || 0);
    else if (sort === "created_at") cmp = a.createdAt.localeCompare(b.createdAt);
    else cmp = a.updatedAt.localeCompare(b.updatedAt);
    return cmp * order;
  });

  return filtered.map(toListItem);
}

export function getNodeGroupOnDisk(
  projectId: string,
  groupId: string
): LocalNodeGroupDetail | null {
  return readJson<LocalNodeGroupDetail | null>(groupFile(projectId, groupId), null);
}

export function createNodeGroupOnDisk(params: {
  projectId: string;
  title: string;
  snapshot: GroupSnapshot;
  coverAssetId?: string | null;
  tags?: string[];
}): LocalNodeGroupDetail {
  const t = nowIso();
  const id = randomUUID();
  const detail: LocalNodeGroupDetail = {
    id,
    projectId: params.projectId,
    title: String(params.title || "未命名组").trim() || "未命名组",
    coverAssetId: params.coverAssetId ?? null,
    assetIds: (params.snapshot.assets || []).map((a) => a.assetId).filter(Boolean),
    tags: Array.isArray(params.tags) ? params.tags.map(String) : [],
    nodeCount: params.snapshot.nodes?.length ?? 0,
    createdAt: t,
    updatedAt: t,
    snapshot: params.snapshot,
  };
  writeJson(groupFile(params.projectId, id), detail);
  return detail;
}

export function patchNodeGroupOnDisk(
  projectId: string,
  groupId: string,
  patch: { title?: string; tags?: string[] }
): LocalNodeGroupListItem | null {
  const cur = getNodeGroupOnDisk(projectId, groupId);
  if (!cur) return null;
  if (patch.title != null) cur.title = String(patch.title).trim() || cur.title;
  if (patch.tags != null) cur.tags = patch.tags.map(String);
  cur.updatedAt = nowIso();
  writeJson(groupFile(projectId, groupId), cur);
  return toListItem(cur);
}

export function deleteNodeGroupOnDisk(projectId: string, groupId: string): boolean {
  const file = groupFile(projectId, groupId);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

/** 跨项目复制组：拷贝快照 JSON；同项目内素材文件尽量复制到目标 assets。 */
export function copyNodeGroupOnDisk(params: {
  groupId: string;
  sourceProjectId: string;
  targetProjectId: string;
  title?: string;
}): LocalNodeGroupDetail {
  const src = getNodeGroupOnDisk(params.sourceProjectId, params.groupId);
  if (!src) throw new Error("源组不存在");

  const sameProject = params.sourceProjectId === params.targetProjectId;
  if (!sameProject) {
    // 尽量复制引用素材文件（已存在则跳过）
    const dataRoot = resolveActiveDataRoot();
    const srcAssets = path.join(dataRoot, "projects", safeName(params.sourceProjectId), "assets");
    const dstAssets = path.join(dataRoot, "projects", safeName(params.targetProjectId), "assets");
    fs.mkdirSync(dstAssets, { recursive: true });
    const indexPath = path.join(srcAssets, "index.json");
    const index = readJson<
      Array<{ id: string; fileName: string; title?: string; category?: string; subcategory?: string | null; fileType?: string; fileSize?: number; createdAt?: string }>
    >(indexPath, []);
    const dstIndexPath = path.join(dstAssets, "index.json");
    const dstIndex = readJson<typeof index>(dstIndexPath, []);
    const dstById = new Set(dstIndex.map((a) => a.id));

    for (const assetId of src.assetIds || []) {
      const hit = index.find((a) => a.id === assetId);
      if (!hit?.fileName) continue;
      const from = path.join(srcAssets, hit.fileName);
      const to = path.join(dstAssets, hit.fileName);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        try {
          fs.copyFileSync(from, to);
        } catch {
          /* ignore single file failure */
        }
      }
      if (!dstById.has(hit.id)) {
        dstIndex.unshift({
          ...hit,
          createdAt: hit.createdAt || nowIso(),
        });
        dstById.add(hit.id);
      }
    }
    writeJson(dstIndexPath, dstIndex);
  }

  return createNodeGroupOnDisk({
    projectId: params.targetProjectId,
    title: (params.title || "").trim() || src.title,
    snapshot: src.snapshot,
    coverAssetId: src.coverAssetId,
    tags: src.tags,
  });
}
