/** Format API timestamps (东八区 ISO 或 naive 墙钟) for admin UI. */
export function formatDateTimeCN(value?: string | null): string {
  if (!value) return "—";
  const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}+08:00`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}

const TRACE_TIME_KEYS = new Set([
  "createdAt",
  "completedAt",
  "detectedAt",
  "at",
  "capturedAt",
  "updatedAt",
]);

/** 递归格式化 trace JSON 中的时间字段为北京时间展示。 */
export function formatTraceJsonForDisplay(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatTraceJsonForDisplay);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (TRACE_TIME_KEYS.has(key) && typeof child === "string") {
        out[key] = formatDateTimeCN(child);
      } else {
        out[key] = formatTraceJsonForDisplay(child);
      }
    }
    return out;
  }
  return value;
}
