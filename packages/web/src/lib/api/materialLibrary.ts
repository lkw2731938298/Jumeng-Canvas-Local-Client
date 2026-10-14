/** 平台素材库：请求官网中继站公开 API（风格 / 特效 / 角色 / 提示词 / 模板） */

export type MaterialLibraryCategory =
  | "style"
  | "effect"
  | "character"
  | "prompt"
  | "template";

/** 各库二级分类标签（后台可配置；模板库也可来自首页广场 cats） */
export interface LibraryTagCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive?: boolean;
}

/** @deprecated 使用 LibraryTagCategory */
export type PromptLibraryCategory = LibraryTagCategory;

export interface MaterialLibraryItem {
  id: string;
  category: MaterialLibraryCategory;
  title: string;
  mediaType: "image" | "video";
  ossKey: string;
  mediaUrl: string;
  /** 模板库：本地画布导出 zip 公开直链；其它类别为空 */
  packageUrl?: string;
  /** 提示词库正文；其它类别为空 */
  promptText?: string;
  /** 提示词库二级分类；未分类为空 */
  promptCategoryId?: string | null;
  promptCategoryName?: string;
  styleCategoryId?: string | null;
  styleCategoryName?: string;
  effectCategoryId?: string | null;
  effectCategoryName?: string;
  characterCategoryId?: string | null;
  characterCategoryName?: string;
  templateCategoryId?: string | null;
  templateCategoryName?: string;
  sortOrder: number;
  isActive?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface MaterialLibraryListResult {
  items: MaterialLibraryItem[];
  /** 当前库二级分类（风格/特效/角色/提示词/模板） */
  categories: LibraryTagCategory[];
  /** 兼容旧调用 */
  promptCategories: LibraryTagCategory[];
}

/** 公开素材库基址：默认生产官网；可用环境变量覆盖（测试服 / 本地中继站） */
const MATERIAL_LIBRARY_API = (
  process.env.NEXT_PUBLIC_MATERIAL_LIBRARY_URL ||
  "https://www.jumeng.vip/api/v1/material-library"
).replace(/\/$/, "");

/** 官网 Origin（首页广场 /api/content/home 与素材库同源） */
function siteOrigin(): string {
  try {
    return new URL(MATERIAL_LIBRARY_API).origin;
  } catch {
    return "https://www.jumeng.vip";
  }
}

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

/** 按库类型取出条目上的二级分类 id（模板广场用分类名作 id） */
export function itemLibraryTagId(
  item: MaterialLibraryItem,
  category: MaterialLibraryCategory
): string {
  switch (category) {
    case "style":
      return String(item.styleCategoryId || "").trim();
    case "effect":
      return String(item.effectCategoryId || "").trim();
    case "character":
      return String(item.characterCategoryId || "").trim();
    case "prompt":
      return String(item.promptCategoryId || "").trim();
    case "template":
      return String(item.templateCategoryId || item.templateCategoryName || "").trim();
    default:
      return "";
  }
}

/** 保证列表 id 唯一（后台/广场偶发重复 id 会触发 React key 警告） */
function uniquifyMaterialItemIds(items: MaterialLibraryItem[]): MaterialLibraryItem[] {
  const seen = new Set<string>();
  return items.map((it, i) => {
    let id = String(it?.id || "").trim() || `item-${i}`;
    if (seen.has(id)) id = `${id}__${i}`;
    seen.add(id);
    return id === it.id ? it : { ...it, id };
  });
}

function categoriesFor(
  data: Record<string, unknown>,
  category?: MaterialLibraryCategory
): LibraryTagCategory[] {
  const pick = (key: string) =>
    (Array.isArray(data[key]) ? data[key] : []) as LibraryTagCategory[];
  if (!category) {
    return [
      ...pick("styleCategories"),
      ...pick("effectCategories"),
      ...pick("characterCategories"),
      ...pick("promptCategories"),
      ...pick("templateCategories"),
    ];
  }
  const map: Record<MaterialLibraryCategory, string> = {
    style: "styleCategories",
    effect: "effectCategories",
    character: "characterCategories",
    prompt: "promptCategories",
    template: "templateCategories",
  };
  return pick(map[category]);
}

function isZipUrl(url: string): boolean {
  return /\.zip(\?|#|$)/i.test(String(url || "").trim());
}

/** 封面若是视频文件，不能当 img，否则缩略图空白 */
export function isVideoMediaUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(String(url || "").trim());
}

/**
 * 首页广场「模版库」作品 → 画布模板条目。
 * 与 materials 后台 template 分类并行；广场有封面 + zip 即可导入。
 */
export async function listPlazaTemplateLibrary(): Promise<MaterialLibraryListResult> {
  const url = `${siteOrigin()}/api/content/home`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (raw as { error?: string; message?: string })?.error ||
      (raw as { message?: string })?.message ||
      `模版库请求失败（${res.status}）`;
    throw new Error(msg);
  }
  const data = convertKeys(raw) as {
    content?: {
      plaza?: {
        cats?: string[];
        works?: Array<{
          id?: string;
          title?: string;
          cat?: string;
          coverUrl?: string;
          cover?: string;
          file?: string;
          packageUrl?: string;
          video?: string;
          workflow?: string;
          api?: string;
          isTemplate?: boolean;
          likes?: number;
        }>;
      };
    };
  };
  const plaza = data.content?.plaza || {};
  const works = Array.isArray(plaza.works) ? plaza.works : [];
  const rawCats = Array.isArray(plaza.cats) ? plaza.cats : [];

