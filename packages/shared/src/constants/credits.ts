export const CREDIT_TYPE_ACTIVITY = "activity" as const;
export const CREDIT_TYPE_MODEL_SPECIFIC = "model_specific" as const;
export const CREDIT_TYPE_SUBSCRIPTION = "subscription" as const;
export const CREDIT_TYPE_GENERAL = "general" as const;

export type CreditType =
  | typeof CREDIT_TYPE_ACTIVITY
  | typeof CREDIT_TYPE_MODEL_SPECIFIC
  | typeof CREDIT_TYPE_SUBSCRIPTION
  | typeof CREDIT_TYPE_GENERAL;

export const ALL_CREDIT_TYPES: readonly CreditType[] = [
  CREDIT_TYPE_MODEL_SPECIFIC,
  CREDIT_TYPE_ACTIVITY,
  CREDIT_TYPE_SUBSCRIPTION,
  CREDIT_TYPE_GENERAL,
] as const;

export const DEFAULT_CONSUME_PRIORITY: CreditType[] = [...ALL_CREDIT_TYPES];

export const CREDIT_TYPE_LABELS: Record<CreditType, string> = {
  [CREDIT_TYPE_ACTIVITY]: "活动算力",
  [CREDIT_TYPE_MODEL_SPECIFIC]: "模型专用算力",
  [CREDIT_TYPE_SUBSCRIPTION]: "会员订阅算力",
  [CREDIT_TYPE_GENERAL]: "通用算力",
};
