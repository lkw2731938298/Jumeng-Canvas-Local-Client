/** 平台素材库：请求官网中继站公开 API（风格 / 特效 / 角色 / 提示词） */

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

/** 公开素材库基址：默认生产官网；可用环境变量覆盖（测试服 / 本地中继站） */
const MATERIAL_LIBRARY_API = (
  process.env.NEXT_PUBLIC_MATERIAL_LIBRARY_URL ||
  "https://www.jumeng.vip/api/v1/material-library"
).replace(/\/$/, "");

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function convertKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        snakeToCamel(k),
        convertKeys(v),
      ])
    );
  }
  return obj;
}

export async function listMaterialLibrary(category?: MaterialLibraryCategory) {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  const res = await fetch(`${MATERIAL_LIBRARY_API}${qs}`, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (raw as { error?: string; message?: string })?.error ||
      (raw as { message?: string })?.message ||
      `素材库请求失败（${res.status}）`;
    throw new Error(msg);
  }
  const data = convertKeys(raw) as {
    items?: MaterialLibraryItem[];
    promptCategories?: PromptLibraryCategory[];
  };
  return {
    items: data.items ?? [],
    promptCategories: data.promptCategories ?? [],
  };
}

export const materialLibraryKey = (category?: MaterialLibraryCategory) =>
  ["material-library", category ?? "all"] as const;
