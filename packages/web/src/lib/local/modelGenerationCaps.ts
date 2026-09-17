/**
 * 模型画布能力：四级优先级解析，避免靠写死模型名猜分辨率。
 *
 * 1. 模型显式 canvasCaps（设置里手改）
 * 2. generationPresets 里已有的清晰度 / 时长选项
 * 3. 可维护规则表 MODEL_CAPS_RULES（正则 → 能力）
 * 4. 安全兜底
 *
 * 画质档：480p / 720p / 768p / 1080p / 1K / 2K / 4K，生图生视频同一套。
 * 所有档位对所有模型都可选，点选即原样提交；模型不认就让上游报错，
 * 不再按内置猜测把 1K 悄悄换成 480p 这类「选了没用」的映射。
 */

import type { GenerationPresetsConfig } from "@/types/generationPresets";

/** 全量画质档（生图 / 生视频共用） */
export const CLARITY_TIER_ORDER = [
  "480p",
  "720p",
  "768p",
  "1080p",
  "1K",
  "2K",
  "4K",
] as const;
export type CanvasClarityTier = (typeof CLARITY_TIER_ORDER)[number];

/** 生图可选档 */
export const IMAGE_CLARITY_TIERS: CanvasClarityTier[] = [...CLARITY_TIER_ORDER];

/** 视频可选档 */
export const VIDEO_CLARITY_TIERS: CanvasClarityTier[] = [...CLARITY_TIER_ORDER];

/**
 * 生图 size 字段语义：
 * - pixel：官方文档写法 `1024x1024`（https://doc.jumengai.com/api/images），比例直接编码进像素宽高
 * - star：同像素但用星号 `1920*1080`（Qwen / 万相系要求）
 * - aspect：size 传画幅比 `16:9`（Gemini / Imagen 系）
 * - tier：size 传清晰度档 `2K`（x-imagine 等旧通道）
 */
export type ImageSizeMode = "pixel" | "aspect" | "tier" | "star";

/**
 * 视频 size 字段语义：
 * - ratio：size 传画幅比 `16:9`，清晰度另走 resolution（聚梦 Seedance 等网关校验如此）
 * - tier：size 传清晰度 `720P`（https://doc.jumengai.com/api/video 官方示例写法）
 * 两种模式都会把比例写进 metadata.parameters.ratio（文档指定的比例入口）。
 */
export type VideoSizeMode = "ratio" | "tier";
export type CapsSource = "explicit" | "presets" | "rule" | "default";

/** 挂在 LocalModel / Catalog 上的能力声明 */
export type ModelCanvasCaps = {
  clarity?: CanvasClarityTier[];
  /** 画布档 → 上游 resolution（如 720p / 1080p / 4K） */
  clarityMap?: Partial<Record<CanvasClarityTier, string>>;
  durationSec?: number[];
  /** 画幅；部分模型（如g-image-2）含 4:3 / 3:4 */
  ratios?: string[];
  imageSizeMode?: ImageSizeMode;
  videoSizeMode?: VideoSizeMode;
};

export type ModelCapsInput = {
  category?: "text" | "image" | "video" | "audio";
  upstreamModel?: string;
  name?: string;
  displayName?: string;
  canvasCaps?: ModelCanvasCaps | null;
  generationPresets?: GenerationPresetsConfig | null;
};

export type ResolvedModelCanvasCaps = {
  clarity: CanvasClarityTier[];
  clarityMap: Record<CanvasClarityTier, string>;
  durationSec: number[];
  ratios: string[];
  imageSizeMode: ImageSizeMode;
  videoSizeMode: VideoSizeMode;
  source: CapsSource;
  /** 命中的规则 id（仅 source=rule） */
  ruleId?: string;
};

type CapsRule = {
  id: string;
  match: RegExp;
  category?: "image" | "video";
  caps: ModelCanvasCaps;
};

/** 五个通用画幅，所有模型统一提供 */
const DEFAULT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

function durationRange(min: number, max: number): number[] {
  const out: number[] = [];
  for (let s = min; s <= max; s++) out.push(s);
  return out;
}

/** 归一化清晰度 id（480p / 1K 等） */
export function normalizeClarityTierId(raw: unknown): CanvasClarityTier | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
  if (!s || s.includes(":")) return null;
  const low = s.toLowerCase();
  if (low === "480" || low === "480p") return "480p";
  if (low === "720" || low === "720p") return "720p";
  if (low === "768" || low === "768p") return "768p";
  if (low === "1080" || low === "1080p" || low === "fhd") return "1080p";
  if (low === "1k" || low === "1024") return "1K";
  if (low === "2k") return "2K";
  if (low === "4k" || low === "2160" || low === "2160p" || low === "uhd") return "4K";
  if (low === "540" || low === "540p" || low === "sd") return "480p";
  return null;
}

