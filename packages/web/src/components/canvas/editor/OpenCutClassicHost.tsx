"use client";

/**
 * 用 iframe 托管 vendor OpenCut classic（Bun :3100），完成素材注入 / 导出回画布 / 返回。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { uploadAsset } from "@/lib/api/assets";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import { canvasHref } from "@/lib/canvas/directorNavigation";
import {
  buildOpencutProjectId,
  JUMENG_BRIDGE_VERSION,
  opencutJumengHref,
  OPENCUT_ORIGIN,
  type JumengBridgeAsset,
} from "@/lib/canvas/opencutBridge";
type Props = { projectId: string };

function base64ToFile(base64: string, fileName: string, mimeType: string): File {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType || "video/mp4" });
}

function absoluteAssetUrl(fileUrl: string): string {
  if (!fileUrl) return fileUrl;
  if (/^https?:\/\//i.test(fileUrl) || fileUrl.startsWith("blob:")) return fileUrl;
  if (typeof window === "undefined") return fileUrl;
  return new URL(fileUrl, window.location.origin).toString();
}

async function probeOpencut(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${OPENCUT_ORIGIN}/jumeng/jm-ping`, {
      method: "GET",
      mode: "no-cors",
      signal: ctrl.signal,
      cache: "no-store",
    });
    window.clearTimeout(t);
    // no-cors 成功时 status 为 0 / opaque，只要没抛错就视为可达
    void res;
    return true;
  } catch {
    try {
      // 再试一次普通探测（若 CORS 放行）
      const res = await fetch(`${OPENCUT_ORIGIN}/`, {
        method: "HEAD",
        mode: "cors",
        cache: "no-store",
      });
      return res.ok || res.type === "opaque";
    } catch {
      return false;
    }
  }
}

export function OpenCutClassicHost({ projectId }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const assetId = search.get("assetId");
  const fromNodeId = search.get("fromNodeId");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const initSentRef = useRef(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [probing, setProbing] = useState(true);
  const { data: assets = [], isLoading: assetsLoading } = useProjectAssetManifest(projectId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setProbing(true);
      const ok = await probeOpencut();
      if (cancelled) return;
      setProbing(false);
      if (!ok) {
        setIframeError("剪辑服务暂时不可用，请稍后重试");
      } else {
        setIframeError(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bridgeAssets: JumengBridgeAsset[] = useMemo(() => {
    const seen = new Set<string>();
    const out: JumengBridgeAsset[] = [];
    // 用画布节点 label 补全素材标题，避免轨道显示裸 video_input_… id
    const nodes = useCanvasStore.getState().nodes || [];
    const labelByAssetId = new Map<string, string>();
    for (const n of nodes) {
      const data = (n.data || {}) as Record<string, unknown>;
      const aid = String(data.assetId || data.videoAssetId || "").trim();
      const label = String(data.label || "").trim();
      if (aid && label && !/^video_input_/i.test(label)) {
        labelByAssetId.set(aid, label);
      }
    }
    for (const a of assets) {
      if (a.category !== "video" && a.category !== "audio") continue;
      const fileUrl = absoluteAssetUrl(a.fileUrl);
      // 忽略签名查询串，同路径 / 同 id 只传一条
      let urlKey = fileUrl;
      try {
        const u = new URL(fileUrl);
        urlKey = `${u.origin}${u.pathname}`;
      } catch {
        urlKey = fileUrl.split("?")[0];
      }
      if (seen.has(a.id) || seen.has(urlKey)) continue;
      seen.add(a.id);
      seen.add(urlKey);
      const rawTitle = (a.title || "").trim();
      const fromNode = labelByAssetId.get(a.id);
      const title =
        (rawTitle && !/^video_input_/i.test(rawTitle) && rawTitle !== a.id
          ? rawTitle
          : fromNode) ||
        (a.category === "audio" ? "音频" : "视频");
      out.push({
        id: a.id,
        title,
        category: a.category as "video" | "audio",
        fileUrl,
      });
    }
    return out;
  }, [assets]);

  const src = useMemo(
    () =>
      opencutJumengHref({
        canvasProjectId: projectId,
        fromNodeId,
        assetId,
      }),
    [projectId, fromNodeId, assetId]
  );

  const backToCanvas = useCallback(() => {
    void useCanvasStore.getState().flushAutoSave();
    router.push(canvasHref(projectId));
  }, [projectId, router]);

  const postInit = useCallback(() => {
    if (initSentRef.current) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    initSentRef.current = true;
    win.postMessage(
      {
        type: "jumeng:init",
        v: JUMENG_BRIDGE_VERSION,
        canvasProjectId: projectId,
        opencutProjectId: buildOpencutProjectId({
          canvasProjectId: projectId,
          fromNodeId,
        }),
        canvasOrigin: window.location.origin,
        assetId,
        fromNodeId,
        assets: bridgeAssets,
      },
      OPENCUT_ORIGIN
    );
  }, [projectId, fromNodeId, assetId, bridgeAssets]);

  useEffect(() => {
    if (iframeReady && !assetsLoading) postInit();
  }, [iframeReady, assetsLoading, postInit]);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== OPENCUT_ORIGIN) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = String((data as { type?: string }).type || "");
      if (type === "jumeng:ready") {
        setIframeReady(true);
        return;
      }
      if (type === "jumeng:return") {
        backToCanvas();
        return;
      }
      if (type === "jumeng:export") {
        try {
          const {
            base64,
            fileName,
            mimeType,
            opencutProjectId,
          } = data as {
            base64: string;
            fileName: string;
            mimeType: string;
            opencutProjectId: string;
          };
          const file = base64ToFile(
            base64,
            fileName || "opencut-export.mp4",
            mimeType || "video/mp4"
          );
          const asset = await uploadAsset({
            file,
            projectId,
            category: "video",
            title: file.name.replace(/\.[^.]+$/, "") || "OpenCut 成片",
          });
          const store = useCanvasStore.getState();
          const position = resolveAddNodePosition("video_input", store.nodes, {
            viewport: store.viewport,
            paneSize: store.flowPaneSize,
            selectedNodeId: store.selectedNodeId,
          });
          store.addNodeFromAsset(
            {
              id: asset.id,
              category: "video",
              fileUrl: asset.fileUrl,
              title: asset.title || "OpenCut 成片",
            },
            position
          );
          const newNodeId = useCanvasStore.getState().selectedNodeId;
          if (newNodeId) {
            store.updateNodeParam(newNodeId, "toolMode", "opencut_compose");
            store.updateNodeParam(newNodeId, "opencutProjectId", opencutProjectId);
            store.updateNodeParam(newNodeId, "composeMeta", {
              source: "opencut-classic",
              opencutProjectId,
              exportedAt: new Date().toISOString(),
            });
            store.updateNodeData(newNodeId, { label: "OpenCut 成片" });
          }
          await store.saveWorkflow(true);
          toast.success("成片已写入画布");
          event.source?.postMessage?.(
            {
              type: "jumeng:export-ack",
              v: JUMENG_BRIDGE_VERSION,
              ok: true,
              assetId: asset.id,
              nodeId: newNodeId || undefined,
            },
            { targetOrigin: OPENCUT_ORIGIN }
          );
          backToCanvas();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(`导出回画布失败：${message}`);
          event.source?.postMessage?.(
            {
              type: "jumeng:export-ack",
              v: JUMENG_BRIDGE_VERSION,
              ok: false,
              error: message,
            },
            { targetOrigin: OPENCUT_ORIGIN }
          );
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [backToCanvas, projectId]);

  return (
    <div className="relative flex h-screen min-h-0 w-full flex-1 flex-col bg-[#08080f] text-white">
      {probing ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-white/55">
          <Loader2 className="h-5 w-5 animate-spin" />
          正在连接剪辑台…
        </div>
      ) : iframeError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-rose-300">{iframeError}</p>
          <p className="max-w-md text-xs leading-relaxed text-white/45">
            剪辑台服务未就绪，请稍后再试或返回画布。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="rounded-lg bg-indigo-500/90 px-3 py-1.5 text-xs text-white hover:bg-indigo-400"
              onClick={() => {
                setIframeError(null);
                setProbing(true);
                void probeOpencut().then((ok) => {
                  setProbing(false);
                  if (!ok) {
                    setIframeError("剪辑服务暂时不可用，请稍后重试");
                  }
                });
              }}
            >
              重试连接
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white"
              onClick={backToCanvas}
            >
              返回画布
            </button>
          </div>
        </div>
      ) : (
        <>
          {!iframeReady ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-black/50 py-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在加载剪辑台…
            </div>
          ) : null}
          <iframe
            ref={iframeRef}
            title="聚梦剪辑台"
            src={src}
            className="h-full min-h-0 w-full flex-1 border-0 bg-[#08080f]"
            allow="autoplay; clipboard-read; clipboard-write; fullscreen"
            onError={() => setIframeError("无法加载 OpenCut 剪辑台")}
            onLoad={() => {
              window.setTimeout(() => {
                setIframeReady(true);
                postInit();
              }, 800);
            }}
          />
        </>
      )}
    </div>
  );
}
