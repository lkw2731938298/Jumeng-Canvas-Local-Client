"use client";

import { useEffect, useRef } from "react";
import { FolderOpen, Paintbrush, Pencil, Upload } from "lucide-react";

interface MediaSourceMenuProps {
  /** Wrapper inside the node — used to detect clicks within the node card. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onUpload: () => void;
  onPickAsset: () => void;
  /** 展示「画图绘制」（有图/无图均可；有图时画板会带入当前节点图） */
  showDraw?: boolean;
  onDraw?: () => void;
  /** 有图且存在画板草稿时展示「继续编辑画板」 */
  showContinueEdit?: boolean;
  onContinueEdit?: () => void;
  onClose: () => void;
}

export function MediaSourceMenu({
  anchorRef,
  onUpload,
  onPickAsset,
  showDraw = false,
  onDraw,
  showContinueEdit = false,
  onContinueEdit,
  onClose,
}: MediaSourceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      const nodeEl = anchorRef.current?.closest(".react-flow__node");
      if (nodeEl?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchorRef, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="nodrag nopan fixed left-1/2 top-1/2 z-[56] min-w-[160px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-white/10 bg-[rgba(18,18,28,0.96)] shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => {
          onClose();
          onUpload();
        }}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] text-white/75 hover:bg-white/10"
      >
        <Upload className="h-4 w-4" />
        本地上传
      </button>
      <button
        type="button"
        onClick={() => {
          onClose();
          onPickAsset();
        }}
        className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2.5 text-[13px] text-white/75 hover:bg-white/10"
      >
        <FolderOpen className="h-4 w-4" />
        从资产选择
      </button>
      {showContinueEdit && onContinueEdit ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            onContinueEdit();
          }}
          className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2.5 text-[13px] text-white/75 hover:bg-white/10"
        >
          <Pencil className="h-4 w-4" />
          继续编辑画板
        </button>
      ) : null}
      {showDraw && onDraw ? (
        <button
          type="button"
          onClick={() => {
            onClose();
            onDraw();
          }}
          className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2.5 text-[13px] text-white/75 hover:bg-white/10"
        >
          <Paintbrush className="h-4 w-4" />
          画图绘制
        </button>
      ) : null}
    </div>
  );
}
