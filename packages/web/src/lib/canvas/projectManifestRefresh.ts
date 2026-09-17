import type { QueryClient } from "@tanstack/react-query";
import { ASSETS_UPDATED_EVENT, projectAssetsKey, type Asset } from "@/lib/api/assets";
import { hasExpiringSignedAssetUrls } from "@/lib/canvas/assetManifestCache";
import { isCdnStorageMode } from "@/lib/api/storageUrl";

/** Re-check signed URLs every 30 minutes (only refresh when near expiry). CDN 模式跳过。 */
const MANIFEST_EXPIRY_CHECK_MS = 30 * 60 * 1000;
const INVALIDATE_DEBOUNCE_MS = 400;

type ProjectRefreshState = {
  refCount: number;
  queryClient: QueryClient;
  expiryTimer: number | null;
  invalidateDebounceTimer: number | undefined;
  onAssetsUpdated: () => void;
};

const states = new Map<string, ProjectRefreshState>();

function getOrCreateState(projectId: string, queryClient: QueryClient): ProjectRefreshState {
  let state = states.get(projectId);
  if (!state) {
    const onAssetsUpdated = () => {
      const current = states.get(projectId);
      if (!current) return;
      if (current.invalidateDebounceTimer) {
        window.clearTimeout(current.invalidateDebounceTimer);
      }
      current.invalidateDebounceTimer = window.setTimeout(() => {
        void current.queryClient.invalidateQueries({ queryKey: projectAssetsKey(projectId) });
      }, INVALIDATE_DEBOUNCE_MS);
    };

    state = {
      refCount: 0,
      queryClient,
      expiryTimer: null,
      invalidateDebounceTimer: undefined,
      onAssetsUpdated,
    };
    states.set(projectId, state);
  } else {
    state.queryClient = queryClient;
  }
  return state;
}

function startExpiryTimer(projectId: string, state: ProjectRefreshState) {
  if (state.expiryTimer) return;
  // CDN 公共读 URL 不过期，无需定时 invalidate
  if (isCdnStorageMode()) return;

  const tick = () => {
    const data = state.queryClient.getQueryData<Asset[]>(projectAssetsKey(projectId));
    if (data?.length && hasExpiringSignedAssetUrls(data)) {
      void state.queryClient.invalidateQueries({ queryKey: projectAssetsKey(projectId) });
    }
  };

  state.expiryTimer = window.setInterval(tick, MANIFEST_EXPIRY_CHECK_MS);
}

function stopExpiryTimer(state: ProjectRefreshState) {
  if (!state.expiryTimer) return;
  window.clearInterval(state.expiryTimer);
  state.expiryTimer = null;
}

function startAssetsUpdatedListener(state: ProjectRefreshState) {
  window.addEventListener(ASSETS_UPDATED_EVENT, state.onAssetsUpdated);
}

function stopAssetsUpdatedListener(state: ProjectRefreshState) {
  window.removeEventListener(ASSETS_UPDATED_EVENT, state.onAssetsUpdated);
  if (state.invalidateDebounceTimer) {
    window.clearTimeout(state.invalidateDebounceTimer);
    state.invalidateDebounceTimer = undefined;
  }
}

/** One shared manifest sync per project (expiry scheduler + assets-updated invalidation). */
export function acquireProjectManifestSync(projectId: string, queryClient: QueryClient): void {
  if (!projectId) return;
  const state = getOrCreateState(projectId, queryClient);
  if (state.refCount === 0) {
    startExpiryTimer(projectId, state);
    startAssetsUpdatedListener(state);
  }
  state.refCount += 1;
}

export function releaseProjectManifestSync(projectId: string): void {
  if (!projectId) return;
  const state = states.get(projectId);
  if (!state || state.refCount <= 0) return;
  state.refCount -= 1;
  if (state.refCount === 0) {
    stopExpiryTimer(state);
    stopAssetsUpdatedListener(state);
    states.delete(projectId);
  }
}

/** @deprecated Use acquireProjectManifestSync */
export function acquireManifestExpiryScheduler(projectId: string, queryClient: QueryClient): void {
  acquireProjectManifestSync(projectId, queryClient);
}

/** @deprecated Use releaseProjectManifestSync */
export function releaseManifestExpiryScheduler(projectId: string): void {
  releaseProjectManifestSync(projectId);
}
