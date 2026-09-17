"use client";

import { useState, useRef } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Maximize2,
  Minus,
  Plus,
  MoreHorizontal,
  Pointer,
  Hand,
  AlignStartVertical,
  Grid3X3,
  Magnet,
  Map,
  Keyboard,
} from "lucide-react";
import { CanvasShortcutsHelp } from "./CanvasShortcutsHelp";

export function CanvasToolbar() {
  const viewport = useCanvasStore((s) => s.viewport);
  const gridVisible = useCanvasStore((s) => s.gridVisible);
  const gridPattern = useCanvasStore((s) => s.gridPattern);
  const snapToGrid = useCanvasStore((s) => s.snapToGrid);
  const minimapVisible = useCanvasStore((s) => s.minimapVisible);
  const canvasMode = useCanvasStore((s) => s.canvasMode);
  const setZoom = useCanvasStore((s) => s.setZoom);
  const fitView = useCanvasStore((s) => s.fitView);
  const organizeNodes = useCanvasStore((s) => s.organizeNodes);
  const setCanvasMode = useCanvasStore((s) => s.setCanvasMode);
  const zoom = viewport.zoom;
  const update = useCanvasStore.setState;
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showGridPopover, setShowGridPopover] = useState(false);

  const showPanel = (panel: HTMLElement) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    panel.style.display = "flex";
  };

  const hidePanel = (panel: HTMLElement) => {
    if (showGridPopover) return;
    hideTimerRef.current = setTimeout(() => {
      panel.style.display = "none";
    }, 180);
  };

  const handleGridClick = () => {
    const s = useCanvasStore.getState();
    if (!s.gridVisible) {
      update({ gridVisible: true, gridPattern: "line" });
      setShowGridPopover(true);
    } else {
      update({ gridVisible: false, gridPattern: "line" });
      setShowGridPopover(false);
    }
  };

  const gridBtnCls = gridVisible ? "text-foreground bg-white/10" : "text-muted-foreground";
  const magnetCls = snapToGrid ? "text-foreground bg-white/10" : "text-muted-foreground";
  const mapCls = minimapVisible ? "text-foreground bg-white/10" : "text-muted-foreground";
  const trackCls = gridPattern === "line" ? "bg-primary" : "bg-white/20";
  const knobCls = gridPattern === "line" ? "left-0.5" : "left-[calc(50%+2px)]";

  return (
    <>
      <div
        className="absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-xl border border-primary/30 bg-white/5 px-2 py-1.5"
        style={{ backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
      >
        <Button
          variant={canvasMode === "pointer" ? "secondary" : "ghost"}
          size="icon-sm"
          className="h-8 w-8"
          onClick={() => setCanvasMode(canvasMode === "pointer" ? "drag" : "pointer")}
          title={
            canvasMode === "pointer"
              ? "指针模式 (Ctrl+空格切换)"
              : "拖拽模式 (Ctrl+空格切换)"
          }
        >
          {canvasMode === "pointer" ? (
            <Pointer className="h-4 w-4" />
          ) : (
            <Hand className="h-4 w-4" />
          )}
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8"
          onClick={() => fitView?.()}
          title="适应画布 (Ctrl+0)"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8"
          onClick={() => setZoom(Math.max(0.1, zoom - 0.1))}
          title="缩小"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="w-10 text-center text-xs text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-8 w-8"
          onClick={() => setZoom(Math.min(5, zoom + 0.1))}
          title="放大"
        >
          <Plus className="h-3 w-3" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button
          variant={shortcutsOpen ? "secondary" : "ghost"}
          size="icon-sm"
          className="h-8 w-8"
          onClick={() => setShortcutsOpen((v) => !v)}
          title="快捷键"
          aria-label="快捷键"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div
          className="relative"
          onMouseEnter={(e) => {
            showPanel(e.currentTarget.querySelector(".more-panel") as HTMLElement);
          }}
          onMouseLeave={(e) => {
            hidePanel(e.currentTarget.querySelector(".more-panel") as HTMLElement);
          }}
        >
          <Button variant="ghost" size="icon-sm" className="h-8 w-8" title="更多工具">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          <div
            className="more-panel absolute bottom-full right-0 z-30 mb-2 flex-col gap-1 rounded-xl border border-primary/30 bg-white/5 p-1.5"
            style={{
              display: "none",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
            }}
            onMouseEnter={() => {
              if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.display = "none";
              setShowGridPopover(false);
            }}
          >
            <button
              onClick={() => organizeNodes?.()}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-white/5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
              title="整理节点"
            >
              <AlignStartVertical className="h-4 w-4" />
            </button>
            <div className="relative">
              <button
                onClick={handleGridClick}
                className={
                  "flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-white/5 transition-colors hover:bg-white/10 " +
                  gridBtnCls
                }
                style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
                title="网格"
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              {showGridPopover && (
                <div
                  className="absolute right-full top-1/2 z-40 mr-2 w-12 -translate-y-1/2 rounded-xl border border-primary/30 bg-white/5 px-2 py-2"
                  style={{
                    backdropFilter: "blur(24px)",
                    WebkitBackdropFilter: "blur(24px)",
                  }}
                >
                  <div className="relative h-5 w-8">
                    <div className={"absolute inset-0 rounded-full transition-colors " + trackCls}>
                      <div
                        className={
                          "absolute top-0.5 h-4 w-[calc(50%-2px)] cursor-pointer rounded-full bg-white shadow transition-transform " +
                          knobCls
                        }
                        onClick={() =>
                          update({ gridPattern: gridPattern === "line" ? "dot" : "line" })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => update({ snapToGrid: !snapToGrid })}
              className={
                "flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-white/5 transition-colors hover:bg-white/10 " +
                magnetCls
              }
              style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
              title="吸附网格"
            >
              <Magnet className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                update({ minimapVisible: !minimapVisible });
              }}
              className={
                "flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-white/5 transition-colors hover:bg-white/10 " +
                mapCls
              }
              style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
              title="小地图"
            >
              <Map className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <CanvasShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
