"use client";

import type { MaterialLibraryItem, PromptLibraryCategory } from "@/lib/api/materialLibrary";

export const PROMPT_LIBRARY_FILTER_ALL = "all";
export const PROMPT_LIBRARY_FILTER_NONE = "uncategorized";

export type PromptLibraryFilterId =
  | typeof PROMPT_LIBRARY_FILTER_ALL
  | typeof PROMPT_LIBRARY_FILTER_NONE
  | string;

/** 按所选分类筛提示词库条目。 */
export function filterPromptLibraryItems(
  items: MaterialLibraryItem[],
  filterId: PromptLibraryFilterId
): MaterialLibraryItem[] {
  if (filterId === PROMPT_LIBRARY_FILTER_ALL) return items;
  if (filterId === PROMPT_LIBRARY_FILTER_NONE) {
    return items.filter((item) => !String(item.promptCategoryId || "").trim());
  }
  return items.filter((item) => String(item.promptCategoryId || "") === filterId);
}

export function PromptLibraryCategoryFilter({
  categories,
  items,
  value,
  onChange,
}: {
  categories: PromptLibraryCategory[];
  items: MaterialLibraryItem[];
  value: PromptLibraryFilterId;
  onChange: (next: PromptLibraryFilterId) => void;
}) {
  const activeCats = categories.filter((c) => c.isActive !== false && c.id && c.name);
  if (activeCats.length === 0) return null;

  const hasUncategorized = items.some((item) => !String(item.promptCategoryId || "").trim());
  const chips: { id: PromptLibraryFilterId; label: string }[] = [
    { id: PROMPT_LIBRARY_FILTER_ALL, label: "全部" },
    ...activeCats.map((c) => ({ id: c.id, label: c.name })),
  ];
  if (hasUncategorized) {
    chips.push({ id: PROMPT_LIBRARY_FILTER_NONE, label: "未分类" });
  }

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const active = value === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              active
                ? "bg-white/15 text-white"
                : "bg-white/[0.04] text-white/45 hover:bg-white/[0.08] hover:text-white/70"
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
