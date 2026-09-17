"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { VisualStyleItem } from "@/lib/canvas/renderToolPrompt";
import { resolveVisualStyleImageUrl } from "@/lib/canvas/visualStyleImage";

interface VisualStylePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  styles: VisualStyleItem[];
  value: string;
  onSelect: (styleId: string) => void;
}

function StylePreview({ style }: { style: VisualStyleItem }) {
  const imageUrl = resolveVisualStyleImageUrl(style.imageUrl);
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={style.label}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500/25 via-fuchsia-500/15 to-sky-500/20 text-[11px] text-white/45">
      风格预览
    </div>
  );
}

export function VisualStylePickerDialog({
  open,
  onOpenChange,
  styles,
  value,
  onSelect,
}: VisualStylePickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden border-white/10 bg-[#1c1c26] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">选择视觉风格</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {styles.map((style) => {
              const active = style.id === value;
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => {
                    onSelect(style.id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "overflow-hidden rounded-xl border text-left transition-colors",
                    active
                      ? "border-purple-400/80 bg-purple-500/10 shadow-[inset_0_0_0_1px_rgba(192,132,252,0.55)]"
                      : "border-white/12 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                  )}
                >
                  <div className="aspect-video w-full overflow-hidden border-b border-white/8">
                    <StylePreview style={style} />
                  </div>
                  <p className="truncate px-2 py-2 text-center text-[13px] font-medium text-white/85">
                    {style.label}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
