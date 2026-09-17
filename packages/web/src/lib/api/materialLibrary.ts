/** 平台素材库（风格 / 特效 / 角色 / 提示词）用户只读 API */

import { apiFetch } from "./client";

export type MaterialLibraryCategory = "style" | "effect" | "character" | "prompt";

/** 提示词库二级分类（后台可配置） */
export interface PromptLibraryCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
}

export interface MaterialLibraryItem {
  id: string;
  category: MaterialLibraryCategory;
  title: string;
  mediaType: "image" | "video";
  ossKey: string;
  mediaUrl: string;
  /** 提示词库正文；其它类别为空 */
  promptText?: string;
  /** 提示词库二级分类；未分类为空 */
  promptCategoryId?: string | null;
  promptCategoryName?: string;
  sortOrder: number;
  isActive?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export function listMaterialLibrary(category?: MaterialLibraryCategory) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return apiFetch<{ items: MaterialLibraryItem[]; promptCategories?: PromptLibraryCategory[] }>(
    `/api/v1/material-library${qs}`
  );
}

export const materialLibraryKey = (category?: MaterialLibraryCategory) =>
  ["material-library", category ?? "all"] as const;
