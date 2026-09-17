"use client";

import { Loader2, Upload } from "lucide-react";

interface MediaUploadOverlayProps {
  uploading: boolean;
  label: string;
  onOpenMenu: () => void;
  /** Empty state: centered in card body. */
  placement?: "center" | "above";
  /** Above placement: controlled by card click. */
  visible?: boolean;
  /** 仅显示上传图标，文字用 title / aria-label */
  iconOnly?: boolean;
}

export function MediaUploadOverlay({
  uploading,
  label,
  onOpenMenu,
  placement = "center",
  visible = false,
  iconOnly = false,
}: MediaUploadOverlayProps) {
  const title = uploading ? "上传中…" : label;

  if (placement === "above") {
    if (!visible) return null;

    return (
      <div className="absolute bottom-full left-1/2 z-30 mb-1.5 w-max -translate-x-1/2">
        <button
          type="button"
          title={title}
          aria-label={title}
          className={
            iconOnly
              ? "nodrag nopan flex size-9 items-center justify-center rounded-lg border border-white/15 bg-[rgba(18,18,28,0.96)] text-white/80 shadow-xl backdrop-blur-sm transition-colors hover:border-purple-400/40 hover:text-white"
              : "nodrag nopan flex items-center gap-1.5 rounded-lg border border-white/15 bg-[rgba(18,18,28,0.96)] px-3 py-2 text-[13px] text-white/80 shadow-xl backdrop-blur-sm transition-colors hover:border-purple-400/40 hover:text-white"
          }
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {!iconOnly ? <span>{title}</span> : null}
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center">
      <button
        type="button"
        title={title}
        aria-label={title}
        className={
          iconOnly
            ? "nodrag nopan flex size-12 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
            : "nodrag nopan flex flex-col items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-white/75 transition-colors hover:text-white"
        }
        onClick={(e) => {
          e.stopPropagation();
          onOpenMenu();
        }}
      >
        {uploading ? (
          <Loader2 className={iconOnly ? "h-6 w-6 animate-spin" : "h-5 w-5 animate-spin"} />
        ) : (
          <Upload className={iconOnly ? "h-6 w-6" : "h-5 w-5"} />
        )}
        {!iconOnly ? (
          <span className="text-[13px]">{title}</span>
        ) : null}
      </button>
    </div>
  );
}
