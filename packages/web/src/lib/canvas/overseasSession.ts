/**
 * 一键出海：发现页 → 画布 的会话状态（sessionStorage）
 */

import type { OverseasMarketId } from "@/lib/canvas/overseasMarkets";
import type { ViralRemakeAspect, ViralRemakeClarity } from "@/lib/canvas/viralRemakeSession";

export const OVERSEAS_LOCALIZE_SKILL = "overseas_localize" as const;

/** 分镜表 viralRemakeMeta.source：一键出海（爆款向导须忽略） */
export const OVERSEAS_META_SOURCE = "overseas_localize" as const;

export type OverseasWizardProgress = {
  phase?: string;
  gridNodeId?: string;
  videoNodeId?: string;
  shotCount?: number;
  styleSummary?: string;
  /** 本地化方案（存 replacePlan 字段兼容成片链路） */
  localePlan?: string;
  message?: string;
};

export type OverseasSession = {
  videoAssetId: string;
  videoFileUrl: string;
  videoTitle: string;
  aspectRatio: ViralRemakeAspect;
  clarity: ViralRemakeClarity;
  /** 目标市场（单国 MVP） */
  targetMarketId: OverseasMarketId;
  /** 用户补充说明（可选） */
  localeNotes: string;
  /** 进入画布后是否自动开始拉片（仅首次） */
  autoStart: boolean;
  progress?: OverseasWizardProgress;
};

function storageKey(projectId: string): string {
  return `jumeng:overseas_localize:${projectId}`;
}

export function saveOverseasSession(projectId: string, session: OverseasSession): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify(session));
  } catch {
    /* quota / private mode */
  }
}

export function loadOverseasSession(projectId: string): OverseasSession | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverseasSession;
    if (!parsed?.videoAssetId || !parsed?.targetMarketId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOverseasSession(projectId: string): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    sessionStorage.removeItem(storageKey(projectId));
  } catch {
    /* ignore */
  }
}

/** 拉片成功进入确认步后再关闭 autoStart */
export function markOverseasSessionStarted(projectId: string): void {
  const cur = loadOverseasSession(projectId);
  if (!cur) return;
  saveOverseasSession(projectId, { ...cur, autoStart: false });
}

export function patchOverseasProgress(
  projectId: string,
  progress: OverseasWizardProgress
): void {
  const cur = loadOverseasSession(projectId);
  if (!cur) return;
  saveOverseasSession(projectId, {
    ...cur,
    progress: { ...cur.progress, ...progress },
  });
}
