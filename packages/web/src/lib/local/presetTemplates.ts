/**
 * 开源画布统一生成档位：
 * - 比例仅 16:9 / 9:16 / 1:1（部分生图另含 4:3/3:4）
 * - 清晰度：480p / 720p / 768p / 1080p / 1K / 2K / 4K（点选即原样提交）
 * - 生图清晰度：以 1K / 2K / 4K 为主
 * - 视频时长默认 5–15 秒；具体模型可再收窄（如 H3 仅 5s）
 */
import type { GenerationPresetsConfig, GenerationPresetGroup } from "@/types/generationPresets";
import {
  asModelCapsInput,
  clampCanvasClarity,
  normalizeClarityTierId,
  resolveModelCanvasCaps,
  VIDEO_CLARITY_TIERS,
  type CanvasClarityTier as CapsClarityTier,
  type ModelCapsInput,
} from "./modelGenerationCaps";

/** 五个通用画幅，生图生视频对所有模型统一提供 */
export const CANVAS_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type CanvasAspectRatio = (typeof CANVAS_ASPECT_RATIOS)[number];

/** 视频画质全量选项（与 modelGenerationCaps 对齐） */
export const CANVAS_CLARITY_TIERS = VIDEO_CLARITY_TIERS;
export type CanvasClarityTier = CapsClarityTier;

export const CANVAS_VIDEO_DURATION_MIN = 5;
export const CANVAS_VIDEO_DURATION_MAX = 15;

function imageRatioItems(ratios?: readonly string[]) {
  const list =
    ratios && ratios.length > 0 ? ratios : (CANVAS_ASPECT_RATIOS as readonly string[]);
  return list.map((r) => ({
    id: r,
    label: r,
    // 组 id 用 ratio，与视频面板 RatioSection 一致；api 三键同写，提交任一都能读到
    // 生图 size 在聚梦通道是 1K/2K/4K，禁止把比例写进 size
    api: { ratio: r, aspect_ratio: r, aspectRatio: r },
  }));
}

function videoRatioItems(ratios?: readonly string[]) {
  const list =
    ratios && ratios.length > 0 ? ratios : (CANVAS_ASPECT_RATIOS as readonly string[]);
  return list.map((r) => ({
    id: r,
    label: r,
    // 比例三键同写；size 是否放比例由模型的「尺寸提交方式」在提交时决定
    api: { ratio: r, aspect_ratio: r, aspectRatio: r },
  }));
}

/** 通用清晰度选项：写入 resolution + clarity，方便旧节点兼容 */
function canvasClarityItems(allowed?: readonly CanvasClarityTier[]) {
  const tiers =
    allowed && allowed.length > 0 ? allowed : CANVAS_CLARITY_TIERS;
  return tiers.map((t) => ({
    id: t,
    label: t,
    api: { resolution: t, clarity: t },
  }));
}

function videoDurationItems(seconds?: readonly number[]) {
  const list =
    seconds && seconds.length > 0
      ? seconds
      : Array.from(
          { length: CANVAS_VIDEO_DURATION_MAX - CANVAS_VIDEO_DURATION_MIN + 1 },
          (_, i) => CANVAS_VIDEO_DURATION_MIN + i
        );
  return list.map((s) => ({
    id: String(s),
    label: `${s}s`,
    api: { duration: s },
  }));
}

function defaultClarityId(allowed: readonly CanvasClarityTier[]): CanvasClarityTier {
  return clampCanvasClarity("2K", allowed);
}

function resolveInput(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string,
  category?: ModelCapsInput["category"]
): ModelCapsInput {
  return asModelCapsInput(upstreamOrInput, displayName, category);
}

export function imageAspectPresets(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): GenerationPresetsConfig {
  const caps = resolveModelCanvasCaps(resolveInput(upstreamOrInput, displayName, "image"));
  const allowed = caps.clarity;
  const ratios = caps.ratios.length ? caps.ratios : [...CANVAS_ASPECT_RATIOS];
  return {
    version: 1,
    groups: [
      {
        id: "ratio",
        label: "比例",
        defaultId: ratios.includes("1:1") ? "1:1" : ratios[0],
        items: imageRatioItems(ratios),
      },
      {
        id: "resolution",
        label: "清晰度",
        defaultId: defaultClarityId(allowed),
        items: canvasClarityItems(allowed),
      },
    ],
  };
}

