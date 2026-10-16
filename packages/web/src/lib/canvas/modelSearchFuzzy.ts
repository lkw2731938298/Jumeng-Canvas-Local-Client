/**
 * 节点卡片模型下拉搜索：支持子串、多词、以及按序字符模糊（如 sd2 → seedance-2.0）。
 */

function normalizeHay(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s_\-/·]+/g, "");
}

/** 按序字符是否全部命中（允许中间夹其它字符） */
function subsequenceMatch(hay: string, needle: string): boolean {
  if (!needle) return true;
  let qi = 0;
  for (let i = 0; i < hay.length && qi < needle.length; i++) {
    if (hay[i] === needle[qi]) qi += 1;
  }
  return qi === needle.length;
}

/**
 * 单段 query 是否命中 haystack（已小写）。
 * 优先完整子串（含数字），再比去掉分隔符后的子串，最后按序模糊。
 */
function matchToken(hayRaw: string, hayCompact: string, token: string): boolean {
  const t = token.trim().toLowerCase();
  if (!t) return true;
  if (hayRaw.includes(t)) return true;
  const tCompact = normalizeHay(t);
  if (tCompact && hayCompact.includes(tCompact)) return true;
  if (subsequenceMatch(hayCompact || hayRaw, tCompact || t)) return true;
  return false;
}

/** 模型选项是否匹配搜索词（空 query 视为全部命中） */
export function modelOptionMatchesQuery(
  fields: { label: string; value: string; description?: string; series?: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hayRaw = `${fields.label} ${fields.value} ${fields.description ?? ""} ${fields.series ?? ""}`.toLowerCase();
  const hayCompact = normalizeHay(hayRaw);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((tok) => matchToken(hayRaw, hayCompact, tok));
}
