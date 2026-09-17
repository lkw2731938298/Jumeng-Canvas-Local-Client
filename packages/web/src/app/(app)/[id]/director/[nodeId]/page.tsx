"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { canvasHref } from "@/lib/canvas/directorNavigation";
import { DirectorStageHeader } from "@/components/canvas/director/DirectorStageHeader";
import type { WorkflowNodeData } from "@/types/workflow";

const DirectorStageView = dynamic(
  () => import("@/components/canvas/director/DirectorStageView").then((m) => m.DirectorStageView),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-white/40">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载导演台…
      </div>
    ),
  }
);

export default function DirectorStagePage() {
  const params = useParams<{ id: string; nodeId: string }>();
  const router = useRouter();
  const projectId = params.id ?? "";
  const nodeId = decodeURIComponent(params.nodeId ?? "");

  const isLoading = useCanvasStore((s) => s.isLoading);
  const loadError = useCanvasStore((s) => s.loadError);
  const nodes = useCanvasStore((s) => s.nodes);

  const node = useMemo(
    () => (nodeId ? nodes.find((n) => n.id === nodeId) ?? null : null),
    [nodeId, nodes]
  );
  const nodeLabel = (node?.data as WorkflowNodeData | undefined)?.label ?? "导演台";

  useProjectAssetManifest(projectId);

  useEffect(() => {
    if (!projectId) return;
    const state = useCanvasStore.getState();
    if (state.projectId !== projectId) {
      void state.initProject(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    const flush = () => useCanvasStore.getState().flushAutoSave();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (isLoading || !projectId || !nodeId) return;
    if (!node || node.type !== "director_stage") {
      router.replace(canvasHref(projectId));
    }
  }, [isLoading, node, nodeId, projectId, router]);

  if (!projectId || !nodeId) {
    return null;
  }

  if (loadError) {
    return (
      <div className="canvas-fullscreen flex flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-sm text-destructive">{loadError}</p>
        <button
          type="button"
          onClick={() => void useCanvasStore.getState().initProject(projectId)}
          className="rounded-md bg-primary/20 px-4 py-2 text-sm text-primary hover:bg-primary/30"
        >
          重试
        </button>
      </div>
    );
  }

  if (isLoading || !node || node.type !== "director_stage") {
    return (
      <div className="canvas-fullscreen flex flex-col bg-black">
        <div className="flex flex-1 items-center justify-center text-sm text-white/40">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载项目…
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-fullscreen flex flex-col bg-black">
      <DirectorStageHeader projectId={projectId} nodeLabel={nodeLabel} />
      <div className="min-h-0 flex-1">
        <DirectorStageView projectId={projectId} nodeId={nodeId} />
      </div>
    </div>
  );
}
