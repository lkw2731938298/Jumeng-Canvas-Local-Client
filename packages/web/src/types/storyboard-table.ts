/** 分镜表节点：固定列的可编辑表格行 */

export const STORYBOARD_TABLE_MODEL = "doubao_pro" as const;
export const STORYBOARD_TABLE_PROMPT_KIND = "storyboard_table" as const;
/** 分镜草图默认走火山方舟即梦图片（豆包系） */
export const STORYBOARD_SKETCH_MODEL = "doubao_image" as const;
export const STORYBOARD_SKETCH_PROMPT_TOOL = "storyboard_sketch" as const;
export const STORYBOARD_CAMERA_PROMPT_KIND = "storyboard_camera" as const;
export const STORYBOARD_VIDEO_PROMPT_KIND = "storyboard_video" as const;

export const STORYBOARD_SKETCH_COLUMN = {
  key: "sketch",
  label: "草图",
  width: 88,
} as const;

/**
 * @deprecated 成片已迁到独立节点 finished_clips_grid（仅爆款/出海批量成片创建），不再作为分镜表列。
 */
export const STORYBOARD_OUTPUT_VIDEO_COLUMN = {
  key: "outputVideo",
  label: "成片",
  width: 96,
} as const;

export const STORYBOARD_TABLE_COLUMNS = [
  { key: "shotNo", label: "镜头号", width: 52, readOnly: true },
  { key: "duration", label: "时长", width: 56 },
  { key: "description", label: "画面描述", width: 140 },
  { key: "shotSize", label: "景别", width: 64 },
  { key: "lighting", label: "光影氛围", width: 96 },
  { key: "dialogue", label: "对话", width: 100 },
  { key: "sfx", label: "音效", width: 72 },
  { key: "cameraPrompt", label: "运镜提示词", width: 100 },
  { key: "videoPrompt", label: "视频提示词", width: 120 },
  { key: "replaceCue", label: "替换指令", width: 140 },
] as const;

export type StoryboardTableColumnKey = (typeof STORYBOARD_TABLE_COLUMNS)[number]["key"];

export type StoryboardSketchStatus = "idle" | "pending" | "running" | "succeeded" | "failed";

export interface StoryboardTableRow {
  id: string;
  index: number;
  shotNo: string;
  duration: string;
  description: string;
  shotSize: string;
  lighting: string;
  dialogue: string;
  sfx: string;
  cameraPrompt: string;
  videoPrompt: string;
  /**
   * 出海位次替换语（如：将左边妇女换成 @Mia，中间女童换成 @Luna）。
   * 成片第②段优先使用；可空。
   */
  replaceCue?: string;
  /** 草图资产 ID（走项目 manifest 解析 URL） */
  sketchAssetId?: string;
  /** 调度故事板：绑定的导演台摄像机对象 id */
  directorCameraId?: string;
  /** 爆款复刻：本镜分段参考视频 assetId（≤12s，供 r2v） */
  clipAssetId?: string;
  /** 同款/出海成片视频 assetId（「成片」表预览） */
  outputVideoAssetId?: string;
  /** 成片生成状态（「成片」表） */
  videoStatus?: StoryboardSketchStatus;
  videoError?: string;
  /** LLM 或用户维护的草图专用提示词 */
  sketchPrompt?: string;
  sketchStatus?: StoryboardSketchStatus;
  sketchError?: string;
  /** 画面描述等内容 hash，用于判断重解析是否需重绘 */
  sketchSourceHash?: string;
  cameraPromptStatus?: StoryboardSketchStatus;
  cameraPromptError?: string;
  videoPromptStatus?: StoryboardSketchStatus;
  videoPromptError?: string;
}

const SKETCH_STYLE_ANCHOR =
  "黑白手绘电影分镜草图，铅笔线稿，交叉排线阴影，矩形分镜画框，无彩色，无写实照片，storyboard pencil sketch, black and white line art, cross-hatching";

export { SKETCH_STYLE_ANCHOR };

