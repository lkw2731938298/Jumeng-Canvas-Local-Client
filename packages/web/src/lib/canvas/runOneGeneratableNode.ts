/**
 * 单节点生成（无 Overlay UI）：批量运行与单点「生成」共用此路径。
 */
import { ApiError } from "@/lib/api/client";
import { listModels, type CanvasModel } from "@/lib/api/models";
import { fetchNodeText, saveNodeText } from "@/lib/api/nodeText";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { generateFromTextNode } from "@/lib/api/textGeneration";
import { clipTextNodeGeneratedContent } from "@/lib/canvas/textNodeGenerationLimit";
import { getCreditQuote } from "@/lib/api/credits";
import { pollGenerationJob } from "@/lib/api/workflows";
import {
  applyMediaJobResultToNode,
  applyTextJobResultToNode,
  type PolledGenerationJob,
} from "@/lib/canvas/applyMediaJobResult";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import { newIdempotencyKey } from "@/lib/canvas/generationCreditHelpers";
import {
  hasVideoReferenceForBilling,
  withRefVideoBillingOption,
} from "@/lib/canvas/refVideoBilling";
import { withMaterialUsageBillingOptions } from "@/lib/canvas/materialUsageBilling";
import { buildModelOptions, getNodeModelCategory } from "@/lib/canvas/nodeModelRouting";
import { getEditorConfig, isEditorNodeType } from "@/lib/canvas/nodeEditorConfig";
import {
  buildMaterialSlots,
  collectGenerationReferences,
  collectMentionedReferences,
  collectVideoR2vReferences,
  isVideoR2vModel,
  resolveAllReferences,
  resolveMentionsInPrompt,
  stripMentionTokens,
  validateGenerationReferences,
} from "@/lib/canvas/nodeMaterialSlots";
import { resolvePreferredModel } from "@/lib/canvas/lastSelectedModel";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import {
  hasMeaningfulGenerationPrompt,
  resolveMediaPromptForGeneration,
} from "@/lib/canvas/resolveMediaPrompt";
import { mergeInlineDrawingForGeneration } from "@/lib/canvas/inlineImageDrawing";
import { DEFAULT_VISUAL_STYLE_ID } from "@/lib/canvas/renderToolPrompt";
import {
  audioGenParamsToGenerationOptions,
  normalizeAudioGenerationParams,
} from "@/lib/canvas/audioGenerationParams";
import { resolveAudioVoiceFromParams } from "@/lib/canvas/audioVoiceStyles";
import { isMinimaxMusicModel } from "@/lib/canvas/minimaxMusicParams";
import { isSunoCustomModel } from "@/lib/canvas/sunoMusicParams";
import { resolveTextPromptKind } from "@/lib/canvas/useTextPromptTools";
import {
  collectI2vFrameReferences,
  getVideoFrameInputSpec,
  validateI2vFrameReferences,
} from "@/lib/canvas/videoFrameReferences";
import { getJobStatus } from "@/lib/api/workflows";
import { markNodeGenerationError } from "@/lib/canvas/markNodeGenerationError";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";

export type RunOneOutcome =
  | { ok: true; mediaNodeId?: string }
  | { ok: false; error: string; code?: string | null; abortBatch?: boolean };

/** 提交成功但尚未轮询完成时，供层内并行 await */
export type SubmitOneOutcome =
  | {
      ok: true;
      pending?: { jobId: number | string; kind: "text" | "media"; model: string; nodeType: string };
      /** 轮询完成后已写入媒体的节点，供聊天框回传 */
      mediaNodeId?: string;
    }
  | { ok: false; error: string; code?: string | null; abortBatch?: boolean };

const modelCache = new Map<string, CanvasModel[]>();

async function loadModels(category: string): Promise<CanvasModel[]> {
  const cached = modelCache.get(category);
  if (cached) return cached;
  const list = await listModels({ category });
  modelCache.set(category, list);
  return list;
}

