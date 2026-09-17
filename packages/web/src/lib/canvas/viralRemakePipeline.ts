/**
 * 爆款复刻完整流水线：异步切镜 → 多模态拉片 → 写入分镜表 → 批量 deferPoll 生视频。
 */

import { toast } from "sonner";
import { extractViralRemakeShots, type ViralRemakeShotFrame } from "@/lib/api/viralRemake";
import { resolveCanvasToolPrimaryModel } from "@/lib/api/canvasTools";
import { getCreditQuote } from "@/lib/api/credits";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { fetchAssetsBatch, notifyAssetsUpdated } from "@/lib/api/assets";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";
import {
  alignRowsWithKeyframes,
  parseViralRemakeContent,
} from "@/lib/canvas/parseViralRemake";
import { bootstrapViralRemakeCanvas } from "@/lib/canvas/viralRemakeBootstrap";
import type { ViralRemakeSession } from "@/lib/canvas/viralRemakeSession";
import {
  markViralRemakeSessionStarted,
  patchViralRemakeProgress,
} from "@/lib/canvas/viralRemakeSession";
import { useCanvasStore } from "@/stores/canvasStore";
import { reindexTableRows } from "@/types/storyboard-table";
import {
  STORYBOARD_SUBJECT_IMAGE_MODEL,
  computeSubjectImageSourceHash,
  parseSubjectsParam,
  subjectKindToKey,
  type StoryboardSubjectItem,
  type StoryboardSubjectsBundle,
} from "@/types/storyboard-subjects";
import type { WorkflowNodeData } from "@/types/workflow";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import {
  completePendingGeneratableNode,
  runOneGeneratableNode,
} from "@/lib/canvas/runOneGeneratableNode";
import { runStoryboardOneClickGeneration } from "@/lib/canvas/storyboardGridActions";
import { toastCreditCharged } from "@/lib/canvas/generationCreditHelpers";
import {
  buildViralRemakeGenerationOptions,
  estimateViralRemakeVideoCredit,
  floorViralGenerationDurationSec,
  parseViralShotDurationSec,
  withViralRemakeDuration,
} from "@/lib/canvas/viralRemakeOptions";
import type { GenerationOptions } from "@/types/generationPresets";
import {
  collectSubjectImageTargets,
  runStoryboardSubjectImageBatch,
} from "@/lib/canvas/storyboardSubjectImageBatch";
import {
  MAX_BODY_HEIGHT,
  NODE_TITLE_HEIGHT,
  defaultNodeSize,
} from "@/lib/canvas/nodeSizing";
import { getOverseasMarket } from "@/lib/canvas/overseasMarkets";

export const STORYBOARD_FROM_VIDEO_TOOL = "storyboard_from_video" as const;
export const STORYBOARD_FROM_VIDEO_KIND = "storyboard_from_video" as const;
export const STORYBOARD_FROM_VIDEO_MODEL = "" as const;

/** 主体图横向；成片/参考片段纵向列表（对齐 oiioii 式镜头列表） */
const VIRAL_SUBJECT_COLS = 4;
const VIRAL_OUTPUT_COLS = 1;
const VIRAL_GAP_X = 48;
const VIRAL_GAP_Y = 48;
const VIRAL_BAND_GAP = 80;
const VIRAL_VIDEO_CELL_W = 280;

type ViralLayoutPoint = { x: number; y: number };
type ViralLayoutCell = { width: number; height: number };

/** 按目标画幅计算视频节点格子（含标题栏） */
function viralVideoCellSize(aspect: ViralRemakeSession["aspectRatio"]): ViralLayoutCell {
  const width = VIRAL_VIDEO_CELL_W;
  const ratio = aspect === "9:16" ? 16 / 9 : aspect === "1:1" ? 1 : 9 / 16;
  const body = Math.min(MAX_BODY_HEIGHT, Math.max(120, Math.round(width * ratio)));
  return { width, height: NODE_TITLE_HEIGHT + body };
}

/** 主体/替换图：与 addNodeFromAsset 默认尺寸一致，避免重叠 */
function viralImageCellSize(): ViralLayoutCell {
  return defaultNodeSize();
}

function viralGridPos(
  index: number,
  origin: ViralLayoutPoint,
  cell: ViralLayoutCell,
  cols: number
): ViralLayoutPoint {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: origin.x + col * (cell.width + VIRAL_GAP_X),
    y: origin.y + row * (cell.height + VIRAL_GAP_Y),
  };
}

function viralBandHeight(count: number, cell: ViralLayoutCell, cols: number): number {
  if (count <= 0) return 0;
  const rows = Math.ceil(count / cols);
  return rows * cell.height + Math.max(0, rows - 1) * VIRAL_GAP_Y;
}

/** 移动节点到目标坐标（复用节点也强制整齐重排） */
function moveNodeTo(id: string, position: ViralLayoutPoint) {
  const { nodes, setNodes } = useCanvasStore.getState();
  const cur = nodes.find((n) => n.id === id);
  if (!cur) return;
  if (cur.position?.x === position.x && cur.position?.y === position.y) return;
  setNodes(nodes.map((n) => (n.id === id ? { ...n, position: { ...position } } : n)));
}

/** 分镜表底边起算各带原点：主体 → 分段参考 → 同款成片 */
function resolveViralLayoutOrigins(opts: {
  gridNodeId: string;
  subjectCount: number;
  shotCount: number;
  hasClipBand: boolean;
  aspectRatio: ViralRemakeSession["aspectRatio"];
}): {
  originX: number;
  subjectOrigin: ViralLayoutPoint;
  clipOrigin: ViralLayoutPoint;
  outputOrigin: ViralLayoutPoint;
  imageCell: ViralLayoutCell;
  videoCell: ViralLayoutCell;
} {
  const grid = useCanvasStore.getState().nodes.find((n) => n.id === opts.gridNodeId);
  const originX = grid?.position?.x ?? 80;
  const gridBottom =
    (grid?.position?.y ?? 80) + (grid?.height && grid.height > 0 ? grid.height : 420);
  const imageCell = viralImageCellSize();
  const videoCell = viralVideoCellSize(opts.aspectRatio);

  let y = gridBottom + VIRAL_BAND_GAP;
  const subjectOrigin = { x: originX, y };
  y += viralBandHeight(opts.subjectCount, imageCell, VIRAL_SUBJECT_COLS);
  if (opts.subjectCount > 0) y += VIRAL_BAND_GAP;

  const clipOrigin = { x: originX, y };
  if (opts.hasClipBand) {
    y += viralBandHeight(opts.shotCount, videoCell, VIRAL_OUTPUT_COLS) + VIRAL_BAND_GAP;
  }

  const outputOrigin = { x: originX, y };
  return { originX, subjectOrigin, clipOrigin, outputOrigin, imageCell, videoCell };
}

/** 节点标签清洗为可 @ 引用的短名 */
function mentionSafeLabel(raw: string, fallback: string): string {
  const cleaned = String(raw || "")
    .replace(new RegExp("[@#]", "g"), " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return cleaned || fallback;
}

/**
 * 写成片 @ 引用：标签后强制空格，避免 `@Mia蹲着` 无法匹配上游节点。
 * 例：`@Mia `、`@镜头3运镜参考 `
 */
function atMention(label: string): string {
  const name = String(label || "").trim();
  if (!name) return "";
  return `@${name} `;
}

/** 批量 @，项间再保留分隔（已含尾随空格，分隔符两侧不再叠空格） */
function joinAtMentions(labels: string[], sep = "、"): string {
  return labels
    .map((l) => atMention(l).trimEnd())
    .filter(Boolean)
    .map((t) => `${t} `)
    .join(sep)
    .replace(/\s+$/, " ");
}

/** 粗判中文主导文案（出海时丢弃被中文工具污染的视频词） */
function looksMostlyChinese(text: string): boolean {
  const s = String(text || "").trim();
  if (!s) return false;
  const cn = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  return cn >= 6 && cn / s.length > 0.25;
}

/** 去掉括号备注与空白，便于「女主角小美」↔「小美」互认 */
function normalizeSubjectToken(label: string): string {
  return String(label || "")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s_\-·.]+/g, "")
    .trim();
}

/** 从文案提取 @标签（替换指令 / 对白说话人） */
function extractAtTokens(text: string): string[] {
  const out: string[] = [];
  const re = /@([\w\u4e00-\u9fff][\w\u4e00-\u9fff\-（）()]{0,31})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    const tok = (m[1] || "").trim();
    if (tok) out.push(tok);
  }
  return out;
}