export function computeSketchSourceHash(
  row: Pick<StoryboardTableRow, "description" | "shotSize" | "lighting" | "dialogue">
): string {
  const payload = [row.description, row.shotSize, row.lighting, row.dialogue].join("|");
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

export function buildSketchPrompt(row: StoryboardTableRow, styleAnchor = SKETCH_STYLE_ANCHOR): string {
  const anchor = styleAnchor.trim() || SKETCH_STYLE_ANCHOR;
  if (row.sketchPrompt?.trim()) {
    return `${row.sketchPrompt.trim()}。${anchor}`;
  }
  const parts = [
    anchor,
    row.shotSize ? `景别：${row.shotSize}` : "",
    row.description ? `画面：${row.description}` : "",
    row.lighting ? `光影：${row.lighting}` : "",
    row.dialogue ? `对话情境：${row.dialogue}` : "",
  ].filter(Boolean);
  return parts.join("。");
}

export function needsSketchGeneration(row: StoryboardTableRow): boolean {
  if (!row.description.trim()) return false;
  if (row.sketchAssetId && row.sketchStatus === "succeeded") {
    const hash = computeSketchSourceHash(row);
    if (row.sketchSourceHash === hash) return false;
  }
  return true;
}

export function sketchNodeId(gridNodeId: string, rowId: string): string {
  return `${gridNodeId}::sketch::${rowId}`;
}

export function newTableRowId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `srow_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultDuration(): string {
  // 爆款/分镜成片最低 4s（对齐产品与模型常用档）
  return "4s";
}

export function enrichTableRow(
  partial: Partial<StoryboardTableRow> & { id: string; index: number }
): StoryboardTableRow {
  const index = partial.index;
  const shotNo = partial.shotNo?.trim() || String(index);
  const base = {
    id: partial.id,
    index,
    shotNo,
    duration: partial.duration?.trim() || defaultDuration(),
    description: partial.description ?? "",
    shotSize: partial.shotSize ?? "",
    lighting: partial.lighting ?? "",
    dialogue: partial.dialogue ?? "",
    sfx: partial.sfx ?? "",
    cameraPrompt: partial.cameraPrompt ?? "",
    videoPrompt: partial.videoPrompt ?? "",
    replaceCue: partial.replaceCue?.trim() || undefined,
    sketchPrompt: partial.sketchPrompt?.trim() || undefined,
    sketchAssetId: partial.sketchAssetId?.trim() || undefined,
    directorCameraId: partial.directorCameraId?.trim() || undefined,
    clipAssetId: partial.clipAssetId?.trim() || undefined,
    outputVideoAssetId: partial.outputVideoAssetId?.trim() || undefined,
    videoStatus: partial.videoStatus,
    videoError: partial.videoError?.trim() || undefined,
    sketchStatus: partial.sketchStatus,
    sketchError: partial.sketchError?.trim() || undefined,
    sketchSourceHash: partial.sketchSourceHash,
    cameraPromptStatus: partial.cameraPromptStatus,
    cameraPromptError: partial.cameraPromptError?.trim() || undefined,
    videoPromptStatus: partial.videoPromptStatus,
    videoPromptError: partial.videoPromptError?.trim() || undefined,
  };
  const hash = computeSketchSourceHash(base);
  return {
    ...base,
    sketchSourceHash: partial.sketchSourceHash ?? hash,
    sketchStatus:
      partial.sketchStatus ??
      (base.sketchAssetId ? "succeeded" : "idle"),
    cameraPromptStatus: partial.cameraPromptStatus ?? "idle",
    videoPromptStatus: partial.videoPromptStatus ?? "idle",
    videoStatus:
      partial.videoStatus ??
      (base.outputVideoAssetId ? "succeeded" : "idle"),
  };
}

export function createEmptyTableRow(index: number): StoryboardTableRow {
  return enrichTableRow({
    id: newTableRowId(),
    index,
    shotNo: String(index),
    duration: defaultDuration(),
    description: "",
    shotSize: "",
    lighting: "",
    dialogue: "",
    sfx: "",
    cameraPrompt: "",
    videoPrompt: "",
  });
}

function isLegacyShotRow(row: Record<string, unknown>): boolean {
  return (
    ("scriptText" in row || "title" in row || "imagePrompt" in row) &&
    !("description" in row)
  );
}

function migrateLegacyShotRow(row: Record<string, unknown>, index: number): StoryboardTableRow {
  const scriptText = String(row.scriptText ?? "").trim();
  const sceneScript = String(row.sceneScript ?? "").trim();
  const imagePrompt = String(row.imagePrompt ?? row.imagePromptGlobal ?? "").trim();
  const videoPrompt = String(row.videoPrompt ?? row.videoPromptGlobal ?? "").trim();
  const cameraNotes = String(row.cameraNotes ?? "").trim();
  const description =
    scriptText ||
    sceneScript ||
    String(row.summary ?? "").trim() ||
    String(row.title ?? "").trim();

  return enrichTableRow({
    id: String(row.id ?? newTableRowId()),
    index,
    shotNo: String(row.index ?? index),
    duration: String(row.duration ?? "").trim() || defaultDuration(),
    description,
    shotSize: "",
    lighting: imagePrompt,
    dialogue: "",
    sfx: "",
    cameraPrompt: cameraNotes,
    videoPrompt,
    sketchAssetId: String(row.assetId ?? row.sketchAssetId ?? "").trim() || undefined,
    sketchPrompt: imagePrompt || undefined,
  });
}

function normalizeTableRow(row: Record<string, unknown>, fallbackIndex: number): StoryboardTableRow {
  if (isLegacyShotRow(row)) {
    return migrateLegacyShotRow(row, fallbackIndex);
  }
  const index = Number(row.index) > 0 ? Number(row.index) : fallbackIndex;
  return enrichTableRow({
    id: String(row.id ?? newTableRowId()),
    index,
    shotNo: String(row.shotNo ?? index),
    duration: String(row.duration ?? ""),
    description: String(row.description ?? ""),
    shotSize: String(row.shotSize ?? ""),
    lighting: String(row.lighting ?? ""),
    dialogue: String(row.dialogue ?? ""),
    sfx: String(row.sfx ?? ""),
    cameraPrompt: String(row.cameraPrompt ?? ""),
    videoPrompt: String(row.videoPrompt ?? ""),
    replaceCue: String(row.replaceCue ?? "").trim() || undefined,
    sketchPrompt: String(row.sketchPrompt ?? ""),
    sketchAssetId: String(row.sketchAssetId ?? "").trim() || undefined,
    directorCameraId: String(row.directorCameraId ?? "").trim() || undefined,
    clipAssetId: String(row.clipAssetId ?? "").trim() || undefined,
    outputVideoAssetId: String(row.outputVideoAssetId ?? "").trim() || undefined,
    videoStatus: row.videoStatus as StoryboardSketchStatus | undefined,
    videoError: String(row.videoError ?? ""),
    sketchStatus: row.sketchStatus as StoryboardSketchStatus | undefined,
    sketchError: String(row.sketchError ?? ""),
    sketchSourceHash: String(row.sketchSourceHash ?? "").trim() || undefined,
    cameraPromptStatus: row.cameraPromptStatus as StoryboardSketchStatus | undefined,
    cameraPromptError: String(row.cameraPromptError ?? ""),
    videoPromptStatus: row.videoPromptStatus as StoryboardSketchStatus | undefined,
    videoPromptError: String(row.videoPromptError ?? ""),
  });
}

export function parseTableRowsParam(value: unknown): StoryboardTableRow[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      raw = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r, i) => normalizeTableRow(r as Record<string, unknown>, i + 1));
}

export function reindexTableRows(rows: StoryboardTableRow[]): StoryboardTableRow[] {
  return rows.map((row, i) => {
    const index = i + 1;
    const shotNo = row.shotNo?.trim() && row.shotNo === String(row.index) ? String(index) : row.shotNo || String(index);
    return { ...row, index, shotNo };
  });
}

export function rowToShotRowsJson(row: StoryboardTableRow): Record<string, string> {
  return {
    镜头号: row.shotNo || String(row.index),
    时长: row.duration,
    画面描述: row.description,
    景别: row.shotSize,
    光影氛围: row.lighting,
    对话: row.dialogue,
    音效: row.sfx,
    运镜提示词: row.cameraPrompt,
    视频提示词: row.videoPrompt,
    替换指令: row.replaceCue ?? "",
    草图提示词: row.sketchPrompt ?? "",
  };
}

export function resolveSelectedRowContent(
  rows: StoryboardTableRow[],
  selectedRowId: string
): string {
  const selected = rows.find((r) => r.id === selectedRowId);
  if (!selected) return "";
  if (selected.videoPrompt.trim()) return selected.videoPrompt.trim();
  if (selected.cameraPrompt.trim()) return selected.cameraPrompt.trim();
  if (selected.description.trim()) return selected.description.trim();
  return "";
}

/**
 * 单镜「时长」列文本解析为秒数（通用兜底，不限爆款 4~12s 上限）。
 * 用于整条时间线自动 reflow 的时长汇总，解析失败/空值兜底为默认时长。
 */
export function parseShotDurationSeconds(raw?: string | number | null): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(120, Math.max(0.5, raw));
  }
  const m = String(raw ?? "").trim().match(/^([\d.]+)\s*s?/i);
  if (!m) return 4;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 4;
  return Math.min(120, Math.max(0.5, n));
}

export interface ShotTimelineSegment {
  id: string;
  shotNo: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  ready: boolean;
}

export interface ShotTimelineSummary {
  totalSec: number;
  readyCount: number;
  totalCount: number;
  segments: ShotTimelineSegment[];
}

/**
 * 按当前表格顺序计算整条时间线（各镜起止时刻按顺序累加）。
 * 纯函数、无缓存：任意一镜的时长/顺序/生成状态变化后，重新调用即得到重排后的
 * 整条时间线——这就是「改单镜后 Editor 自动 reflow 整条时间线」的核心实现。
 */
export function computeShotsTimeline(rows: StoryboardTableRow[]): ShotTimelineSummary {
  let cursor = 0;
  let readyCount = 0;
  const segments: ShotTimelineSegment[] = rows.map((row) => {
    const durationSec = parseShotDurationSeconds(row.duration);
    const startSec = cursor;
    const endSec = cursor + durationSec;
    cursor = endSec;
    const ready = Boolean(row.outputVideoAssetId) || row.videoStatus === "succeeded";
    if (ready) readyCount += 1;
    return { id: row.id, shotNo: row.shotNo || String(row.index), startSec, endSec, durationSec, ready };
  });
  return { totalSec: cursor, readyCount, totalCount: rows.length, segments };
}

/** 时间线总时长展示：<60s 显示秒，否则显示「N分M秒」 */
export function formatTimelineDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return "0s";
  if (totalSec < 60) return `${Math.round(totalSec * 10) / 10}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec - m * 60);
  return `${m}分${s}秒`;
}

/** 时间码展示（mm:ss），用于成片表逐镜起止时刻标注 */
export function formatTimecodeShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