/** 解析节点模型名与目录元数据（优先 params.model，否则最近选用/列表首项） */
export async function resolveNodeModel(
  nodeType: string,
  params: Record<string, unknown>
): Promise<{ model: string; canvasModel: CanvasModel | undefined } | null> {
  const category = getNodeModelCategory(nodeType);
  if (!category) return null;
  const apiModels = await loadModels(category);
  const mockUi = process.env.NEXT_PUBLIC_AI_MOCK_ENABLED === "true";
  const configured = apiModels.filter((m) => {
    if (m.isImplemented === false) return false;
    if (mockUi) return true;
    return m.isConfigured !== false && m.isAvailable;
  });
  const pool = configured.length > 0 ? configured : apiModels;
  if (pool.length === 0) return null;

  // 节点已写入的 model 优先（批量成片预设），避免因密钥未配而回退到纯 i2v
  const stored = String(params.model ?? "").trim();
  if (stored) {
    const hit = apiModels.find((m) => m.name === stored) ?? pool.find((m) => m.name === stored);
    if (hit) return { model: stored, canvasModel: hit };
  }

  const options = buildModelOptions(pool, [category], []);
  const preferred = resolvePreferredModel(category, options);
  if (!preferred) return null;
  const canvasModel = apiModels.find((m) => m.name === preferred) ?? pool[0];
  return { model: preferred, canvasModel };
}

function readGenerationOptions(params: Record<string, unknown>): GenerationOptions {
  const raw = params.generationOptions;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as GenerationOptions;
  }
  return {};
}

async function resolvePromptDraft(
  projectId: string,
  nodeId: string,
  nodeType: string,
  params: Record<string, unknown>,
  promptKey: string
): Promise<string> {
  const local = String(params[promptKey] ?? "").trim();
  if (local) return local;
  if (nodeType !== "text_input") return "";
  try {
    const record = await fetchNodeText(projectId, nodeId);
    return String(record?.content ?? "").trim();
  } catch {
    return "";
  }
}

