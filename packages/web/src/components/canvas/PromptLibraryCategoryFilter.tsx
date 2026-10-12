"use client";

import type {
  LibraryTagCategory,
  MaterialLibraryCategory,
  MaterialLibraryItem,
  PromptLibraryCategory,
} from "@/lib/api/materialLibrary";
import { itemLibraryTagId } from "@/lib/api/materialLibrary";

export const PROMPT_LIBRARY_FILTER_ALL = "all";
export const PROMPT_LIBRARY_FILTER_NONE = "uncategorized";

export type PromptLibraryFilterId =
  | typeof PROMPT_LIBRARY_FILTER_ALL
  | typeof PROMPT_LIBRARY_FILTER_NONE
  | string;

/** 按所选二级分类筛素材库条目（风格/特效/角色/提示词/模板通用）。 */
export function filterLibraryItemsByTag(
  items: MaterialLibraryItem[],
  filterId: PromptLibraryFilterId,
  library: MaterialLibraryCategory
): MaterialLibraryItem[] {
  if (filterId === PROMPT_LIBRARY_FILTER_ALL) return items;
  if (filterId === PROMPT_LIBRARY_FILTER_NONE) {
    return items.filter((item) => !itemLibraryTagId(item, library));
  }
  return items.filter((item) => itemLibraryTagId(item, library) === filterId);
}

/** @deprecated 使用 filterLibraryItemsByTag(..., "prompt") */
export function filterPromptLibraryItems(
  items: MaterialLibraryItem[],
  filterId: PromptLibraryFilterId
): MaterialLibraryItem[] {
  return filterLibraryItemsByTag(items, filterId, "prompt");
}

/** 各库二级分类筛选条（全部 / 标签 / 未分类）。 */
export function MaterialLibraryCategoryFilter({
  categories,
  items,
  library,
  value,
  onChange,
}: {
  categories: LibraryTagCategory[] | PromptLibraryCategory[];
  items: MaterialLibraryItem[];
  library: MaterialLibraryCategory;
  value: PromptLibraryFilterId;
  onChange: (next: PromptLibraryFilterId) => void;
}) {
  const activeCats = categories.filter((c) => c.isActive !== false && c.id && c.name);
  // 无后台标签、且条目上也没有任何分类时不展示（避免空条）
  const anyTagged = items.some((item) => Boolean(itemLibraryTagId(item, library)));
  if (activeCats.length === 0 && !anyTagged) return null;

  const hasUncategorized = items.some((item) => !itemLibraryTagId(item, library));
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

/** @deprecated 使用 MaterialLibraryCategoryFilter */
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
  return (
    <MaterialLibraryCategoryFilter
      categories={categories}
      items={items}
      library="prompt"
      value={value}
      onChange={onChange}
    />
  );
}
