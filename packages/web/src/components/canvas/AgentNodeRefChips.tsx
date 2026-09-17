"use client";

/**
 * LibTV 风格：节点引用整块（缩略图 + 名称）。
 * 选择方式：画布点选（不提供列表选择器）。
 */

import {
  Clapperboard,
  Image as ImageIcon,
  LayoutGrid,
  Music,
  Type,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { typeLabelForNode, type AgentNodeRef } from "@/lib/canvas/agentNodeRefs";

function TypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === "image_input" || type === "director_stage") {
    return <ImageIcon className={className} size={12} />;
  }
  if (type === "video_input") return <Clapperboard className={className} size={12} />;
  if (type === "audio_input") return <Music className={className} size={12} />;
  if (type === "text_input" || type === "prompt") return <Type className={className} size={12} />;
  return <LayoutGrid className={className} size={12} />;
}

/** 单条引用整块：缩略图 + 名称，点击定位，可移除 */
export function AgentNodeRefChip({
  refItem,
  onRemove,
  onFocus,
}: {
  refItem: AgentNodeRef;
  onRemove?: () => void;
  onFocus?: () => void;
}) {
  const border =
    refItem.nodeType === "video_input"
      ? "border-[#ef4444]/70 dark:border-[#f87171]"
      : refItem.nodeType === "audio_input"
        ? "border-[#ec4899]/70 dark:border-[#f472b6]"
        : refItem.nodeType === "text_input" || refItem.nodeType === "prompt"
          ? "border-[#06b6d4]/70 dark:border-[#22d3ee]"
          : "border-[#0690ae] dark:border-[#07b8dd]";

  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-[180px] select-none items-center gap-1 rounded-lg border-[0.5px] pl-0.5 pr-1",
        "bg-black/[0.04] text-[11px] font-medium text-foreground/90 transition-colors",
        "dark:bg-transparent dark:text-[#f7f7f7]",
        border,
        onFocus && "cursor-pointer hover:opacity-90"
      )}
      title={`${refItem.label} · ${typeLabelForNode(refItem.nodeType)} · 点击定位`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onFocus?.();
      }}
    >
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/10 dark:bg-white/10">
        {refItem.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={refItem.thumbUrl} alt="" className="size-full object-cover" />
        ) : (
          <TypeIcon type={refItem.nodeType} className="opacity-70" />
        )}
      </span>
      <span className="min-w-0 truncate">{refItem.label}</span>
      {onRemove ? (
        <button
          type="button"
          className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded opacity-50 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
          aria-label="移除引用"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <X size={10} />
        </button>
      ) : null}
    </span>
  );
}

/** 已选引用行（嵌在输入框顶部，与正文组成一整块） */
export function AgentNodeRefChipRow({
  refs,
  onRemove,
  onFocus,
}: {
  refs: AgentNodeRef[];
  onRemove: (nodeId: string) => void;
  onFocus: (nodeId: string) => void;
}) {
  if (!refs.length) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {refs.map((r) => (
        <AgentNodeRefChip
          key={r.nodeId}
          refItem={r}
          onRemove={() => onRemove(r.nodeId)}
          onFocus={() => onFocus(r.nodeId)}
        />
      ))}
    </div>
  );
}
