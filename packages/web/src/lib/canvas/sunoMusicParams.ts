/**
 * Suno 画布参数。
 * - single：顶层 prompt + metadata.description / make_instrumental（suno-single-v5.5）
 * - custom：metadata.title/tags/prompt 歌词（suno-custom-v5.5）
 */

/** 歌曲标题上限 */
export const SUNO_TITLE_MAX = 80;
/** 完整歌词（custom 上游 prompt）上限 */
export const SUNO_LYRICS_MAX = 5000;
/** 风格标签 tags 上限 */
export const SUNO_TAGS_MAX = 1000;
/** single 模式描述上限（上游 RunningHub description 1–400） */
export const SUNO_SINGLE_DESC_MAX = 400;

function normModel(model: string | undefined | null): string {
  return (model || "").trim().toLowerCase();
}

/** Custom 模式：须 title / 歌词 / tags */
export function isSunoCustomModel(model: string | undefined | null): boolean {
  const m = normModel(model);
  if (!m.includes("suno")) return false;
  return (
    m.includes("custom") ||
    m === "suno_custom_v55" ||
    m.includes("suno-v5.5/custom") ||
    m.includes("suno_v55_custom")
  );
}

/** 灵感/单句模式：suno-single-v5.5 及非 custom 的 suno */
export function isSunoSingleModel(model: string | undefined | null): boolean {
  const m = normModel(model);
  if (!m.includes("suno")) return false;
  return !isSunoCustomModel(m);
}

/** 任意 Suno 音乐模型 */
export function isSunoMusicModel(model: string | undefined | null): boolean {
  return normModel(model).includes("suno");
}

/** 聚梦 / 目录常用 custom 模型 id */
export const SUNO_CUSTOM_MODEL = "suno-custom-v5.5";

export const SUNO_TITLE_PLACEHOLDER = "歌曲标题（必填，最多 80 字）";
export const SUNO_TAGS_PLACEHOLDER =
  "风格标签，英文逗号分隔，如：流行,民谣,旋律,电影感,女声（必填）";
export const SUNO_LYRICS_PLACEHOLDER =
  "完整歌词（必填）；可用 [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]…";
export const SUNO_SINGLE_PLACEHOLDER =
  "用一句话描述歌曲主题、情绪或风格（必填，最多 400 字）…";
