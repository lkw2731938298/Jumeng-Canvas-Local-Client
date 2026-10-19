/**
 * 图片高清：固定 gemini-nano-banana-2.1，
 * 用户选 1K/2K/4K 清晰档与比例，算出 size（宽x高）提交聚梦 POST /v1/images/generations。
 */

import type { CanvasModel } from "@/lib/api/models";
import type { GenerationOptions } from "@/types/generationPresets";

/** 上游 / 网关 model id（权威） */
export const HD_NANO_BANANA_I2I_UPSTREAM = "gemini-nano-banana-2.1";
/** 画布展示名 */
export const HD_NANO_BANANA_I2I_DISPLAY = "gemini-nano-banana-2.1";
/** 本系统目录 name（无命中时回退） */
export const HD_NANO_BANANA_I2I_CATALOG = "jumengai_gemini_nano_banana_21";

/** @deprecated 兼容旧引用 */
export const HD_G_IMAGE_HIGH_UPSTREAM = HD_NANO_BANANA_I2I_UPSTREAM;
/** @deprecated */
export const HD_G_IMAGE_HIGH_DISPLAY = HD_NANO_BANANA_I2I_DISPLAY;
/** @deprecated */
export const HD_G_IMAGE_HIGH_CATALOG = HD_NANO_BANANA_I2I_CATALOG;
/** @deprecated */
export const TOPAZ_HD_FIDELITY_V3_MODEL = HD_NANO_BANANA_I2I_DISPLAY;

/** 清晰档：1K / 2K / 4K（长边目标像素） */
export const HD_CLARITY_TIERS = [
  { id: "1k", label: "1K", longSide: 1024 },
  { id: "2k", label: "2K", longSide: 2048 },
  { id: "4k", label: "4K", longSide: 4096 },
] as const;

export type HdClarityTierId = (typeof HD_CLARITY_TIERS)[number]["id"];

export const DEFAULT_HD_CLARITY_TIER: HdClarityTierId = "2k";

