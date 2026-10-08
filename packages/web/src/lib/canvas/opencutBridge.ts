/**
 * 开源本地画布 ↔ OpenCut classic（:3100）桥接常量与工程 id。
 */

export const OPENCUT_ORIGIN =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_OPENCUT_ORIGIN?.trim()) ||
  "http://127.0.0.1:3100";

export const JUMENG_BRIDGE_VERSION = 1;

export type JumengBridgeAsset = {
  id: string;
  title: string;
  category: "video" | "audio" | "image";
  fileUrl: string;
};

export function buildOpencutProjectId(params: {
  canvasProjectId: string;
  fromNodeId?: string | null;
}): string {
  const base = `jm-${params.canvasProjectId.trim()}`;
  const node = (params.fromNodeId || "").trim();
  return node ? `${base}--${node}` : base;
}

export function opencutJumengHref(params: {
  canvasProjectId: string;
  fromNodeId?: string | null;
  assetId?: string | null;
  canvasOrigin?: string;
}): string {
  const opencutId = buildOpencutProjectId(params);
  const q = new URLSearchParams();
  q.set("canvasProjectId", params.canvasProjectId);
  const origin =
    params.canvasOrigin ||
    (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3456");
  q.set("canvasOrigin", origin);
  if (params.fromNodeId) q.set("fromNodeId", params.fromNodeId);
  if (params.assetId) q.set("assetId", params.assetId);
  return `${OPENCUT_ORIGIN}/jumeng/${encodeURIComponent(opencutId)}?${q.toString()}`;
}