  const items: MaterialLibraryItem[] = [];
  for (let i = 0; i < works.length; i++) {
    const w = works[i];
    if (!w) continue;
    const pack = String(w.packageUrl || w.file || "").trim();
    // 封面可能是 mp4；没有静图时再用作品视频
    const cover = String(w.coverUrl || w.cover || w.video || "").trim();
    // 无可导入 zip 的作品跳过（广场「打开工作流」类不进画布模板库）
    if (!pack || !isZipUrl(pack)) continue;
    const catName = String(w.cat || "").trim();
    // 广场作品 id 常重复（如多条都是 w3），必须带下标保证 React key / 导入态唯一
    const rawId = String(w.id || "").trim();
    items.push({
      id: rawId ? `plaza-${rawId}-${i}` : `plaza-${i}`,
      category: "template",
      title: String(w.title || "未命名模板").trim() || "未命名模板",
      mediaType: isVideoMediaUrl(cover) ? "video" : "image",
      ossKey: "",
      mediaUrl: cover,
      packageUrl: pack,
      templateCategoryId: catName || null,
      templateCategoryName: catName,
      sortOrder: i,
      isActive: true,
    });
  }

  // 广场分类名即筛选 id；去掉「全部」占位
  const categories: LibraryTagCategory[] = rawCats
    .map((name, idx) => String(name || "").trim())
    .filter((name) => name && name !== "全部")
    .map((name, idx) => ({
      id: name,
      name,
      sortOrder: idx,
      isActive: true,
    }));

  return { items, categories, promptCategories: [] };
}

export async function listMaterialLibrary(
  category?: MaterialLibraryCategory
): Promise<MaterialLibraryListResult> {
  // 模板库：优先连通官网首页广场模版库（neo-main），再合并素材后台 template 条目
  if (category === "template") {
    const plaza = await listPlazaTemplateLibrary().catch(() => null);
    const qs = `?category=${encodeURIComponent("template")}`;
    const res = await fetch(`${MATERIAL_LIBRARY_API}${qs}`, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    const raw = await res.json().catch(() => ({}));
    const data = convertKeys(raw) as Record<string, unknown>;
    const adminItems = res.ok
      ? (((data.items as MaterialLibraryItem[]) || []).filter(
          (it) => it && (it.packageUrl || "").trim()
        ) as MaterialLibraryItem[])
      : [];
    const adminCats = categoriesFor(data, "template");

    const seen = new Set<string>();
    const merged: MaterialLibraryItem[] = [];
    for (const it of [...(plaza?.items || []), ...adminItems]) {
      const key = String(it.packageUrl || it.id).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(it);
    }

    // 分类：广场 cats + 后台 templateCategories，按名称去重
    const catSeen = new Set<string>();
    const categories: LibraryTagCategory[] = [];
    for (const c of [...(plaza?.categories || []), ...adminCats]) {
      const id = String(c.id || c.name || "").trim();
      if (!id || catSeen.has(id)) continue;
      catSeen.add(id);
      categories.push({
        id,
        name: String(c.name || id).trim() || id,
        sortOrder: Number(c.sortOrder) || categories.length,
        isActive: c.isActive !== false,
      });
    }

    return {
      items: uniquifyMaterialItemIds(merged),
      categories,
      promptCategories: [],
    };
  }

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
  const data = convertKeys(raw) as Record<string, unknown>;
  const cats = categoriesFor(data, category);
  return {
    items: uniquifyMaterialItemIds((data.items as MaterialLibraryItem[]) ?? []),
    categories: cats,
    promptCategories:
      category === "prompt" || !category
        ? ((data.promptCategories as LibraryTagCategory[]) ?? cats)
        : [],
  };
}

export const materialLibraryKey = (category?: MaterialLibraryCategory) =>
  ["material-library", category ?? "all"] as const;
