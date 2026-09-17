/**
 * MiniMax Music 2.6 画布参数（对齐 ai_read/不参考/minmax模型）。
 * 主输入框 = 风格描述 prompt；歌曲模式另需歌词 lyrics。
 */

export const MINIMAX_MUSIC_MODEL = "";

/** 风格描述上限（配置：纯音乐必填时 [1, 2000]） */
export const MINIMAX_MUSIC_PROMPT_MAX = 2000;
/** 歌词上限 */
export const MINIMAX_MUSIC_LYRICS_MAX = 20000;

export function isMinimaxMusicModel(model: string | undefined | null): boolean {
  return (model || "").trim() === MINIMAX_MUSIC_MODEL;
}

/** generationOptions.instrumental === "instrumental" 表示纯音乐 */
export function isMinimaxInstrumental(generationOptions: Record<string, string> | undefined): boolean {
  return (generationOptions?.instrumental || "").trim() === "instrumental";
}

export function minimaxMusicStylePlaceholder(isInstrumental: boolean): string {
  return isInstrumental
    ? "描述音乐风格、情绪与场景（纯音乐必填，最多 2000 字）…"
    : "描述音乐风格、情绪与场景（可选，最多 2000 字）…";
}

export const MINIMAX_MUSIC_LYRICS_PLACEHOLDER =
  "输入歌曲歌词，换行分隔；可用结构标签 [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]…";
