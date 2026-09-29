/**
 * 解析工具 arguments：失败时返回明确错误，禁止静默成 {} 导致空跑。
 */

export type ParsedToolArgs = {
  args: Record<string, unknown>;
  error?: string;
};

export function parseToolArgs(raw: string | undefined | null): ParsedToolArgs {
  const text = String(raw ?? "").trim();
  if (!text) return { args: {} };
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      return { args: {}, error: "工具参数必须是 JSON 对象" };
    }
    return { args: v as Record<string, unknown> };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { args: {}, error: `工具参数 JSON 无效：${msg}` };
  }
}
