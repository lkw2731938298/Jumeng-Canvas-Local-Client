/**
 * 开源本地版：算力 API 全部本地桩（永不请求云端）。
 */

import { isLocalDesktop } from "@/lib/localDesktop";

export interface CreditBreakdownItem {
  groupId: string;
  itemId: string;
  label: string;
  cost: number;
}

export interface CreditQuote {
  model: string;
  total: number;
  base: number;
  breakdown: CreditBreakdownItem[];
  pricingVersion: number;
  optionSnapshot: Record<string, string>;
  creditsEnabled: boolean;
  quoteToken: string;
  expiresAt: string;
}

export interface CreditTypeBreakdown {
  activity: number;
  modelSpecific: number;
  subscription: number;
  general: number;
}

export interface ModelSpecificBalance {
  model: string;
  modelDisplayName?: string | null;
  balance: number;
  expiresAt?: string | null;
}

export interface ExpiringCredit {
  type: string;
  amount: number;
  expiresAt: string;
  model?: string | null;
  modelDisplayName?: string | null;
}

export interface CreditBalance {
  balance: number | null;
  availableForModel?: number | null;
  creditsEnabled: boolean;
  breakdown?: CreditTypeBreakdown | null;
  modelSpecific?: ModelSpecificBalance[];
  expiringSoon?: ExpiringCredit[];
  consumePriority?: string[];
}

export const CREDIT_TYPE_LABELS: Record<string, string> = {
  model_specific: "模型专用算力",
  activity: "活动算力",
  subscription: "会员订阅算力",
  general: "通用算力",
};

export const DEFAULT_CONSUME_PRIORITY = [
  "model_specific",
  "activity",
  "subscription",
  "general",
] as const;

function freeQuote(model: string, generationOptions?: Record<string, string>): CreditQuote {
  return {
    model,
    total: 0,
    base: 0,
    breakdown: [],
    pricingVersion: 1,
    optionSnapshot: generationOptions ?? {},
    creditsEnabled: false,
    quoteToken: "local-desktop",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

export function getCreditQuote(params: {
  model: string;
  category?: string;
  generationOptions?: Record<string, string>;
  canvasTool?: string;
}) {
  return Promise.resolve(freeQuote(params.model, params.generationOptions));
}

export interface CanvasToolPricingItem {
  toolId: string;
  label: string;
  group?: string;
  billingMode?: string;
  creditCost: number;
  creditsPerSecond?: number | null;
  priceSource?: string;
  primaryModel?: string | null;
  primaryModelDisplayName?: string | null;
}

export interface CanvasToolPricingResponse {
  version: number;
  items: CanvasToolPricingItem[];
  creditsEnabled: boolean;
}

export function getCanvasToolPricing() {
  return Promise.resolve({
    version: 1,
    items: [] as CanvasToolPricingItem[],
    creditsEnabled: false,
  } satisfies CanvasToolPricingResponse);
}

export function postCreditQuotesBatch(
  items: Array<{
    model: string;
    category?: string;
    generationOptions?: Record<string, string>;
  }>
) {
  return Promise.resolve({
    items: items.map((item) => freeQuote(item.model, item.generationOptions)),
  });
}

export function getCreditBalance(_model?: string) {
  return Promise.resolve({
    balance: null,
    availableForModel: null,
    creditsEnabled: false,
    breakdown: null,
    modelSpecific: [],
    expiringSoon: [],
    consumePriority: [...DEFAULT_CONSUME_PRIORITY],
  } satisfies CreditBalance);
}

export function getConsumePriority() {
  return Promise.resolve({
    priority: [...DEFAULT_CONSUME_PRIORITY],
    labels: { ...CREDIT_TYPE_LABELS },
  });
}

export function putConsumePriority(priority: string[]) {
  return Promise.resolve({
    priority,
    labels: { ...CREDIT_TYPE_LABELS },
  });
}

export interface CreditTransaction {
  id: string;
  delta: number;
  balanceAfter: number;
  source: string;
  sourceLabel?: string;
  creditType?: string;
  modelName?: string;
  modelDisplayName?: string;
  jobId?: string;
  reason?: string;
  createdAt: string;
  expiresAt?: string | null;
  expiresLabel?: string | null;
}

export interface CreditTransactionList {
  items: CreditTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

export function listCreditTransactions(page = 1, pageSize = 20, _source?: string) {
  return Promise.resolve({ items: [], total: 0, page, pageSize } satisfies CreditTransactionList);
}

export interface CreditActivity {
  id: string;
  title: string;
  description: string;
  coverUrl?: string;
  creditType: string;
  amount: number;
  modelName?: string | null;
  modelDisplayName?: string | null;
  validDays: number;
  startsAt?: string | null;
  endsAt?: string | null;
  perUserLimit: number;
  totalQuota?: number | null;
  claimedCount: number;
  status: string;
  userClaimCount: number;
}

export function listCreditActivities() {
  return Promise.resolve({ items: [] as CreditActivity[] });
}

export function claimCreditActivity(_activityId: string) {
  return Promise.reject(new Error("开源本地版不支持活动领取"));
}

export function resolveQuoteTotal(data: {
  total?: number;
  creditsEnabled?: boolean;
}): number {
  if (data.creditsEnabled === false) return 0;
  return Number(data.total) || 0;
}

export function roundCreditAmount(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

export function formatCreditAmount(cost: number): string {
  const n = roundCreditAmount(cost);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatCreditLabel(_cost: number, _creditsEnabled = true): string {
  // 本地版不展示算力
  if (isLocalDesktop) return "";
  return "";
}

export type AgentSkillPricing = {
  version: number;
  creditsEnabled: boolean;
  items: Array<{ skillSlug: string; creditCost: number; label?: string }>;
  quote?: { total?: number; creditsEnabled?: boolean };
};

export async function getAgentSkillPricing(_skillSlug?: string): Promise<AgentSkillPricing> {
  return {
    version: 1,
    creditsEnabled: false,
    items: [],
    quote: { total: 0, creditsEnabled: false },
  };
}

export function getOptionCreditCost(
  pricing: Record<string, unknown> | undefined,
  groupId: string,
  itemId: string,
  optionSnapshot?: Record<string, string>
): number {
  if (!pricing || typeof pricing !== "object") return 0;
  const refGid = String(pricing.refVideoGroupId || "refVideo");
  const useWithRef = optionSnapshot?.[refGid] === "with";
  const root =
    (useWithRef
      ? (pricing.optionsWithVideoReference as Record<string, Record<string, number>> | undefined)
      : undefined) ?? (pricing.options as Record<string, Record<string, number>> | undefined);
  const group = root?.[groupId];
  if (!group) return 0;
  const raw = group[itemId];
  return typeof raw === "number" && raw > 0 ? raw : 0;
}

export function formatCreditTypeLabel(type: string): string {
  return CREDIT_TYPE_LABELS[type] || type;
}