/** 图片比例：original=保持原图；其余为固定画幅（对齐全能图片比例组） */
export const HD_ASPECT_RATIOS = [
  { id: "original", label: "原图", ratio: 0 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
  { id: "21:9", label: "21:9", ratio: 21 / 9 },
] as const;

export type HdAspectRatioId = (typeof HD_ASPECT_RATIOS)[number]["id"];

export const DEFAULT_HD_ASPECT_RATIO: HdAspectRatioId = "original";

export function isHdAspectRatioId(v: unknown): v is HdAspectRatioId {
  return HD_ASPECT_RATIOS.some((t) => t.id === v);
}

export function hdAspectRatioById(id: string | undefined | null) {
  const hit = HD_ASPECT_RATIOS.find((t) => t.id === id);
  return hit ?? HD_ASPECT_RATIOS[0];
}

/** @deprecated 旧 MP 档位表仅兼容读旧节点 */
export const HD_UPSCALE_MP_TIERS = HD_CLARITY_TIERS;
/** @deprecated */
export type HdUpscaleMpTierId = HdClarityTierId;
/** @deprecated */
export const DEFAULT_HD_MP_TIER = DEFAULT_HD_CLARITY_TIER;

export function isHdClarityTierId(v: unknown): v is HdClarityTierId {
  return HD_CLARITY_TIERS.some((t) => t.id === v);
}

/** @deprecated */
export const isHdUpscaleMpTierId = isHdClarityTierId;

export function hdClarityTierById(id: string | undefined | null) {
  const hit = HD_CLARITY_TIERS.find((t) => t.id === id);
  return hit ?? HD_CLARITY_TIERS[1];
}

/** @deprecated */
export const hdMpTierById = hdClarityTierById;

/** 目录 / upstream / 展示名是否命中 gemini-nano-banana-2.1 */
export function isHdNanoBananaI2iModel(input: {
  upstreamModel?: string | null;
  name?: string | null;
  displayName?: string | null;
}): boolean {
  const blob = `${input.upstreamModel || ""} ${input.name || ""} ${input.displayName || ""}`;
  if (/gemini-nano-banana-2\.1/i.test(blob)) return true;
  if (/gemini[-_]?nano[-_]?banana[-_]?2\.?1/i.test(blob)) return true;
  // 兼容旧 id
  if (/nano-banana-2\.1(\/image-to-image)?/i.test(blob)) return true;
  if (input.name === HD_NANO_BANANA_I2I_CATALOG) return true;
  if (/jumengai_gemini_nano_banana_21|jumengai_nano_banana_21/i.test(blob)) return true;
  return false;
}

/**
 * 从本地/目录列表里挑 HD 用的模型条目（优先命中 gemini-nano-banana-2.1）。
 * 返回的 name 供 findLocalModel / 报价；上游实际 model id 另用 resolveHdUpstreamModelId。
 */
export function pickHdNanoBananaCatalogModel<
  T extends { name: string; displayName?: string; parameters?: Record<string, unknown> },
>(list: T[] | null | undefined): T | null {
  const rows = list ?? [];
  const upstreamOf = (m: T) =>
    String((m.parameters as { upstreamModel?: string } | undefined)?.upstreamModel || "");
  return (
    rows.find((m) =>
      isHdNanoBananaI2iModel({
        name: m.name,
        displayName: m.displayName,
        upstreamModel: upstreamOf(m),
      })
    ) ??
    rows.find((m) => m.name === HD_NANO_BANANA_I2I_CATALOG) ??
    rows.find(
      (m) =>
        String(m.displayName || "").includes(HD_NANO_BANANA_I2I_DISPLAY) ||
        upstreamOf(m).includes(HD_NANO_BANANA_I2I_UPSTREAM)
    ) ??
    null
  );
}

/**
 * HD 提交给聚梦的上游 model id：一律固定为 gemini-nano-banana-2.1。
 * 凭据仍用目录条目 name（如 jumengai_gemini_nano_banana_21），与本函数返回值解耦。
 */
export function resolveHdUpstreamModelId(_input?: {
  upstreamModel?: string | null;
  name?: string | null;
  displayName?: string | null;
}): string {
  return HD_NANO_BANANA_I2I_UPSTREAM;
}

/** @deprecated */
export const isHdGImageHighModel = isHdNanoBananaI2iModel;
/** @deprecated */
export const isTopazHdFidelityV3Model = isHdNanoBananaI2iModel;

/** 单边上限 */
const HD_MAX_SIDE_PX = 8192;

/**
 * 按清晰档长边 + 比例（原图或固定画幅）算出聚梦 API 的 size（小写 x）。
 * 不低于 1×（相对源图长边）；单边封顶 8192。
 * 固定模型：gemini-nano-banana-2.1。
 */
export function computeHdOutputSizePx(opts: {
  srcW: number;
  srcH: number;
  /** 清晰档 id */
  clarityTier?: string;
  /** 比例 id：original | 16:9 | … */
  aspectRatio?: string;
  targetMp?: number;
  longSide?: number;
}): {
  width: number;
  height: number;
  size: string;
  outputMp: number;
  scale: number;
  aspectHint: string;
  clarityTier: HdClarityTierId;
  aspectRatio: HdAspectRatioId;
} {
  const srcW = Math.max(1, Math.round(opts.srcW));
  const srcH = Math.max(1, Math.round(opts.srcH));
  const tier = hdClarityTierById(opts.clarityTier);
  const aspect = hdAspectRatioById(opts.aspectRatio);
  const targetLong = Math.max(
    64,
    Math.round(opts.longSide || tier.longSide || 2048)
  );

  let width: number;
  let height: number;
  if (aspect.id === "original" || aspect.ratio <= 0) {
    const srcLong = Math.max(srcW, srcH);
    const scale = Math.max(1, targetLong / Math.max(srcLong, 1));
    width = Math.max(2, Math.round(srcW * scale));
    height = Math.max(2, Math.round(srcH * scale));
  } else {
    // 固定画幅：长边对齐清晰档，短边按比例
    if (aspect.ratio >= 1) {
      width = targetLong;
      height = Math.max(2, Math.round(targetLong / aspect.ratio));
    } else {
      height = targetLong;
      width = Math.max(2, Math.round(targetLong * aspect.ratio));
    }
  }

  const longSide = Math.max(width, height);
  if (longSide > HD_MAX_SIDE_PX) {
    const shrink = HD_MAX_SIDE_PX / longSide;
    width = Math.max(2, Math.round(width * shrink));
    height = Math.max(2, Math.round(height * shrink));
  }
  width -= width % 2;
  height -= height % 2;
  const outputMp = (width * height) / 1_000_000;
  const scale = width / srcW;
  return {
    width,
    height,
    size: `${width}x${height}`,
    outputMp,
    scale,
    aspectHint: aspect.id === "original" ? aspectHintFromPx(srcW, srcH) : aspect.id,
    clarityTier: tier.id,
    aspectRatio: aspect.id,
  };
}

/** 从像素粗略归到常见画幅 */
function aspectHintFromPx(w: number, h: number): string {
  const r = w / Math.max(1, h);
  const presets: Array<{ id: string; r: number }> = [
    { id: "1:1", r: 1 },
    { id: "4:3", r: 4 / 3 },
    { id: "3:4", r: 3 / 4 },
    { id: "16:9", r: 16 / 9 },
    { id: "9:16", r: 9 / 16 },
    { id: "3:2", r: 3 / 2 },
    { id: "2:3", r: 2 / 3 },
    { id: "21:9", r: 21 / 9 },
  ];
  let best = presets[0];
  let bestDiff = Infinity;
  for (const p of presets) {
    const d = Math.abs(Math.log(r / p.r));
    if (d < bestDiff) {
      bestDiff = d;
      best = p;
    }
  }
  return best.id;
}

/** @deprecated 旧 MP 目标；现按清晰档长边 */
export function resolveHdTierTargetMp(tierId: string, _plusSteps = 1): number {
  const tier = hdClarityTierById(tierId);
  return (tier.longSide * tier.longSide) / 1_000_000;
}

/** 浏览器探测源图像素尺寸 */
export function probeImageNaturalSize(
  url: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      resolve({
        width: Math.max(1, img.naturalWidth || img.width || 1),
        height: Math.max(1, img.naturalHeight || img.height || 1),
      });
    };
    img.onerror = () => reject(new Error("无法读取源图像素尺寸"));
    img.src = url;
  });
}

