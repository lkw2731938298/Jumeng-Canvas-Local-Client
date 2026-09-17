/**
 * Suno Custom v5.5 画布参数（对齐 ai_read/不参考/suno）。
 * 上游：title / prompt(歌词) / tags(风格) 均为必填。
 */

export const SUNO_CUSTOM_MODEL = "";

/** 歌曲标题上限 */
export const SUNO_TITLE_MAX = 80;
/** 完整歌词（上游 prompt）上限 */
export const SUNO_LYRICS_MAX = 5000;
/** 风格标签 tags 上限 */
export const SUNO_TAGS_MAX = 1000;

export function isSunoCustomModel(model: string | undefined | null): boolean {
  return (model || "").trim() === SUNO_CUSTOM_MODEL;
}

export const SUNO_TITLE_PLACEHOLDER = "歌曲标题（必填，最多 80 字）";
export const SUNO_TAGS_PLACEHOLDER =
  "风格标签，英文逗号分隔，如：流行,民谣,旋律,电影感,女声（必填）";
export const SUNO_LYRICS_PLACEHOLDER =
  "完整歌词（必填）；可用 [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]…";
