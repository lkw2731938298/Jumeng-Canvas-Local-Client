"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { Button } from "@/components/ui/button";

export function CanvasSyncConflictBanner() {
  const syncConflict = useCanvasStore((s) => s.syncConflict);
  const reloadWorkflowFromServer = useCanvasStore((s) => s.reloadWorkflowFromServer);
  const dismissSyncConflict = useCanvasStore((s) => s.dismissSyncConflict);
  const [loading, setLoading] = useState(false);

  if (!syncConflict) return null;

  const handleReload = async () => {
    setLoading(true);
    try {
      await reloadWorkflowFromServer();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="absolute left-1/2 top-16 z-40 flex w-[min(92vw,520px)] -translate-x-1/2 items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-950/80 px-4 py-2.5 text-sm text-amber-50 shadow-lg backdrop-blur-xl"
      role="alert"
    >
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        其他协作者已更新画布（版本 {syncConflict.serverRevision}），当前编辑可能无法保存。
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 border-amber-500/20 bg-amber-500/10 text-amber-50 hover:bg-amber-500/20"
          disabled={loading}
          onClick={() => void handleReload()}
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          拉取最新
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 text-amber-100/70 hover:bg-amber-500/10 hover:text-amber-50"
          onClick={dismissSyncConflict}
        >
          稍后
        </Button>
      </div>
    </div>
  );
}
