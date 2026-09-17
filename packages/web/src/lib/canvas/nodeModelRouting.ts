import type { Edge } from "@xyflow/react";
import type { CanvasModel } from "@/lib/api/models";
import {
  AUDIO_MODEL_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  VIDEO_MODEL_OPTIONS,
} from "@/lib/canvas/mediaModels";
import { resolveModelSeries } from "@/lib/canvas/modelSeries";
import { TEXT_MODEL_OPTIONS } from "@/lib/canvas/textModels";
import { getNodeDef } from "@/types/node-registry";

export type ModelCategory = "text" | "image" | "video" | "audio";

export interface ModelOption {
  value: string;
  label: string;
  /** 后台模型「描述」，下拉选项副文案；触发器仍只显示 label */
  description?: string;
  /** 画布 UI 标签 id（多选） */
  uiTagIds?: string[];
  /** 系列名（下拉左栏分组，悬停右侧出具体模型） */
  series?: string;
}

/** Node type → admin model category (text / image / video / audio). */
export const NODE_TYPE_MODEL_CATEGORY: Record<string, ModelCategory> = {
  text_input: "text",
  image_input: "image",
  video_input: "video",
  audio_input: "audio",
};

export function getNodeModelCategory(nodeType: string): ModelCategory | null {
  return NODE_TYPE_MODEL_CATEGORY[nodeType] ?? null;
}

/** Default model category when the node has no right-side connections. */
const SOURCE_NODE_DEFAULT_CATEGORY: Record<string, ModelCategory> = {
  ...NODE_TYPE_MODEL_CATEGORY,
};

/**
 * Downstream node type → invocable model categories for the source node's editor popup.
 */
const DOWNSTREAM_NODE_MODEL_CATEGORIES: Record<string, ModelCategory[]> = {
  text_input: ["text"],
  image_input: ["image"],
  video_input: ["video"],
  audio_input: ["audio"],
  prompt: ["text"],
  llm_text: ["text"],
  ksampler: ["image"],
  vae_decode: ["image"],
  lora: ["image"],
  model_loader: ["image"],
  image_preview: ["image"],
  upscale: ["image"],
};

const FALLBACK_BY_CATEGORY: Record<ModelCategory, readonly { value: string; label: string }[]> = {
  text: TEXT_MODEL_OPTIONS,
  image: IMAGE_MODEL_OPTIONS,
  video: VIDEO_MODEL_OPTIONS,
  audio: AUDIO_MODEL_OPTIONS,
};

const CATEGORY_ORDER: ModelCategory[] = ["text", "image", "video", "audio"];

/** 已知视频模型名（兜底：防 DB category 误标进图片下拉） */
const KNOWN_VIDEO_MODEL_NAMES = new Set<string>(VIDEO_MODEL_OPTIONS.map((o) => o.value));
/** 已知图片模型名 */
const KNOWN_IMAGE_MODEL_NAMES = new Set<string>(IMAGE_MODEL_OPTIONS.map((o) => o.value));

/** 按命名判断是否为视频生成模型（r2v/i2v/t2v/对口型等） */
function isLikelyVideoModelName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (KNOWN_VIDEO_MODEL_NAMES.has(n) || KNOWN_VIDEO_MODEL_NAMES.has(name)) return true;
  if (KNOWN_IMAGE_MODEL_NAMES.has(n) || KNOWN_IMAGE_MODEL_NAMES.has(name)) return false;
  return /_(?:r2v|i2v|t2v)$/i.test(n) || n.includes("lip_sync");
}

function modelAllowedForCategories(model: CanvasModel, categories: ModelCategory[]): boolean {
  const cat = (model.category || "").trim().toLowerCase() as ModelCategory;
  if (!categories.includes(cat)) return false;
  // 图片-only 列表：即使 category 被误标为 image，也不展示视频模型
  if (categories.includes("image") && !categories.includes("video") && isLikelyVideoModelName(model.name)) {
    return false;
  }
  // 视频-only 列表：不展示纯图片模型名
  if (
    categories.includes("video") &&
    !categories.includes("image") &&
    (KNOWN_IMAGE_MODEL_NAMES.has(model.name) || /_image(?:_|$)/i.test(model.name))
  ) {
    return false;
  }
  return true;
}

