/**
 * MiniMax-H3 等：报价/提交时写入 inputVideoSeconds、inputImageCount，
 * 与后端 billInputVideoSeconds / extraImageBilling 对齐。
 */
import type { Node } from "@xyflow/react";
import type { GenerationOptions } from "@/types/generationPresets";
import type { GenerationReference, MaterialSlot } from "@/lib/canvas/nodeMaterialSlots";
import { extractMentionLabelsInOrder } from "@/lib/canvas/nodeMaterialSlots";

const DEFAULT_VIDEO_SEC = 5;

function nodeParams(node: Node | undefined): Record<string, unknown> {
  if (!node) return {};
  const data = node.data as { params?: Record<string, unknown> };
  return data?.params ?? {};
}

/** 从视频节点参数估算参考时长（裁剪区间优先，否则 durationSec，缺省 5s）。 */
export function estimateVideoSlotSeconds(node: Node | undefined): number {
  const params = nodeParams(node);
  const trim =
    (params.inlineVideoTrim as { inSec?: number; outSec?: number } | undefined) ||
    (params.videoTrim as { inSec?: number; outSec?: number } | undefined);
  if (
    trim &&
    typeof trim.inSec === "number" &&
    typeof trim.outSec === "number" &&
    trim.outSec > trim.inSec
  ) {
    return Math.max(2, Math.min(15, Math.round(trim.outSec - trim.inSec)));
  }
  const raw = params.durationSec ?? params.duration_sec ?? params.duration;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.max(2, Math.min(15, Math.round(n)));
  }
  return DEFAULT_VIDEO_SEC;
}

function selectedMaterialSlots(
  draft: string,
  materialSlots: MaterialSlot[],
  pickedReferences?: GenerationReference[]
): MaterialSlot[] {
  if (pickedReferences && pickedReferences.length > 0) {
    const byId = new Map(materialSlots.map((s) => [s.nodeId, s]));
    const out: MaterialSlot[] = [];
    for (const ref of pickedReferences) {
      const slot = byId.get(ref.nodeId);
      if (slot) out.push(slot);
      else {
        out.push({
          nodeId: ref.nodeId,
          nodeType: "",
          label: ref.label,
          type: ref.type,
          source: ref.source ?? "upstream",
        });
      }
    }
    return out;
  }
  const knownLabels = materialSlots.map((s) => s.label).filter(Boolean);
  const mentions = extractMentionLabelsInOrder(draft, knownLabels);
  if (mentions.length > 0) {
    const byLabel = new Map(materialSlots.map((s) => [s.label, s]));
    return mentions.map((label) => byLabel.get(label)).filter(Boolean) as MaterialSlot[];
  }
  // 无 @ 时：仅上游图/视频（与 collectGenerationReferences 一致）
  return materialSlots.filter(
    (s) => (s.type === "image" || s.type === "video") && s.source !== "local"
  );
}

export function countBillingImages(
  draft: string,
  materialSlots: MaterialSlot[],
  pickedReferences?: GenerationReference[]
): number {
  if (pickedReferences?.length) {
    return Math.min(9, pickedReferences.filter((r) => r.type === "image").length);
  }
  const slots = selectedMaterialSlots(draft, materialSlots, pickedReferences);
  return Math.min(9, slots.filter((s) => s.type === "image").length);
}

export function sumBillingVideoSeconds(
  draft: string,
  materialSlots: MaterialSlot[],
  nodes: Node[],
  pickedReferences?: GenerationReference[]
): number {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  if (pickedReferences?.length) {
    let total = 0;
    for (const ref of pickedReferences) {
      if (ref.type !== "video") continue;
      const fromRef = Number(
        (ref as GenerationReference & { durationSec?: number }).durationSec
      );
      if (Number.isFinite(fromRef) && fromRef > 0) {
        total += Math.max(2, Math.min(15, Math.round(fromRef)));
      } else {
        total += estimateVideoSlotSeconds(nodeMap.get(ref.nodeId));
      }
    }
    return Math.min(45, total);
  }
  const slots = selectedMaterialSlots(draft, materialSlots, pickedReferences);
  let total = 0;
  for (const slot of slots) {
    if (slot.type !== "video") continue;
    total += estimateVideoSlotSeconds(nodeMap.get(slot.nodeId));
  }
  return Math.min(45, total);
}

/** 即使前端模型缓存缺定价开关，也必须写入对应素材用量，否则报价与提交会 PRICING_CHANGED 死循环。
 * 注意：按模型拆分「视频秒 / 参考图」，禁止 H3 以外模型误写另一类字段。
 */
export function modelNeedsInputVideoSecondsBilling(modelName?: string | null): boolean {
  const name = String(modelName || "").trim().toLowerCase();
  return name.startsWith("rh_minimax_hailuo_h3") || name === "rh_seedance_25_r2v";
}

export function modelNeedsInputImageCountBilling(modelName?: string | null): boolean {
  const name = String(modelName || "").trim().toLowerCase();
  return name.startsWith("rh_minimax_hailuo_h3") || name.startsWith("qwen_image");
}

/** @deprecated 请用 modelNeedsInputVideoSecondsBilling / modelNeedsInputImageCountBilling */
export function modelNeedsMaterialUsageBilling(modelName?: string | null): boolean {
  return (
    modelNeedsInputVideoSecondsBilling(modelName) || modelNeedsInputImageCountBilling(modelName)
  );
}

export function pricingNeedsMaterialUsage(
  pricing: Record<string, unknown> | undefined,
  modelName?: string | null
): boolean {
  if (modelNeedsMaterialUsageBilling(modelName)) return true;
  if (!pricing || typeof pricing !== "object") return false;
  if (pricing.billInputVideoSeconds) return true;
  return Boolean(pricing.extraImageBilling && typeof pricing.extraImageBilling === "object");
}

/** 在 normalize / refVideo 之后写入素材用量字段。 */
export function withMaterialUsageBillingOptions(
  pricing: Record<string, unknown> | undefined,
  options: GenerationOptions,
  draft: string,
  materialSlots: MaterialSlot[],
  nodes: Node[],
  pickedReferences?: GenerationReference[],
  modelName?: string | null
): GenerationOptions {
  if (!pricingNeedsMaterialUsage(pricing, modelName)) return options;
  // 视频秒：H3 / Seedance2.5 多模态，或定价开关 billInputVideoSeconds
  const billVideo =
    modelNeedsInputVideoSecondsBilling(modelName) || Boolean(pricing?.billInputVideoSeconds);
  // 参考图张数：H3 / 千问图像，或定价含 extraImageBilling
  const billImage =
    modelNeedsInputImageCountBilling(modelName) ||
    Boolean(pricing?.extraImageBilling && typeof pricing.extraImageBilling === "object");
  const next: GenerationOptions = { ...options };
  if (billVideo) {
    next.inputVideoSeconds = String(
      sumBillingVideoSeconds(draft, materialSlots, nodes, pickedReferences)
    );
  }
  if (billImage) {
    next.inputImageCount = String(countBillingImages(draft, materialSlots, pickedReferences));
  }
  return next;
}
