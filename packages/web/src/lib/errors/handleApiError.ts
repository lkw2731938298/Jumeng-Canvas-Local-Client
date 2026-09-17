"use client";

import { toast } from "sonner";
import { ApiError } from "@/lib/api/client";
import { getErrorMessageZh } from "@/lib/errors/errorCodes";

export interface HandleApiErrorOptions {
  toast?: boolean;
  onPricingChanged?: () => void;
  onInsufficientCredits?: () => void;
  onSmsCooldown?: (waitSeconds: number) => void;
  fallbackMessage?: string;
}

function contentRecord(err: ApiError): Record<string, unknown> | null {
  const raw = err.content ?? err.detail;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

export function handleApiError(err: unknown, options: HandleApiErrorOptions = {}): string {
  const {
    toast: showToast = true,
    onPricingChanged,
    onInsufficientCredits,
    onSmsCooldown,
    fallbackMessage = "操作失败，请稍后重试",
  } = options;

  if (!(err instanceof ApiError)) {
    const message = err instanceof Error ? err.message : fallbackMessage;
    if (showToast) toast.error(message);
    return message;
  }

  const code = err.code;
  const content = contentRecord(err);
  const message =
    err.message ||
    getErrorMessageZh(code ?? undefined, fallbackMessage) ||
    fallbackMessage;

  if (code === "PRICING_CHANGED") {
    if (showToast) toast.error(message);
    onPricingChanged?.();
    return message;
  }

  if (code === "INSUFFICIENT_CREDITS") {
    if (showToast) toast.error(message);
    onInsufficientCredits?.();
    return message;
  }

  if (code === "SMS_COOLDOWN" || code === "PHONE_LOCKED" || code === "SMS_LOCKED") {
    const waitRaw = content?.waitSeconds;
    const waitSeconds =
      typeof waitRaw === "number" ? waitRaw : Number(waitRaw) || 0;
    if (waitSeconds > 0) onSmsCooldown?.(waitSeconds);
    if (showToast) toast.error(message);
    return message;
  }

  if (code === "ACTIVITY_CLAIM_LIMIT" || code === "CLAIM_IN_PROGRESS" || code === "ACTIVITY_NOT_ELIGIBLE") {
    if (showToast) toast.error(message);
    return message;
  }

  if (code === "REVISION_CONFLICT") {
    if (showToast) toast.error(message);
    return message;
  }

  if (showToast) toast.error(message);
  return message;
}
