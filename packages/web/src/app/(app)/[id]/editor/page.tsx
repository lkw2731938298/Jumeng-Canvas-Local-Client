"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";

const OpenCutClassicHost = dynamic(
  () =>
    import("@/components/canvas/editor/OpenCutClassicHost").then(
      (m) => m.OpenCutClassicHost
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-white/40">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载剪辑台…
      </div>
    ),
  }
);

/** 剪辑页：嵌入 OpenCut classic */
export default function VideoEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="canvas-fullscreen flex flex-1 items-center justify-center bg-black text-sm text-white/40">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          加载剪辑台…
        </div>
      }
    >
      <VideoEditorPageInner />
    </Suspense>
  );
}

function VideoEditorPageInner() {
  const params = useParams<{ id: string }>();
  const projectId = params.id ?? "";

  const isLoading = useCanvasStore((s) => s.isLoading);
  const loadError = useCanvasStore((s) => s.loadError);

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

  if (!projectId) return null;

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

  if (isLoading) {
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
      <OpenCutClassicHost projectId={projectId} />
    </div>
  );
}
