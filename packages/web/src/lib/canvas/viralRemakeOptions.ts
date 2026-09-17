/**
 * 将用户选择的画幅/清晰度映射为视频模型 generationOptions；
 * 优先 RH/华狐 Seedance 2.0 多模态（*_r2v），以便接入参考视频。
 */

import { listModels, type CanvasModel } from "@/lib/api/models";
import {
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import { resolvePreferredModel } from "@/lib/canvas/lastSelectedModel";
import {
  presetsSupportRefVideoBilling,
  withRefVideoBillingOption,
} from "@/lib/canvas/refVideoBilling";
import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import type { ViralRemakeAspect, ViralRemakeClarity } from "@/lib/canvas/viralRemakeSession";

/** RH / 华狐 Seedance 2.0 多模态（可参考视频） */
const R2V_NAME_RE = /^((rh|huahu)_seedance_20(_fast|_mini|_4k)?_r2v)$/i;

/** 分镜「时长」解析；默认 4s，上限 12s（SD2.0 参考） */
export const MIN_VIRAL_SHOT_DURATION_SEC = 4;
export const MAX_VIRAL_SHOT_DURATION_SEC = 12;

export function parseViralShotDurationSec(raw?: string | number | null): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(MAX_VIRAL_SHOT_DURATION_SEC, Math.max(0.5, raw));
  }
  const m = String(raw || "").trim().match(/^([\d.]+)\s*s?/i);
  if (!m) return MIN_VIRAL_SHOT_DURATION_SEC;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return MIN_VIRAL_SHOT_DURATION_SEC;
  return Math.min(MAX_VIRAL_SHOT_DURATION_SEC, Math.max(0.5, n));
}

/** 成片提交用：强制 ≥4s ≤12s */
export function floorViralGenerationDurationSec(raw?: string | number | null): number {
  const sec = parseViralShotDurationSec(raw);
  return Math.min(
    MAX_VIRAL_SHOT_DURATION_SEC,
    Math.max(MIN_VIRAL_SHOT_DURATION_SEC, sec)
  );
}

/**
 * 将目标秒数写入 generationOptions.duration（取模型可选档中最接近的一档）。
 * 用于出海/爆款成片与分镜表、参考片段时长对齐。
 */
export function withViralRemakeDuration(
  presets: GenerationPresetsConfig | null | undefined,
  options: GenerationOptions,
  durationSec: number
): GenerationOptions {
  const target = floorViralGenerationDurationSec(durationSec);
  const rounded = Math.max(MIN_VIRAL_SHOT_DURATION_SEC, Math.round(target));
  const group = presets?.groups?.find((g) => g.id === "duration");
  if (!group) {
    return { ...options, duration: String(rounded) };
  }
  const candidates = group.items
    .filter((i) => i.enabled !== false)
    .map((item) => {
      const fromId = Number.parseFloat(String(item.id));
      const fromLabel = Number.parseFloat(String(item.label).replace(/s$/i, ""));
      const sec = Number.isFinite(fromId)
        ? fromId
        : Number.isFinite(fromLabel)
          ? fromLabel
          : NaN;
      return { item, sec };
    })
    .filter((x) => Number.isFinite(x.sec) && x.sec > 0);
  if (candidates.length === 0) {
    return normalizeGenerationOptions(presets ?? null, { ...options, duration: String(rounded) });
  }
  let best = candidates[0];
  let bestDiff = Math.abs(best.sec - target);
  for (let i = 1; i < candidates.length; i += 1) {
    const diff = Math.abs(candidates[i].sec - target);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }
  return normalizeGenerationOptions(presets ?? null, { ...options, [group.id]: best.item.id });
}

function isR2vModel(name: string): boolean {
  return R2V_NAME_RE.test(name.trim());
}

function pickRatioId(
  group: { items: Array<{ id: string; label: string; enabled?: boolean }> },
  aspect: ViralRemakeAspect
): string | null {
  const enabled = group.items.filter((i) => i.enabled !== false);
  const exact = enabled.find((i) => i.id === aspect || i.label === aspect);
  if (exact) return exact.id;
  const compact = aspect.replace(":", "");
  const loose = enabled.find(
    (i) => i.id.replace(/[:xX-]/g, "") === compact || i.label.includes(aspect)
  );
  return loose?.id ?? null;
}

