/**
 * 一键出海流水线：复用爆款切镜 / 分镜表 / 主体图 / 批量成片，
 * 仅替换「目标市场本地化」工具与 Prompt / meta.source。
 */

import { toast } from "sonner";
import { extractViralRemakeShots, type ViralRemakeShotFrame } from "@/lib/api/viralRemake";
import { getCreditQuote } from "@/lib/api/credits";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { notifyAssetsUpdated } from "@/lib/api/assets";
import { runStoryboardTextJob } from "@/lib/canvas/storyboardTextJob";
import {
  alignRowsWithKeyframes,
  parseViralRemakeContent,
} from "@/lib/canvas/parseViralRemake";
import { bootstrapViralRemakeCanvas } from "@/lib/canvas/viralRemakeBootstrap";
import { getOverseasMarket, OVERSEAS_MARKETS } from "@/lib/canvas/overseasMarkets";
import {
  markOverseasSessionStarted,
  patchOverseasProgress,
  type OverseasSession,
  OVERSEAS_META_SOURCE,
} from "@/lib/canvas/overseasSession";
import type { ViralRemakeAspect, ViralRemakeClarity, ViralRemakeSession } from "@/lib/canvas/viralRemakeSession";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  parseTableRowsParam,
  reindexTableRows,
  type StoryboardTableRow,
} from "@/types/storyboard-table";
import { mergeTableRowsPreservingIds } from "@/lib/canvas/parseStoryboardTable";
import type { WorkflowNodeData } from "@/types/workflow";
import { toastCreditCharged } from "@/lib/canvas/generationCreditHelpers";
import {
  estimateViralRemakeBatchCost,
  getViralRemakeSubjectReadiness,
  runViralRemakeBatchVideos,
  runViralRemakeFillPrompts,
  runViralRemakeSubjectImages,
  type ViralRemakePipelineState,
} from "@/lib/canvas/viralRemakePipeline";

/** 画布工具 / textPromptKind：一键出海本地化 */
export const STORYBOARD_OVERSEAS_TOOL = "storyboard_overseas_localize" as const;
export const STORYBOARD_OVERSEAS_KIND = "storyboard_overseas_localize" as const;
export const STORYBOARD_OVERSEAS_MODEL = "" as const;

export type OverseasPipelineState = ViralRemakePipelineState & {
  /** 目标市场展示名 */
  targetMarketLabel?: string;
  /** 本地化方案（与 replacePlan 同源） */
  localePlan?: string;
};

type ProgressCb = (state: Partial<OverseasPipelineState>) => void;

/** 出海节点 / 会话已绑定的分镜表；仅作 prefer，不存在则新建出海分镜 */
function resolveOverseasPreferGridId(session: OverseasSession): string {
  const store = useCanvasStore.getState();
  const candidates = [
    String(session.progress?.gridNodeId || "").trim(),
  ];
  const skill = store.nodes.find((n) => n.type === "overseas_localize");
  if (skill) {
    const params = (skill.data as WorkflowNodeData | undefined)?.params ?? {};
    candidates.push(String(params.gridNodeId || "").trim());
  }
  for (const id of candidates) {
    if (!id) continue;
    const node = store.nodes.find((n) => n.id === id && n.type === "storyboard_grid");
    if (node) return id;
  }
  return "";
}

function assertCanvasProjectId(projectId: string) {
  const cur = String(useCanvasStore.getState().projectId || "").trim();
  if (cur && cur !== String(projectId).trim()) {
    throw new Error("项目已切换，请重新打开一键出海");
  }
}

function patchGridParams(gridNodeId: string, patch: Record<string, unknown>) {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === gridNodeId);
  const current = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  useCanvasStore.getState().updateNodeData(gridNodeId, {
    params: { ...current, ...patch },
  });
}

