import type { CanvasModel } from "@/lib/api/models";
import type {
  GenerationOptions,
  GenerationPresetGroup,
  GenerationPresetsConfig,
} from "@/types/generationPresets";
import { readGlobalWatermarkEnabled } from "@/lib/preferences/globalWatermark";
import {
  findCanvasAspectInOptions,
  pickCanvasClarityFromOptions,
  toCanvasClarityTier,
} from "@/lib/local/presetTemplates";
import { clampCanvasClarity } from "@/lib/local/modelGenerationCaps";

export function getModelGenerationPresets(model: CanvasModel | undefined): GenerationPresetsConfig | null {
  const raw = model?.parameters?.generationPresets;
  if (!raw || typeof raw !== "object") return null;
  const config = raw as GenerationPresetsConfig;
  if (!Array.isArray(config.groups) || config.groups.length === 0) return null;
  return config;
}

/**
 * Agent 常写 aspectRatio/clarity；视频选择器 group id 多为 ratio/resolution。
 * 接收完整 group（而非仅 id）是为了让 "size" 分支也能按需拿到 group 定义
 * （如豆包/ComfyUI 图片的"尺寸"选项组，id 固定为 size，但 Agent 始终写
 * ratio/aspectRatio，需要在这里把值取出来交给 resolvePresetItem 做比例匹配）。
 */
export function incomingOptionForGroup(
  group: GenerationPresetGroup,
  incoming: GenerationOptions
): string | number | undefined | null {
  const groupId = group.id;
  if (groupId === "ratio" || groupId === "aspectRatio" || groupId === "aspect_ratio") {
    // 三键可能不一致：以画布合法画幅为准，避免高亮 16:9 却提交旧的 1:1
    const picked = findCanvasAspectInOptions(incoming);
    if (picked) return picked;
  }
  const direct = incoming[groupId];
  if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
    return direct;
  }
  if (groupId === "resolution") {
    return incoming.clarity;
  }
  if (groupId === "clarity") {
    return incoming.resolution;
  }
  if (groupId === "size") {
    // 豆包/ComfyUI 等模型把"画幅/尺寸"选项组命名为 size；Agent 手册统一教写
    // ratio/aspectRatio，这里做兜底映射，具体的比例↔选项 id 匹配在
    // resolvePresetItem 的 size 分支完成
    return incoming.size ?? incoming.ratio ?? incoming.aspectRatio ?? incoming.aspect_ratio;
  }
  return undefined;
}

export function normalizeGenerationOptions(
  presets: GenerationPresetsConfig | null,
  options: GenerationOptions | undefined
): GenerationOptions {
  if (!presets) return {};
  const incoming = options ?? {};
  const normalized: GenerationOptions = {};

  for (const group of presets.groups) {
    const item = resolvePresetItem(group, incomingOptionForGroup(group, incoming));
    if (item) normalized[group.id] = item.id;
    // 画幅三键同写，避免面板写 ratio、提交却读到旧的 aspect_ratio
    if (item && (group.id === "ratio" || group.id === "aspect_ratio" || group.id === "aspectRatio")) {
      const r = item.id;
      normalized.ratio = r;
      normalized.aspect_ratio = r;
      normalized.aspectRatio = r;
    }
  }
  const syncedAspect = findCanvasAspectInOptions({ ...incoming, ...normalized });
  if (syncedAspect) {
    normalized.ratio = syncedAspect;
    normalized.aspect_ratio = syncedAspect;
    normalized.aspectRatio = syncedAspect;
  }
  // 清晰度：保留 480p/720p/768p/1K/2K/4K，并夹到当前模型预设里实际存在的档
  if (presets.groups.some((g) => g.id === "resolution" || g.id === "clarity")) {
    const clarityGroup =
      presets.groups.find((g) => g.id === "resolution") ??
      presets.groups.find((g) => g.id === "clarity");
    const allowed =
      clarityGroup?.items
        .filter((i) => i.enabled !== false)
        .map((i) => toCanvasClarityTier(i.id, "2K"))
        .filter((id, idx, arr) => arr.indexOf(id) === idx) ?? [];
    const rawClarity = pickCanvasClarityFromOptions({ ...incoming, ...normalized }, "2K");
    const clarity = allowed.length
      ? clampCanvasClarity(rawClarity, allowed)
      : rawClarity;
    normalized.resolution = clarity;
    normalized.clarity = clarity;
  }

  // 全局水印开关覆盖各模型独立水印选项
  if (presets.groups.some((g) => g.id === "watermark")) {
    normalized.watermark = readGlobalWatermarkEnabled() ? "on" : "off";
  }

  return normalized;
}

