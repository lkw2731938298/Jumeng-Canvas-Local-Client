"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, Loader2 } from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { canvasHref } from "@/lib/canvas/directorNavigation";
import { runDirectorExitPreviewCapture } from "@/lib/director/exitPreviewCapture";

interface DirectorStageHeaderProps {
  projectId: string;
  nodeLabel: string;
}

export function DirectorStageHeader({ projectId, nodeLabel }: DirectorStageHeaderProps) {
  const router = useRouter();
  const projectName = useCanvasStore((s) => s.projectName);
  const projectNo = useCanvasStore((s) => s.projectNo);
  const [leaving, setLeaving] = useState(false);

  const backToCanvas = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      // 退出前把当前视口写入节点 imageUrl，供卡片预览与下游参考图使用
      await runDirectorExitPreviewCapture();
      await useCanvasStore.getState().flushAutoSave();
    } catch {
      /* errors surfaced by saveWorkflow when not silent */
    }
    router.push(canvasHref(projectId));
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-black/40 px-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={() => void backToCanvas()}
          disabled={leaving}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          {leaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeft className="h-4 w-4" />}
          返回画布
        </button>
        <span className="text-white/25">|</span>
        <div className="flex min-w-0 items-center gap-2">
          <Clapperboard className="h-4 w-4 shrink-0 text-indigo-300" />
          <span className="truncate text-sm font-medium text-white/90">{nodeLabel}</span>
        </div>
        {projectNo ? (
          <>
            <span className="hidden text-white/25 sm:inline">·</span>
            <span className="hidden truncate text-xs text-white/40 sm:inline">
              {projectNo}
              {projectName ? ` / ${projectName}` : ""}
            </span>
          </>
        ) : null}
      </div>
      <p className="hidden text-xs text-white/35 md:block">3D 构图 · 机位 · 截图可回写分镜</p>
    </header>
  );
}
