import { apiFetch } from "./client";
import { isLocalDesktop } from "@/lib/localDesktop";
import { localStore } from "@/lib/local/store";
import {
  canonicalizeImagePresets,
  canonicalizeVideoPresets,
} from "@/lib/local/presetTemplates";
import { resolveModelCanvasCaps } from "@/lib/local/modelGenerationCaps";
import type { ModelCanvasCaps } from "@/lib/local/modelGenerationCaps";
import type { GenerationPresetsConfig } from "@/types/generationPresets";

/** 图片：统一比例，并按四级能力解析过滤清晰度 */
function sanitizeLocalImagePresets(
  category: string,
  presets: GenerationPresetsConfig | undefined,
  capsInput: {
    upstreamModel?: string;
    name?: string;
    displayName?: string;
    canvasCaps?: ModelCanvasCaps | null;
    generationPresets?: GenerationPresetsConfig;
  }
): GenerationPresetsConfig | undefined {
  if (category !== "image") return presets;
  return canonicalizeImagePresets(presets, {
    category: "image",
    ...capsInput,
    generationPresets: presets,
  });
}

/** 视频：统一画幅 + 按四级能力解析过滤清晰度/时长 */
function ensureLocalVideoPresets(
  category: string,
  presets: GenerationPresetsConfig | undefined,
  capsInput: {
    upstreamModel?: string;
    name?: string;
    displayName?: string;
    canvasCaps?: ModelCanvasCaps | null;
    generationPresets?: GenerationPresetsConfig;
  }
): GenerationPresetsConfig | undefined {
  if (category !== "video") return presets;
  return canonicalizeVideoPresets(presets, {
    category: "video",
    ...capsInput,
    generationPresets: presets,
  });
}

/** 本地模型 → 画布 catalog：补全 presets，视频默认支持参考图（r2v） */
function localModelParameters(m: {
  category: string;
  upstreamModel?: string;
  name?: string;
  displayName?: string;
  mode?: string;
  generationPresets?: GenerationPresetsConfig;
  canvasCaps?: ModelCanvasCaps | null;
}): Record<string, unknown> {
  const capsInput = {
    upstreamModel: m.upstreamModel || m.name || "",
    name: m.name,
    displayName: m.displayName || m.name || "",
    canvasCaps: m.canvasCaps,
    generationPresets: m.generationPresets,
  };
  let gp = m.generationPresets;
  if (m.category === "image") {
    gp = sanitizeLocalImagePresets(m.category, gp, capsInput);
  }
  if (m.category === "video") {
    gp = ensureLocalVideoPresets(m.category, gp, capsInput);
  }
  const resolved = resolveModelCanvasCaps({
    category: m.category as "image" | "video" | "text" | "audio",
    ...capsInput,
    generationPresets: gp,
  });
  return {
    upstreamModel: m.upstreamModel,
    endpointMode: m.mode,
    canvasCaps: {
      clarity: resolved.clarity,
      clarityMap: resolved.clarityMap,
      durationSec: resolved.durationSec,
      ratios: resolved.ratios,
      imageSizeMode: resolved.imageSizeMode,
      videoSizeMode: resolved.videoSizeMode,
      source: resolved.source,
      ruleId: resolved.ruleId,
    },
    ...(m.category === "video"
      ? { videoMode: "r2v", capabilities: ["reference_to_video", "text_to_video"] }
      : {}),
    ...(gp ? { generationPresets: gp } : {}),
  };
}

export interface CanvasModel {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  modelType: string;
  category: string;
  description?: string;
  isAvailable: boolean;
  isConfigured?: boolean;
  isImplemented?: boolean;
  providerGroup?: string;
  /** 绑定的 UI 标签 id（多选） */
  uiTagIds?: string[];
  parameters?: Record<string, unknown>;
}

export interface ModelUiTag {
  id: string;
  label: string;
  sortOrder: number;
  categories: string[];
}

export interface ModelUiTagsResponse {
  version: number;
  tags: ModelUiTag[];
}

export async function listModels(params?: {
  category?: string;
  modelType?: string;
  provider?: string;
  search?: string;
}) {
  if (isLocalDesktop) {
    const items = await localStore().listModels();
    let out: CanvasModel[] = items
      .filter((m) => m.enabled !== false)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((m) => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName || m.name,
        provider: m.mode === "custom_template" ? "custom" : "openai_compatible",
        modelType: m.category,
        category: m.category,
        description:
          m.description ||
          (m.mode === "custom_template" ? "自定义请求模板" : "OpenAI 兼容"),
        isAvailable: true,
        isConfigured: true,
        isImplemented: true,
        providerGroup: m.mode,
        parameters: localModelParameters({
          ...m,
          name: m.name,
          displayName: m.displayName || m.name,
        }),
      }));
    if (params?.category) out = out.filter((m) => m.category === params.category);
    if (params?.search) {
      const q = params.search.toLowerCase();
      out = out.filter(
        (m) =>
          m.name.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q)
      );
    }
    return out;
  }
  const search = new URLSearchParams();
  if (params?.category) search.set("category", params.category);
  if (params?.modelType) search.set("model_type", params.modelType);
  if (params?.provider) search.set("provider", params.provider);
  if (params?.search) search.set("search", params.search);
  const qs = search.toString();
  return apiFetch<CanvasModel[]>(`/api/v1/models${qs ? `?${qs}` : ""}`);
}

/** 画布模型选择旁的 UI 标签（仅启用） */
export function listModelUiTags(params?: { category?: string }) {
  if (isLocalDesktop) {
    return Promise.resolve({ version: 1, tags: [] as ModelUiTag[] });
  }
  const search = new URLSearchParams();
  if (params?.category) search.set("category", params.category);
  const qs = search.toString();
  return apiFetch<ModelUiTagsResponse>(`/api/v1/models/ui-tags${qs ? `?${qs}` : ""}`);
}

/** 画布选模左侧系列展示顺序（仅启用） */
export interface ModelUiSeriesItem {
  label: string;
  sortOrder: number;
  categories: string[];
}

export interface ModelUiSeriesResponse {
  version: number;
  series: ModelUiSeriesItem[];
}

export function listModelUiSeries(params?: { category?: string }) {
  if (isLocalDesktop) {
    return Promise.resolve({ version: 1, series: [] as ModelUiSeriesItem[] });
  }
  const search = new URLSearchParams();
  if (params?.category) search.set("category", params.category);
  const qs = search.toString();
  return apiFetch<ModelUiSeriesResponse>(`/api/v1/models/ui-series${qs ? `?${qs}` : ""}`);
}