/** 转成爆款会话形状，复用 bootstrap（无替换图） */
function toViralSession(session: OverseasSession): ViralRemakeSession {
  const market = getOverseasMarket(session.targetMarketId);
  const notes = [
    `目标市场：${market.label}（${market.region}）`,
    `对白语言：${market.language}`,
    `视觉人设：${market.castingHint}`,
    session.localeNotes.trim() ? `用户补充：${session.localeNotes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    videoAssetId: session.videoAssetId,
    videoFileUrl: session.videoFileUrl,
    videoTitle: session.videoTitle,
    aspectRatio: session.aspectRatio,
    clarity: session.clarity,
    replaceNotes: notes,
    replaceImageAssetIds: [],
    replaceImageUrls: [],
    autoStart: session.autoStart,
  };
}

function buildOverseasAnalyzePrompt(
  session: OverseasSession,
  frames: ViralRemakeShotFrame[]
): string {
  const market = getOverseasMarket(session.targetMarketId);
  const lines = [
    `目标市场：${market.label} / ${market.region}`,
    `对白语言（硬约束）：${market.language} — 「对话」字段正文必须是该语言；禁止中文对白正文`,
    `视觉与人设方向：${market.castingHint}`,
    `目标画幅：${session.aspectRatio}`,
    `目标清晰度：${session.clarity}`,
    `系统已切出 ${frames.length} 个镜头关键帧（按镜头顺序附图），请据此做「完整出海复刻版」拉片。`,
    "【完整复刻要求】",
    "1. 保留原片镜头数、景别、运镜、节奏与叙事钩子，做成可投放的出海完整版，不是字幕翻译。",
    "2. 人物外貌、整套服饰、场景地标、道具习惯全部本地化；roles[].extractPrompt 写清五官+上装/下装/鞋履/配饰（供面部特写+全身三视图）。",
    "3. 「视频提示词」必须可直接喂给视频模型：本地化人物服饰+场景+运镜，并写明 Spoken dialogue in " +
      market.language +
      " only, no Chinese speech。",
    "4. 「对话」用目标语言，且必须标明说话人：`@Mia: \"...\"`；多人逐句标注；转成英文后说话人与原片位次一致，禁止串角。",
    "5. 「视频提示词」对白处写 `Spoken by @RoleName in " +
      market.language +
      ": \"...\"`。",
    "6. roles[].name 用简短稳定英文/本地名，便于 @ 引用。",
    "7. 每镜「替换指令」：将左边妇女换成 @Mia…；@ 名与 roles 一致。",
    "8. 成片同时参考本镜运镜片段与本地化主体图。",
  ];
  if (session.localeNotes.trim()) {
    lines.push(`【用户补充说明】\n${session.localeNotes.trim()}`);
  }
  frames.forEach((f) => {
    lines.push(
      `镜头${f.index}：${f.startSec.toFixed(2)}s–${f.endSec.toFixed(2)}s（约 ${f.durationLabel}）`
    );
  });
  return lines.join("\n");
}

function buildOverseasReferences(
  session: OverseasSession,
  videoNodeId: string,
  frames: ViralRemakeShotFrame[]
): GenerationReference[] {
  const refs: GenerationReference[] = [];
  const totalDur = frames.length ? Number(frames[frames.length - 1]?.endSec ?? 0) : 0;
  const keyframeOnly = frames.length >= 6 || totalDur > 12.05;
  if (!keyframeOnly && session.videoFileUrl) {
    refs.push({
      nodeId: videoNodeId || "overseas-ref-video",
      type: "video",
      label: "出海参考视频",
      url: session.videoFileUrl,
    });
  }
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
      nodeId: `overseas-kf-${f.index}`,
      type: "image",
      label: `镜头${f.index}关键帧`,
      url: f.fileUrl || f.thumbnailUrl,
    });
  }
  return refs;
}