function pickResolutionId(
  group: { items: Array<{ id: string; label: string; enabled?: boolean }> },
  clarity: ViralRemakeClarity
): string | null {
  const enabled = group.items.filter((i) => i.enabled !== false);
  const bare = clarity.replace(/p$/i, "");
  const candidates = [clarity, bare, `${bare}p`, `native${clarity}`, `native${bare}p`];
  for (const c of candidates) {
    const hit = enabled.find(
      (i) => i.id === c || i.id.toLowerCase() === c.toLowerCase() || i.label === clarity
    );
    if (hit) return hit.id;
  }
  const fuzzy = enabled.find((i) => i.id.includes(bare) || i.label.includes(bare));
  return fuzzy?.id ?? null;
}

/** 纯首帧 i2v（无参考视频时容易因缺首帧提交失败） */
function isPureI2vModel(model: CanvasModel): boolean {
  if (isR2vModel(model.name)) return false;
  if (/_i2v$/i.test(model.name)) return true;
  const mode = model.parameters?.videoMode;
  return typeof mode === "string" && mode.toLowerCase() === "i2v";
}

/**
 * 爆款复刻 / 一键出海默认视频模型：
 * 1) 用户上次选中且为 *_r2v（含真人参考时避开华狐，改 RH）
 * 2) 可用列表中的 RH/华狐 r2v（优先 RH：华狐对真人参考有隐私硬拦）
 * 3) 其它可用视频模型兜底（出海/无参考视频时避开纯 i2v）
 */
async function loadViralRemakeVideoModel(opts?: {
  /** 无参考视频时避开纯 i2v，避免「缺首帧」提交失败 */
  avoidPureI2v?: boolean;
  /**
   * 含真人原片/主体时优先 RH Seedance。
   * 华狐走 Ark 隐私审核，`realPerson` 开关无法绕过 PrivacyInformation。
   */
  preferRhForRealPerson?: boolean;
}): Promise<CanvasModel | undefined> {
  const list = await listModels({ category: "video" });
  const mockUi = process.env.NEXT_PUBLIC_AI_MOCK_ENABLED === "true";
  // Mock 联调：密钥可能未配置，仍允许选用已实现模型名（Worker 走 AI_MOCK）
  const available = list.filter((m) => {
    if (m.isImplemented === false) return false;
    if (mockUi) return true;
    return m.isConfigured !== false && m.isAvailable;
  });
  const pool = opts?.avoidPureI2v
    ? available.filter((m) => !isPureI2vModel(m))
    : available;
  const pickFrom = pool.length > 0 ? pool : available;
  const preferRh = opts?.preferRhForRealPerson !== false;

  const pickRhR2v = (): CanvasModel | undefined =>
    pickFrom.find((m) => /^rh_seedance_20_r2v$/i.test(m.name)) ||
    pickFrom.find((m) => /^rh_seedance_20_fast_r2v$/i.test(m.name)) ||
    pickFrom.find((m) => /^rh_seedance_20.*_r2v$/i.test(m.name));

  const preferred = resolvePreferredModel(
    "video",
    pickFrom.map((m) => ({ value: m.name }))
  );
  if (preferred && isR2vModel(preferred)) {
    // 上次选的是华狐且本次含真人参考 → 改 RH，避免 PrivacyInformation 硬拦
    if (preferRh && /huahu_seedance/i.test(preferred)) {
      const rh = pickRhR2v();
      if (rh) return rh;
    }
    const hit = pickFrom.find((m) => m.name === preferred);
    if (hit) return hit;
  }

  const r2v = pickFrom.filter((m) => isR2vModel(m.name));
  const rank = (name: string) => {
    // RH 优先于华狐（真人参考片）
    if (/^rh_seedance_20_r2v$/i.test(name)) return 0;
    if (/^rh_seedance_20_fast_r2v$/i.test(name)) return 1;
    if (/^rh_seedance_20_4k_r2v$/i.test(name)) return 2;
    if (/^rh_seedance_20_mini_r2v$/i.test(name)) return 3;
    if (/huahu_seedance_20_r2v$/i.test(name)) return 10;
    if (/huahu_.*_fast_r2v$/i.test(name)) return 11;
    if (/huahu_.*_4k_r2v$/i.test(name)) return 12;
    if (/huahu_.*_mini_r2v$/i.test(name)) return 13;
    if (/_fast_r2v$/i.test(name)) return 20;
    if (/_4k_r2v$/i.test(name)) return 21;
    if (/_mini_r2v$/i.test(name)) return 22;
    return 30;
  };
  r2v.sort((a, b) => rank(a.name) - rank(b.name));
  if (preferRh) {
    const rh = pickRhR2v();
    if (rh) return rh;
  }
  if (r2v[0]) return r2v[0];

  return pickFrom.find((m) => m.name === preferred) ?? pickFrom[0] ?? list[0];
}

