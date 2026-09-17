/**
 * 自由创作 Agent Team 路径（画布操控 / 智能编排，无分镜表承载）的
 * Project Graph 快照缓存——进程内、非权威，仅用于让组件树之外的代码
 * （如 applyMediaJobResult.ts）也能读到当前 shots[] / timeline，
 * 从而在单镜生成成功后就地判断「是否需要 reflow」，无需专门发一次
 * GET /projects/{id}/graph。
 *
 * 权威数据始终在后端 Project Graph（MySQL）；本缓存只在会话创建/续聊
 * 拿到最新 graph payload时刷新，或本地乐观更新后由持久化调用校正。
 */

import { useSyncExternalStore } from "react";
import type { ProjectGraphPayload } from "@/lib/api/agentSessions";

export interface AgentGraphShotSnapshot {
  id: string;
  canvasNodeId?: string;
  outputAssetId?: string | null;
  status: string;
}

/** identityLock：角色定妆图节点快照（三视图身份锁闭环用） */
export interface AgentGraphCharacterSnapshot {
  id: string;
  canvasNodeId?: string;
  sheetAssetIds: string[];
}

/** 单一产品电影级宣传片 Skill：产品多视角定妆图节点快照（对齐角色 identityLock） */
export interface AgentGraphProductSnapshot {
  id: string;
  canvasNodeId?: string;
  sheetAssetIds: string[];
}

export interface AgentTimelineSummary {
  totalCount: number;
  readyCount: number;
}

interface AgentGraphSnapshot {
  projectId: string;
  revision: number;
  /** 按 timeline.shotIds 排序；缺失时回退 shots 原始顺序 */
  shotIds: string[];
  shotsById: Map<string, AgentGraphShotSnapshot>;
  charactersById: Map<string, AgentGraphCharacterSnapshot>;
  productsById: Map<string, AgentGraphProductSnapshot>;
  /** 随快照变化预计算并缓存，避免 useSyncExternalStore 的 getSnapshot 每次返回新引用 */
  summary: AgentTimelineSummary;
}

let current: AgentGraphSnapshot | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function computeSummary(shotIds: string[], shotsById: Map<string, AgentGraphShotSnapshot>): AgentTimelineSummary {
  let readyCount = 0;
  for (const id of shotIds) {
    const shot = shotsById.get(id);
    if (shot && (shot.status === "ready" || shot.outputAssetId)) readyCount += 1;
  }
  return { totalCount: shotIds.length, readyCount };
}

function parseShots(graph: Record<string, unknown> | undefined): AgentGraphShotSnapshot[] {
  const raw = Array.isArray(graph?.shots) ? (graph!.shots as unknown[]) : [];
  const out: AgentGraphShotSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const id = String(s.id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      canvasNodeId: s.canvasNodeId ? String(s.canvasNodeId).trim() : undefined,
      outputAssetId: s.outputAssetId != null ? String(s.outputAssetId).trim() || null : null,
      status: typeof s.status === "string" && s.status.trim() ? s.status.trim() : "planned",
    });
  }
  return out;
}

function parseShotIds(graph: Record<string, unknown> | undefined, fallback: AgentGraphShotSnapshot[]): string[] {
  const timeline = graph?.timeline as Record<string, unknown> | undefined;
  const raw = Array.isArray(timeline?.shotIds) ? (timeline!.shotIds as unknown[]) : [];
  const ids = raw.map((x) => String(x).trim()).filter(Boolean);
  return ids.length ? ids : fallback.map((s) => s.id);
}

function parseCharacters(graph: Record<string, unknown> | undefined): AgentGraphCharacterSnapshot[] {
  const raw = Array.isArray(graph?.characters) ? (graph!.characters as unknown[]) : [];
  const out: AgentGraphCharacterSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const id = String(c.id ?? "").trim();
    if (!id) continue;
    const lock = (c.identityLock && typeof c.identityLock === "object" ? c.identityLock : {}) as Record<
      string,
      unknown
    >;
    const sheetAssetIds = Array.isArray(lock.sheetAssetIds)
      ? (lock.sheetAssetIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    out.push({
      id,
      canvasNodeId: c.canvasNodeId ? String(c.canvasNodeId).trim() : undefined,
      sheetAssetIds,
    });
  }
  return out;
}

/** 单一产品电影级宣传片 Skill 专用：解析 products[]（结构对齐 characters[]） */
function parseProducts(graph: Record<string, unknown> | undefined): AgentGraphProductSnapshot[] {
  const raw = Array.isArray(graph?.products) ? (graph!.products as unknown[]) : [];
  const out: AgentGraphProductSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const id = String(p.id ?? "").trim();
    if (!id) continue;
    const lock = (p.identityLock && typeof p.identityLock === "object" ? p.identityLock : {}) as Record<
      string,
      unknown
    >;
    const sheetAssetIds = Array.isArray(lock.sheetAssetIds)
      ? (lock.sheetAssetIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    out.push({
      id,
      canvasNodeId: p.canvasNodeId ? String(p.canvasNodeId).trim() : undefined,
      sheetAssetIds,
    });
  }
  return out;
}