/** 解析 "9:16" / "9x16" / "16 : 9" 等画幅字符串为宽高数值比；解析失败返回 null */
function parseRatioValue(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase().replace(/×/g, "x").replace(/\s/g, "");
  const m = cleaned.match(/^(\d+(?:\.\d+)?)[:x](\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/**
 * 从选项 item 的 api 字段解析宽高比：优先 api.width/height（数值，ComfyUI 用法），
 * 其次 api.size 形如 "1440x2560" 的字符串（豆包用法）。纯档位型（如 "2K"/"4K"
 * 这类不含具体宽高的 size 字符串）解析失败返回 null，不参与比例匹配。
 */
function parseItemDimensionRatio(item: GenerationPresetGroup["items"][number]): number | null {
  const api = item.api;
  if (!api || typeof api !== "object") return null;
  const rec = api as Record<string, unknown>;
  const w = Number(rec.width);
  const h = Number(rec.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
  const sizeStr = rec.size;
  if (typeof sizeStr === "string") {
    const m = sizeStr.trim().toLowerCase().match(/^(\d+)x(\d+)$/);
    if (m) {
      const sw = Number(m[1]);
      const sh = Number(m[2]);
      if (sw > 0 && sh > 0) return sw / sh;
    }
  }
  return null;
}

export function resolvePresetItem(
  group: GenerationPresetGroup,
  itemId: string | number | undefined | null
): GenerationPresetGroup["items"][number] | null {
  const enabled = group.items.filter((i) => i.enabled !== false);
  if (itemId !== undefined && itemId !== null && String(itemId).trim() !== "") {
    const raw = String(itemId).trim();
    const found = enabled.find((i) => i.id === raw);
    if (found) return found;

    // Agent/LLM 常写 "4s" / "4秒" / 数字 4 / "720P" / "16x9"
    if (group.id === "duration") {
      const n = raw.replace(/[^\d.]/g, "");
      const rounded = n ? String(Math.round(Number(n))) : "";
      const byId =
        (rounded && enabled.find((i) => i.id === rounded)) ||
        enabled.find((i) => i.id === n) ||
        enabled.find((i) => String(i.label).replace(/s$/i, "") === rounded);
      if (byId) return byId;
      // 越界秒数钳到该模型合法区间（如 MiniMax-H3 写 4 → 5），不要静默回落到 defaultId
      const range = getDurationRangeFromGroup(group);
      if (range && rounded) {
        const num = Number(rounded);
        if (Number.isFinite(num) && num > 0) {
          const clamped = String(Math.min(range.max, Math.max(range.min, Math.round(num))));
          const byClamp = enabled.find((i) => i.id === clamped);
          if (byClamp) return byClamp;
        }
      }
    }
    if (group.id === "aspectRatio" || group.id === "ratio") {
      const norm = raw.toLowerCase().replace(/×/g, "x").replace(/x/g, ":").replace(/\s/g, "");
      const byId = enabled.find((i) => i.id === norm || i.id === raw);
      if (byId) return byId;
    }
    if (group.id === "resolution" || group.id === "clarity") {
      const dig = raw.replace(/[^\d]/g, "");
      const byId =
        (dig && enabled.find((i) => i.id === dig || i.id === `${dig}p` || i.id === `${dig}K` || i.id === `${dig}k`)) ||
        enabled.find((i) => i.id.toLowerCase() === raw.toLowerCase());
      if (byId) return byId;
      // 保留六档；若当前模型不支持该档则夹到最近可用档
      const tier = toCanvasClarityTier(raw, "2K");
      const byTier = enabled.find((i) => i.id === tier);
      if (byTier) return byTier;
      const allowed = enabled
        .map((i) => toCanvasClarityTier(i.id, "2K"))
        .filter((id, idx, arr) => arr.indexOf(id) === idx);
      if (allowed.length) {
        const clamped = clampCanvasClarity(tier, allowed);
        const byClamp = enabled.find((i) => i.id === clamped);
        if (byClamp) return byClamp;
      }
    }
    if (group.id === "size") {
      // 豆包等模型的 size 组 id 用 "x" 分隔（"16x9"/"9x16"/"1x1"）；Agent 写的是
      // ":" 分隔的 "16:9"，这里做双向归一后按 id 精确匹配
      const normColon = raw.toLowerCase().replace(/×/g, "x").replace(/\s/g, "");
      const normX = normColon.replace(/:/g, "x");
      const normRatio = normColon.replace(/x/g, ":");
      const byId = enabled.find((i) => i.id === normX || i.id === normRatio);
      if (byId) return byId;

      // 兜底：按数值宽高比就近匹配（覆盖 ComfyUI 的 square/landscape/portrait
      // 这类语义化 id，也自动适配未来新模型，无需为每个模型单独硬编码映射）。
      // 只有声明了具体宽高（item.api.width/height 或 "WxH" 形式 api.size）的
      // item 才参与匹配，纯档位型（"2K"/"4K"）不受影响，继续走 defaultId 兜底
      const requestedRatio = parseRatioValue(raw);
      if (requestedRatio) {
        let best: GenerationPresetGroup["items"][number] | null = null;
        let bestDiff = Infinity;
        for (const it of enabled) {
          const itemRatio = parseItemDimensionRatio(it);
          if (itemRatio == null) continue;
          const diff = Math.abs(Math.log(itemRatio / requestedRatio));
          if (diff < bestDiff) {
            bestDiff = diff;
            best = it;
          }
        }
        // 对数比差 < 0.08 约等于宽高比相对误差 8% 以内，避免请求比例与所有
        // 档位都相差很远时仍强行套用一个不相关的选项
        if (best && bestDiff < 0.08) return best;
      }
    }
  }
  if (group.defaultId) {
    const def = enabled.find((i) => i.id === group.defaultId);
    if (def) return def;
  }
  return enabled[0] ?? null;
}

export function defaultGenerationOptions(presets: GenerationPresetsConfig | null): GenerationOptions {
  return normalizeGenerationOptions(presets, {});
}

export function formatOptionsSummary(
  presets: GenerationPresetsConfig | null,
  options: GenerationOptions
): string {
  if (!presets) return "";
  return presets.groups
    .map((g) => {
      if (g.id === "duration") {
        const item = resolvePresetItem(g, options[g.id]);
        if (item?.id && /^\d+$/.test(item.id)) return `${item.id}s`;
      }
      const item = resolvePresetItem(g, options[g.id]);
      return item?.label;
    })
    .filter(Boolean)
    .join(" · ");
}

/** Numeric second range for video duration slider (from preset items). */
export function getDurationRangeFromGroup(
  group: GenerationPresetGroup
): { min: number; max: number } | null {
  if (group.id !== "duration") return null;
  const nums = group.items
    .filter((i) => i.enabled !== false)
    .map((i) => parseInt(String(i.id), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

export function isDurationSliderGroup(group: GenerationPresetGroup): boolean {
  return getDurationRangeFromGroup(group) !== null;
}