export function videoDurationPresets(
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): GenerationPresetsConfig {
  const caps = resolveModelCanvasCaps(resolveInput(upstreamOrInput, displayName, "video"));
  const allowed = caps.clarity;
  const durations = caps.durationSec;
  const durationDefault = String(durations[0] ?? 5);
  const ratios = caps.ratios.length ? caps.ratios : [...CANVAS_ASPECT_RATIOS];
  return {
    version: 1,
    groups: [
      {
        id: "ratio",
        label: "画幅",
        defaultId: ratios.includes("16:9") ? "16:9" : ratios[0],
        items: videoRatioItems(ratios),
      },
      {
        id: "resolution",
        label: "清晰度",
        defaultId: defaultClarityId(allowed),
        items: canvasClarityItems(allowed),
      },
      {
        id: "duration",
        label: "时长",
        defaultId: durationDefault,
        items: videoDurationItems(durations),
      },
    ],
  };
}

function replaceGroup(
  groups: GenerationPresetGroup[],
  id: string,
  next: GenerationPresetGroup
): GenerationPresetGroup[] {
  const idx = groups.findIndex((g) => g.id === id);
  if (idx < 0) return [...groups, next];
  const copy = groups.slice();
  copy[idx] = next;
  return copy;
}

const RATIO_GROUP_IDS = new Set(["ratio", "aspect_ratio", "aspectRatio"]);
/** 仅替换清晰度档组；quality 常是画质（low/medium/high），不能当分辨率 */
const CLARITY_GROUP_IDS = new Set(["resolution", "clarity"]);

function cleanAspectToken(raw: unknown): string {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/：/g, ":");
  // 分镜主体图等调用方历史上写成 16x9 / 16*9，这里统一成 16:9，
  // 否则会被当成像素尺寸，画幅退回 1:1（角色四联排就被压成方图）
  const m = /^(\d{1,2})[x*](\d{1,2})$/i.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

function isCanvasAspect(raw: unknown): raw is CanvasAspectRatio {
  return (CANVAS_ASPECT_RATIOS as readonly string[]).includes(cleanAspectToken(raw));
}

function groupLooksLikeRatio(g: GenerationPresetGroup): boolean {
  if (RATIO_GROUP_IDS.has(g.id)) return true;
  if (g.id !== "size") return false;
  return (g.items || []).some((i) => isCanvasAspect(i.id));
}

function groupLooksLikeClarity(g: GenerationPresetGroup): boolean {
  if (CLARITY_GROUP_IDS.has(g.id)) return true;
  if (g.id !== "size") return false;
  // size 组若是 1k/2k/480p 这类清晰度，不当成画幅
  return (g.items || []).some((i) => {
    const id = String(i.id || "").toLowerCase();
    return /^(1|2|4)k$/.test(id) || /^\d{3,4}p?$/.test(id);
  });
}

/**
 * 解析画布清晰度档：保留 480p/720p/768p/1080p/1K/2K/4K。
 * 无法识别时回退 fallback。
 */
export function toCanvasClarityTier(
  raw: unknown,
  fallback: CanvasClarityTier = "2K"
): CanvasClarityTier {
  const direct = normalizeClarityTierId(raw);
  if (direct) return direct;
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
  if (!t || t.includes(":")) return fallback;
  if (/^\d{3,4}p?$/.test(t)) {
    const n = Number.parseInt(t.replace(/\D/g, ""), 10);
    if (n > 0 && n <= 540) return "480p";
    if (n <= 740) return "720p";
    if (n <= 900) return "768p";
    if (n <= 1440) return "1080p";
    return "4K";
  }
  return fallback;
}

/** 从节点 options 取出通用清晰度档 */
export function pickCanvasClarityFromOptions(
  opts: Record<string, unknown> | undefined,
  fallback: CanvasClarityTier = "2K"
): CanvasClarityTier {
  const o = opts || {};
  for (const k of ["resolution", "clarity", "size"]) {
    const v = o[k];
    if (v == null || String(v).trim() === "") continue;
    if (String(v).includes(":")) continue; // size 可能是画幅
    return toCanvasClarityTier(v, fallback);
  }
  return fallback;
}

/** 点选清晰度时双写 resolution/clarity（保留 480p 等原档） */
export function patchOptionsWithClarity(
  value: Record<string, string>,
  groupId: string,
  itemId: string
): Record<string, string> {
  const next: Record<string, string> = { ...value, [groupId]: itemId };
  const c = toCanvasClarityTier(itemId, "2K");
  const looksClarity =
    CLARITY_GROUP_IDS.has(groupId) ||
    normalizeClarityTierId(itemId) != null ||
    (CANVAS_CLARITY_TIERS as readonly string[]).includes(itemId);
  if (looksClarity) {
    next.resolution = c;
    next.clarity = c;
  }
  return next;
}