/** 默认恒等映射：点选哪档就提交哪档，不做任何猜测性替换 */
function identityClarityMap(): Record<CanvasClarityTier, string> {
  const out = {} as Record<CanvasClarityTier, string>;
  for (const t of CLARITY_TIER_ORDER) out[t] = t;
  return out;
}

/**
 * 可维护规则表：只声明「提交语义」——生图 size 字段的形态、视频可选时长。
 * 清晰度与画幅一律全量开放、原样提交，规则表不再收窄或改写，
 * 否则用户点 1K 实际发出去是 480p，属于选了没用。
 */
export const MODEL_CAPS_RULES: CapsRule[] = [
  {
    id: "seedance",
    match: /seedance/i,
    category: "video",
    caps: { durationSec: durationRange(5, 15) },
  },
  {
    id: "minimax-h3-fixed5",
    match: /minimax-h3|minimax\/h3|hailuo-h3|hailuo\/h3/i,
    category: "video",
    caps: { durationSec: [5] },
  },
  {
    id: "minimax-family",
    match: /minimax|hailuo|(^|[^a-z0-9])h3([^a-z0-9]|$)/i,
    category: "video",
    caps: { durationSec: durationRange(5, 15) },
  },
  {
    id: "kling",
    match: /kling|可灵/i,
    category: "video",
    caps: { durationSec: durationRange(5, 15) },
  },
  {
    id: "wan-video",
    match: /wan2|wan3|万相|wan\//i,
    category: "video",
    caps: { durationSec: durationRange(5, 15) },
  },
  {
    id: "image-star",
    match: /qwen.?image|wanx|kolors|stable.?diffusion|sdxl|flux-digital/i,
    category: "image",
    caps: { imageSizeMode: "star" },
  },
  {
    id: "image-aspect",
    match: /gemini|imagen|dall-?e|gpt-image/i,
    category: "image",
    caps: { imageSizeMode: "aspect" },
  },
];

function modelBlob(input: ModelCapsInput): string {
  return `${input.upstreamModel || ""} ${input.name || ""} ${input.displayName || ""}`.toLowerCase();
}

function sanitizeClarity(list?: CanvasClarityTier[] | null): CanvasClarityTier[] {
  const out: CanvasClarityTier[] = [];
  for (const t of CLARITY_TIER_ORDER) {
    if (list?.includes(t)) out.push(t);
  }
  return out;
}

/** 画幅勾选：只保留五个通用画幅，且按固定顺序输出 */
function sanitizeRatios(list?: string[] | null): string[] {
  if (!list?.length) return [];
  const picked = new Set(list.map((r) => String(r || "").trim().replace(/：/g, ":")));
  return DEFAULT_RATIOS.filter((r) => picked.has(r));
}