/** 生成可写入 video_input.params.generationOptions 的选项快照 */
export async function buildViralRemakeGenerationOptions(opts: {
  aspectRatio: ViralRemakeAspect;
  clarity: ViralRemakeClarity;
  /** 是否接入原片参考视频（RH/华狐 r2v 有参考视频档） */
  withRefVideo?: boolean;
  /** 本镜目标时长（秒）；与分镜表/参考片段对齐 */
  durationSec?: number;
  /** 含真人原片时优先 RH（默认 true） */
  preferRhForRealPerson?: boolean;
}): Promise<{
  generationOptions: GenerationOptions;
  modelName?: string;
  supportsRefVideo: boolean;
  presets: GenerationPresetsConfig | null;
}> {
  const avoidPureI2v = opts.withRefVideo === false;
  const model = await loadViralRemakeVideoModel({
    avoidPureI2v,
    preferRhForRealPerson: opts.preferRhForRealPerson,
  });
  const presets = getModelGenerationPresets(model);
  const raw: GenerationOptions = {};

  const groups = presets?.groups ?? [];
  const ratioGroup = groups.find((g) => g.id === "ratio" || g.id === "aspect_ratio");
  if (ratioGroup) {
    const id = pickRatioId(ratioGroup, opts.aspectRatio);
    if (id) raw[ratioGroup.id] = id;
  } else {
    raw.ratio = opts.aspectRatio;
  }

  const resGroup = groups.find((g) => g.id === "resolution" || g.id === "clarity");
  if (resGroup) {
    const id = pickResolutionId(resGroup, opts.clarity);
    if (id) raw[resGroup.id] = id;
  } else {
    raw.resolution = opts.clarity.replace(/p$/i, "");
  }

  // 若调用方传入镜头时长，写入 duration（与分镜表/参考片段对齐）
  if (opts.durationSec != null && Number.isFinite(opts.durationSec)) {
    Object.assign(raw, withViralRemakeDuration(presets, raw, opts.durationSec));
  }

  let generationOptions = normalizeGenerationOptions(presets, raw);
  // 出海/爆款原片几乎都含真人：显式打开真人模式（RH 1505；华狐仍可能隐私硬拦）
  if (presets?.groups.some((g) => g.id === "realPerson")) {
    generationOptions = { ...generationOptions, realPerson: "on" };
  }
  const supportsRefVideo = presetsSupportRefVideoBilling(presets);
  const wantRef = opts.withRefVideo !== false && supportsRefVideo;
  generationOptions = withRefVideoBillingOption(presets, generationOptions, wantRef);

  return {
    generationOptions,
    modelName: model?.name,
    supportsRefVideo,
    presets,
  };
}

/** 预估单镜视频算力（默认按「有参考视频」报价，与成片接线一致） */
export async function estimateViralRemakeVideoCredit(opts: {
  aspectRatio: ViralRemakeAspect;
  clarity: ViralRemakeClarity;
  withRefVideo?: boolean;
}): Promise<{ model: string; total: number; generationOptions: GenerationOptions } | null> {
  try {
    const { getCreditQuote } = await import("@/lib/api/credits");
    const built = await buildViralRemakeGenerationOptions({
      aspectRatio: opts.aspectRatio,
      clarity: opts.clarity,
      withRefVideo: opts.withRefVideo,
    });
    if (!built.modelName) return null;
    const quote = await getCreditQuote({
      model: built.modelName,
      category: "video",
      generationOptions: built.generationOptions,
    });
    return {
      model: built.modelName,
      total: Number(quote.total ?? 0),
      generationOptions: built.generationOptions,
    };
  } catch {
    return null;
  }
}

export { isR2vModel };
