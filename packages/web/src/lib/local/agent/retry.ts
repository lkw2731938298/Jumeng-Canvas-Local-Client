/**
 * Agent LLM / 工具失败重试策略。
 */

import { isAgentTurnAbortedError } from "@/lib/canvas/agentCanvasBusy";

/** 网关瞬时错误：可对 localGenerateChat 重试（用户停止除外） */
export function isTransientLlmError(err: unknown): boolean {
  if (isAgentTurnAbortedError(err)) return false;
  if (err instanceof Error && err.name === "AbortError") return false;
  const msg = err instanceof Error ? err.message : String(err);
  if (/AGENT_TURN_ABORTED|已停止/.test(msg) && /abort/i.test(msg)) return false;
  return /超时|timeout|ECONNRESET|ETIMEDOUT|fetch failed|网络|429|502|503|504|rate.?limit|too many requests|temporarily/i.test(
    msg
  );
}

/** 工具结果可再试（不含业务硬失败如缺模型、参数错误） */
export function isRetryableToolFailure(message: string): boolean {
  const m = String(message || "");
  if (!m) return false;
  if (/缺少|未找到|未配置|无效|禁止|不支持|找不到节点|未知工具/i.test(m)) return false;
  return /超时|timeout|429|502|503|504|rate.?limit|繁忙|稍后|网络|连接失败|ECONNRESET|fetch failed/i.test(
    m
  );
}

export async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** 带退避的 LLM 调用重试（不含 tools 不支持这类应降级的错误） */
export async function withLlmRetries<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number; shouldRetry?: (err: unknown) => boolean }
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 800;
  const shouldRetry = opts?.shouldRetry ?? isTransientLlmError;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
      await sleepMs(baseDelayMs * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
