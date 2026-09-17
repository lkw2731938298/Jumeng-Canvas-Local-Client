export interface StoryboardSceneMeta {
  time?: string;
  place?: string;
  characters?: string[];
  goal?: string;
  mood?: string;
}

export interface StoryboardShot {
  id: string;
  index: number;
  /** 第几幕（如 "1" 或 "第一幕"） */
  act?: string;
  /** 场景（幕内细粒度，可选） */
  scene?: string;
  /** 标题 */
  title: string;
  /** 剧本（场景/集级） */
  sceneScript?: string;
  /** 镜头剧本 */
  scriptText: string;
  /** 图片提示词（行级通用） */
  imagePromptGlobal?: string;
  /** 镜头图片提示词 */
  imagePrompt: string;
  /** 视频提示词（行级通用） */
  videoPromptGlobal?: string;
  /** 镜头视频提示词 */
  videoPrompt: string;
  duration?: string;
  sceneMeta?: StoryboardSceneMeta;
  cameraNotes?: string;
  assetId?: string;
  summary: string;
  placeChip?: string;
  promptHint?: string;
}

export const STORYBOARD_GRID_COLUMNS = 3;

const CN_DIGIT_MAP: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100, 千: 1000,
  廿: 20, 卅: 30, 貮: 2,
};

/** 将「第一幕」「3」等规范为幕序号字符串 */
export function normalizeActNumber(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const digit = text.match(/^第?\s*(\d+)\s*幕?$/);
  if (digit) return digit[1];
  if (/^\d+$/.test(text)) return text;
  const cn = text.replace(/^第?\s*/, "").replace(/\s*幕$/, "");
  if (/^[零〇一二三四五六七八九十百千万两廿卅貮]+$/.test(cn)) {
    let total = 0;
    let current = 0;
    for (const ch of cn) {
      const n = CN_DIGIT_MAP[ch];
      if (n === undefined) return text;
      if (n === 10 || n === 100 || n === 1000) {
        current = current === 0 ? 1 : current;
        total += current * n;
        current = 0;
      } else {
        current = current * 10 + n;
      }
    }
    return String(total + current);
  }
  return text;
}

export function formatActLabel(act?: string): string {
  if (!act?.trim()) return "";
  const normalized = normalizeActNumber(act);
  if (/^\d+$/.test(normalized)) return `第 ${normalized} 幕`;
  if (act.includes("幕")) return act.trim();
  return `第 ${act.trim()} 幕`;
}

export function summarizeText(text: string, maxLen = 80): string {
  const one = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (one.length <= maxLen) return one;
  return `${one.slice(0, maxLen)}…`;
}

export function newShotId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `shot_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function enrichShot(
  partial: Omit<StoryboardShot, "summary" | "promptHint"> & {
    summary?: string;
    promptHint?: string;
  }
): StoryboardShot {
  const scriptText = partial.scriptText ?? "";
  const imagePrompt = partial.imagePrompt ?? "";
  const displayScript = [partial.sceneScript, scriptText].filter(Boolean).join("\n\n");
  const displayImage = imagePrompt || partial.imagePromptGlobal || "";
  const placeChip =
    partial.placeChip ||
    formatActLabel(partial.act) ||
    partial.scene ||
    [partial.sceneMeta?.time, partial.sceneMeta?.place].filter(Boolean).join("·") ||
    undefined;
  return {
    ...partial,
    scriptText,
    imagePrompt,
    videoPrompt: partial.videoPrompt ?? "",
    summary: partial.summary ?? summarizeText(displayScript || displayImage, 120),
    promptHint: partial.promptHint ?? summarizeText(displayImage, 60),
    placeChip,
  };
}

/** 下游生成优先使用镜头级提示词，其次行级通用提示词 */
export function resolveShotImagePrompt(shot: StoryboardShot): string {
  return (shot.imagePrompt || shot.imagePromptGlobal || "").trim();
}

export function resolveShotVideoPrompt(shot: StoryboardShot): string {
  return (shot.videoPrompt || shot.videoPromptGlobal || "").trim();
}

export function parseShotsParam(value: unknown): StoryboardShot[] {
  if (Array.isArray(value)) {
    return value.filter((s) => s && typeof s === "object") as StoryboardShot[];
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as StoryboardShot[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