/** 轮询已入队任务并回写节点（与 submit 分离，便于层内并行等待） */
export async function completePendingGeneratableNode(opts: {
  projectId: string;
  nodeId: string;
  jobId: number | string;
  kind: "text" | "media";
  model: string;
  nodeType: string;
}): Promise<RunOneOutcome> {
  const store = useCanvasStore.getState();
  try {
    const maxWaitMs = opts.kind === "media" && opts.nodeType === "video_input" ? 1_500_000 : 900_000;
    const polled = await pollGenerationJob(opts.jobId, { maxWaitMs });
    if (polled.status !== "succeeded") {
      const errMsg = polled.errorMessage || "生成失败";
      markNodeGenerationError(opts.nodeId, errMsg);
      store.endNodeGeneration(opts.nodeId);
      return { ok: false, error: errMsg };
    }
    if (opts.kind === "text") {
      const job = {
        status: polled.status,
        resultText: polled.resultText,
        errorMessage: polled.errorMessage,
      } as PolledGenerationJob;
      const applied = applyTextJobResultToNode(
        opts.nodeId,
        opts.nodeType,
        job,
        opts.jobId,
        opts.model
      );
      if (applied) {
        const text = clipTextNodeGeneratedContent(String(job.resultText ?? "").trim());
        if (text) await saveNodeText(opts.projectId, opts.nodeId, text, opts.model);
      }
      return { ok: true };
    }
    const full = (await getJobStatus(opts.jobId)) as PolledGenerationJob;
    await applyMediaJobResultToNode(opts.projectId, opts.nodeId, opts.nodeType, full, opts.jobId);
    // 媒体落节点后带回 nodeId，供会话聊天框展示素材
    return { ok: true, mediaNodeId: opts.nodeId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "生成失败";
    markNodeGenerationError(opts.nodeId, errMsg);
    store.endNodeGeneration(opts.nodeId);
    return {
      ok: false,
      error: errMsg,
    };
  }
}

/**
 * 对单个可编辑节点：报价 → 提交；默认会轮询完成。
 * `deferPoll: true` 时 pending 立即返回，由 completePendingGeneratableNode 并行等待。
 * 遇 RATE_LIMITED 由调用方重试；INSUFFICIENT_CREDITS 标记 abortBatch。
 */
export async function runOneGeneratableNode(opts: {
  projectId: string;
  nodeId: string;
  batchId: string;
  quoteToken?: string;
  /** 为 true 时提交成功后不轮询，返回 pending 供层内并行 */
  deferPoll?: boolean;
}): Promise<SubmitOneOutcome> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === opts.nodeId);
  if (!node || !isEditorNodeType(node.type)) {
    return { ok: false, error: "节点不可生成" };
  }
  const config = getEditorConfig(node.type);
  if (!config) return { ok: false, error: "节点配置缺失" };

  const params = (node.data.params ?? {}) as Record<string, unknown>;
  const modelInfo = await resolveNodeModel(node.type, params);
  if (!modelInfo) {
    return { ok: false, error: "无可用模型" };
  }

  const { model, canvasModel } = modelInfo;
  const promptKey = config.promptParamKey;
  const draft = await resolvePromptDraft(
    opts.projectId,
    opts.nodeId,
    node.type,
    params,
    promptKey
  );
  const edges = store.edges;
  const materialSlots = buildMaterialSlots(opts.nodeId, edges, store.nodes);
  const hasUpstreamMedia = materialSlots.some((s) => s.type === "image" || s.type === "video");
  if (!draft && !hasUpstreamMedia) {
    return { ok: false, error: "缺少提示词或上游素材" };
  }

  const isTextNode = node.type === "text_input";
  const isImageNode = node.type === "image_input";
  const isVideoNode = node.type === "video_input";
  const presets = getModelGenerationPresets(canvasModel);
  const baseGenerationOptions = normalizeGenerationOptions(
    presets,
    {
      ...defaultGenerationOptions(presets),
      ...readGenerationOptions(params),
    }
  );
  const visualStyleId = String(params.visualStyleId ?? DEFAULT_VISUAL_STYLE_ID);

  store.beginNodeGeneration(opts.nodeId);
  store.setNodeStatus(opts.nodeId, "running");
  store.updateNodeParam(opts.nodeId, "generationJobId", "");

  const idempotencyKey = `${opts.batchId}-${newIdempotencyKey(opts.nodeId)}`;

  try {
    const allRefs = await resolveAllReferences(
      opts.projectId,
      materialSlots,
      useCanvasStore.getState().nodes,
      edges
    );

    let references = collectGenerationReferences(draft, allRefs);
    const apiModels = canvasModel ? [canvasModel] : [];
    const i2vSpec =
      isVideoNode && model ? getVideoFrameInputSpec(model, apiModels) : null;

    if (i2vSpec?.isFrameModel) {
      const frameCollection = collectI2vFrameReferences(
        draft,
        allRefs,
        i2vSpec.supportsLastFrame
      );
      const validationError = validateI2vFrameReferences(
        frameCollection,
        i2vSpec.supportsLastFrame
      );
      if (validationError) {
        markNodeGenerationError(opts.nodeId, validationError);
        store.endNodeGeneration(opts.nodeId);
        return { ok: false, error: validationError };
      }
      references = frameCollection.references;
    } else if (isVideoNode && isVideoR2vModel(canvasModel)) {
      references = collectVideoR2vReferences(draft, allRefs);
    }

    const referenceValidationError = validateGenerationReferences(draft, allRefs, references);
    if (referenceValidationError) {
      markNodeGenerationError(opts.nodeId, referenceValidationError);
      store.endNodeGeneration(opts.nodeId);
      return { ok: false, error: referenceValidationError };
    }

    // 多模态：参考视频计费档 + MiniMax-H3 素材用量字段
    const modelPricing = canvasModel?.parameters?.pricing as Record<string, unknown> | undefined;
    const generationOptions = withMaterialUsageBillingOptions(
      modelPricing,
      withRefVideoBillingOption(
        presets,
        baseGenerationOptions,
        hasVideoReferenceForBilling(draft, materialSlots, references)
      ),
      draft,
      materialSlots,
      store.nodes,
      references,
      model
    );

    // 始终按本次最终 generationOptions 重签 quoteToken，避免调用方缓存凭证与素材用量不一致
    let quoteToken = opts.quoteToken;
    try {
      const quote = await getCreditQuote({
        model,
        category: config.category,
        generationOptions,
      });
      quoteToken = quote.quoteToken;
    } catch {
      /* 无 quote 时沿用传入凭证或走 pricingVersion 兜底 */
    }

    let promptForApi: string;
    if (isTextNode) {
      const { resolvedPrompt } = resolveMentionsInPrompt(draft, allRefs);
      promptForApi = stripMentionTokens(resolvedPrompt, allRefs) || resolvedPrompt.trim();
    } else {
      const isVideo = node.type === "video_input";
      const isImage = node.type === "image_input";
      if (isVideo || isImage) {
        const resolved = await resolveMediaPromptForGeneration({
          draft,
          references: allRefs,
        });
        promptForApi = resolved.prompt;
      } else {
        promptForApi = draft.trim();
      }
      if (
        node.type === "audio_input" &&
        model.startsWith("rh_audio_extract") &&
        !promptForApi
      ) {
        promptForApi =
          model === "rh_audio_extract_other"
            ? "从参考视频提取伴奏与环境音（消除人声）"
            : "从参考视频提取纯人声（Vocals）";
      }
      if (isVideo && !hasMeaningfulGenerationPrompt(promptForApi)) {
        const errMsg = "请填写视频提示词，或连接文本节点提供描述";
        markNodeGenerationError(opts.nodeId, errMsg);
        store.endNodeGeneration(opts.nodeId);
        return { ok: false, error: errMsg };
      }
    }

    const submitOptions = { idempotencyKey, quoteToken };

    if (isTextNode) {
      const textPromptKind = resolveTextPromptKind(params.textPromptKind);
      const result = await generateFromTextNode(
        {
          projectId: opts.projectId,
          nodeId: opts.nodeId,
          workflowId: store.workflowId ?? undefined,
          content: promptForApi,
          model,
          ...(textPromptKind ? { textPromptKind } : {}),
          references,
          submitSource: "auto",
        },
        submitOptions
      );

      if (result.status === "awaiting_approval") {
        store.updateNodeParam(opts.nodeId, "generationJobId", result.jobId);
        store.setNodeStatus(opts.nodeId, "idle");
        store.endNodeGeneration(opts.nodeId);
        return { ok: false, error: result.message || "已提交审批，需创建者确认" };
      }

      if (result.status === "pending" && result.jobId) {
        store.updateNodeParam(opts.nodeId, "generationJobId", result.jobId);
        if (opts.deferPoll) {
          return {
            ok: true,
            pending: {
              jobId: result.jobId,
              kind: "text",
              model,
              nodeType: node.type,
            },
          };
        }
        return completePendingGeneratableNode({
          projectId: opts.projectId,
          nodeId: opts.nodeId,
          jobId: result.jobId,
          kind: "text",
          model,
          nodeType: node.type,
        });
      }

      if (result.status === "succeeded" && result.content) {
        const content = clipTextNodeGeneratedContent(result.content);
        store.updateNodeParam(opts.nodeId, promptKey, content);
        if (result.jobId) store.updateNodeParam(opts.nodeId, "generationJobId", result.jobId);
        await saveNodeText(opts.projectId, opts.nodeId, content, model);
        store.setNodeStatus(opts.nodeId, "success");
        store.endNodeGeneration(opts.nodeId);
        return { ok: true };
      }

      markNodeGenerationError(opts.nodeId, "文本生成失败");
      store.endNodeGeneration(opts.nodeId);
      return { ok: false, error: "文本生成失败" };
    }

    if (!config.assetCategory || !config.urlParamKey) {
      markNodeGenerationError(opts.nodeId, "媒体节点配置缺失");
      store.endNodeGeneration(opts.nodeId);
      return { ok: false, error: "媒体节点配置缺失" };
    }

    const selfMentioned = collectMentionedReferences(draft, allRefs).some(
      (r) => r.nodeId === opts.nodeId
    );
    const isVoiceCloneModel = node.type === "audio_input" && model === "cosyvoice_clone";
    const isVoiceTtsModel = node.type === "audio_input" && model === "cosyvoice_tts";
    const isAudioSeparateModel =
      node.type === "audio_input" && model.startsWith("rh_audio_extract");
    const isMinimaxMusic = node.type === "audio_input" && isMinimaxMusicModel(model);
    const isSunoMusic = node.type === "audio_input" && isSunoCustomModel(model);
    const musicLyrics =
      typeof params.musicLyrics === "string" ? params.musicLyrics.trim() : "";
    const musicTitle =
      typeof params.musicTitle === "string" ? params.musicTitle.trim() : "";
    const musicTags =
      typeof params.musicTags === "string" ? params.musicTags.trim() : "";
    // 图片 / 声音复刻：提交本节点媒体；分离音频另取参考视频
    const shouldPassSourceUrl = isImageNode || selfMentioned || isVoiceCloneModel;
    let resolvedSourceUrl = shouldPassSourceUrl
      ? await resolveNodeMediaUrl(opts.projectId, params, config.urlParamKey)
      : undefined;
    if (isAudioSeparateModel && !resolvedSourceUrl) {
      const videoRef = references.find((r) => r.type === "video" && r.url?.trim());
      resolvedSourceUrl = videoRef?.url?.trim() || undefined;
    }
    // 批量运行与编辑器提交保持一致：先把节点内笔迹合并到上传原图。
    const sourceUrl =
      isImageNode && resolvedSourceUrl
        ? await mergeInlineDrawingForGeneration({
            projectId: opts.projectId,
            nodeId: opts.nodeId,
            nodeParams: params,
            sourceUrl: resolvedSourceUrl,
          })
        : resolvedSourceUrl;

    // 语音合成：从节点 params 透传音色；声音复刻写入展示名供落库
    const voiceResolved = isVoiceTtsModel
      ? resolveAudioVoiceFromParams(params)
      : null;
    const cloneDisplayName = isVoiceCloneModel
      ? promptForApi.replace(/\s+/g, " ").trim().slice(0, 24) || "复刻音色"
      : "";
    const audioCtrlOpts =
      isVoiceTtsModel || isVoiceCloneModel
        ? audioGenParamsToGenerationOptions(normalizeAudioGenerationParams(params.audioGenParams))
        : {};

    const result = await generateFromMediaNode(
      {
        projectId: opts.projectId,
        nodeId: opts.nodeId,
        workflowId: store.workflowId ?? undefined,
        category: config.assetCategory,
        prompt: promptForApi,
        model,
        references,
        sourceUrl: sourceUrl || undefined,
        generationOptions: {
          ...generationOptions,
          ...(voiceResolved
            ? {
                voice: voiceResolved.voiceId,
                voiceId: voiceResolved.voiceId,
                voiceKind: voiceResolved.kind,
                ttsModel: voiceResolved.ttsModel,
              }
            : {}),
          ...(cloneDisplayName ? { cloneDisplayName } : {}),
          ...audioCtrlOpts,
          ...(isMinimaxMusic
            ? {
                ...(musicLyrics ? { lyrics: musicLyrics } : {}),
                ...(promptForApi.trim() ? { musicPrompt: promptForApi.trim() } : {}),
              }
            : {}),
          ...(isSunoMusic
            ? {
                ...(musicTitle ? { title: musicTitle } : {}),
                ...(musicTags ? { tags: musicTags } : {}),
                ...(promptForApi.trim() ? { lyrics: promptForApi.trim() } : {}),
              }
            : {}),
        },
        visualStyleId: visualStyleId || DEFAULT_VISUAL_STYLE_ID,
        submitSource: "auto",
      },
      submitOptions
    );

    if (result.status === "awaiting_approval") {
      store.updateNodeParam(opts.nodeId, "generationJobId", result.jobId);
      store.setNodeStatus(opts.nodeId, "idle");
      store.endNodeGeneration(opts.nodeId);
      return { ok: false, error: result.message || "已提交审批，需创建者确认" };
    }

    if (result.status === "pending" && result.jobId) {
      store.updateNodeParam(opts.nodeId, "generationJobId", result.jobId);
      if (opts.deferPoll) {
        return {
          ok: true,
          pending: {
            jobId: result.jobId,
            kind: "media",
            model,
            nodeType: node.type,
          },
        };
      }
      return completePendingGeneratableNode({
        projectId: opts.projectId,
        nodeId: opts.nodeId,
        jobId: result.jobId,
        kind: "media",
        model,
        nodeType: node.type,
      });
    }

    if (result.status === "succeeded") {
      const applied = await applyMediaJobResultToNode(
        opts.projectId,
        opts.nodeId,
        node.type,
        {
          assetId: result.assetId,
          resultUrl: result.resultUrl,
          outputAssets: result.outputAssets,
        },
        result.jobId ?? ""
      );
      if (!applied) {
        store.setNodeStatus(opts.nodeId, "success");
        store.endNodeGeneration(opts.nodeId);
      }
      return { ok: true, mediaNodeId: opts.nodeId };
    }

    markNodeGenerationError(opts.nodeId, result.message || "媒体生成失败");
    store.endNodeGeneration(opts.nodeId);
    return { ok: false, error: result.message || "媒体生成失败" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "生成失败";
    markNodeGenerationError(opts.nodeId, errMsg);
    store.endNodeGeneration(opts.nodeId);
    if (err instanceof ApiError) {
      const abortBatch =
        err.code === "INSUFFICIENT_CREDITS" || err.status === 402;
      return {
        ok: false,
        error: err.message || "生成失败",
        code: err.code,
        abortBatch,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "生成失败",
    };
  }
}

/** 供批量预检：节点是否具备基本可跑条件（不调上游） */
export async function previewNodeRunnable(
  projectId: string,
  nodeId: string
): Promise<{ runnable: boolean; reason?: string; model?: string; category?: string; generationOptions?: Record<string, string> }> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || !isEditorNodeType(node.type)) {
    return { runnable: false, reason: "非可生成节点" };
  }
  const config = getEditorConfig(node.type);
  if (!config) return { runnable: false, reason: "配置缺失" };
  const params = (node.data.params ?? {}) as Record<string, unknown>;
  const modelInfo = await resolveNodeModel(node.type, params);
  if (!modelInfo) return { runnable: false, reason: "无可用模型" };

  const draft = await resolvePromptDraft(
    projectId,
    nodeId,
    node.type,
    params,
    config.promptParamKey
  );
  const slots = buildMaterialSlots(nodeId, store.edges, store.nodes);
  const hasUpstreamMedia = slots.some((s) => s.type === "image" || s.type === "video");
  if (!draft && !hasUpstreamMedia) {
    return { runnable: false, reason: "缺少提示词或上游素材" };
  }

  const presets = getModelGenerationPresets(modelInfo.canvasModel);
  const generationOptions = normalizeGenerationOptions(presets, {
    ...defaultGenerationOptions(presets),
    ...readGenerationOptions(params),
  });

  return {
    runnable: true,
    model: modelInfo.model,
    category: config.category,
    generationOptions,
  };
}

export function clearBatchModelCache(): void {
  modelCache.clear();
}
