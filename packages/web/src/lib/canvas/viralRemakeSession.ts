/** 爆款复刻：发现页 → 画布 的会话状态（sessionStorage） */

export const VIRAL_REMAKE_SKILL = "viral_remake" as const;

export type ViralRemakeAspect = "16:9" | "9:16" | "1:1";
export type ViralRemakeClarity = "720p" | "1080p";

/** 向导可恢复进度（刷新后仍可打开面板） */
export type ViralRemakeWizardProgress = {
  phase?: string;
  gridNodeId?: string;
  videoNodeId?: string;
  shotCount?: number;
  styleSummary?: string;
  replacePlan?: string;
  message?: string;
};

export type ViralRemakeSession = {
  videoAssetId: string;
  videoFileUrl: string;
  videoTitle: string;
  aspectRatio: ViralRemakeAspect;
  clarity: ViralRemakeClarity;
  /** 用户替换说明（角色/产品/文案） */
  replaceNotes: string;
  /** 可选：替换参考图素材 ID */
  replaceImageAssetIds: string[];
  replaceImageUrls: string[];
  /** 进入画布后是否自动开始拉片（仅首次） */
  autoStart: boolean;
  /** 向导进度快照，便于刷新恢复 */
  progress?: ViralRemakeWizardProgress;
};

function storageKey(projectId: string): string {
  return `jumeng:viral_remake:${projectId}`;
}

/** Agent / 弹窗写入会话后，通知画布向导刷新 */
export const VIRAL_REMAKE_SESSION_EVENT = "jumeng:viral_remake_session";

export function saveViralRemakeSession(projectId: string, session: ViralRemakeSession): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify(session));
    window.dispatchEvent(
      new CustomEvent(VIRAL_REMAKE_SESSION_EVENT, { detail: { projectId } })
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadViralRemakeSession(projectId: string): ViralRemakeSession | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ViralRemakeSession;
    if (!parsed?.videoAssetId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearViralRemakeSession(projectId: string): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    sessionStorage.removeItem(storageKey(projectId));
  } catch {
    /* ignore */
  }
}

/** 拉片成功进入确认步后再关闭 autoStart，避免刷新后向导永久消失 */
export function markViralRemakeSessionStarted(projectId: string): void {
  const cur = loadViralRemakeSession(projectId);
  if (!cur) return;
  saveViralRemakeSession(projectId, { ...cur, autoStart: false });
}

/** 合并写入向导进度（保留会话素材，便于刷新后恢复面板） */
export function patchViralRemakeProgress(
  projectId: string,
  progress: ViralRemakeWizardProgress
): void {
  const cur = loadViralRemakeSession(projectId);
  if (!cur) return;
  saveViralRemakeSession(projectId, {
    ...cur,
    progress: { ...cur.progress, ...progress },
  });
}