/** 自动拉片：切镜 + 出海本地化 LLM + 写入分镜表 */
export async function runOverseasAnalyze(opts: {
  projectId: string;
  session: OverseasSession;
  onProgress?: ProgressCb;
}): Promise<OverseasPipelineState> {
  const { projectId, session } = opts;
  assertCanvasProjectId(projectId);
  const market = getOverseasMarket(session.targetMarketId);

  const report = (partial: Partial<OverseasPipelineState>) => {
    opts.onProgress?.(partial);
    if (partial.phase || partial.gridNodeId || partial.message) {
      patchOverseasProgress(projectId, {
        phase: partial.phase,
        gridNodeId: partial.gridNodeId,
        videoNodeId: partial.videoNodeId,
        shotCount: partial.shotCount,
        styleSummary: partial.styleSummary,
        localePlan: partial.localePlan ?? partial.replacePlan,
        message: partial.message,
      });
    }
  };

  report({
    phase: "bootstrap",
    message: `正在搭建出海画布（${market.label}）…`,
    targetMarketLabel: market.label,
  });

  const viralSession = toViralSession(session);
  // 只复用「出海」专用分镜 / 本会话已绑定表；绝不改写用户已有普通分镜
  const preferGridNodeId = resolveOverseasPreferGridId(session);
  const boot = bootstrapViralRemakeCanvas(viralSession, {
    preferGridNodeId: preferGridNodeId || undefined,
    reuseMetaSource: OVERSEAS_META_SOURCE,
    gridLabel: `出海分镜·${market.label}`,
    videoLabel: "出海参考视频",
  });
  if (!boot.gridNodeId) {
    const err = "无法创建出海分镜表节点";
    report({ phase: "error", message: err, error: err });
    throw new Error(err);
  }
  // 确保标签为出海分镜（新建或复用出海表时）
  useCanvasStore.getState().updateNodeData(boot.gridNodeId, { label: `出海分镜·${market.label}` });
  if (boot.videoNodeId) {
    useCanvasStore.getState().updateNodeData(boot.videoNodeId, { label: "出海参考视频" });
  }
  // 尽早打出海 source，避免中断后下次误当成可复用空表被其它流程占用
  {
    const grid = useCanvasStore.getState().nodes.find((n) => n.id === boot.gridNodeId);
    const cur = (grid?.data as WorkflowNodeData | undefined)?.params ?? {};
    const prevMeta = (cur.viralRemakeMeta as Record<string, unknown> | undefined) ?? {};
    patchGridParams(boot.gridNodeId, {
      viralRemakeMeta: {
        ...prevMeta,
        source: OVERSEAS_META_SOURCE,
        targetMarketId: session.targetMarketId,
        targetMarketLabel: market.label,
        aspectRatio: session.aspectRatio,
        clarity: session.clarity,
        videoAssetId: session.videoAssetId,
        videoNodeId: boot.videoNodeId,
      },
    });
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
      // 运镜参考去原片音轨，成片按本地化台词重新生成语音
      stripAudio: true,
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
    message: `已切出 ${frames.length} 镜，正在 AI 本地化拉片（${market.label}）…`,
    shotCount: frames.length,
  });

  let quoteToken: string | undefined;
  let analyzeCredit: number | undefined;
  let creditsEnabled = true;
  try {
    const quote = await getCreditQuote({
      model: STORYBOARD_OVERSEAS_MODEL,
      category: "text",
      canvasTool: STORYBOARD_OVERSEAS_TOOL,
    });
    quoteToken = quote.quoteToken;
    analyzeCredit = Number(quote.total ?? 0);
    creditsEnabled = quote.creditsEnabled !== false;
  } catch {
    /* 无报价仍尝试提交 */
  }

  const workflowId = useCanvasStore.getState().workflowId ?? undefined;
  const content = buildOverseasAnalyzePrompt(session, frames);
  const references = buildOverseasReferences(session, boot.videoNodeId, frames);

  let text = "";
  try {
    const result = await runStoryboardTextJob({
      projectId,
      nodeId: `${boot.gridNodeId}::overseas-analyze`,
      workflowId,
      content,
      model: STORYBOARD_OVERSEAS_MODEL,
      textPromptKind: STORYBOARD_OVERSEAS_KIND,
      canvasTool: STORYBOARD_OVERSEAS_TOOL,
      quoteToken,
      idempotencySuffix: "overseas-analyze",
      references,
    });
    text = result.text;
    toastCreditCharged(result.creditCost, true);
    if (result.creditCost != null) analyzeCredit = result.creditCost;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "出海拉片分析失败";
    report({ phase: "error", message: msg, error: msg, gridNodeId: boot.gridNodeId });
    throw err;
  }

  const parsed = parseViralRemakeContent(text);
  const localePlan = parsed.replacePlan || "";
  const rows = alignRowsWithKeyframes(parsed.rows, frames);
  const indexed = reindexTableRows(rows);

  // 出海拉片报价 + 成片按「有参考视频」档（分段运镜 + 主体身份，对齐 OiiOii）
  const cost = await estimateViralRemakeBatchCost({
    shotCount: indexed.length,
    session: viralSession,
    analyzeCanvasTool: STORYBOARD_OVERSEAS_TOOL,
    analyzeModel: STORYBOARD_OVERSEAS_MODEL,
    withRefVideo: true,
  });
  if (cost.creditsEnabled === false) creditsEnabled = false;

  patchGridParams(boot.gridNodeId, {
    shots: indexed,
    subjects: parsed.subjects,
    viewMode: "shots",
    selectedShotId: indexed[0]?.id ?? "",
    // 写入兼容字段，复用成片 / 主体图链路；source 标记避免打开爆款向导
    viralRemakeMeta: {
      source: OVERSEAS_META_SOURCE,
      styleSummary: parsed.styleSummary,
      replacePlan: localePlan,
      localePlan,
      targetMarketId: session.targetMarketId,
      targetMarketLabel: market.label,
      aspectRatio: session.aspectRatio,
      clarity: session.clarity,
      videoAssetId: session.videoAssetId,
      videoNodeId: boot.videoNodeId,
      replaceImageAssetIds: [],
    },
  });

  if (parsed.warnings.length) {
    toast.message(parsed.warnings.slice(0, 2).join("；"));
  }

  const state: OverseasPipelineState = {
    phase: "confirm",
    message: `本地化拉片完成：${indexed.length} 镜（${market.label}）。可生成主体图后确认成片。`,
    gridNodeId: boot.gridNodeId,
    videoNodeId: boot.videoNodeId,
    shotCount: indexed.length,
    styleSummary: parsed.styleSummary,
    replacePlan: localePlan,
    localePlan,
    targetMarketLabel: market.label,
    generatedVideoNodeIds: [],
    analyzeCredit: analyzeCredit ?? cost.analyzeCredit,
    videoCreditEach: cost.videoCreditEach,
    estimatedVideoTotal: cost.estimatedVideoTotal,
    videoModelName: cost.videoModelName,
    creditsEnabled,
  };
  report(state);
  markOverseasSessionStarted(projectId);
  toast.success(`出海拉片完成：${indexed.length} 个镜头 · ${market.label}`);
  return state;
}

