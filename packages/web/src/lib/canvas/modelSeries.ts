/**
 * 画布模型下拉「系列」分组：优先 parameters.uiSeries，否则按名称启发式推断。
 */

const SERIES_RULES: Array<{ series: string; pattern: RegExp }> = [
  { series: "Seedance", pattern: /seedance/i },
  { series: "HappyHorse", pattern: /happyhorse|happy[_-]?horse/i },
  { series: "PixVerse", pattern: /pixverse/i },
  { series: "可灵", pattern: /kling|可灵/i },
  { series: "万相", pattern: /wan2|wan3|wanxiang|万相|wanx/i },
  { series: "千问", pattern: /qwen.?image|千问/i },
  { series: "Vidu", pattern: /\bvidu\b/i },
  { series: "即梦", pattern: /jimeng|即梦|doubao.?image|seedream/i },
  { series: "豆包", pattern: /doubao|豆包/i },
  { series: "DeepSeek", pattern: /deepseek/i },
  { series: "Runway", pattern: /runway/i },
  { series: "Luma", pattern: /\bluma\b|dream.?machine/i },
  { series: "Sora", pattern: /\bsora\b/i },
  { series: "海螺", pattern: /hailuo|minimax|海螺/i },
];

/** 读取运营配置的系列名 */
export function readUiSeriesFromParams(
  parameters: Record<string, unknown> | undefined
): string | undefined {
  if (!parameters) return undefined;
  const raw = parameters.uiSeries ?? parameters.ui_series;
  const label = String(raw || "").trim();
  return label || undefined;
}

/**
 * 推断模型所属系列（用于下拉左栏）。
 * 优先后台 uiSeries；否则匹配名称/展示名；再否则用 providerGroup 短名或「其他」。
 */
export function resolveModelSeries(input: {
  name: string;
  displayName?: string;
  providerGroup?: string;
  parameters?: Record<string, unknown>;
}): string {
  const configured = readUiSeriesFromParams(input.parameters);
  if (configured) return configured;

  const haystack = `${input.displayName || ""} ${input.name || ""}`;
  for (const rule of SERIES_RULES) {
    if (rule.pattern.test(haystack)) return rule.series;
  }

  const group = String(input.providerGroup || "").trim();
  if (group) {
    // 「火山方舟 · 即梦」→ 取末段
    const parts = group.split(/[·•]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
    return group;
  }

  return "其他";
}

/**
 * 系列左栏排序：配置项按 sortOrder；未配置按拼音；「其他」始终最后。
 * orderByLabel 的 value 为越小越靠前的排序权重。
 */
export function compareSeriesLabels(
  a: string,
  b: string,
  orderByLabel?: Map<string, number> | null
): number {
  if (a === "其他") return 1;
  if (b === "其他") return -1;
  const oa = orderByLabel?.get(a);
  const ob = orderByLabel?.get(b);
  const hasA = oa !== undefined;
  const hasB = ob !== undefined;
  if (hasA && hasB) {
    const diff = (oa as number) - (ob as number);
    if (diff !== 0) return diff;
    return a.localeCompare(b, "zh");
  }
  if (hasA) return -1;
  if (hasB) return 1;
  return a.localeCompare(b, "zh");
}
