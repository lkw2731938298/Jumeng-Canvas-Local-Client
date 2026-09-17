/** 用户侧模型展示名：仅当目录 displayName 与内部 name 不同时返回。 */

export function userFacingModelLabel(opts: {
  modelDisplayName?: string | null;
  modelName?: string | null;
  model?: string | null;
}): string | null {
  const display = (opts.modelDisplayName || "").trim();
  const internal = (opts.modelName || opts.model || "").trim();
  if (!display) return null;
  if (internal && display === internal) return null;
  return display;
}

/** 拼接可选模型后缀，如「 · 万相 3.0」；无展示名则返回空串。 */
export function userFacingModelSuffix(opts: {
  modelDisplayName?: string | null;
  modelName?: string | null;
  model?: string | null;
  prefix?: string;
}): string {
  const label = userFacingModelLabel(opts);
  if (!label) return "";
  const prefix = opts.prefix ?? " · ";
  return `${prefix}${label}`;
}
