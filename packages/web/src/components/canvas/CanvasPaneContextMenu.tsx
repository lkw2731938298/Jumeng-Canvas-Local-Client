"use client";

import { cn } from "@/lib/utils";

export type CanvasPaneMenuAction =
  | "upload"
  | "saveAsset"
  | "addNode"
  | "screenshot"
  | "undo"
  | "redo"
  | "paste";

interface MenuItem {
  id: CanvasPaneMenuAction;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

interface CanvasPaneContextMenuProps {
  x: number;
  y: number;
  canUndo: boolean;
  canRedo: boolean;
  canSaveAsset: boolean;
  onAction: (action: CanvasPaneMenuAction) => void;
  onClose: () => void;
}

function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl+";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl+";
}

/** 画布空白处右键菜单（上传 / 截图 / 撤销重做 / 粘贴） */
export function CanvasPaneContextMenu({
  x,
  y,
  canUndo,
  canRedo,
  canSaveAsset,
  onAction,
  onClose,
}: CanvasPaneContextMenuProps) {
  const mod = modKey();
  const items: MenuItem[] = [
    { id: "upload", label: "上传" },
    { id: "saveAsset", label: "保存到我的资产", disabled: !canSaveAsset },
    { id: "addNode", label: "添加节点" },
    { id: "screenshot", label: "截图" },
    { id: "undo", label: "撤销", shortcut: `${mod}Z`, disabled: !canUndo, separatorBefore: true },
    {
      id: "redo",
      label: "重做",
      shortcut: mod === "⌘" ? `⇧${mod}Z` : "Ctrl+Shift+Z / Ctrl+Y",
      disabled: !canRedo,
    },
    { id: "paste", label: "粘贴", shortcut: `${mod}V`, separatorBefore: true },
  ];

  return (
    <>
      <div className="fixed inset-0 z-[90]" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-[91] min-w-[180px] overflow-hidden rounded-xl border border-white/10 bg-[rgba(34,34,42,0.98)] py-1 shadow-2xl backdrop-blur-xl"
        style={{ left: x, top: y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) => (
          <div key={item.id}>
            {item.separatorBefore ? (
              <div className="my-1 h-px bg-white/10" aria-hidden />
            ) : null}
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                onAction(item.id);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-6 px-3.5 py-2 text-left text-[13px] transition-colors",
                item.disabled
                  ? "cursor-not-allowed text-white/30"
                  : "text-white/85 hover:bg-white/[0.08]"
              )}
            >
              <span>{item.label}</span>
              {item.shortcut ? (
                <span className="text-[12px] text-white/35 tabular-nums">{item.shortcut}</span>
              ) : null}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