/** 将文案中的 @token / 短名对齐到已有主体标签 */
function matchLabelToAll(token: string, allLabels: string[]): string | null {
  const t = String(token || "").trim();
  if (!t) return null;
  const tl = t.toLowerCase();
  const tn = normalizeSubjectToken(t);
  const exact = allLabels.find((l) => l.toLowerCase() === tl);
  if (exact) return exact;
  const scored = allLabels
    .map((l) => {
      const ll = l.toLowerCase();
      const ln = normalizeSubjectToken(l);
      let score = 0;
      if (ll === tl || (ln && tn && ln === tn)) score = 100;
      else if (ll.includes(tl) || tl.includes(ll)) score = 80 - Math.abs(ll.length - tl.length);
      else if (ln && tn && (ln.includes(tn) || tn.includes(ln))) score = 60;
      return { l, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.l ?? null;
}

function labelMatchesHay(label: string, hay: string): boolean {
  const raw = label.toLowerCase().trim();
  if (raw.length >= 2 && hay.includes(raw)) return true;
  const norm = normalizeSubjectToken(label);
  const hayNorm = hay.replace(/[\s_\-·.]+/g, "");
  if (norm.length >= 2 && hayNorm.includes(norm)) return true;
  // 「女主角小美」→ 取「小美」；「Mia-主」→「Mia」
  const base = raw.split(/[（(·\-_/]/)[0]?.trim() || "";
  if (base.length >= 2 && hay.includes(base)) return true;
  // 名称末段（常为真名）：女主角小美 → 小美
  if (raw.length >= 4) {
    const tail = raw.slice(-2);
    if (/[\u4e00-\u9fff]{2}/.test(tail) && hay.includes(tail)) return true;
  }
  return false;
}

/**
 * 本镜应 @ 的主体：以提示词/替换指令/对白里已写的 @ 为准（拉片阶段就要写准）。
 * 无 @ 时再按画面文案命中名称；禁止因「多人」把未出场角色一并挂上。
 */
function pickRelevantMentionLabels(
  row: {
    description?: string;
    videoPrompt?: string;
    dialogue?: string;
    replaceCue?: string;
    cameraPrompt?: string;
  },
  allLabels: string[],
  _opts?: { roleLabels?: string[] }
): string[] {
  if (allLabels.length <= 1) return allLabels;
  // 权威来源：生成阶段写入的 @（替换指令 / 视频词 / 对白）
  const atTexts = [row.replaceCue, row.videoPrompt, row.dialogue].map((s) => String(s || ""));
  const fromAt: string[] = [];
  const seen = new Set<string>();
  for (const text of atTexts) {
    for (const tok of extractAtTokens(text)) {
      const matched = matchLabelToAll(tok, allLabels);
      if (matched && !seen.has(matched)) {
        seen.add(matched);
        fromAt.push(matched);
      }
    }
  }
  if (fromAt.length > 0) return fromAt;

  // 无 @ 时：仅用画面描述等字面命中，不强行扩成全体角色
  const hay = [row.description, row.cameraPrompt, row.videoPrompt, row.replaceCue, row.dialogue]
    .map((s) => String(s || ""))
    .join(" ")
    .toLowerCase();
  const fromName = allLabels.filter((label) => labelMatchesHay(label, hay));
  if (fromName.length > 0) return fromName;

  // 完全无法判断时再回退全部，避免成片零参考
  return allLabels;
}

/** 把文中 @别名 改写为准备资产正式名，保证提交时可匹配节点标签 */
function rewriteAtTokensToCanonicalLabels(text: string, allLabels: string[]): string {
  let out = String(text || "");
  if (!out || allLabels.length === 0) return out;
  const tokens = extractAtTokens(out);
  // 长名优先，避免短名先替换破坏长标签
  const unique = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  for (const tok of unique) {
    const canonical = matchLabelToAll(tok, allLabels);
    if (!canonical || canonical === tok) continue;
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${esc}(?![\\w\\u4e00-\\u9fff])`, "g"), `@${canonical}`);
  }
  return out;
}

/** 拉片结果落表前：规范 @ 正式名；无替换指令时仅在能明确命中本镜主体时补全 */
function normalizeViralShotSubjectMentions<T extends {
  description?: string;
  videoPrompt?: string;
  dialogue?: string;
  replaceCue?: string;
  cameraPrompt?: string;
}>(rows: T[], subjects: StoryboardSubjectsBundle): T[] {
  const rawNames = [...subjects.roles, ...subjects.scenes, ...subjects.props]
    .map((s) => mentionSafeLabel(s.name || "", ""))
    .filter(Boolean);
  if (rawNames.length === 0) return rows;

  return rows.map((row) => {
    const videoPrompt = rewriteAtTokensToCanonicalLabels(
      String(row.videoPrompt ?? ""),
      rawNames
    );
    const dialogue = rewriteAtTokensToCanonicalLabels(String(row.dialogue ?? ""), rawNames);
    let replaceCue = rewriteAtTokensToCanonicalLabels(
      String(row.replaceCue ?? ""),
      rawNames
    ).trim();

    if (!replaceCue) {
      const hay = `${row.description || ""} ${videoPrompt} ${dialogue}`.toLowerCase();
      const named = rawNames.filter((l) => labelMatchesHay(l, hay));
      const fromAt = [
        ...extractAtTokens(videoPrompt),
        ...extractAtTokens(dialogue),
      ]
        .map((t) => matchLabelToAll(t, rawNames))
        .filter((x): x is string => Boolean(x));
      const accurate = [...new Set([...fromAt, ...named])];
      if (accurate.length > 0) {
        replaceCue = buildPositionalReplaceCue(accurate);
      }
    }

    return {
      ...row,
      videoPrompt,
      dialogue,
      ...(replaceCue ? { replaceCue } : {}),
    };
  });
}

/** 左/中/右位次词，用于无 LLM 替换指令时的兜底 */
function positionalSlotLabel(index: number, total: number): string {
  if (total === 1) return "画面中人物";
  if (total === 2) return index === 0 ? "左侧人物" : "右侧人物";
  if (total === 3) {
    if (index === 0) return "左边人物";
    if (index === 1) return "中间人物";
    return "右侧人物";
  }
  return `从左到右第${index + 1}个人物`;
}

/** 无拉片「替换指令」时：按主体顺序生成左→右位次替换句 */
function buildPositionalReplaceCue(subjectLabels: string[]): string {
  const labels = subjectLabels.filter(Boolean);
  if (labels.length === 0) return "";
  return labels
    .map((name, i) => `将${positionalSlotLabel(i, labels.length)}换成 ${atMention(name).trimEnd()}`)
    .join("，");
}

/**
 * 出海对白：确保标明说话主体；已有 @Name: 则保留，单人无标注则补上。
 * 多人无标注时仍原样输出，并在成片固定要求里强调勿串角。
 */
function formatOverseasSpokenDialogue(
  dialogue: string,
  spokenLanguage: string,
  subjectLabels: string[]
): string {
  const text = String(dialogue || "").trim();
  if (!text) return "";
  const hasSpeakerTag = /@[\w\u4e00-\u9fff][\w\u4e00-\u9fff\-]*\s*:/.test(text);
  let body = text;
  if (!hasSpeakerTag && subjectLabels.length === 1) {
    body = `${atMention(subjectLabels[0]).trimEnd()}: "${text.replace(/^["“]|["”]$/g, "")}"`;
  } else {
    // 给已有 @Name: / @Name紧贴中文 补空格，保证可解析为素材槽
    body = ensureAtMentionTrailingSpace(body, subjectLabels);
  }
  return (
    `Spoken dialogue in ${spokenLanguage} only (speaker tags required, do not swap speakers): ${body}`
  );
}

/** 在已知主体/片段标签的 @ 后补空格（不破坏 @Name: 对白格式） */
function ensureAtMentionTrailingSpace(text: string, labels: string[]): string {
  let out = String(text || "");
  const sorted = [...labels].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const label of sorted) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // @Label 后若不是空白/:/"，则插入空格
    out = out.replace(
      new RegExp(`@${esc}(?![\\s:："'])`, "g"),
      `@${label} `
    );
  }
  return out;
}

/**
 * 组装成片提示词。
 * 出海固定三段：①分镜表视频提示词 ②替换风格+精确 @ 主体 ③固定要求；
 * 爆款仍为文首 @ + 正文。
 */
function buildBatchVideoPrompt(opts: {
  row: {
    index: number;
    videoPrompt?: string;
    cameraPrompt?: string;
    description?: string;
    dialogue?: string;
    /** 拉片产出的位次替换语 */
    replaceCue?: string;
  };
  /** 爆款：全部 @ 标签；出海可空（改用 subjectLabels/clipLabel） */
  mentionLabels: string[];
  /** 出海：本地化主体/替换图标签（不含运镜片段） */
  subjectLabels?: string[];
  /** 出海：本镜运镜参考片段标签 */
  clipLabel?: string;
  isOverseas: boolean;
  spokenLanguage: string;
  aspectRatio?: string;
  clarity?: string;
}): string {
  let videoPrompt = String(opts.row.videoPrompt ?? "").trim();
  const cameraPrompt = String(opts.row.cameraPrompt ?? "").trim();
  const description = String(opts.row.description ?? "").trim();
  const dialogue = String(opts.row.dialogue ?? "").trim();

  if (opts.isOverseas) {
    // 中文污染的视频词会带偏口播语言，丢弃后由画面描述重建第①段
    if (videoPrompt && looksMostlyChinese(videoPrompt)) {
      videoPrompt = "";
    }

    const subjectLabels = (opts.subjectLabels ?? []).filter(Boolean);
    const allMentionLabels = [
      ...subjectLabels,
      ...(opts.clipLabel ? [opts.clipLabel] : []),
    ];

    // ① 分镜表视频提示词（可附运镜/带说话人的对白/画幅）；@ 后强制空格
    if (videoPrompt) {
      videoPrompt = ensureAtMentionTrailingSpace(videoPrompt, allMentionLabels);
    }
    const section1Parts: string[] = [];
    if (videoPrompt) {
      section1Parts.push(videoPrompt);
    } else if (description) {
      section1Parts.push(description);
    }
    if (cameraPrompt && !section1Parts.join(" ").includes(cameraPrompt)) {
      section1Parts.push(cameraPrompt);
    }
    const spokenLine = formatOverseasSpokenDialogue(
      dialogue,
      opts.spokenLanguage,
      subjectLabels
    );
    // 视频词已含 Spoken by / dialogue 时避免重复堆叠
    if (
      spokenLine &&
      !/spoken by\s+@/i.test(videoPrompt) &&
      !/spoken dialogue in/i.test(videoPrompt)
    ) {
      section1Parts.push(spokenLine);
    }
    const metaBits = [opts.aspectRatio, opts.clarity].filter(Boolean).join(",");
    if (metaBits) section1Parts.push(metaBits);
    const section1 = section1Parts.filter(Boolean).join("，");

    // ② 替换风格 + 精确位次 @ 主体（@ 标签后带空格）
    const subjectAts = joinAtMentions(subjectLabels, "、");
    const clipAt = opts.clipLabel ? atMention(opts.clipLabel).trimEnd() : "";
    const llmCue = String(opts.row.replaceCue ?? "").trim();
    const positionalCue = ensureAtMentionTrailingSpace(
      llmCue || buildPositionalReplaceCue(subjectLabels),
      allMentionLabels
    );

    let section2 = "";
    if (clipAt && positionalCue) {
      // 拉片已含「将@运镜…改为」则不再套前缀，避免重复
      const hasClipLead =
        positionalCue.includes(clipAt) ||
        positionalCue.includes(`@${opts.clipLabel}`) ||
        /改为\s*\S*版本/.test(positionalCue) ||
        positionalCue.includes("运镜参考");
      section2 = hasClipLead
        ? `${positionalCue}${/character refs|camera motion/i.test(positionalCue) ? "" : "，appearance & outfit must match character refs，camera motion match source clip。"}`
        : `将 ${clipAt} 视频改为${opts.spokenLanguage}版本，${positionalCue}，appearance & outfit must match character refs，camera motion match source clip。`;
    } else if (clipAt) {
      section2 =
        `将 ${clipAt} 视频改为${opts.spokenLanguage}版本，` +
        "保留运镜与构图，人物按本地化方案替换，camera motion match source clip。";
    } else if (positionalCue) {
      section2 =
        `生成${opts.spokenLanguage}出海版本，${positionalCue}，` +
        "appearance & outfit must match character refs。";
    } else if (subjectAts) {
      section2 =
        `生成${opts.spokenLanguage}出海版本，将原片人物精确替换为 ${subjectAts}，` +
        "appearance & outfit must match character refs。";
    }

    // ③ 固定要求（含说话人锁：英文化后谁说仍是谁）
    // 运镜参考已去音轨；仍强调勿回灌原片语音，按 Spoken dialogue 生成目标语言对白
    const section3 = [
      "never copy costumes or faces from the source clip.",
      "Scene lock: prefer localized scene/prop subject images when mentioned; keep lighting/composition continuity with the clip.",
      `Speech lock: Spoken dialogue in ${opts.spokenLanguage} only. The motion reference clip has NO usable speech audio — do not reuse or remix any original-language voice from the source. Generate NEW speech audio in ${opts.spokenLanguage} matching the Spoken dialogue lines; regenerate lip motion for ${opts.spokenLanguage}.`,
      "Speaker lock: each line must be spoken by the tagged @ subject; keep the same speaker as the original shot after localization — do not swap speakers or assign lines to the wrong character.",
    ].join(" ");

    // 整段再扫一遍 @，防止 LLM 视频词漏空格
    return ensureAtMentionTrailingSpace(
      [section1, section2, section3].filter((s) => s.trim()).join("\n\n"),
      allMentionLabels
    );
  }

  // —— 爆款复刻：@ 以拉片「视频提示词 / 替换指令 / 对白」为准，文首只补本镜准确主体 ——
  const subjectLabels = (opts.subjectLabels ?? []).filter(Boolean);
  const allMentionLabels = [
    ...subjectLabels,
    ...(opts.clipLabel ? [opts.clipLabel] : []),
  ];
  let videoPromptNorm = rewriteAtTokensToCanonicalLabels(videoPrompt, subjectLabels);
  videoPromptNorm = ensureAtMentionTrailingSpace(videoPromptNorm, allMentionLabels);
  let replaceCueNorm = rewriteAtTokensToCanonicalLabels(
    String(opts.row.replaceCue ?? "").trim(),
    subjectLabels
  );
  replaceCueNorm = ensureAtMentionTrailingSpace(replaceCueNorm, subjectLabels);
  let dialogueNorm = rewriteAtTokensToCanonicalLabels(dialogue, subjectLabels);
  dialogueNorm = ensureAtMentionTrailingSpace(dialogueNorm, subjectLabels);

  // 文首 @：片段 + 本镜准确主体（与连线同源）；不再把未出场角色塞进提示词
  const mentionLine = opts.mentionLabels.map((l) => atMention(l)).join("").trimEnd();
  const bodyParts: string[] = [];
  if (videoPromptNorm) bodyParts.push(videoPromptNorm);
  if (cameraPrompt) bodyParts.push(cameraPrompt);
  if (description && !videoPromptNorm.includes(description.slice(0, Math.min(12, description.length)))) {
    bodyParts.push(description);
  }
  if (dialogueNorm) bodyParts.push(`对白：${dialogueNorm}`);
  if (replaceCueNorm) bodyParts.push(`替换：${replaceCueNorm}`);
  if (mentionLine) {
    bodyParts.push("严格参考提示词中 @ 主体的外观与服饰（勿使用未 @ 的人物形象）。");
  }
  const body = bodyParts.filter(Boolean).join("。");
  const merged = mentionLine ? (body ? `${mentionLine}\n${body}` : mentionLine) : body;
  return ensureAtMentionTrailingSpace(merged, allMentionLabels);
}

export type ViralRemakePipelinePhase =
  | "idle"
  | "bootstrap"
  | "extracting"
  | "analyzing"
  | "ready"
  | "confirm"
  | "prompting"
  | "generating"
  | "done"
  | "error";

export type ViralRemakePipelineState = {
  phase: ViralRemakePipelinePhase;
  message: string;
  gridNodeId: string;
  videoNodeId: string;
  shotCount: number;
  styleSummary: string;
  replacePlan: string;
  generatedVideoNodeIds: string[];
  /** 拉片固定算力 */
  analyzeCredit?: number;
  /** 单镜视频参考价 */
  videoCreditEach?: number;
  /** 预估成片总算力（镜数 × 单价，未含运镜词） */
  estimatedVideoTotal?: number;
  videoModelName?: string;
  /** 服务端算力开关；false 时向导应标免扣费 */
  creditsEnabled?: boolean;
  error?: string;
};

type ProgressCb = (state: Partial<ViralRemakePipelineState>) => void;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 画布 store 与请求 projectId 必须一致，防止错写项目 */
function assertCanvasProjectId(projectId: string) {
  const cur = String(useCanvasStore.getState().projectId || "").trim();
  if (cur && cur !== String(projectId).trim()) {
    throw new Error("项目已切换，请重新打开爆款复刻");
  }
}

function patchGridParams(gridNodeId: string, patch: Record<string, unknown>) {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const current = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  useCanvasStore.getState().updateNodeData(gridNodeId, {
    params: { ...current, ...patch },
  });
}

function readGridSubjects(gridNodeId: string): StoryboardSubjectsBundle {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  return parseSubjectsParam(params.subjects);
}

function patchSubjectOnGrid(
  gridNodeId: string,
  subjectId: string,
  patch: Partial<StoryboardSubjectItem>
) {
  const subjects = readGridSubjects(gridNodeId);
  const next: StoryboardSubjectsBundle = {
    roles: subjects.roles.map((x) => (x.id === subjectId ? { ...x, ...patch } : x)),
    scenes: subjects.scenes.map((x) => (x.id === subjectId ? { ...x, ...patch } : x)),
    props: subjects.props.map((x) => (x.id === subjectId ? { ...x, ...patch } : x)),
  };
  patchGridParams(gridNodeId, { subjects: next });
}

/** 主体就绪度：有多少主体、多少已成功出图 */
export function getViralRemakeSubjectReadiness(gridNodeId: string): {
  subjectCount: number;
  readyCount: number;
  pendingCount: number;
} {
  const subjects = readGridSubjects(gridNodeId);
  const all = [...subjects.roles, ...subjects.scenes, ...subjects.props];
  const subjectCount = all.filter((s) => s.name.trim() || s.extractPrompt.trim()).length;
  const readyCount = all.filter(
    (s) => s.imageAssetId && (s.imageStatus === "succeeded" || !s.imageStatus)
  ).length;
  const pendingCount = collectSubjectImageTargets(subjects).length;
  return { subjectCount, readyCount, pendingCount };
}

/** 一键批量生成主体图（写回分镜表 subjects） */
export async function runViralRemakeSubjectImages(opts: {
  projectId: string;
  gridNodeId: string;
  onProgress?: ProgressCb;
}): Promise<{ done: number; total: number }> {
  assertCanvasProjectId(opts.projectId);
  const subjects = readGridSubjects(opts.gridNodeId);
  const targets = collectSubjectImageTargets(subjects);
  if (targets.length === 0) {
    opts.onProgress?.({ message: "主体图已就绪，无需再生成" });
    return { done: 0, total: 0 };
  }

  opts.onProgress?.({
    phase: "confirm",
    message: `正在生成主体图 0/${targets.length}…`,
  });

  let failed = 0;
  const subjectModel = await resolveCanvasToolPrimaryModel(
    "storyboard_subject_image",
    STORYBOARD_SUBJECT_IMAGE_MODEL
  );
  await runStoryboardSubjectImageBatch({
    projectId: opts.projectId,
    gridNodeId: opts.gridNodeId,
    subjects,
    model: subjectModel,
    concurrency: 2,
    onItemStart: (subjectId) => {
      patchSubjectOnGrid(opts.gridNodeId, subjectId, {
        imageStatus: "running",
        imageError: undefined,
      });
    },
    onItemDone: (subjectId, assetId, kind) => {
      const key = subjectKindToKey(kind);
      const item = subjects[key].find((entry) => entry.id === subjectId);
      patchSubjectOnGrid(opts.gridNodeId, subjectId, {
        imageAssetId: assetId,
        imageStatus: "succeeded",
        imageError: undefined,
        imageSourceHash: item
          ? computeSubjectImageSourceHash(item, kind)
          : undefined,
      });
    },
    onItemFail: (subjectId, error) => {
      failed += 1;
      patchSubjectOnGrid(opts.gridNodeId, subjectId, {
        imageStatus: "failed",
        imageError: error,
      });
    },
    onProgress: (done, total) => {
      opts.onProgress?.({
        phase: "confirm",
        message: `正在生成主体图 ${done}/${total}…`,
      });
    },
  });

  const ready = getViralRemakeSubjectReadiness(opts.gridNodeId);
  opts.onProgress?.({
    phase: "confirm",
    message:
      failed > 0
        ? `主体图完成：成功 ${ready.readyCount}，失败 ${failed}。可重试或继续成片。`
        : `主体图已就绪（${ready.readyCount}/${ready.subjectCount}）`,
  });
  return { done: targets.length - failed, total: targets.length };
}

function buildAnalyzePrompt(session: ViralRemakeSession, frames: ViralRemakeShotFrame[]): string {
  const lines = [
    `目标画幅：${session.aspectRatio}`,
    `目标清晰度：${session.clarity}`,
    `系统已切出 ${frames.length} 个镜头关键帧（按镜头顺序附图），请据此拉片。`,
  ];
  if (session.replaceNotes.trim()) {
    lines.push(`【用户替换说明】\n${session.replaceNotes.trim()}`);
  } else {
    lines.push("【用户替换说明】暂无，请提取原片主体供后续替换。");
  }
  frames.forEach((f) => {
    lines.push(
      `镜头${f.index}：${f.startSec.toFixed(2)}s–${f.endSec.toFixed(2)}s（约 ${f.durationLabel}）`
    );
  });
  return lines.join("\n");
}

/**
 * 多模态参考：镜数较多或整片>12s 时只传关键帧（省 token / 避开超长参考视频）。
 */
function buildReferences(
  session: ViralRemakeSession,
  videoNodeId: string,
  frames: ViralRemakeShotFrame[],
  replaceImageNodeIds: string[]
): GenerationReference[] {
  const refs: GenerationReference[] = [];
  const totalDur = frames.length ? Number(frames[frames.length - 1]?.endSec ?? 0) : 0;
  const keyframeOnly = frames.length >= 6 || totalDur > 12.05;
  if (!keyframeOnly && session.videoFileUrl) {
    refs.push({
      nodeId: videoNodeId || "viral-ref-video",
      type: "video",
      label: "参考爆款视频",
      url: session.videoFileUrl,
    });
  }
  // 过多关键帧易导致上游读超时：超过 12 镜时均匀抽样
  const maxFrames = 12;
  const picked =
    frames.length <= maxFrames
      ? frames
      : Array.from({ length: maxFrames }, (_, i) => {
          const idx = Math.round((i * (frames.length - 1)) / (maxFrames - 1));
          return frames[idx];
        });
  for (const f of picked) {
    refs.push({
      nodeId: `viral-kf-${f.index}`,
      type: "image",
      label: `镜头${f.index}关键帧`,
      url: f.fileUrl || f.thumbnailUrl,
    });
  }
  session.replaceImageUrls.forEach((url, i) => {
    if (!url) return;
    refs.push({
      nodeId: replaceImageNodeIds[i] || `viral-replace-${i}`,
      type: "image",
      label: `替换素材${i + 1}`,
      url,
    });
  });
  return refs;
}

/** 收集画布上可作为「替换参考」的图片节点（会话上传 + 连到分镜表的图） */
function collectReplaceImageNodeIds(gridNodeId: string, sessionAssetIds: string[]): string[] {
  const { nodes, edges } = useCanvasStore.getState();
  const ids = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "image_input") continue;
    const params = (n.data as WorkflowNodeData).params ?? {};
    const assetId = String(params.assetId ?? "");
    if (assetId && sessionAssetIds.includes(assetId)) ids.add(n.id);
  }
  for (const e of edges) {
    if (e.target !== gridNodeId) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (src?.type === "image_input") ids.add(src.id);
  }
  return [...ids];
}

/** 准备资产中已生成/替换成功的主体图 assetId（角色/场景/道具） */
function collectSubjectImageAssets(params: Record<string, unknown>): Array<{
  assetId: string;
  name: string;
  kind: "role" | "scene" | "prop";
}> {
  const subjects = parseSubjectsParam(params.subjects);
  const groups: Array<{ kind: "role" | "scene" | "prop"; items: StoryboardSubjectItem[] }> = [
    { kind: "role", items: subjects.roles },
    { kind: "scene", items: subjects.scenes },
    { kind: "prop", items: subjects.props },
  ];
  const out: Array<{ assetId: string; name: string; kind: "role" | "scene" | "prop" }> = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group.items) {
      const assetId = String(item.imageAssetId ?? "").trim();
      if (!assetId || seen.has(assetId)) continue;
      // 有 assetId 即视为可用；status 缺失时兼容旧数据
      if (item.imageStatus && item.imageStatus !== "succeeded") continue;
      seen.add(assetId);
      out.push({ assetId, name: item.name || "主体", kind: group.kind });
    }
  }
  return out;
}

/** 确保主体图在画布上有 image_input 节点，供视频参考口连线；复用时也重排到网格 */
function ensureImageNodesForAssets(
  assets: Array<{ assetId: string; name: string; fileUrl?: string }>,
  origin: ViralLayoutPoint,
  cell: ViralLayoutCell = viralImageCellSize()
): string[] {
  const nodeIds: string[] = [];
  assets.forEach((asset, i) => {
    const pos = viralGridPos(i, origin, cell, VIRAL_SUBJECT_COLS);
    const existing = useCanvasStore.getState().nodes.find((n) => {
      if (n.type !== "image_input") return false;
      const p = (n.data as WorkflowNodeData).params ?? {};
      return String(p.assetId ?? "") === asset.assetId;
    });
    if (existing) {
      moveNodeTo(existing.id, pos);
      nodeIds.push(existing.id);
      return;
    }
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNodeFromAsset(
      {
        id: asset.assetId,
        category: "image",
        fileUrl: asset.fileUrl || "",
        title: asset.name,
      },
      pos
    );
    const id =
      useCanvasStore
        .getState()
        .nodes.find((n) => n.type === "image_input" && !before.has(n.id))?.id ?? "";
    if (id) {
      useCanvasStore.getState().updateNodeData(id, { label: asset.name });
      // 统一格子尺寸，避免 addNodeFromAsset 与后续媒体自适应后错位观感
      useCanvasStore.getState().updateNodeSize(id, cell.width, cell.height);
      nodeIds.push(id);
    }
  });
  return nodeIds;
}

function connectRefsToVideo(videoId: string, sourceIds: string[]) {
  const store = useCanvasStore.getState();
  const wanted = new Set(sourceIds.filter(Boolean));
  // 复用节点时拆掉多余旧参考（如历史关键帧），避免原片人物继续混入
  const pruned = store.edges.filter((e) => {
    if (e.target !== videoId || e.targetHandle !== REFERENCE_INPUT_ID) return true;
    return wanted.has(e.source);
  });
  if (pruned.length !== store.edges.length) {
    store.setEdges(pruned);
  }
  for (const srcId of wanted) {
    if (!srcId || srcId === videoId) continue;
    // 必须落到「参考」口，避免已有其它 handle 连线时误判已连接
    const already = useCanvasStore
      .getState()
      .edges.some(
        (e) =>
          e.source === srcId &&
          e.target === videoId &&
          e.targetHandle === REFERENCE_INPUT_ID
      );
    if (already) continue;
    const src = useCanvasStore.getState().nodes.find((n) => n.id === srcId);
    const handle = src?.type === "video_input" ? "video" : "image";
    useCanvasStore.getState().connectNodes({
      source: srcId,
      target: videoId,
      sourceHandle: handle,
      targetHandle: REFERENCE_INPUT_ID,
    });
  }
}

/** 预估成片算力（供向导确认步） */
export async function estimateViralRemakeBatchCost(opts: {
  shotCount: number;
  session: ViralRemakeSession;
  /** 拉片工具；出海传 storyboard_overseas_localize */
  analyzeCanvasTool?: string;
  analyzeModel?: string;
  /** 出海成片不接原片/clip 时传 false */
  withRefVideo?: boolean;
}): Promise<
  Pick<
    ViralRemakePipelineState,
    "videoCreditEach" | "estimatedVideoTotal" | "videoModelName" | "analyzeCredit" | "creditsEnabled"
  >
> {
  let analyzeCredit: number | undefined;
  let creditsEnabled = true;
  try {
    const aq = await getCreditQuote({
      model: opts.analyzeModel || STORYBOARD_FROM_VIDEO_MODEL,
      category: "text",
      canvasTool: opts.analyzeCanvasTool || STORYBOARD_FROM_VIDEO_TOOL,
    });
    analyzeCredit = Number(aq.total ?? 0);
    creditsEnabled = aq.creditsEnabled !== false;
  } catch {
    /* optional */
  }
  const withRefVideo = opts.withRefVideo !== false;
  // 爆款默认接参考视频档；出海默认无参考视频（仅主体图）
  const videoEst = await estimateViralRemakeVideoCredit({
    aspectRatio: opts.session.aspectRatio,
    clarity: opts.session.clarity,
    withRefVideo,
  });
  const each = videoEst?.total;
  return {
    analyzeCredit,
    videoCreditEach: each,
    estimatedVideoTotal: each != null ? each * Math.max(0, opts.shotCount) : undefined,
    videoModelName: videoEst?.model,
    creditsEnabled,
  };
}

/** 自动拉片：异步切镜 + LLM 分析 + 写入分镜表 */
export async function runViralRemakeAnalyze(opts: {
  projectId: string;
  session: ViralRemakeSession;
  onProgress?: ProgressCb;
}): Promise<ViralRemakePipelineState> {
  const { projectId, session } = opts;
  assertCanvasProjectId(projectId);
  const report = (partial: Partial<ViralRemakePipelineState>) => {
    opts.onProgress?.(partial);
    // 进度落盘，刷新后仍可打开向导（勿在 bootstrap 就清 autoStart）
    if (partial.phase || partial.gridNodeId || partial.message) {
      patchViralRemakeProgress(projectId, {
        phase: partial.phase,
        gridNodeId: partial.gridNodeId,
        videoNodeId: partial.videoNodeId,
        shotCount: partial.shotCount,
        styleSummary: partial.styleSummary,
        replacePlan: partial.replacePlan,
        message: partial.message,
      });
    }
  };

  report({ phase: "bootstrap", message: "正在搭建复刻画布…" });
  const boot = bootstrapViralRemakeCanvas(session);
  if (!boot.gridNodeId) {
    const err = "无法创建分镜表节点";
    report({ phase: "error", message: err, error: err });
    throw new Error(err);
  }

  report({
    phase: "extracting",
    message: "正在切镜并提取关键帧…",
    gridNodeId: boot.gridNodeId,
    videoNodeId: boot.videoNodeId,
  });

  let frames: ViralRemakeShotFrame[] = [];
  try {
    const extracted = await extractViralRemakeShots({
      projectId,
      videoAssetId: session.videoAssetId,
      onProgress: (msg) => report({ phase: "extracting", message: msg }),
    });
    frames = extracted.shots ?? [];
    notifyAssetsUpdated();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "切镜失败";
    report({ phase: "error", message: msg, error: msg, gridNodeId: boot.gridNodeId });
    throw err;
  }

  report({
    phase: "analyzing",
    message: `已切出 ${frames.length} 镜，正在 AI 拉片分析…`,
    shotCount: frames.length,
  });

  let quoteToken: string | undefined;
  let analyzeCredit: number | undefined;
  try {
    const quote = await getCreditQuote({
      model: STORYBOARD_FROM_VIDEO_MODEL,
      category: "text",
      canvasTool: STORYBOARD_FROM_VIDEO_TOOL,
    });
    quoteToken = quote.quoteToken;
    analyzeCredit = Number(quote.total ?? 0);
  } catch {
    /* 无报价仍尝试提交 */
  }

  const workflowId = useCanvasStore.getState().workflowId ?? undefined;
  const content = buildAnalyzePrompt(session, frames);
  const references = buildReferences(session, boot.videoNodeId, frames, boot.replaceImageNodeIds);

  let text = "";
  try {
    const result = await runStoryboardTextJob({
      projectId,
      nodeId: `${boot.gridNodeId}::viral-analyze`,
      workflowId,
      content,
      model: STORYBOARD_FROM_VIDEO_MODEL,
      textPromptKind: STORYBOARD_FROM_VIDEO_KIND,
      canvasTool: STORYBOARD_FROM_VIDEO_TOOL,
      quoteToken,
      idempotencySuffix: "viral-analyze",
      references,
    });
    text = result.text;
    toastCreditCharged(result.creditCost, true);
    if (result.creditCost != null) analyzeCredit = result.creditCost;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "拉片分析失败";
    report({ phase: "error", message: msg, error: msg, gridNodeId: boot.gridNodeId });
    throw err;
  }

  const parsed = parseViralRemakeContent(text);
  const rows = normalizeViralShotSubjectMentions(
    alignRowsWithKeyframes(parsed.rows, frames),
    parsed.subjects
  );
  const indexed = reindexTableRows(rows);

  const cost = await estimateViralRemakeBatchCost({
    shotCount: indexed.length,
    session,
  });

  patchGridParams(boot.gridNodeId, {
    shots: indexed,
    subjects: parsed.subjects,
    viewMode: "shots",
    selectedShotId: indexed[0]?.id ?? "",
    viralRemakeMeta: {
      styleSummary: parsed.styleSummary,
      replacePlan: parsed.replacePlan,
      aspectRatio: session.aspectRatio,
      clarity: session.clarity,
      videoAssetId: session.videoAssetId,
      videoNodeId: boot.videoNodeId,
      replaceImageAssetIds: session.replaceImageAssetIds,
    },
  });

  if (parsed.warnings.length) {
    toast.message(parsed.warnings.slice(0, 2).join("；"));
  }

  const state: ViralRemakePipelineState = {
    phase: "confirm",
    message: `拉片完成：${indexed.length} 镜。请确认后生成同款（可先在分镜表替换素材）`,
    gridNodeId: boot.gridNodeId,
    videoNodeId: boot.videoNodeId,
    shotCount: indexed.length,
    styleSummary: parsed.styleSummary,
    replacePlan: parsed.replacePlan,
    generatedVideoNodeIds: [],
    analyzeCredit: cost.analyzeCredit ?? analyzeCredit,
    videoCreditEach: cost.videoCreditEach,
    estimatedVideoTotal: cost.estimatedVideoTotal,
    videoModelName: cost.videoModelName,
  };
  report(state);
  // 进入确认步后再关闭 autoStart，刷新仍可凭 progress / viralRemakeMeta 打开向导
  markViralRemakeSessionStarted(projectId);
  toast.success(`拉片完成：${indexed.length} 个镜头`);
  return state;
}

/** 补全运镜/视频词：仅填空，并带入替换方案，避免覆盖拉片文案 */
export async function runViralRemakeFillPrompts(opts: {
  gridNodeId: string;
  onProgress?: ProgressCb;
}): Promise<void> {
  opts.onProgress?.({ phase: "prompting", message: "正在补全缺失的运镜与视频提示词…" });
  const grid = useCanvasStore.getState().nodes.find((n) => n.id === opts.gridNodeId);
  const params = (grid?.data as WorkflowNodeData | undefined)?.params ?? {};
  const meta = (params.viralRemakeMeta as Record<string, unknown> | undefined) ?? {};
  const replacePlan = String(meta.replacePlan || meta.localePlan || "").trim();
  const isOverseas = String(meta.source || "") === "overseas_localize";
  // 出海禁止走中文 storyboard_video 补全（会污染口播语言）；成片时由 buildBatchVideoPrompt 组装
  if (isOverseas) {
    opts.onProgress?.({
      phase: "confirm",
      message: "出海模式将用对白语言锁与主体 @ 引用组装成片提示词",
    });
    return;
  }
  const extraContext = replacePlan
    ? `爆款复刻替换方案：${replacePlan}。视频提示词必须用 @正式主体名 标注本镜出场主体（与分镜表「准备资产」名称逐字一致），禁止标注未出场主体，禁止用男主/女主等代称。`
    : "爆款复刻：视频提示词必须用 @正式主体名 标注本镜出场主体（与准备资产名称一致），只标本镜实际出场者。";
  // 把当前主体名单塞进补全文案，便于 storyboard_video 写准 @
  const subjects = parseSubjectsParam(params.subjects);
  const nameList = [...subjects.roles, ...subjects.scenes, ...subjects.props]
    .map((s) => s.name.trim())
    .filter(Boolean);
  const subjectHint =
    nameList.length > 0 ? `\n可用主体正式名（@ 必须从中选）：${nameList.join("、")}` : "";
  await runStoryboardOneClickGeneration({
    gridNodeId: opts.gridNodeId,
    onlyEmpty: true,
    extraContext: `${extraContext}${subjectHint}`,
  });
  opts.onProgress?.({ phase: "confirm", message: "提示词已就绪，可确认生成同款视频" });
}

/** 按分镜行创建 video_input：串行提交 + 并行轮询（deferPoll） */
export async function runViralRemakeBatchVideos(opts: {
  projectId: string;
  gridNodeId: string;
  onProgress?: ProgressCb;
}): Promise<string[]> {
  assertCanvasProjectId(opts.projectId);
  const store = useCanvasStore.getState();
  const grid = store.nodes.find((n) => n.id === opts.gridNodeId);
  if (!grid) throw new Error("分镜表不存在");

  // 有主体列表但尚无成功主体图 → 拦截，避免成片仍参考原片人物
  const ready = getViralRemakeSubjectReadiness(opts.gridNodeId);
  if (ready.subjectCount > 0 && ready.readyCount === 0) {
    throw new Error("请先生成主体图后再确认成片（可点向导内「一键生成主体图」）");
  }

  const params = (grid.data as WorkflowNodeData).params ?? {};
  const shots = Array.isArray(params.shots) ? params.shots : [];
  if (shots.length === 0) throw new Error("分镜表为空");

  const meta = (params.viralRemakeMeta as Record<string, unknown> | undefined) ?? {};
  const isOverseas = String(meta.source || "") === "overseas_localize";
  const spokenLanguage = isOverseas
    ? getOverseasMarket(String(meta.targetMarketId || "")).language
    : "中文";
  const aspectRatio = (String(meta.aspectRatio || "9:16") as ViralRemakeSession["aspectRatio"]);
  const clarity = (String(meta.clarity || "1080p") as ViralRemakeSession["clarity"]);
  const sessionReplaceIds = Array.isArray(meta.replaceImageAssetIds)
    ? (meta.replaceImageAssetIds as string[])
    : [];
  const videoAssetId = String(meta.videoAssetId || "").trim();
  const metaVideoNodeId = String(meta.videoNodeId || "").trim();

  // 整片原视频节点仅作兜底；成片优先接「本镜分段参考视频」（≤12s）
  let fullSourceVideoNodeId = metaVideoNodeId;
  if (
    !fullSourceVideoNodeId ||
    !store.nodes.some((n) => n.id === fullSourceVideoNodeId && n.type === "video_input")
  ) {
    fullSourceVideoNodeId =
      store.nodes.find((n) => {
        if (n.type !== "video_input") return false;
        const p = (n.data as WorkflowNodeData).params ?? {};
        return videoAssetId && String(p.assetId ?? "") === videoAssetId;
      })?.id ?? "";
  }

  opts.onProgress?.({
    phase: "generating",
    message: `准备生成 ${shots.length} 镜同款视频（每镜≥4秒，写入独立成片表）…`,
    shotCount: shots.length,
  });

  // 仅爆款/出海：新建或复用独立「成片表」节点（不在分镜表内）
  const { ensureFinishedClipsGridNode } = await import("@/lib/canvas/finishedClipsGrid");
  ensureFinishedClipsGridNode({
    gridNodeId: opts.gridNodeId,
    skillKind: isOverseas ? "overseas_localize" : "viral_remake",
  });
  try {
    const { syncOutputVideosToStoryboardRows } = await import("@/lib/canvas/overseasShotVideos");
    const shotIds = shots
      .map((s) => String((s as { id?: string }).id || ""))
      .filter(Boolean);
    syncOutputVideosToStoryboardRows(opts.gridNodeId, [], { markRunningShotIds: shotIds });
  } catch {
    /* ignore */
  }

  const needPrompts = shots.some((r) => {
    const row = r as { videoPrompt?: string };
    return !String(row.videoPrompt ?? "").trim();
  });
  if (needPrompts) {
    await runViralRemakeFillPrompts({ gridNodeId: opts.gridNodeId, onProgress: opts.onProgress });
  }

  const latest = useCanvasStore.getState().nodes.find((n) => n.id === opts.gridNodeId);
  const latestParams = (latest?.data as WorkflowNodeData | undefined)?.params ?? {};
  const latestShots = (Array.isArray(latestParams.shots) ? latestParams.shots : []) as Array<{
    id: string;
    index: number;
    videoPrompt?: string;
    description?: string;
    cameraPrompt?: string;
    dialogue?: string;
    replaceCue?: string;
    duration?: string;
    sketchAssetId?: string;
    clipAssetId?: string;
  }>;

  const clipIds = latestShots
    .map((r) => String(r.clipAssetId ?? "").trim())
    .filter(Boolean);
  const hasAnyClip = clipIds.length > 0;
  // 出海对齐 OiiOii：分段原片作运镜/构图参考 + 主体图作身份/服饰；计价走有参考视频档
  const withRefVideo = hasAnyClip || Boolean(fullSourceVideoNodeId);

  const { generationOptions, modelName, supportsRefVideo, presets } =
    await buildViralRemakeGenerationOptions({
      aspectRatio,
      clarity,
      withRefVideo,
      // 原片/主体含真人：优先 RH（华狐 PrivacyInformation 硬拦无法靠真人开关绕过）
      preferRhForRealPerson: true,
    });
  if (withRefVideo && !supportsRefVideo) {
    toast.message("当前默认视频模型不支持参考视频，将仅用主体图参考；建议选用 RH Seedance 2.0 多模态");
  }
  if (modelName && /^huahu_seedance/i.test(modelName)) {
    toast.message("当前为华狐渠道：含真人参考图/视频可能被隐私审核拦截，建议改用 RH Seedance 2.0 多模态");
  } else if (isOverseas && modelName && /^rh_seedance/i.test(modelName)) {
    toast.message("出海成片已选用 RH Seedance（支持真人参考）；请保持「真人模式·开启」");
  }
  if (isOverseas && hasAnyClip) {
    toast.message(
      "出海成片：无声运镜片段管镜头运动，本地化主体图管人设；对白由模型按分镜台词重新生成"
    );
  }

  const batchId = `viral-${Date.now()}`;
  const replaceNodeIds = collectReplaceImageNodeIds(opts.gridNodeId, sessionReplaceIds);

  // 优先用「准备资产」里新生成/替换的主体图，而不是原片关键帧
  const subjectAssetsMeta = collectSubjectImageAssets(latestParams);
  const subjectIds = subjectAssetsMeta.map((s) => s.assetId);
  const subjectFetched = subjectIds.length
    ? await fetchAssetsBatch(opts.projectId, subjectIds)
    : [];
  const subjectUrlById = new Map(subjectFetched.map((a) => [a.id, a.fileUrl]));

  // 有主体/替换图/分段或整片参考视频时都不再用关键帧当主体；仅皆无时回退关键帧构图
  // 先算布局带（主体数量含将创建的主体图；关键帧回退时占主体带）
  const willUseKeyframeFallback =
    subjectAssetsMeta.length === 0 &&
    replaceNodeIds.length === 0 &&
    !hasAnyClip &&
    !fullSourceVideoNodeId;

  const subjectBandCount = willUseKeyframeFallback
    ? latestShots.filter((r) => String(r.sketchAssetId ?? "").trim()).length
    : subjectAssetsMeta.length + replaceNodeIds.length;

  const layout = resolveViralLayoutOrigins({
    gridNodeId: opts.gridNodeId,
    subjectCount: subjectBandCount,
    shotCount: latestShots.length,
    hasClipBand: hasAnyClip,
    aspectRatio,
  });

  // 替换素材也排进主体带（接在生成主体之后），避免散落在分镜表旁
  if (replaceNodeIds.length > 0) {
    const start = willUseKeyframeFallback ? 0 : subjectAssetsMeta.length;
    replaceNodeIds.forEach((id, ri) => {
      moveNodeTo(
        id,
        viralGridPos(start + ri, layout.subjectOrigin, layout.imageCell, VIRAL_SUBJECT_COLS)
      );
      useCanvasStore
        .getState()
        .updateNodeSize(id, layout.imageCell.width, layout.imageCell.height);
    });
  }

  const subjectNodeIds = ensureImageNodesForAssets(
    subjectAssetsMeta.map((s) => ({
      assetId: s.assetId,
      name: mentionSafeLabel(s.name, "主体"),
      fileUrl: subjectUrlById.get(s.assetId) || "",
    })),
    layout.subjectOrigin,
    layout.imageCell
  );

  // 统一主体节点标签，供成片提示词 @ 引用
  const subjectMentionLabels: string[] = [];
  subjectNodeIds.forEach((id, idx) => {
    const name = mentionSafeLabel(subjectAssetsMeta[idx]?.name || "", `主体${idx + 1}`);
    useCanvasStore.getState().updateNodeData(id, { label: name });
    subjectMentionLabels.push(name);
  });
  const replaceMentionLabels: string[] = [];
  replaceNodeIds.forEach((id, idx) => {
    const n = useCanvasStore.getState().nodes.find((x) => x.id === id);
    const name = mentionSafeLabel(
      String((n?.data as WorkflowNodeData | undefined)?.label || ""),
      `替换${idx + 1}`
    );
    useCanvasStore.getState().updateNodeData(id, { label: name });
    replaceMentionLabels.push(name);
  });

  if (subjectNodeIds.length === 0 && replaceNodeIds.length === 0) {
    toast.message("未检测到主体图或替换素材，将仅用提示词生成（建议先在「准备资产」生成主体）");
  }

  const clipFetched = clipIds.length ? await fetchAssetsBatch(opts.projectId, clipIds) : [];
  const clipUrlById = new Map(clipFetched.map((a) => [a.id, a.fileUrl]));

  const useKeyframeFallback = willUseKeyframeFallback;
  const sketchIds = useKeyframeFallback
    ? latestShots.map((r) => String(r.sketchAssetId ?? "").trim()).filter(Boolean)
    : [];
  const sketchAssets = sketchIds.length
    ? await fetchAssetsBatch(opts.projectId, sketchIds)
    : [];
  const sketchUrlById = new Map(sketchAssets.map((a) => [a.id, a.fileUrl]));

  /** 为本镜创建/复用分段参考视频节点；与成片同列纵向列表对齐 */
  const ensureShotClipNode = (row: { index: number; clipAssetId?: string }, i: number): string => {
    const clipAssetId = String(row.clipAssetId ?? "").trim();
    if (!clipAssetId) return "";
    const pos = viralGridPos(i, layout.clipOrigin, layout.videoCell, VIRAL_OUTPUT_COLS);
    const existing = useCanvasStore.getState().nodes.find((n) => {
      if (n.type !== "video_input") return false;
      const p = (n.data as WorkflowNodeData).params ?? {};
      return String(p.assetId ?? "") === clipAssetId;
    });
    if (existing) {
      moveNodeTo(existing.id, pos);
      useCanvasStore
        .getState()
        .updateNodeSize(existing.id, layout.videoCell.width, layout.videoCell.height);
      return existing.id;
    }
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNodeFromAsset(
      {
        id: clipAssetId,
        category: "video",
        fileUrl: clipUrlById.get(clipAssetId) || "",
        title: `镜头${row.index}参考片段`,
      },
      pos
    );
    const id =
      useCanvasStore
        .getState()
        .nodes.find((n) => n.type === "video_input" && !before.has(n.id))?.id ?? "";
    if (id) {
      useCanvasStore
        .getState()
        .updateNodeSize(id, layout.videoCell.width, layout.videoCell.height);
    }
    return id;
  };

  type Pending = {
    nodeId: string;
    jobId: number | string;
    kind: "text" | "media";
    model: string;
    nodeType: string;
    shotIndex: number;
    shotId: string;
  };

  const createdIds: string[] = [];
  const pendings: Pending[] = [];
  // 每一镜最终必须落定成功/失败，避免表格「待生成」查无音讯
  const failedShotMessages = new Map<string, string>();

  // 1) 建节点 + 连线 + 串行提交（deferPoll，避开用户级提交锁冲突）
  let abortRemaining = false;
  for (let i = 0; i < latestShots.length; i += 1) {
    if (abortRemaining) break;
    const row = latestShots[i];

    opts.onProgress?.({
      phase: "generating",
      message: `提交镜头 ${i + 1}/${latestShots.length}…`,
    });

    // 幂等：同镜已有同款节点则复用；成片节点压到窄带，主 UX 在「成片」表
    const parkOrigin = {
      x: layout.outputOrigin.x,
      y: layout.outputOrigin.y + 420,
    };
    const outputPos = viralGridPos(i, parkOrigin, { width: 160, height: 90 }, 6);
    let videoId =
      useCanvasStore.getState().nodes.find((n) => {
        if (n.type !== "video_input") return false;
        const p = (n.data as WorkflowNodeData).params ?? {};
        return String(p.viralRemakeShotId ?? "") === row.id;
      })?.id ?? "";
    if (!videoId) {
      const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
      useCanvasStore.getState().addNode("video_input", outputPos);
      videoId =
        useCanvasStore.getState().nodes.find((n) => n.type === "video_input" && !before.has(n.id))
          ?.id ?? "";
    } else {
      moveNodeTo(videoId, outputPos);
    }
    if (!videoId) continue;
    useCanvasStore.getState().updateNodeSize(videoId, 160, 90);

    // 分段节点：出海/爆款均作运镜参考（身份仍由主体图锁定）
    const shotClipNodeId = ensureShotClipNode(row, i);
    if (shotClipNodeId) {
      const clipLabel = mentionSafeLabel(
        isOverseas ? `镜头${row.index}运镜参考` : `镜头${row.index}参考片段`,
        `镜头${row.index}参考`
      );
      const clipNode = useCanvasStore.getState().nodes.find((n) => n.id === shotClipNodeId);
      const clipParams =
        (clipNode?.data as WorkflowNodeData | undefined)?.params ?? {};
      const clipDurSec = String(row.duration ?? "").trim()
        ? parseViralShotDurationSec(row.duration)
        : parseViralShotDurationSec(
            (clipParams.durationSec as number | string | undefined) ?? undefined
          );
      useCanvasStore.getState().updateNodeData(shotClipNodeId, {
        label: clipLabel,
        params: {
          ...clipParams,
          // 与分镜表时长同步，供成片 duration 回退读取
          ...(clipDurSec > 0 ? { durationSec: clipDurSec } : {}),
        },
      });
    }
    const refVideoNodeId = shotClipNodeId
      ? shotClipNodeId
      : // 出海勿回退整段有声原片（会带回原语言对白）；无静音片段则仅靠主体图
        isOverseas
        ? ""
        : fullSourceVideoNodeId;

    // 本镜 @ 主体以拉片提示词/替换指令为准，连线与文首 @ 同源
    const roleMentionLabels = subjectMentionLabels.filter(
      (_, idx) => subjectAssetsMeta[idx]?.kind === "role"
    );
    const relevantSubjects = pickRelevantMentionLabels(row, subjectMentionLabels, {
      roleLabels: roleMentionLabels,
    });
    const clipMention = shotClipNodeId
      ? mentionSafeLabel(
          String(
            (
              useCanvasStore.getState().nodes.find((n) => n.id === shotClipNodeId)?.data as
                | WorkflowNodeData
                | undefined
            )?.label || ""
          ),
          `镜头${row.index}参考`
        )
      : "";
    // 出海：主体在前（身份优先），片段在后（运镜）；爆款：片段在前
    const subjectLabelsForPrompt = [...relevantSubjects, ...replaceMentionLabels];
    // 替换参考图始终接入；与主体去重
    const mentionLabels = isOverseas
      ? [...subjectLabelsForPrompt, ...(clipMention ? [clipMention] : [])]
      : [
          ...(clipMention ? [clipMention] : []),
          ...relevantSubjects,
          ...replaceMentionLabels,
        ];

    const promptRaw = buildBatchVideoPrompt({
      row,
      mentionLabels,
      subjectLabels: subjectLabelsForPrompt,
      clipLabel: clipMention || undefined,
      isOverseas,
      spokenLanguage,
      aspectRatio,
      clarity,
    });
    // 提交前再保证 @标签后有空格，避免校验「未匹配到上游节点」
    const prompt = ensureAtMentionTrailingSpace(promptRaw, mentionLabels).trim();
    if (!prompt.trim()) {
      toast.message(`镜头 ${row.index} 缺少提示词，已跳过`);
      failedShotMessages.set(row.id, "缺少提示词，已跳过");
      continue;
    }

    const curParams =
      (useCanvasStore.getState().nodes.find((n) => n.id === videoId)?.data as WorkflowNodeData)
        ?.params ?? {};
    // 时长与分镜表「时长」一致；成片强制 ≥4s
    let shotDurationSec = String(row.duration ?? "").trim()
      ? parseViralShotDurationSec(row.duration)
      : 0;
    if (!(shotDurationSec > 0) && shotClipNodeId) {
      const clipParams =
        (
          useCanvasStore.getState().nodes.find((n) => n.id === shotClipNodeId)?.data as
            | WorkflowNodeData
            | undefined
        )?.params ?? {};
      shotDurationSec = parseViralShotDurationSec(
        (clipParams.durationSec as number | string | undefined) ??
          (clipParams.duration as number | string | undefined)
      );
    }
    if (!(shotDurationSec > 0)) shotDurationSec = 4;
    shotDurationSec = floorViralGenerationDurationSec(shotDurationSec);
    const shotGenerationOptions = withViralRemakeDuration(
      presets,
      generationOptions,
      shotDurationSec
    );
    const nextParams: Record<string, unknown> = {
      ...curParams,
      prompt,
      generationOptions: shotGenerationOptions as GenerationOptions,
      viralRemakeShotId: row.id,
      // 便于节点 UI / 合并读到目标秒数
      durationSec: shotDurationSec,
    };
    if (modelName) nextParams.model = modelName;

    useCanvasStore.getState().updateNodeData(videoId, {
      label: isOverseas ? `出海镜头${row.index}` : `同款镜头${row.index}`,
      params: nextParams,
    });

    // 连线与提示词 @ 同源：凡 prompt 会 @ 的主体都必须接到「参考」口，提交时才能带上
    const relevantSubjectNodeIds = subjectNodeIds.filter((_, idx) =>
      relevantSubjects.includes(subjectMentionLabels[idx] || "")
    );
    // 出海：主体图在前（身份），运镜片段紧随；爆款：参考视频在前
    const refSources: string[] = isOverseas
      ? [
          ...relevantSubjectNodeIds,
          ...replaceNodeIds,
          ...(refVideoNodeId ? [refVideoNodeId] : []),
        ]
      : [
          ...(refVideoNodeId ? [refVideoNodeId] : []),
          ...relevantSubjectNodeIds,
          ...replaceNodeIds,
        ];

    if (useKeyframeFallback && row.sketchAssetId) {
      // 关键帧占主体带，与成片同序，便于对照
      const kfPos = viralGridPos(i, layout.subjectOrigin, layout.imageCell, VIRAL_SUBJECT_COLS);
      const existingImg = useCanvasStore.getState().nodes.find((n) => {
        if (n.type !== "image_input") return false;
        const p = (n.data as WorkflowNodeData).params ?? {};
        return String(p.assetId ?? "") === row.sketchAssetId;
      });
      let imgId = existingImg?.id ?? "";
      if (!imgId) {
        const sketchNodeBefore = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
        useCanvasStore.getState().addNodeFromAsset(
          {
            id: row.sketchAssetId,
            category: "image",
            fileUrl: sketchUrlById.get(row.sketchAssetId) || "",
            title: `镜头${row.index}关键帧`,
          },
          kfPos
        );
        imgId =
          useCanvasStore
            .getState()
            .nodes.find((n) => n.type === "image_input" && !sketchNodeBefore.has(n.id))?.id ?? "";
      } else {
        moveNodeTo(imgId, kfPos);
      }
      if (imgId) {
        useCanvasStore
          .getState()
          .updateNodeSize(imgId, layout.imageCell.width, layout.imageCell.height);
        refSources.push(imgId);
      }
    }

    connectRefsToVideo(videoId, refSources);
    createdIds.push(videoId);

    // 提交重试（9201）；算力不足 abortBatch 停止后续镜头
    let submitted = false;
    for (let attempt = 0; attempt < 4 && !submitted; attempt += 1) {
      const result = await runOneGeneratableNode({
        projectId: opts.projectId,
        nodeId: videoId,
        batchId: `${batchId}-${i}`,
        deferPoll: true,
      });
      if (result.ok) {
        submitted = true;
        if (result.pending) {
          pendings.push({
            nodeId: videoId,
            jobId: result.pending.jobId,
            kind: result.pending.kind,
            model: result.pending.model,
            nodeType: result.pending.nodeType,
            shotIndex: row.index,
            shotId: row.id,
          });
        }
        break;
      }
      if (result.abortBatch) {
        abortRemaining = true;
        toast.error(result.error || "算力不足，已停止后续提交");
        failedShotMessages.set(row.id, result.error || "算力不足，已停止提交");
        // 本镜之后未及处理的镜头也需在表格里明确标为失败，而非停在「待生成」
        for (let j = i + 1; j < latestShots.length; j += 1) {
          failedShotMessages.set(latestShots[j].id, "算力不足，未生成，可稍后重新确认生成");
        }
        break;
      }
      const busy =
        result.code === "RATE_LIMITED" ||
        (typeof result.error === "string" && result.error.includes("生成提交处理中"));
      if (busy && attempt < 3) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      toast.error(`镜头 ${row.index}：${result.error || "提交失败"}`);
      failedShotMessages.set(row.id, result.error || "提交失败");
      useCanvasStore.getState().setNodeStatus(videoId, "error");
      useCanvasStore.getState().updateNodeData(videoId, { error: result.error || "提交失败" });
      break;
    }
  }

  // 节点已落格：先适应视口，用户可边等边看整齐排布
  requestAnimationFrame(() => {
    useCanvasStore.getState().fitView?.();
  });

  // 2) 并行等待已提交任务
  if (pendings.length > 0) {
    opts.onProgress?.({
      phase: "generating",
      message: `已提交 ${pendings.length} 段，等待生成完成…`,
    });
    await Promise.all(
      pendings.map(async (p) => {
        const done = await completePendingGeneratableNode({
          projectId: opts.projectId,
          nodeId: p.nodeId,
          jobId: p.jobId,
          kind: p.kind,
          model: p.model,
          nodeType: p.nodeType,
        });
        if (!done.ok) {
          toast.error(`镜头 ${p.shotIndex}：${done.error || "生成失败"}`);
          failedShotMessages.set(p.shotId, done.error || "生成失败");
          useCanvasStore.getState().updateNodeData(p.nodeId, { error: done.error || "生成失败" });
        }
      })
    );
  }

  // 刷新素材 manifest，避免成片节点仅有 assetId 时预览空白
  notifyAssetsUpdated();

  // 成片状态回写分镜行（权威字段），独立成片表只读展示；失败镜也落定
  let successCount = createdIds.length;
  try {
    const { syncOutputVideosToStoryboardRows, markStoryboardShotsFailed } = await import(
      "@/lib/canvas/overseasShotVideos"
    );
    syncOutputVideosToStoryboardRows(opts.gridNodeId, createdIds);
    if (failedShotMessages.size > 0) {
      markStoryboardShotsFailed(opts.gridNodeId, failedShotMessages);
      successCount = Math.max(0, latestShots.length - failedShotMessages.size);
    }
  } catch {
    /* 表格回写失败不阻断 */
  }
  ensureFinishedClipsGridNode({
    gridNodeId: opts.gridNodeId,
    skillKind: isOverseas ? "overseas_localize" : "viral_remake",
  });

  const failedCount = failedShotMessages.size;
  opts.onProgress?.({
    phase: "done",
    message:
      failedCount > 0
        ? `${isOverseas ? "出海" : "同款"}成片已写入独立成片表 · 成功 ${successCount} 镜 / 失败 ${failedCount} 镜`
        : `${isOverseas ? "出海" : "同款"}成片已写入独立成片表 · ${createdIds.length} 镜`,
    generatedVideoNodeIds: createdIds,
  });
  if (failedCount > 0) {
    toast.warning(
      `成片完成 ${successCount} 镜，失败 ${failedCount} 镜（见画布「成片表」节点）`
    );
  } else {
    toast.success(`已完成 ${createdIds.length} 镜成片（见画布「成片表」节点）`);
  }
  // 聚焦成片表，避免散落视频节点抢视线
  requestAnimationFrame(() => {
    useCanvasStore.getState().fitView?.();
  });
  return createdIds;
}
