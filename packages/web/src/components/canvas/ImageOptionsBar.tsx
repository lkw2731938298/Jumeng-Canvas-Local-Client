"use client";

import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import { imageAspectPresets } from "@/lib/local/presetTemplates";
import { GenerationOptionsDropdowns } from "./GenerationOptionsDropdowns";
import { VideoGenerationOptionsCollapsible } from "./VideoGenerationOptionsCollapsible";

interface ImageOptionsBarProps {
  presets: GenerationPresetsConfig;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  /** audio：与视频相同的折叠摘要条（歌曲 · 采样率 · …） */
  variant?: "image" | "video" | "audio";
  layout?: "block" | "inline";
  /** Current model name — which models use screenshot options panel */
  modelName?: string;
}

/** 视频/音频专用选项组：图片节点摘要不应出现「5s」等时长文案 */
const VIDEO_AUDIO_ONLY_GROUP_IDS = new Set([
  "duration",
  "fps",
  "instrumental",
  "lyricsOptimizer",
  "sampleRate",
  "bitrate",
  "format",
]);

function isVideoPresets(presets: GenerationPresetsConfig): boolean {
  return presets.groups.some((g) => g.id === "duration");
}

/** 图片栏：去掉时长等视频组；若剔空则回落图片比例预设 */
export function presetsForImageVariant(presets: GenerationPresetsConfig): GenerationPresetsConfig {
  const groups = presets.groups.filter((g) => !VIDEO_AUDIO_ONLY_GROUP_IDS.has(g.id));
  if (groups.length === 0) return imageAspectPresets();
  if (groups.length === presets.groups.length) return presets;
  return { ...presets, groups };
}

/** 「全能图片 G/Pro …（官方稳定）」显示创作工具宫格菜单 */
export function isNanoOfficialCreativeToolsModel(modelName: string | undefined): boolean {
  if (!modelName || !modelName.includes("_official")) return false;
  return modelName.startsWith("nano_g_") || modelName.startsWith("nano_pro_");
}

/** @deprecated use isNanoOfficialCreativeToolsModel */
export const isNanoGOfficialModel = isNanoOfficialCreativeToolsModel;

/** 图片模型统一使用截图风格参数面板，保证不同模型的交互一致 */
export function isScreenshotOptionsModel(modelName: string | undefined): boolean {
  return Boolean(modelName);
}

/** @deprecated use isScreenshotOptionsModel */
export const isNanoScreenshotOptionsModel = isScreenshotOptionsModel;

/** Inline generation options on node editor popup (image / video / audio). */
export function ImageOptionsBar({
  presets,
  value,
  onChange,
  pricing,
  variant,
  layout = "block",
  modelName,
}: ImageOptionsBarProps) {
  const useCollapsiblePanel =
    variant === "video" ||
    variant === "audio" ||
    (variant === "image" && isScreenshotOptionsModel(modelName)) ||
    (variant !== "image" && variant !== "video" && variant !== "audio" && isVideoPresets(presets));

  if (useCollapsiblePanel) {
    const summaryFallback =
      variant === "image"
        ? "点击设置图片参数"
        : variant === "audio"
          ? "点击设置音频参数"
          : "点击设置视频参数";
    // 图片模型误挂视频时长预设时，摘要会显示「5s」——按 variant 过滤
    const effectivePresets =
      variant === "image" ? presetsForImageVariant(presets) : presets;
    return (
      <VideoGenerationOptionsCollapsible
        presets={effectivePresets}
        value={value}
        onChange={onChange}
        pricing={pricing}
        layout={layout}
        summaryFallback={summaryFallback}
        leadingIcon={variant === "audio" ? "music" : "ratio"}
      />
    );
  }

  if (layout === "inline") {
    return (
      <GenerationOptionsDropdowns presets={presets} value={value} onChange={onChange} pricing={pricing} />
    );
  }

  return (
    <div className="border-b border-white/10 px-3 py-2.5">
      <GenerationOptionsDropdowns presets={presets} value={value} onChange={onChange} pricing={pricing} />
    </div>
  );
}
