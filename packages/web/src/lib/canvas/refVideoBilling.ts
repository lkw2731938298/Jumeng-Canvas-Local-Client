/**
 * RH Seedance 多模态：有参考视频时自动写入 generationOptions.refVideo=with，
 * 与后端 optionsWithVideoReference 单价表对齐。
 */
import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import type { GenerationReference, MaterialSlot } from "@/lib/canvas/nodeMaterialSlots";
import { extractMentionLabelsInOrder } from "@/lib/canvas/nodeMaterialSlots";

const REF_VIDEO_GROUP = "refVideo";

export function presetsSupportRefVideoBilling(
  presets: GenerationPresetsConfig | null | undefined
): boolean {
  return Boolean(presets?.groups?.some((g) => g.id === REF_VIDEO_GROUP));
}

/** 与 collectGenerationReferences 一致：有 @ 则看提及里是否含视频，否则看上游视频槽。 */
export function hasVideoReferenceForBilling(
  draft: string,
  materialSlots: MaterialSlot[],
  pickedReferences?: GenerationReference[]
): boolean {
  if (pickedReferences?.some((r) => r.type === "video")) return true;

  const videoSlots = materialSlots.filter((s) => s.type === "video");
  if (videoSlots.length === 0) return false;

  const knownLabels = materialSlots.map((s) => s.label).filter(Boolean);
  const mentions = extractMentionLabelsInOrder(draft, knownLabels);
  if (mentions.length > 0) {
    const byLabel = new Map(materialSlots.map((s) => [s.label, s]));
    return mentions.some((label) => byLabel.get(label)?.type === "video");
  }

  return videoSlots.some((s) => s.source !== "local");
}

/** 在 normalize 之后写入 refVideo，供报价与提交使用。 */
export function withRefVideoBillingOption(
  presets: GenerationPresetsConfig | null | undefined,
  options: GenerationOptions,
  hasVideoRef: boolean
): GenerationOptions {
  if (!presetsSupportRefVideoBilling(presets)) return options;
  return {
    ...options,
    [REF_VIDEO_GROUP]: hasVideoRef ? "with" : "none",
  };
}