function coerceAspect(raw: string | undefined): ViralRemakeAspect {
  const v = String(raw || "").trim();
  if (v === "16:9" || v === "1:1" || v === "9:16") return v;
  return "9:16";
}

function coerceClarity(raw: string | undefined): ViralRemakeClarity {
  const v = String(raw || "").trim();
  if (v === "720p" || v === "1080p") return v;
  return "1080p";
}

/** 把现有分镜行压成文本，供本地化改写 */
function serializeTableForLocalize(rows: StoryboardTableRow[]): string {
  return rows
    .map((r) =>
      [
        `镜头${r.index} ${r.shotNo || ""} duration=${r.duration || ""}`.trim(),
        r.description ? `画面：${r.description}` : "",
        r.shotSize ? `景别：${r.shotSize}` : "",
        r.lighting ? `灯光：${r.lighting}` : "",
        r.dialogue ? `对白：${r.dialogue}` : "",
        r.sfx ? `音效：${r.sfx}` : "",
        r.cameraPrompt ? `运镜：${r.cameraPrompt}` : "",
        r.videoPrompt ? `视频提示词：${r.videoPrompt}` : "",
        r.replaceCue ? `替换指令：${r.replaceCue}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function buildOverseasRewritePrompt(
  session: Pick<OverseasSession, "targetMarketId" | "localeNotes" | "aspectRatio" | "clarity">,
  tableText: string
): string {
  const market = getOverseasMarket(session.targetMarketId);
  const lines = [
    `目标市场：${market.label} / ${market.region}`,
    `对白语言（硬约束）：${market.language} — 「对话」字段正文必须是该语言；禁止中文对白正文`,
    `视觉与人设方向：${market.castingHint}`,
    `目标画幅：${session.aspectRatio}`,
    `目标清晰度：${session.clarity}`,
    "下面是已有分镜表。请按目标市场改写人物外貌/服饰/场景/对白/视频提示词，保持镜头数量与顺序，不要删镜或新增无关镜。",
    "「对话」用目标语言并标明说话人：`@Name: \"...\"`。",
    "「视频提示词」须可直接喂视频模型，并写 Spoken dialogue in " +
      market.language +
      " only, no Chinese speech。",
  ];
  if (session.localeNotes.trim()) {
    lines.push(`【用户补充说明】\n${session.localeNotes.trim()}`);
  }
  lines.push("【现有分镜】\n" + tableText);
  return lines.join("\n");
}

/**
 * Agent `storyboard_overseas_localize`：已有分镜则改写；空表且有参考视频则切镜拉片。
 */
export async function runOverseasLocalizeForAgent(opts: {
  projectId: string;
  gridNodeId: string;
  targetMarketId: string;
  localeNotes?: string;
  aspectRatio?: string;
  clarity?: string;
  video?: {
    nodeId: string;
    assetId: string;
    fileUrl: string;
    title?: string;
  };
}): Promise<{ shotCount: number; marketLabel: string }> {
  const rawMarket = String(opts.targetMarketId || "").trim();
  const marketId = (OVERSEAS_MARKETS.some((m) => m.id === rawMarket)
    ? rawMarket
    : OVERSEAS_MARKETS.find((m) => m.id === rawMarket.toUpperCase())?.id) as
    | string
    | undefined;
  if (!marketId) {
    throw new Error("未知目标市场，请使用 US / JP / KR / SEA / EU / MENA / BR / IN");
  }
  const market = getOverseasMarket(marketId);
  const aspectRatio = coerceAspect(opts.aspectRatio);
  const clarity = coerceClarity(opts.clarity);
  const localeNotes = String(opts.localeNotes || "").trim();
  const grid = useCanvasStore.getState().nodes.find((n) => n.id === opts.gridNodeId);
  if (!grid || grid.type !== "storyboard_grid") {
    throw new Error("请选择分镜表节点");
  }
  const params = ((grid.data as WorkflowNodeData | undefined)?.params ?? {}) as Record<
    string,
    unknown
  >;
  const prevRows = parseTableRowsParam(params.shots);

  if (prevRows.length > 0) {
    let quoteToken: string | undefined;
    try {
      const quote = await getCreditQuote({
        model: STORYBOARD_OVERSEAS_MODEL,
        category: "text",
        canvasTool: STORYBOARD_OVERSEAS_TOOL,
      });
      quoteToken = quote.quoteToken;
    } catch {
      /* 无报价仍尝试 */
    }
    const content = buildOverseasRewritePrompt(
      {
        targetMarketId: market.id,
        localeNotes,
        aspectRatio,
        clarity,
      },
      serializeTableForLocalize(prevRows)
    );
    const result = await runStoryboardTextJob({
      projectId: opts.projectId,
      nodeId: `${opts.gridNodeId}::overseas-rewrite`,
      workflowId: useCanvasStore.getState().workflowId ?? undefined,
      content,
      model: STORYBOARD_OVERSEAS_MODEL,
      textPromptKind: STORYBOARD_OVERSEAS_KIND,
      canvasTool: STORYBOARD_OVERSEAS_TOOL,
      quoteToken,
      idempotencySuffix: "overseas-rewrite",
    });
    const parsed = parseViralRemakeContent(result.text);
    if (!parsed.rows.length) {
      throw new Error(parsed.warnings[0] || "出海本地化未返回分镜行");
    }
    const merged = reindexTableRows(mergeTableRowsPreservingIds(prevRows, parsed.rows));
    const localePlan = parsed.replacePlan || "";
    const prevMeta =
      (params.viralRemakeMeta as Record<string, unknown> | undefined) ?? {};
    patchGridParams(opts.gridNodeId, {
      shots: merged,
      subjects: parsed.subjects ?? params.subjects,
      viralRemakeMeta: {
        ...prevMeta,
        source: OVERSEAS_META_SOURCE,
        styleSummary: parsed.styleSummary,
        replacePlan: localePlan,
        localePlan,
        targetMarketId: market.id,
        targetMarketLabel: market.label,
        aspectRatio,
        clarity,
      },
    });
    useCanvasStore.getState().scheduleAutoSave();
    toastCreditCharged(result.creditCost, true);
    return { shotCount: merged.length, marketLabel: market.label };
  }

  if (!opts.video?.assetId) {
    throw new Error("分镜表还是空的：请先拉片，或把参考视频连到分镜表 ref_in");
  }

  const session: OverseasSession = {
    videoAssetId: opts.video.assetId,
    videoFileUrl: opts.video.fileUrl,
    videoTitle: opts.video.title || "出海参考视频",
    aspectRatio,
    clarity,
    targetMarketId: market.id,
    localeNotes,
    autoStart: false,
    progress: { gridNodeId: opts.gridNodeId, videoNodeId: opts.video.nodeId },
  };
  const state = await runOverseasAnalyze({
    projectId: opts.projectId,
    session,
  });
  return {
    shotCount: state.shotCount || 0,
    marketLabel: market.label,
  };
}

/** 补全提示词：强调本地化方案 */
export async function runOverseasFillPrompts(opts: {
  gridNodeId: string;
  onProgress?: ProgressCb;
}): Promise<void> {
  // 复用爆款补全；extraContext 由 viralRemakeFill 读 replacePlan，出海已写入 localePlan→replacePlan
  await runViralRemakeFillPrompts({
    gridNodeId: opts.gridNodeId,
    onProgress: opts.onProgress,
  });
}

export {
  getViralRemakeSubjectReadiness as getOverseasSubjectReadiness,
  runViralRemakeSubjectImages as runOverseasSubjectImages,
  runViralRemakeBatchVideos as runOverseasBatchVideos,
};
