/**
 * 平台素材库节点约定：风格 / 特效 / 角色落画布后锁定（无上下弹窗），仅作参考源。
 * 提示词库落可编辑文本节点（写入正文后用户可改）。
 */

import type { Node } from "@xyflow/react";
import { isSeedance20Model } from "@/lib/canvas/videoGenerationModes";
import type { MaterialLibraryCategory, MaterialLibraryItem } from "@/lib/api/materialLibrary";

export type { MaterialLibraryCategory };

export const LIBRARY_PARAM_LOCKED = "libraryLocked";
export const LIBRARY_PARAM_CATEGORY = "libraryCategory";
export const LIBRARY_PARAM_ITEM_ID = "libraryItemId";
export const LIBRARY_PARAM_OSS_KEY = "libraryOssKey";

export function isLibraryLockedParams(params: Record<string, unknown> | undefined | null): boolean {
  return Boolean(params?.[LIBRARY_PARAM_LOCKED]);
}

/** UI 是否锁定（底栏/顶栏/上传）：提示词库文本可编辑，即使历史节点带 libraryLocked */
export function isLibraryUiLockedParams(
  params: Record<string, unknown> | undefined | null
): boolean {
  if (!isLibraryLockedParams(params)) return false;
  return getLibraryCategory(params) !== "prompt";
}

export function getLibraryCategory(
  params: Record<string, unknown> | undefined | null
): MaterialLibraryCategory | null {
  const raw = String(params?.[LIBRARY_PARAM_CATEGORY] ?? "");
  if (raw === "style" || raw === "effect" || raw === "character" || raw === "prompt") {
    return raw;
  }
  return null;
}

export function isLibraryLockedNode(node: Node | undefined | null): boolean {
  if (!node) return false;
  const params = (node.data as { params?: Record<string, unknown> } | undefined)?.params;
  return isLibraryLockedParams(params);
}

/** 按库类别与媒体决定落画布节点类型；提示词库固定落文本节点 */
export function libraryNodeTypeForItem(
  item: MaterialLibraryItem
): "image_input" | "video_input" | "text_input" {
  if (item.category === "prompt") return "text_input";
  // 以实际上传媒体为准：特效库也可有 GIF/WebP 图
  if (item.mediaType === "video") return "video_input";
  if (item.mediaType === "image") return "image_input";
  return item.category === "effect" ? "video_input" : "image_input";
}

/** 从素材库条目取出提示词正文（兼容 camelCase / snake_case） */
export function libraryPromptTextFromItem(item: MaterialLibraryItem): string {
  const rec = item as MaterialLibraryItem & { prompt_text?: string };
  return String(rec.promptText || rec.prompt_text || "").trim();
}

/** 构建素材库节点 params（复用 image/video/text 节点；媒体类加锁定，提示词可编辑） */
export function buildLibraryNodeParams(item: MaterialLibraryItem): Record<string, unknown> {
  const nodeType = libraryNodeTypeForItem(item);
  const base = {
    [LIBRARY_PARAM_CATEGORY]: item.category,
    [LIBRARY_PARAM_ITEM_ID]: item.id,
    [LIBRARY_PARAM_OSS_KEY]: item.ossKey,
  };
  if (nodeType === "text_input") {
    // 提示词库：可编辑文本节点；libraryPromptText 作备份，避免 overlay 空 OSS 覆盖 content
    const prompt = libraryPromptTextFromItem(item);
    return {
      ...base,
      [LIBRARY_PARAM_LOCKED]: false,
      content: prompt,
      libraryPromptText: prompt,
    };
  }
  // 风格 / 特效 / 角色：锁定媒体节点
  if (nodeType === "video_input") {
    return { ...base, [LIBRARY_PARAM_LOCKED]: true, videoUrl: item.mediaUrl, assetId: "" };
  }
  return { ...base, [LIBRARY_PARAM_LOCKED]: true, imageUrl: item.mediaUrl, assetId: "" };
}

/**
 * 从素材库节点拉线落空时，菜单里允许高亮/选用的目标节点类型。
 * 非素材库源返回 null（表示全部可选）。
 */
export function allowedAddNodeTypesForLibrarySource(
  source: Node | undefined | null
): string[] | null {
  if (!isLibraryLockedNode(source)) return null;
  const category = getLibraryCategory(
    (source?.data as { params?: Record<string, unknown> } | undefined)?.params
  );
  if (category === "effect") {
    // 视频特效 → 仅视频节点；动图/图特效 → 图+视频
    const params = (source?.data as { params?: Record<string, unknown> } | undefined)?.params;
    const isVideo =
      source?.type === "video_input" || Boolean(String(params?.videoUrl || "").trim());
    return isVideo ? ["video_input"] : ["image_input", "video_input"];
  }
  // 风格 / 角色 / 提示词：只能连图片或视频作参考
  if (category === "style" || category === "character" || category === "prompt") {
    return ["image_input", "video_input"];
  }
  return null;
}

/** 特效库新建视频节点时的默认模型（全能参考，可接参考视频） */
export const DEFAULT_EFFECT_LIBRARY_TARGET_MODEL = "";

/**
 * 校验素材库相关连线。
 * - 风格/角色/提示词库：只能连到图片或视频节点当参考
 * - 特效库：只能连到 SD2.0 视频节点当参考（动图可连图/视频）
 * - 库节点本身不可作为连线目标（不可生成）
 * 返回错误文案；合法返回 null
 */
export function validateLibraryConnection(
  source: Node | undefined,
  target: Node | undefined
): string | null {
  if (!source || !target) return null;

  if (isLibraryLockedNode(target)) {
    return "素材库节点不可作为连线目标";
  }

  if (!isLibraryLockedNode(source)) return null;

  const category = getLibraryCategory(
    (source.data as { params?: Record<string, unknown> }).params
  );

  if (category === "effect") {
    // 视频特效：仅连 SD2.0 视频节点；GIF/WebP 特效按图片参考连图/视频节点
    const sourceParams =
      (source.data as { params?: Record<string, unknown> } | undefined)?.params || {};
    const sourceIsVideo =
      source.type === "video_input" || Boolean(String(sourceParams.videoUrl || "").trim());
    if (sourceIsVideo) {
      if (target.type !== "video_input") {
        return "特效库视频只能连接到视频节点";
      }
      const model = String(
        ((target.data as { params?: Record<string, unknown> }).params?.model as string) || ""
      );
      if (!isSeedance20Model(model)) {
        return "特效库视频只能连接到 Seedance 2.0 视频模型节点作参考";
      }
      return null;
    }
    if (target.type !== "image_input" && target.type !== "video_input") {
      return "特效库动图/图片只能连接到图片或视频节点";
    }
    return null;
  }

  // 风格库 / 角色库 / 提示词库：图片与视频节点
  if (target.type !== "image_input" && target.type !== "video_input") {
    if (category === "character") return "角色库只能连接到图片或视频节点";
    if (category === "prompt") return "提示词库只能连接到图片或视频节点";
    return "风格库只能连接到图片或视频节点";
  }
  return null;
}
