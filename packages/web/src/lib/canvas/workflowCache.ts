const CACHE_PREFIX = "jm_canvas_workflow_v2:";
const LEGACY_CACHE_PREFIX = "jm_canvas_workflow_v1:";
/** Persist across sessions; refreshed on each save / successful sync. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface WorkflowCacheEntry {
  projectNo: string;
  projectName: string;
  workflowId: string | null;
  workflowRevision?: number;
  flowJson: string;
  savedAt: number;
}

function storageKey(projectId: string): string {
  return `${CACHE_PREFIX}${projectId}`;
}

function legacySessionKey(projectId: string): string {
  return `${LEGACY_CACHE_PREFIX}${projectId}`;
}

function isExpired(entry: WorkflowCacheEntry): boolean {
  return !entry?.flowJson || Date.now() - (entry.savedAt ?? 0) > CACHE_TTL_MS;
}

function parseEntry(raw: string | null): WorkflowCacheEntry | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as WorkflowCacheEntry;
    if (isExpired(entry)) return null;
    return entry;
  } catch {
    return null;
  }
}

function readLegacySessionCache(projectId: string): WorkflowCacheEntry | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const entry = parseEntry(sessionStorage.getItem(legacySessionKey(projectId)));
    if (entry) {
      writeWorkflowCache(projectId, entry);
      sessionStorage.removeItem(legacySessionKey(projectId));
    }
    return entry;
  } catch {
    return null;
  }
}

export function readWorkflowCache(projectId: string): WorkflowCacheEntry | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const fromLocal = parseEntry(localStorage.getItem(storageKey(projectId)));
    if (fromLocal) return fromLocal;
    return readLegacySessionCache(projectId);
  } catch {
    return readLegacySessionCache(projectId);
  }
}

export function writeWorkflowCache(
  projectId: string,
  payload: Omit<WorkflowCacheEntry, "savedAt">
): void {
  if (typeof window === "undefined" || !projectId || !payload.flowJson) return;
  const entry: WorkflowCacheEntry = { ...payload, savedAt: Date.now() };
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(entry));
    return;
  } catch {
    /* fall through */
  }
  try {
    sessionStorage.setItem(storageKey(projectId), JSON.stringify(entry));
  } catch {
    /* quota or private mode */
  }
}