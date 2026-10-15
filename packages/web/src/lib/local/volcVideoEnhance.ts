/**
 * 聚梦「火山画质增强」三模型：识别、画布预设、提交体字段。
 * 对齐 RunningHub / 火山方舟参数；经聚梦 POST /v1/videos + 轮询。
 */

import type { GenerationPresetsConfig, GenerationPresetGroup } from "@/types/generationPresets";

/** 画布顶栏「画质增强」固定调用的上游模型名（标准/专业双档） */
export const VOLC_ENHANCE_STANDARD_PRO_MODEL = "火山画质增强-标准专业版";

export type VolcEnhanceVariant = "generative" | "fast" | "standard_pro";

export type VolcEnhanceMode = "standard" | "professional";
export type VolcEnhanceScene = "common" | "aigc" | "short_series" | "ugc" | "old_film";
export type VolcEnhanceStyle = "hd" | "natural";
export type VolcEnhanceBitrateLevel = "low" | "medium" | "high";
export type VolcEnhanceBitDepth = "8" | "10" | "12" | "16";

function blobOf(input: {
  upstreamModel?: string | null;
  name?: string | null;
  displayName?: string | null;
}): string {
  return `${input.upstreamModel || ""} ${input.name || ""} ${input.displayName || ""}`;
}

/** 是否为火山画质增强三模型之一 */
export function isVolcVideoEnhanceModel(input: {
  upstreamModel?: string | null;
  name?: string | null;
  displayName?: string | null;
  canvasTool?: string | null;
}): boolean {
  if (detectVolcEnhanceVariant(input) != null) return true;
  const tool = String(input.canvasTool || "").toLowerCase();
  // 视频高清工具在本地版固定走标准专业版
  if (tool === "hd_upscale_video") return true;
  return false;
}

/** 识别三模型变体；无法识别返回 null */
export function detectVolcEnhanceVariant(input: {
  upstreamModel?: string | null;
  name?: string | null;
  displayName?: string | null;
}): VolcEnhanceVariant | null {
  const blob = blobOf(input);
  if (/火山画质增强[-_]?大模型|volc[_-]?enhance[_-]?generative|enhance-generative/i.test(blob)) {
    return "generative";
  }
  if (/火山画质增强[-_]?极速|volc[_-]?enhance[_-]?fast|enhance-fast/i.test(blob)) {
    return "fast";
  }
  if (
    /火山画质增强[-_]?标准专业|volc[_-]?enhance(?![a-z_-]*(generative|fast))/i.test(blob)
  ) {
    return "standard_pro";
  }
  // 兜底：其它「火山画质增强」归标准专业版
  if (/火山画质增强/.test(blob)) return "standard_pro";
  return null;
}

export function volcEnhanceVariantLabel(v: VolcEnhanceVariant): string {
  if (v === "generative") return "大模型版";
  if (v === "fast") return "极速版";
  return "标准专业版";
}

/** 各变体可选输出分辨率（与上游 enum 一致，小写） */
export function volcEnhanceResolutions(variant: VolcEnhanceVariant): string[] {
  if (variant === "generative") return ["720p", "1080p", "2k"];
  if (variant === "fast") return ["720p", "1080p", "2k", "4k"];
  return ["720p", "1080p", "2k", "4k", "8k"];
}

const FPS_OPTIONS = [
  { id: "keep", label: "保持原帧率", value: "" },
  { id: "24", label: "24", value: "24" },
  { id: "25", label: "25", value: "25" },
  { id: "30", label: "30", value: "30" },
  { id: "50", label: "50", value: "50" },
  { id: "60", label: "60", value: "60" },
] as const;

function item(
  id: string,
  label: string,
  api: Record<string, unknown>
): GenerationPresetGroup["items"][number] {
  return { id, label, api };
}

/** 拉取/接入时写入模型的 generationPresets（高级设置「更多」也读这份） */
export function volcEnhanceGenerationPresets(
  variant: VolcEnhanceVariant
): GenerationPresetsConfig {
  const resolutions = volcEnhanceResolutions(variant);
  const groups: GenerationPresetGroup[] = [];

  if (variant === "standard_pro") {
    groups.push({
      id: "mode",
      label: "档次",
      defaultId: "standard",
      items: [
        item("standard", "标准版", { mode: "standard", enhanceMode: "standard" }),
        item("professional", "专业版", {
          mode: "professional",
          enhanceMode: "professional",
        }),
      ],
    });
    groups.push({
      id: "scene",
      label: "场景（标准版）",
      defaultId: "common",
      items: [
        item("common", "通用", { scene: "common", enhanceScene: "common" }),
        item("aigc", "AIGC", { scene: "aigc", enhanceScene: "aigc" }),
        item("short_series", "短剧", {
          scene: "short_series",
          enhanceScene: "short_series",
        }),
        item("ugc", "UGC", { scene: "ugc", enhanceScene: "ugc" }),
        item("old_film", "老片修复", { scene: "old_film", enhanceScene: "old_film" }),
      ],
    });
    groups.push({
      id: "enhanceStyle",
      label: "增强风格",
      defaultId: "hd",
      items: [
        item("hd", "高清", { enhanceStyle: "hd" }),
        item("natural", "自然", { enhanceStyle: "natural" }),
      ],
    });
  }

  groups.push({
    id: "resolution",
    label: "画质",
    defaultId: resolutions.includes("1080p") ? "1080p" : resolutions[0],
    items: resolutions.map((r) =>
      item(r, r.toUpperCase() === r ? r : r.replace("k", "K"), {
        resolution: r,
        clarity: r,
        enhanceResolution: r,
      })
    ),
  });

  groups.push({
    id: "fps",
    label: "帧率",
    defaultId: "keep",
    items: FPS_OPTIONS.map((o) =>
      item(o.id, o.label, o.value ? { fps: o.value, enhanceFps: o.value } : { enhanceFps: "" })
    ),
  });

  groups.push({
    id: "bitrateLevel",
    label: "码率档",
    defaultId: "medium",
    items: [
      item("low", "低", { bitrateLevel: "low", enhanceBitrateLevel: "low" }),
      item("medium", "中", { bitrateLevel: "medium", enhanceBitrateLevel: "medium" }),
      item("high", "高", { bitrateLevel: "high", enhanceBitrateLevel: "high" }),
    ],
  });

  if (variant === "standard_pro") {
    groups.push({
      id: "bitDepth",
      label: "色深（专业版）",
      defaultId: "8",
      items: (["8", "10", "12", "16"] as const).map((d) =>
        item(d, `${d}bit`, { bitDepth: d, enhanceBitDepth: d })
      ),
    });
  }

  return { version: 1, groups };
}