/** 从节点 generationOptions 取出已选画幅；没有合法值时返回 null */
export function findCanvasAspectInOptions(
  opts: Record<string, unknown> | undefined
): CanvasAspectRatio | null {
  const o = opts || {};
  const keys = ["ratio", "aspect_ratio", "aspectRatio", "size"] as const;
  const votes: CanvasAspectRatio[] = [];
  for (const k of keys) {
    const t = cleanAspectToken(o[k]);
    if (isCanvasAspect(t)) votes.push(t);
  }
  if (!votes.length) return null;
  const count = new Map<CanvasAspectRatio, number>();
  for (const v of votes) count.set(v, (count.get(v) || 0) + 1);
  let bestN = 0;
  for (const n of count.values()) if (n > bestN) bestN = n;
  const tied = [...count.entries()].filter(([, n]) => n === bestN).map(([v]) => v);
  if (tied.length === 1) return tied[0];
  // 1:1 常是组默认残留，和用户点过的 16:9/9:16 冲突时采用户选项
  const nonSquare = tied.filter((v) => v !== "1:1");
  if (nonSquare.length === 1) return nonSquare[0];
  const fromRatio = cleanAspectToken(o.ratio);
  if (isCanvasAspect(fromRatio)) return fromRatio;
  return tied[0];
}

/** 从节点 generationOptions 取出三档画幅（16:9 / 9:16 / 1:1） */
export function pickCanvasAspectFromOptions(
  opts: Record<string, unknown> | undefined,
  fallback: CanvasAspectRatio = "16:9"
): CanvasAspectRatio {
  return findCanvasAspectInOptions(opts) ?? fallback;
}

/** 点选画幅时三键同写，避免面板写 ratio、提交却读到旧的 aspect_ratio */
export function patchOptionsWithAspect(
  value: Record<string, string>,
  groupId: string,
  itemId: string
): Record<string, string> {
  const next: Record<string, string> = { ...value, [groupId]: itemId };
  if (RATIO_GROUP_IDS.has(groupId) || isCanvasAspect(itemId)) {
    const r = cleanAspectToken(itemId);
    next.ratio = r;
    next.aspect_ratio = r;
    next.aspectRatio = r;
  }
  return next;
}

/** 点选任意档位：画幅三键 + 清晰度双写一并处理 */
export function patchGenerationOptionSelect(
  value: Record<string, string>,
  groupId: string,
  itemId: string
): Record<string, string> {
  return patchOptionsWithClarity(patchOptionsWithAspect(value, groupId, itemId), groupId, itemId);
}

/** 运行时强制统一比例 + 按模型能力过滤清晰度 */
export function canonicalizeImagePresets(
  presets?: GenerationPresetsConfig,
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): GenerationPresetsConfig {
  const base = imageAspectPresets(
    resolveInput(upstreamOrInput, displayName, "image")
  );
  const ratioGroup = base.groups.find((g) => g.id === "ratio")!;
  const resolutionGroup = base.groups.find((g) => g.id === "resolution")!;
  if (!presets?.groups?.length) return base;
  let groups = presets.groups.filter(
    (g) =>
      g.id !== "duration" &&
      g.id !== "fps" &&
      !groupLooksLikeRatio(g) &&
      !groupLooksLikeClarity(g)
  );
  groups = [ratioGroup, resolutionGroup, ...groups];
  return { version: 1, groups };
}

export function canonicalizeVideoPresets(
  presets?: GenerationPresetsConfig,
  upstreamOrInput?: string | ModelCapsInput,
  displayName?: string
): GenerationPresetsConfig {
  const base = videoDurationPresets(
    resolveInput(upstreamOrInput, displayName, "video")
  );
  const ratio = base.groups.find((g) => g.id === "ratio")!;
  const duration = base.groups.find((g) => g.id === "duration")!;
  const resolution = base.groups.find((g) => g.id === "resolution")!;
  if (!presets?.groups?.length) return base;
  let groups = presets.groups.filter(
    (g) => !groupLooksLikeRatio(g) && !groupLooksLikeClarity(g) && g.id !== "duration"
  );
  groups = [ratio, resolution, ...groups];
  groups = replaceGroup(groups, "duration", duration);
  return { version: 1, groups };
}

/** 按上游模型 id 生成视频预设（清晰度 / 时长已按能力收窄） */
export function videoDurationPresetsForUpstream(
  upstreamModel: string | ModelCapsInput,
  displayName?: string
): GenerationPresetsConfig {
  return videoDurationPresets(upstreamModel, displayName);
}