function sanitizeDuration(list?: number[] | null): number[] {
  if (!list?.length) return [];
  const nums = list
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function safeDefault(category?: ModelCapsInput["category"]): ResolvedModelCanvasCaps {
  if (category === "image") {
    return {
      clarity: [...IMAGE_CLARITY_TIERS],
      clarityMap: identityClarityMap(),
      durationSec: [],
      ratios: [...DEFAULT_RATIOS],
      // 官方文档 /api/images：size 是 1024x1024 这类像素宽高，比例只能靠它带过去
      imageSizeMode: "pixel",
      videoSizeMode: "ratio",
      source: "default",
    };
  }
  return {
    clarity: [...VIDEO_CLARITY_TIERS],
    clarityMap: identityClarityMap(),
    durationSec: durationRange(5, 15),
    ratios: [...DEFAULT_RATIOS],
    imageSizeMode: "pixel",
    // 聚梦视频网关把 size 校验成画幅比；清晰度走 resolution + metadata
    videoSizeMode: "ratio",
    source: "default",
  };
}

/** 从 presets 抽出清晰度 / 时长 */
export function capsFromGenerationPresets(
  presets?: GenerationPresetsConfig | null
): ModelCanvasCaps | null {
  if (!presets?.groups?.length) return null;
  const clarityGroup =
    presets.groups.find((g) => g.id === "resolution" || g.id === "clarity") ||
    presets.groups.find((g) =>
      (g.items || []).some((i) => normalizeClarityTierId(i.id) != null)
    );
  const durationGroup = presets.groups.find((g) => g.id === "duration");

  const clarity = sanitizeClarity(
    (clarityGroup?.items || [])
      .filter((i) => i.enabled !== false)
      .map((i) => normalizeClarityTierId(i.id))
      .filter((t): t is CanvasClarityTier => t != null)
  );

  const durationSec = sanitizeDuration(
    (durationGroup?.items || [])
      .filter((i) => i.enabled !== false)
      .map((i) => Number.parseInt(String(i.id), 10))
  );

  const clarityMap: Partial<Record<CanvasClarityTier, string>> = {};
  for (const item of clarityGroup?.items || []) {
    if (item.enabled === false) continue;
    const tier = normalizeClarityTierId(item.id);
    if (!tier) continue;
    const api = (item.api || {}) as Record<string, unknown>;
    const mapped = api.resolution ?? api.clarity;
    if (typeof mapped === "string" && mapped.trim()) {
      clarityMap[tier] = mapped.trim();
    }
  }

  if (!clarity.length && !durationSec.length) return null;
  return {
    ...(clarity.length ? { clarity } : {}),
    ...(Object.keys(clarityMap).length ? { clarityMap } : {}),
    ...(durationSec.length ? { durationSec } : {}),
  };
}

function matchRule(input: ModelCapsInput): CapsRule | null {
  const blob = modelBlob(input);
  const cat = input.category;
  for (const rule of MODEL_CAPS_RULES) {
    if (rule.category && cat && rule.category !== cat) continue;
    if (rule.id === "minimax-h3-fixed5" && /multimodal|r2v|reference/.test(blob)) {
      continue;
    }
    if (rule.match.test(blob)) return rule;
  }
  return null;
}

function mergeClarityMap(
  category: ModelCapsInput["category"],
  clarity: CanvasClarityTier[],
  ...maps: Array<Partial<Record<CanvasClarityTier, string>> | undefined>
): Record<CanvasClarityTier, string> {
  void category;
  // 基线恒等；只有用户显式声明或上游 presets 自带的映射才覆盖
  const out: Record<CanvasClarityTier, string> = identityClarityMap();
  for (const map of maps) {
    if (!map) continue;
    for (const t of CLARITY_TIER_ORDER) {
      const v = map[t];
      if (typeof v === "string" && v.trim()) out[t] = v.trim();
    }
  }
  void clarity;
  return out;
}

function finish(
  category: ModelCapsInput["category"],
  partial: ModelCanvasCaps,
  source: CapsSource,
  ruleId?: string
): ResolvedModelCanvasCaps {
  const fallback = safeDefault(category);
  // 清晰度与画幅只接受用户在设置里的显式收窄；规则表 / presets 不得删档，
  // 保证面板里七档画质、五个画幅对所有模型都点得到
  const explicitClarity = source === "explicit" ? sanitizeClarity(partial.clarity) : [];
  const clarity = explicitClarity.length > 0 ? explicitClarity : fallback.clarity;
  const durationSec =
    sanitizeDuration(partial.durationSec).length > 0
      ? sanitizeDuration(partial.durationSec)
      : category === "video"
        ? fallback.durationSec
        : [];
  const explicitRatios = source === "explicit" ? sanitizeRatios(partial.ratios) : [];
  const ratios = explicitRatios.length > 0 ? explicitRatios : fallback.ratios;
  const imageSizeMode = partial.imageSizeMode || fallback.imageSizeMode;
  const videoSizeMode = partial.videoSizeMode || fallback.videoSizeMode;
  const clarityMap = mergeClarityMap(category, clarity, partial.clarityMap);

  return {
    clarity,
    clarityMap,
    durationSec,
    ratios,
    imageSizeMode,
    videoSizeMode,
    source,
    ruleId,
  };
}

/**
 * 统一解析模型画布能力（四级优先级）。
 * 画布 UI / 提交映射都应走这里。
 */
export function resolveModelCanvasCaps(input: ModelCapsInput): ResolvedModelCanvasCaps {
  const category = input.category;
  const explicit = input.canvasCaps;
  const hasExplicitClarity = sanitizeClarity(explicit?.clarity).length > 0;
  const hasExplicitDuration = sanitizeDuration(explicit?.durationSec).length > 0;
  if (
    explicit &&
    (hasExplicitClarity ||
      hasExplicitDuration ||
      explicit.imageSizeMode ||
      explicit.videoSizeMode ||
      (explicit.ratios?.length ?? 0) > 0)
  ) {
    return finish(category, explicit, "explicit");
  }

  const rule = matchRule(input);
  // presets 来自上游模型目录：只取它自带的「档位 → 上游取值」映射与可选时长，
  // 不用它删减档位（旧目录常只声明 1K/2K/4K，会把新加的 480p 等挤掉）
  const fromPresets = capsFromGenerationPresets(input.generationPresets);
  if (fromPresets) {
    const presetDuration = sanitizeDuration(fromPresets.durationSec);
    const merged: ModelCanvasCaps = {
      ...(rule?.caps || {}),
      ...(fromPresets.clarityMap ? { clarityMap: fromPresets.clarityMap } : {}),
      ...(presetDuration.length ? { durationSec: presetDuration } : {}),
    };
    return finish(category, merged, rule ? "rule" : "presets", rule?.id);
  }

  if (rule) {
    return finish(category, rule.caps, "rule", rule.id);
  }

  return safeDefault(category);
}

/** 兼容旧调用：字符串 upstream + displayName */
export function asModelCapsInput(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string,
  category?: ModelCapsInput["category"]
): ModelCapsInput {
  if (upstreamOrInput && typeof upstreamOrInput === "object") {
    return {
      category: upstreamOrInput.category || category,
      ...upstreamOrInput,
    };
  }
  return {
    category,
    upstreamModel: upstreamOrInput,
    displayName,
  };
}

export function videoClarityTiersForModel(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): CanvasClarityTier[] {
  return resolveModelCanvasCaps(asModelCapsInput(upstreamOrInput, displayName, "video")).clarity;
}

export function mapVideoClarityToUpstream(
  tier: CanvasClarityTier,
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): string {
  const caps = resolveModelCanvasCaps(asModelCapsInput(upstreamOrInput, displayName, "video"));
  const clamped = clampCanvasClarity(tier, caps.clarity);
  return caps.clarityMap[clamped] || caps.clarityMap["2K"] || "720p";
}

export function videoDurationSecondsForModel(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): number[] {
  return resolveModelCanvasCaps(asModelCapsInput(upstreamOrInput, displayName, "video"))
    .durationSec;
}

export function detectImageSizeMode(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): ImageSizeMode {
  return resolveModelCanvasCaps(asModelCapsInput(upstreamOrInput, displayName, "image"))
    .imageSizeMode;
}

export function imageClarityTiersForModel(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): CanvasClarityTier[] {
  return resolveModelCanvasCaps(asModelCapsInput(upstreamOrInput, displayName, "image")).clarity;
}

/** @deprecated 仅兼容旧 import；请用 resolveModelCanvasCaps */
export type VideoModelFamily = "seedance" | "minimax" | "kling" | "wan" | "generic";

export function detectVideoModelFamily(
  upstreamOrName?: string,
  displayName?: string
): VideoModelFamily {
  const rule = matchRule({ category: "video", upstreamModel: upstreamOrName, displayName });
  if (!rule) return "generic";
  if (rule.id.startsWith("seedance")) return "seedance";
  if (rule.id.startsWith("minimax")) return "minimax";
  if (rule.id.startsWith("kling")) return "kling";
  if (rule.id.startsWith("wan")) return "wan";
  return "generic";
}

export function clampCanvasClarity(
  tier: CanvasClarityTier,
  allowed: readonly CanvasClarityTier[]
): CanvasClarityTier {
  if (!allowed.length) return "2K";
  if (allowed.includes(tier)) return tier;
  const order = CLARITY_TIER_ORDER;
  const idx = order.indexOf(tier);
  for (let i = idx + 1; i < order.length; i++) {
    if (allowed.includes(order[i])) return order[i];
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (allowed.includes(order[i])) return order[i];
  }
  return allowed[0];
}

/** 根据已解析 caps 生成写入 LocalModel 的手改声明 */
export function buildExplicitCanvasCaps(
  resolved: ResolvedModelCanvasCaps,
  patch: Partial<ModelCanvasCaps>
): ModelCanvasCaps {
  const clarity = sanitizeClarity(patch.clarity ?? resolved.clarity);
  const durationSec = sanitizeDuration(patch.durationSec ?? resolved.durationSec);
  const clarityMap: Partial<Record<CanvasClarityTier, string>> = {};
  for (const t of clarity) {
    clarityMap[t] = (patch.clarityMap?.[t] || resolved.clarityMap[t]) as string;
  }
  const ratios = sanitizeRatios(patch.ratios ?? resolved.ratios);
  return {
    clarity,
    clarityMap,
    ...(durationSec.length ? { durationSec } : {}),
    ratios: ratios.length ? ratios : [...DEFAULT_RATIOS],
    imageSizeMode: patch.imageSizeMode ?? resolved.imageSizeMode,
    videoSizeMode: patch.videoSizeMode ?? resolved.videoSizeMode,
  };
}

/** 视频 size 语义（ratio / tier）；提交时决定 size 放画幅还是清晰度 */
export function videoSizeModeForModel(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): VideoSizeMode {
  return resolveModelCanvasCaps(asModelCapsInput(upstreamOrInput, displayName, "video"))
    .videoSizeMode;
}
