import {
  computeSketchSourceHash,
  createEmptyTableRow,
  defaultDuration,
  enrichTableRow,
  newTableRowId,
  type StoryboardTableRow,
} from "@/types/storyboard-table";

export type { StoryboardTableRow };

export interface ParseStoryboardTableResult {
  rows: StoryboardTableRow[];
  warnings: string[];
}

type ParsedRowFieldKey =
  | "shotNo"
  | "duration"
  | "description"
  | "shotSize"
  | "lighting"
  | "dialogue"
  | "sfx";

const ROW_JSON_KEYS: Record<ParsedRowFieldKey, string[]> = {
  shotNo: ["镜头号", "shotNo", "num"],
  duration: ["时长", "duration", "dur"],
  description: ["画面描述", "分镜描述", "description", "desc", "镜头剧本", "剧本"],
  shotSize: ["景别", "shotSize", "jingbie"],
  lighting: ["光影氛围", "光影", "lighting", "light"],
  dialogue: ["对话", "对白", "dialogue", "dialog"],
  sfx: ["音效", "sfx"],
};

function stripMarkdownFence(text: string): string {
  let trimmed = text.trim().replace(/^\uFEFF/, "");
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  // 模型常在围栏外加说明文字：尽量取出 ```json ... ``` 中间段
  const inner = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (inner?.[1]) return inner[1].trim();
  return trimmed;
}

/** 从杂文中按括号深度截取首个 JSON 对象/数组 */
function extractBalancedJson(text: string): string | null {
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  let open = "";
  let close = "";
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj;
    open = "{";
    close = "}";
  } else if (startArr >= 0) {
    start = startArr;
    open = "[";
    close = "]";
  } else {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function softenJson(raw: string): string {
  // 常见模型瑕疵：尾逗号
  return raw.replace(/,\s*([}\]])/g, "$1");
}

function tryParseJsonValue(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const balanced = extractBalancedJson(trimmed);
  if (balanced) candidates.push(balanced);
  for (const candidate of candidates) {
    for (const variant of [candidate, softenJson(candidate)]) {
      try {
        return JSON.parse(variant);
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

function tryParseJson(content: string): unknown | null {
  const candidates = new Set<string>();
  const raw = content.trim().replace(/^\uFEFF/, "");
  if (raw) candidates.add(raw);
  const unfenced = stripMarkdownFence(raw);
  if (unfenced) candidates.add(unfenced);

  for (const candidate of candidates) {
    const parsed = tryParseJsonValue(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function pickField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return "";
}

function mapShotRow(row: Record<string, unknown>, index: number): StoryboardTableRow {
  const shotNo = pickField(row, ROW_JSON_KEYS.shotNo) || String(index);
  const duration = pickField(row, ROW_JSON_KEYS.duration) || defaultDuration();
  // 爆款拉片等工具可能直接返回运镜/视频词，一并写入行
  const cameraPrompt = pickField(row, ["运镜提示词", "cameraPrompt", "camera"]);
  const videoPrompt = pickField(row, ["视频提示词", "videoPrompt", "video"]);
  // 出海位次替换：左边妇女换成 @Mia …；爆款可空
  const replaceCue = pickField(row, ["替换指令", "replaceCue", "位次替换", "替换说明"]);
  return enrichTableRow({
    id: newTableRowId(),
    index,
    shotNo,
    duration,
    description: pickField(row, ROW_JSON_KEYS.description),
    shotSize: pickField(row, ROW_JSON_KEYS.shotSize),
    lighting: pickField(row, ROW_JSON_KEYS.lighting),
    dialogue: pickField(row, ROW_JSON_KEYS.dialogue),
    sfx: pickField(row, ROW_JSON_KEYS.sfx),
    cameraPrompt,
    videoPrompt,
    replaceCue: replaceCue || undefined,
    cameraPromptStatus: cameraPrompt ? "succeeded" : "idle",
    videoPromptStatus: videoPrompt ? "succeeded" : "idle",
  });
}

function parseShotRowsJson(data: unknown): StoryboardTableRow[] {
  if (Array.isArray(data)) {
    return data
      .filter((r) => r && typeof r === "object")
      .map((r, i) => mapShotRow(r as Record<string, unknown>, i + 1));
  }
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const rows =
    obj.shotRows ??
    obj.shots ??
    obj.rows ??
    obj["镜头列表"] ??
    obj["分镜表"] ??
    obj["分镜列表"];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === "object")
    .map((r, i) => mapShotRow(r as Record<string, unknown>, i + 1));
}

export function mergeTableRowsPreservingIds(
  prev: StoryboardTableRow[],
  next: StoryboardTableRow[]
): StoryboardTableRow[] {
  const byIndex = new Map(prev.map((r) => [r.index, r]));
  return next.map((row) => {
    const old = byIndex.get(row.index);
    if (!old) return row;

    const newHash = computeSketchSourceHash(row);
    const oldHash = computeSketchSourceHash(old);
    const contentChanged = newHash !== oldHash;

    return {
      ...row,
      id: old.id,
      sketchPrompt: row.sketchPrompt || old.sketchPrompt,
      sketchSourceHash: newHash,
      sketchAssetId: contentChanged ? undefined : old.sketchAssetId,
      sketchStatus: contentChanged
        ? "idle"
        : old.sketchStatus ?? (old.sketchAssetId ? "succeeded" : "idle"),
      sketchError: contentChanged ? undefined : old.sketchError,
      cameraPrompt: contentChanged ? "" : old.cameraPrompt,
      videoPrompt: contentChanged ? "" : old.videoPrompt,
      cameraPromptStatus: contentChanged ? "idle" : old.cameraPromptStatus,
      cameraPromptError: contentChanged ? undefined : old.cameraPromptError,
      videoPromptStatus: contentChanged ? "idle" : old.videoPromptStatus,
      videoPromptError: contentChanged ? undefined : old.videoPromptError,
    };
  });
}

export function parseStoryboardTableContent(content: string): ParseStoryboardTableResult {
  const warnings: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) {
    return { rows: [], warnings: ["AI 返回内容为空"] };
  }

  const json = tryParseJson(trimmed);
  if (!json) {
    return { rows: [], warnings: ["未识别到合法 JSON，请确认文本模型可用且返回了 shotRows"] };
  }

  const rows = parseShotRowsJson(json);
  if (rows.length === 0) {
    return { rows: [], warnings: ["JSON 中未找到 shotRows 数组"] };
  }

  return { rows, warnings };
}

export { createEmptyTableRow };
