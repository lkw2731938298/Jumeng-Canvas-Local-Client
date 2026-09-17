"use client";

/**
 * 开源本地版：无多人协作 presence，恒为空。
 */
export function useProjectPresence(_projectId: string | null | undefined, _enabled = true) {
  return { peers: [] as Array<{ userId: string; displayName: string }> };
}

export function formatPresenceLabel(
  _peers: Array<{ userId: string; displayName: string }>
): string {
  return "";
}
