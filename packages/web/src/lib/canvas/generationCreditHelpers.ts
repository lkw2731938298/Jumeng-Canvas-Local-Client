import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import { formatCreditAmount, roundCreditAmount } from "@/lib/api/credits";

export function isPricingChangedError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === "PRICING_CHANGED") return true;
  if (err.status !== 409) return false;
  const payload = (err.content ?? err.detail) as { code?: string } | undefined;
  return payload?.code === "PRICING_CHANGED";
}

export function toastPricingChanged(refetchQuote?: () => void) {
  toast.error("价格已更新，请确认后重试");
  refetchQuote?.();
}

export function toastCreditCharged(cost?: number, creditsEnabled = true) {
  if (creditsEnabled && cost != null && cost > 0) {
    toast.message(`已扣除 ${formatCreditAmount(cost)} 算力`);
  }
}

/** Skip charge toast when generation awaits owner approval (no reserve yet). */
export function maybeToastCreditCharged(
  result: { status?: string; creditCost?: number },
  creditsEnabled = true
) {
  if (result.status === "awaiting_approval") return;
  toastCreditCharged(result.creditCost, creditsEnabled);
}

export function toastAwaitingApproval(message?: string) {
  toast.message(message || "已提交审批，等待项目创建者确认");
}

export function handleCollaboratorSpendCapError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (
    err.code === "COLLABORATOR_DAILY_CAP_EXCEEDED" ||
    err.code === "COLLABORATOR_TOTAL_CAP_EXCEEDED"
  ) {
    toast.error(err.message);
    return true;
  }
  return false;
}

export function newIdempotencyKey(nodeId: string): string {
  // Fetch Headers 要求 ByteString（ISO-8859-1）；去掉非 ASCII，避免中文工具名直接打挂请求
  const safe = String(nodeId || "job")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 180);
  return `${safe || "job"}-${Date.now()}`;
}

export function durationSecondsFromSnapshot(
  optionSnapshot: Record<string, string> = {}
): number {
  const raw = optionSnapshot.duration;
  if (raw && /^\d+$/.test(raw)) return Math.max(1, parseInt(raw, 10));
  return 5;
}

/** 与后端 _image_output_count 对齐：生成数量 1–4 */
function imageOutputCountFromSnapshot(optionSnapshot: Record<string, string>): number {
  const raw = optionSnapshot.count || optionSnapshot.n;
  if (raw && /^\d+$/.test(raw)) {
    return Math.max(1, Math.min(parseInt(raw, 10), 4));
  }
  return 1;
}