/** 会话创建 / 续聊拿到新 graph payload 时调用，刷新整份快照 */
export function setAgentProjectGraphSnapshot(
  projectId: string,
  payload: ProjectGraphPayload | null | undefined
): void {
  const pid = String(projectId || "").trim();
  if (!pid || !payload?.graph) return;
  const shots = parseShots(payload.graph);
  const shotIds = parseShotIds(payload.graph, shots);
  const shotsById = new Map(shots.map((s) => [s.id, s]));
  const characters = parseCharacters(payload.graph);
  const charactersById = new Map(characters.map((c) => [c.id, c]));
  const products = parseProducts(payload.graph);
  const productsById = new Map(products.map((p) => [p.id, p]));
  current = {
    projectId: pid,
    revision: Number(payload.revision) || 0,
    shotIds,
    shotsById,
    charactersById,
    productsById,
    summary: computeSummary(shotIds, shotsById),
  };
  notify();
}

/** 按 canvasNodeId 反查该节点绑定的镜头（自由创作路径专用，非分镜表） */
export function findAgentShotByNodeId(
  projectId: string,
  nodeId: string
): AgentGraphShotSnapshot | null {
  if (!current || current.projectId !== projectId) return null;
  for (const shot of current.shotsById.values()) {
    if (shot.canvasNodeId === nodeId) return shot;
  }
  return null;
}

/** 本地乐观更新（生成成功后先改本地展示，再 fire-and-forget 持久化） */
export function patchAgentShotLocal(
  projectId: string,
  shotId: string,
  patch: Partial<Pick<AgentGraphShotSnapshot, "status" | "outputAssetId">>
): void {
  if (!current || current.projectId !== projectId) return;
  const shot = current.shotsById.get(shotId);
  if (!shot) return;
  const merged = { ...shot, ...patch };
  if (merged.status === shot.status && merged.outputAssetId === shot.outputAssetId) return;
  current.shotsById.set(shotId, merged);
  current = { ...current, summary: computeSummary(current.shotIds, current.shotsById) };
  notify();
}

/** 按 canvasNodeId 反查该节点绑定的角色（identityLock 定妆图节点专用） */
export function findAgentCharacterByNodeId(
  projectId: string,
  nodeId: string
): AgentGraphCharacterSnapshot | null {
  if (!current || current.projectId !== projectId) return null;
  for (const character of current.charactersById.values()) {
    if (character.canvasNodeId === nodeId) return character;
  }
  return null;
}

/** 定妆图生成成功后本地乐观更新 sheetAssetIds（去重、上限 4，与后端一致） */
export function patchAgentCharacterSheetLocal(
  projectId: string,
  characterId: string,
  sheetAssetId: string
): boolean {
  if (!current || current.projectId !== projectId) return false;
  const character = current.charactersById.get(characterId);
  if (!character) return false;
  const assetId = String(sheetAssetId || "").trim();
  if (!assetId || character.sheetAssetIds.includes(assetId)) return false;
  const nextIds = [...character.sheetAssetIds, assetId].slice(-4);
  current.charactersById.set(characterId, { ...character, sheetAssetIds: nextIds });
  current = { ...current };
  notify();
  return true;
}

/** 按 canvasNodeId 反查该节点绑定的产品（单一产品电影级宣传片 identityLock 定妆图节点专用） */
export function findAgentProductByNodeId(
  projectId: string,
  nodeId: string
): AgentGraphProductSnapshot | null {
  if (!current || current.projectId !== projectId) return null;
  for (const product of current.productsById.values()) {
    if (product.canvasNodeId === nodeId) return product;
  }
  return null;
}

/** 产品定妆图生成成功后本地乐观更新 sheetAssetIds（去重、上限 4，与后端一致） */
export function patchAgentProductSheetLocal(
  projectId: string,
  productId: string,
  sheetAssetId: string
): boolean {
  if (!current || current.projectId !== projectId) return false;
  const product = current.productsById.get(productId);
  if (!product) return false;
  const assetId = String(sheetAssetId || "").trim();
  if (!assetId || product.sheetAssetIds.includes(assetId)) return false;
  const nextIds = [...product.sheetAssetIds, assetId].slice(-4);
  current.productsById.set(productId, { ...product, sheetAssetIds: nextIds });
  current = { ...current };
  notify();
  return true;
}

export function computeAgentTimelineSummary(projectId: string): AgentTimelineSummary | null {
  if (!current || current.projectId !== projectId || current.shotIds.length === 0) return null;
  return current.summary;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React 组件读取时间线完成度（随快照变化自动重渲染） */
export function useAgentTimelineSummary(projectId: string | undefined | null): AgentTimelineSummary | null {
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? computeAgentTimelineSummary(projectId) : null),
    () => null
  );
}