export function getDownstreamNodeTypes(
  sourceNodeId: string,
  edges: Edge[],
  nodeTypeById: Map<string, string>
): string[] {
  const types = new Set<string>();
  for (const edge of edges) {
    if (edge.source !== sourceNodeId) continue;
    const type = nodeTypeById.get(edge.target);
    if (type) types.add(type);
  }
  return [...types];
}

export function resolveModelCategories(
  sourceNodeType: string,
  downstreamTypes: string[]
): ModelCategory[] {
  if (downstreamTypes.length === 0) {
    const fallback = SOURCE_NODE_DEFAULT_CATEGORY[sourceNodeType];
    return fallback ? [fallback] : ["text"];
  }

  const categories = new Set<ModelCategory>();
  for (const nodeType of downstreamTypes) {
    const mapped = DOWNSTREAM_NODE_MODEL_CATEGORIES[nodeType];
    if (mapped?.length) {
      mapped.forEach((c) => categories.add(c));
      continue;
    }
    const def = getNodeDef(nodeType);
    if (!def) continue;
    if (def.outputs.some((p) => p.type === "image") || def.inputs.some((p) => p.type === "image")) {
      categories.add("image");
    }
    if (def.outputs.some((p) => p.type === "video") || def.inputs.some((p) => p.type === "video")) {
      categories.add("video");
    }
    if (def.outputs.some((p) => p.type === "audio") || def.inputs.some((p) => p.type === "audio")) {
      categories.add("audio");
    }
    if (def.outputs.some((p) => p.type === "text") || def.inputs.some((p) => p.type === "text")) {
      categories.add("text");
    }
  }

  if (categories.size === 0) {
    const fallback = SOURCE_NODE_DEFAULT_CATEGORY[sourceNodeType];
    return fallback ? [fallback] : ["text"];
  }

  return CATEGORY_ORDER.filter((c) => categories.has(c));
}

function modelMatchesDownstream(model: CanvasModel, downstreamTypes: string[]): boolean {
  const compatible = model.parameters?.compatible_node_types ?? model.parameters?.target_node_types;
  if (!Array.isArray(compatible) || compatible.length === 0) return true;
  if (downstreamTypes.length === 0) return true;
  return downstreamTypes.some((t) => compatible.includes(t));
}

/** 兼容仅写在 parameters.uiTagIds 的历史数据 */
function readUiTagIdsFromParams(parameters: Record<string, unknown> | undefined): string[] {
  if (!parameters) return [];
  const raw = parameters.uiTagIds ?? parameters.ui_tag_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x || "").trim()).filter(Boolean);
}

export function buildModelOptions(
  apiModels: CanvasModel[] | undefined,
  categories: ModelCategory[],
  downstreamTypes: string[]
): ModelOption[] {
  const options: ModelOption[] = [];
  const seen = new Set<string>();

  if (apiModels?.length) {
    for (const model of apiModels) {
      if (!modelAllowedForCategories(model, categories)) continue;
      if (!modelMatchesDownstream(model, downstreamTypes)) continue;
      if (seen.has(model.name)) continue;
      seen.add(model.name);
      options.push({
        value: model.name,
        label: model.displayName,
        // 后台「描述」→ 下拉小字；空串视为无
        description: String(model.description || "").trim() || undefined,
        uiTagIds: Array.isArray(model.uiTagIds)
          ? model.uiTagIds.map((x) => String(x || "").trim()).filter(Boolean)
          : readUiTagIdsFromParams(model.parameters),
        series: resolveModelSeries({
          name: model.name,
          displayName: model.displayName,
          providerGroup: model.providerGroup,
          parameters: model.parameters,
        }),
      });
    }
  }

  if (options.length === 0) {
    for (const category of categories) {
      for (const item of FALLBACK_BY_CATEGORY[category] ?? []) {
        if (seen.has(item.value)) continue;
        seen.add(item.value);
        options.push({ value: item.value, label: item.label });
      }
    }
  }

  return options;
}