export type VolcEnhanceSubmitOptions = {
  mode?: string;
  scene?: string;
  enhanceStyle?: string;
  resolution?: string;
  fps?: string | number;
  bitrateLevel?: string;
  bitrate?: string | number;
  bitDepth?: string;
};

/** 从画布 generationOptions / 节点 params 归一化提交字段 */
export function normalizeVolcEnhanceOptions(
  variant: VolcEnhanceVariant,
  opts: Record<string, unknown> | null | undefined
): VolcEnhanceSubmitOptions {
  const o = opts || {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = o[k];
      if (v != null && String(v).trim() !== "" && String(v) !== "keep") return String(v).trim();
    }
    return "";
  };

  const resolutionRaw = pick(
    "enhanceResolution",
    "resolution",
    "clarity"
  ).toLowerCase();
  const allowed = volcEnhanceResolutions(variant);
  let resolution = resolutionRaw.replace(/^(\d+)k$/, "$1k");
  if (resolution === "2k" || resolution === "4k" || resolution === "8k") {
    /* ok */
  } else if (/^1080/.test(resolution)) resolution = "1080p";
  else if (/^720/.test(resolution)) resolution = "720p";
  else if (/^4k|^2160/.test(resolution)) resolution = "4k";
  else if (/^8k|^4320/.test(resolution)) resolution = "8k";
  else if (/^2k/.test(resolution)) resolution = "2k";
  if (!allowed.includes(resolution)) {
    resolution = allowed.includes("1080p") ? "1080p" : allowed[0];
  }

  const out: VolcEnhanceSubmitOptions = {
    resolution,
    bitrateLevel: (pick("enhanceBitrateLevel", "bitrateLevel") || "medium") as string,
  };

  const fpsRaw = pick("enhanceFps", "fps");
  if (fpsRaw) {
    const n = Number(fpsRaw);
    if (Number.isFinite(n) && n >= 15 && n <= 120) out.fps = n;
  }

  const bitrateRaw = pick("bitrate", "enhanceBitrate");
  if (bitrateRaw) {
    const n = Math.round(Number(bitrateRaw));
    if (Number.isFinite(n) && n >= 10 && n <= 150000) out.bitrate = n;
  }

  if (variant === "standard_pro") {
    let mode = (pick("enhanceMode", "mode") || "standard").toLowerCase();
    if (mode !== "professional") mode = "standard";
    out.mode = mode;
    out.scene = (pick("enhanceScene", "scene") || "common") as string;
    out.enhanceStyle = (pick("enhanceStyle") || "hd") as string;
    if (!["hd", "natural"].includes(out.enhanceStyle)) out.enhanceStyle = "hd";
    if (
      !["common", "aigc", "short_series", "ugc", "old_film"].includes(String(out.scene))
    ) {
      out.scene = "common";
    }
    const depth = pick("enhanceBitDepth", "bitDepth") || "8";
    out.bitDepth = (["8", "10", "12", "16"].includes(depth) ? depth : "8") as string;
  }

  return out;
}

/** 写入 POST /v1/videos 的业务字段（不含 model / prompt） */
export function buildVolcEnhanceRequestFields(
  variant: VolcEnhanceVariant,
  publicVideoUrl: string,
  opts: VolcEnhanceSubmitOptions
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    videoUrl: publicVideoUrl,
    video_url: publicVideoUrl,
    image: publicVideoUrl,
    video: publicVideoUrl,
    videos: [publicVideoUrl],
    resolution: opts.resolution,
  };
  if (opts.fps != null && opts.fps !== "") fields.fps = Number(opts.fps);
  if (opts.bitrateLevel) {
    fields.bitrateLevel = opts.bitrateLevel;
    fields.bitrate_level = opts.bitrateLevel;
  }
  if (opts.bitrate != null) fields.bitrate = Number(opts.bitrate);

  if (variant === "standard_pro") {
    fields.mode = opts.mode || "standard";
    fields.tool_version = opts.mode || "standard";
    fields.enhanceStyle = opts.enhanceStyle || "hd";
    fields.enhance_style = opts.enhanceStyle || "hd";
    if ((opts.mode || "standard") === "standard") {
      fields.scene = opts.scene || "common";
    }
    if ((opts.mode || "standard") === "professional" && opts.bitDepth) {
      fields.bitDepth = opts.bitDepth;
      fields.bit_depth = opts.bitDepth;
    }
  }

  fields.metadata = JSON.stringify({
    videoUrl: publicVideoUrl,
    resolution: opts.resolution,
    mode: opts.mode,
    scene: opts.scene,
    enhanceStyle: opts.enhanceStyle,
    fps: opts.fps,
    bitrateLevel: opts.bitrateLevel,
    bitDepth: opts.bitDepth,
  });

  return fields;
}
