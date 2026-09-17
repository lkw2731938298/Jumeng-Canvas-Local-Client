"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listModelUiTags, type ModelUiTag } from "@/lib/api/models";
import type { ModelOption } from "@/lib/canvas/nodeModelRouting";
import { cn } from "@/lib/utils";

interface ModelTagPickerProps {
  category: string | null | undefined;
  modelOptions: ModelOption[];
  activeTagId: string | null;
  onActiveTagChange: (tagId: string | null) => void;
}

/**
 * 放在模型下拉顶端：仅点击标签过滤列表（无悬停子菜单）。
 */
export function ModelTagPicker({
  category,
  modelOptions,
  activeTagId,
  onActiveTagChange,
}: ModelTagPickerProps) {
  const { data } = useQuery({
    queryKey: ["models", "ui-tags", category ?? ""],
    queryFn: () => listModelUiTags({ category: category || undefined }),
    staleTime: 60_000,
    enabled: Boolean(category),
  });

  const visibleTags = useMemo(() => {
    const tags = data?.tags ?? [];
    return tags.filter((tag) =>
      modelOptions.some((opt) => (opt.uiTagIds ?? []).includes(tag.id))
    );
  }, [data?.tags, modelOptions]);

  if (!visibleTags.length) return null;

  return (
    <div
      className="sticky top-0 z-10 -mx-1 mb-1 border-b border-white/10 bg-[#1a1a28] px-2 pb-2 pt-1"
      // 避免点标签时关闭 / 误选 Select
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex flex-wrap items-center gap-1">
        {visibleTags.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            active={activeTagId === tag.id}
            onClick={() => onActiveTagChange(activeTagId === tag.id ? null : tag.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TagChip({
  tag,
  active,
  onClick,
}: {
  tag: ModelUiTag;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${tag.label}（点击过滤列表）`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
        active
          ? "border-purple-400/50 bg-purple-500/25 text-purple-50"
          : "border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:text-white/80"
      )}
    >
      {tag.label}
    </button>
  );
}