/**
 * 组装高清提交 / 报价 options：
 * - resolution=1k|2k|4k（计价主组）
 * - size / hdOutputSize = WxH（上游像素）
 */
export function buildHdImageGenerationOptions(opts: {
  clarityTier?: string;
  aspectRatio?: string;
  /** @deprecated 旧字段，等同 clarityTier */
  tierId?: string;
  plusSteps?: number;
  outputSize: string;
  model?: CanvasModel | null;
}): GenerationOptions {
  const tier = hdClarityTierById(opts.clarityTier || opts.tierId);
  const aspect = hdAspectRatioById(opts.aspectRatio);
  const params = (opts.model?.parameters ?? {}) as Record<string, unknown>;
  const pricing = (params.pricing ?? {}) as Record<string, unknown>;
  const primaryGroupId = String(pricing.primaryGroupId || "resolution").trim() || "resolution";

  const ratioApi = aspect.id === "original" ? "" : aspect.id;
  const out: GenerationOptions = {
    hdClarityTier: tier.id,
    hdMpTier: tier.id,
    hdAspectRatio: aspect.id,
    resolution: tier.id,
    // 上游像素 size（后端识别 WxH 后覆盖 api.size）
    hdOutputSize: opts.outputSize,
    size: opts.outputSize,
  };
  if (ratioApi) {
    out.ratio = ratioApi;
    out.aspectRatio = ratioApi;
    out.aspect_ratio = ratioApi;
  }
  // image_by_tier / primary_group 均认 resolution 组
  out[primaryGroupId] = tier.id;
  out.resolution = tier.id;
  return out;
}

/** @deprecated */
export const buildTopazHdGenerationOptions = buildHdImageGenerationOptions;
