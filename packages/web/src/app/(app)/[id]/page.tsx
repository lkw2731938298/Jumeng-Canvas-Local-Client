"use client";

import dynamic from "next/dynamic";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { CanvasHeader } from "@/components/canvas/CanvasHeader";
import { CanvasSyncConflictBanner } from "@/components/canvas/CanvasSyncConflictBanner";
import { CanvasPaneSkeleton } from "@/components/canvas/CanvasPaneSkeleton";
import { LocalAgentPanel } from "@/components/canvas/LocalAgentPanel";
import { OVERSEAS_LOCALIZE_SKILL } from "@/lib/canvas/overseasSession";
import { removeOverseasLocalizeNodes } from "@/lib/canvas/overseasLocalizeNode";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const FlowEditor = dynamic(
  () => import("@/components/canvas/FlowEditor").then((mod) => ({ default: mod.FlowEditor })),
  { ssr: false, loading: () => <CanvasPaneSkeleton /> }
);

const SideToolbar = dynamic(
  () => import("@/components/canvas/SideToolbar").then((mod) => ({ default: mod.SideToolbar })),
  { ssr: false }
);

const CanvasToolbar = dynamic(
  () => import("@/components/canvas/CanvasToolbar").then((mod) => ({ default: mod.CanvasToolbar })),
  { ssr: false }
);

const NodeListPanel = dynamic(
  () => import("@/components/canvas/panels/NodeListPanel").then((mod) => ({ default: mod.NodeListPanel })),
  { ssr: false }
);

const MinimapOverlay = dynamic(
  () => import("@/components/canvas/MinimapOverlay").then((mod) => ({ default: mod.MinimapOverlay })),
  { ssr: false }
);

/** 清理遗留出海节点卡，并去掉 URL 上的 skill=overseas 参数（已无独立向导）。 */
function OverseasLegacyCleanup({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isLoading = useCanvasStore((s) => s.isLoading);

  useEffect(() => {
    if (!projectId || isLoading) return;
    removeOverseasLocalizeNodes();
    const skill = searchParams.get("skill");
    if (skill === OVERSEAS_LOCALIZE_SKILL) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("skill");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [projectId, isLoading, searchParams, pathname, router]);

  return null;
}

export default function CanvasPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const isLoading = useCanvasStore((s) => s.isLoading);
  const loadError = useCanvasStore((s) => s.loadError);
  const drawingBoardOpen = useCanvasStore((s) => Boolean(s.drawingBoardNodeId));

  useProjectAssetManifest(projectId || "");

  useEffect(() => {
    void import("@/lib/api/projects");
    void import("@/lib/api/workflows");
  }, []);

  useEffect(() => {
    if (!projectId) return;
    useCanvasStore.getState().initProject(projectId);
    const flush = () => useCanvasStore.getState().flushAutoSave();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [projectId]);

  return (
    <div className="canvas-fullscreen">
      {!drawingBoardOpen ? <CanvasHeader /> : null}
      {!drawingBoardOpen ? <CanvasSyncConflictBanner /> : null}
      {loadError ? (
        <div
          className={cn(
            "absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center",
            drawingBoardOpen ? "top-0" : "top-14"
          )}
        >
          <p className="text-sm text-destructive">{loadError}</p>
          <button
            type="button"
            onClick={() => useCanvasStore.getState().initProject(projectId)}
            className="rounded-md border border-white/20 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
          >
            重试
          </button>
        </div>
      ) : (
        <>
          {!drawingBoardOpen ? <SideToolbar /> : null}
          {!drawingBoardOpen ? <NodeListPanel /> : null}
          <div className={cn("absolute inset-0 z-0", drawingBoardOpen ? "top-0" : "top-14")}>
            <FlowEditor />
          </div>
          {!drawingBoardOpen ? <CanvasToolbar /> : null}
          {!drawingBoardOpen ? <MinimapOverlay /> : null}
          {!drawingBoardOpen && projectId ? (
            <Suspense fallback={null}>
              <OverseasLegacyCleanup projectId={projectId} />
              <LocalAgentPanel projectId={projectId} />
            </Suspense>
          ) : null}
          {isLoading && !drawingBoardOpen ? (
            <div
              className="pointer-events-none absolute right-4 top-16 z-40 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/70 px-2.5 py-1 text-[11px] text-white/60"
              aria-live="polite"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              同步工作流…
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