/** Client-side estimate when quote API is unavailable — mirrors backend pricing modes. */
export function estimateCreditFromPricing(
  pricing: Record<string, unknown> | undefined,
  optionSnapshot: Record<string, string> = {}
): number {
  if (!pricing || typeof pricing !== "object") return 0;

  const base = Math.max(Number(pricing.baseCost) || 0, 0);
  const minCost = Math.max(Number(pricing.minCost) || 0, 0);
  const mode = String(pricing.mode || "additive");
  const options = pricing.options as Record<string, Record<string, number>> | undefined;

  let unit = 0;
  if (mode === "primary_group") {
    const primaryGroup = String(pricing.primaryGroupId || "duration");
    const selected = optionSnapshot[primaryGroup];
    let primaryCost = 0;
    if (selected && options?.[primaryGroup]?.[selected] != null) {
      primaryCost = Math.max(Number(options[primaryGroup][selected]) || 0, 0);
    }
    unit = Math.max(minCost, primaryCost > 0 ? primaryCost : base);
  } else if (mode === "video_per_second") {
    const rateGroup = String(pricing.rateGroupId || "resolution");
    const seconds = durationSecondsFromSnapshot(optionSnapshot);
    const selectedRate = optionSnapshot[rateGroup];
    const refGid = String(pricing.refVideoGroupId || "refVideo");
    const withRoot =
      optionSnapshot[refGid] === "with"
        ? (pricing.optionsWithVideoReference as
            | Record<string, Record<string, number>>
            | undefined)
        : undefined;
    const rateTable = withRoot?.[rateGroup] ?? options?.[rateGroup];
    const rate =
      selectedRate && rateTable?.[selectedRate] != null
        ? Math.max(Number(rateTable[selectedRate]) || 0, 0)
        : 0;
    let total = seconds * rate;
    // MiniMax-H3：输入视频秒数按同档单价另计
    if (pricing.billInputVideoSeconds && rate > 0) {
      const inputSecs = Math.max(0, Math.min(45, Number(optionSnapshot.inputVideoSeconds) || 0));
      total += inputSecs * rate;
    }
    // 参考图超额：前 freeCount 张免费
    const eib = pricing.extraImageBilling as
      | { freeCount?: number; costPerImage?: number }
      | undefined;
    if (eib && typeof eib === "object") {
      const freeCount = Math.max(0, Number(eib.freeCount) || 0);
      const perImage = Math.max(0, Number(eib.costPerImage) || 0);
      const imgCount = Math.max(0, Math.min(9, Number(optionSnapshot.inputImageCount) || 0));
      const extra = Math.max(0, imgCount - freeCount);
      if (extra > 0 && perImage > 0) total += extra * perImage;
    }
    return Math.max(minCost, total);
  } else if (mode === "image_by_tier") {
    const tierGroups = Array.isArray(pricing.tierGroupIds)
      ? (pricing.tierGroupIds as string[])
      : ["quality", "resolution", "size"];
    let total = 0;
    for (const groupId of tierGroups) {
      const itemId = optionSnapshot[groupId];
      if (!itemId || options?.[groupId]?.[itemId] == null) continue;
      total += Math.max(Number(options[groupId][itemId]) || 0, 0);
    }
    unit = Math.max(minCost, total);
  } else if (mode === "image_matrix") {
    // 二维矩阵：按（画质 × 清晰度）取唯一价格，不累加
    const groupIds = Array.isArray(pricing.matrixGroupIds)
      ? (pricing.matrixGroupIds as string[])
      : ["quality", "resolution"];
    const [rowGroup, colGroup] = [
      String(groupIds[0] || "quality"),
      String(groupIds[1] || "resolution"),
    ];
    const matrix = pricing.matrix as Record<string, Record<string, number>> | undefined;
    const rowId = optionSnapshot[rowGroup];
    const colId = optionSnapshot[colGroup];
    let cost = 0;
    if (rowId && colId && matrix?.[rowId]?.[colId] != null) {
      cost = Math.max(Number(matrix[rowId][colId]) || 0, 0);
    }
    unit = Math.max(minCost, cost);
  } else {
    let optionTotal = 0;
    for (const [groupId, itemId] of Object.entries(optionSnapshot)) {
      if (groupId === "count" || groupId === "n") continue;
      const raw = options?.[groupId]?.[itemId];
      if (typeof raw === "number" && raw > 0) optionTotal += raw;
    }
    unit = Math.max(minCost, base + optionTotal);
  }

  // 图片一次多张：单价 × 张数（与后端 quote 对齐）
  const n = imageOutputCountFromSnapshot(optionSnapshot);
  const total = n > 1 ? unit * n : unit;
  return roundCreditAmount(total);
}

export function formatOptionCreditSuffix(
  pricing: Record<string, unknown> | undefined,
  groupId: string,
  cost: number
): string | null {
  if (cost <= 0) return null;
  const mode = String(pricing?.mode || "additive");
  const c = formatCreditAmount(cost);
  if (mode === "video_per_second") {
    const rateGroup = String(pricing?.rateGroupId || "resolution");
    if (groupId === rateGroup) return `${c}/秒`;
    return null;
  }
  if (mode === "image_by_tier") {
    if (["quality", "resolution", "size"].includes(groupId)) {
      return cost > 0 ? `+${c}` : null;
    }
    return null;
  }
  return `+${c}`;
}

export function getDurationCreditHint(
  pricing: Record<string, unknown> | undefined,
  durationId: string,
  optionSnapshot: Record<string, string> = {}
): string | null {
  if (!pricing || String(pricing.mode) !== "video_per_second") return null;
  const seconds = /^\d+$/.test(durationId) ? parseInt(durationId, 10) : 0;
  if (seconds <= 0) return null;
  const rateGroup = String(pricing.rateGroupId || "resolution");
  const options = pricing.options as Record<string, Record<string, number>> | undefined;
  const rateKey = optionSnapshot[rateGroup];
  const rate =
    rateKey && options?.[rateGroup]?.[rateKey] != null
      ? Math.max(Number(options[rateGroup][rateKey]) || 0, 0)
      : 0;
  if (rate <= 0) return null;
  const variable = seconds * rate;
  return variable > 0 ? `${variable}` : null;
}
