import { apiFetch, ApiError } from "./client";
import type { GenerationReference } from "./textGeneration.types";
import type { AssetCategory } from "./assets";
import { isLocalDesktop } from "@/lib/localDesktop";
import { pickCanvasAspectFromOptions, pickCanvasClarityFromOptions } from "@/lib/local/presetTemplates";

const VIDEO_GENERATE_TIMEOUT_MS = 25 * 60 * 1000;
/** 人声分离等上游音频任务可能较久 */
const AUDIO_GENERATE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_GENERATE_TIMEOUT_MS = 8 * 60 * 1000;
const RECOVER_POLL_INTERVAL_MS = 3000;
const RECOVER_POLL_TIMEOUT_MS = 3 * 60 * 1000;

export interface GenerationJobStatus {
  id: number;
  status: string;
  assetId?: string;
  resultUrl?: string;
  outputAssets?: Array<{ url?: string; id?: string; assetId?: string }>;
  errorMessage?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchLatestNodeJob(
  projectId: string,
  nodeId: string
): Promise<GenerationJobStatus | null> {
  try {
    const url = `/api/v1/generations/latest/by-node?projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(nodeId)}`;
    return await apiFetch<GenerationJobStatus>(url);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** After proxy disconnect, backend may still finish — poll latest node job. */
export async function recoverLatestNodeGeneration(
  projectId: string,
  nodeId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<MediaGenerationResponse | null> {
  const deadline = Date.now() + (options?.timeoutMs ?? RECOVER_POLL_TIMEOUT_MS);
  const intervalMs = options?.intervalMs ?? RECOVER_POLL_INTERVAL_MS;

  while (Date.now() < deadline) {
    const job = await fetchLatestNodeJob(projectId, nodeId);
    if (!job) return null;

    if (job.status === "succeeded") {
      const assetId = job.assetId ?? job.outputAssets?.[0]?.assetId ?? job.outputAssets?.[0]?.id;
      const resultUrl = job.resultUrl ?? job.outputAssets?.[0]?.url;
      return {
        jobId: job.id,
        status: "succeeded",
        assetId: assetId ? String(assetId) : undefined,
        resultUrl: resultUrl ? String(resultUrl) : undefined,
        outputAssets: job.outputAssets,
        message: `任务已完成（#${job.id}）`,
      };
    }

    if (job.status === "failed") {
      return null;
    }

    await sleep(intervalMs);
  }

  return null;
}

function shouldAttemptRecovery(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof ApiError) {
    return err.status === 502 || err.status === 504 || err.message.includes("无法连接");
  }
  return false;
}

export interface MediaGenerationRequest {
  projectId: string;
  nodeId: string;
  workflowId?: string;
  /** `tool` = admin「其他模型」分类，用于多角度等画布工具 */
  category: AssetCategory | "tool";
  prompt: string;
  model: string;
  references?: GenerationReference[];
  sourceUrl?: string;
  generationOptions?: Record<string, string>;
  visualStyleId?: string;
  /** 写入项目素材库时的子分类（如 人物/场景/物品） */
  assetSubcategory?: string;
  /** 写入项目素材库时的标题 */
  assetTitle?: string;
  /** 管理端生成日志：分镜表等批量场景传 auto */
  submitSource?: "manual" | "auto" | "dedupe";
  /** 画布工具固定算力（多角度/打光/全景等） */
  canvasTool?: string;
  /** 画面编辑：源视频素材 ID（服务端优先 OSS 内网校验时长） */
  sourceAssetId?: string;
}

export interface MediaGenerationResponse {
  /** 云端为数字 job id；本地可为素材 id 字符串 */
  jobId: number | string;
  status: "pending" | "awaiting_approval" | "succeeded" | "failed";
  resultUrl?: string;
  assetId?: string;
  /** 多张生成时含全部产物；首张与 assetId 一致 */
  outputAssets?: Array<{ url?: string; id?: string; assetId?: string }>;
  message?: string;
  creditCost?: number;
}

export interface GenerationSubmitOptions {
  idempotencyKey?: string;
  quoteToken?: string;
  expectedPricingVersion?: number;
  /** 用户停止助手时中断本地/云端提交与轮询 */
  signal?: AbortSignal;
  /**
   * 上游已出结果、本机落盘开始前回调（可先把远程 URL / dataURL 画到节点，缩短等待感）。
   * 落盘成功后仍会以本地 asset URL 再写一次。
   */
  onUpstreamPreview?: (preview: { url?: string; b64?: string }) => void;
}

/** 从 PRICING_CHANGED 错误体取出可重试的报价凭证与选项快照 */
export function pricingChangedRetryPayload(err: unknown): {
  quoteToken: string;
  optionSnapshot: Record<string, string>;
} | null {
  if (!(err instanceof ApiError) || err.code !== "PRICING_CHANGED") return null;
  const raw = (err.content ?? err.detail) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const quoteToken = typeof raw.quoteToken === "string" ? raw.quoteToken.trim() : "";
  if (!quoteToken) return null;
  const snap = raw.optionSnapshot;
  const optionSnapshot =
    snap && typeof snap === "object" && !Array.isArray(snap)
      ? Object.fromEntries(
          Object.entries(snap as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")])
        )
      : {};
  return { quoteToken, optionSnapshot };
}

async function postMediaGenerate(
  request: MediaGenerationRequest,
  options?: GenerationSubmitOptions,
  signal?: AbortSignal
): Promise<MediaGenerationResponse> {
  return apiFetch<MediaGenerationResponse>("/api/v1/media/generate", {
    method: "POST",
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
    body: JSON.stringify({
      projectId: request.projectId,
      nodeId: request.nodeId,
      workflowId: request.workflowId,
      category: request.category,
      prompt: request.prompt,
      model: request.model,
      references: request.references ?? [],
      sourceUrl: request.sourceUrl,
      generationOptions: request.generationOptions ?? {},
      ...(request.visualStyleId ? { visualStyleId: request.visualStyleId } : {}),
      ...(request.assetSubcategory ? { assetSubcategory: request.assetSubcategory } : {}),
      ...(request.assetTitle ? { assetTitle: request.assetTitle } : {}),
      ...(request.submitSource ? { submitSource: request.submitSource } : {}),
      ...(request.canvasTool ? { canvasTool: request.canvasTool } : {}),
      ...(request.sourceAssetId ? { sourceAssetId: request.sourceAssetId } : {}),
      ...(options?.quoteToken ? { quoteToken: options.quoteToken } : {}),
      ...(options?.expectedPricingVersion != null
        ? { expectedPricingVersion: options.expectedPricingVersion }
        : {}),
    }),
    signal,
  });
}

/** 本地桌面：图片 / 视频经本机代理直连上游 */
async function generateFromMediaNodeLocal(
  request: MediaGenerationRequest,
  options?: GenerationSubmitOptions
): Promise<MediaGenerationResponse> {
  if (options?.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  if (
    request.category !== "image" &&
    request.category !== "video" &&
    request.category !== "audio" &&
    request.category !== "tool"
  ) {
    throw new Error(`本地版暂不支持类别：${request.category}`);
  }

  const { withLocalGenerationJob } = await import("@/lib/local/withLocalGenerationJob");
  const { findLocalModel } = await import("@/lib/local/generate");
  const modelMeta = await findLocalModel(request.model);
  const modelLabel = modelMeta?.displayName || modelMeta?.name || request.model;
  const upstreamModel = modelMeta?.upstreamModel || modelMeta?.name || request.model;
  const referenceCount = (request.references ?? []).filter((r) => String(r.url || "").trim())
    .length;

  // 音频：Suno 等异步走 /v1/video/generations；TTS 走 /v1/audio/speech
  if (request.category === "audio") {
    return withLocalGenerationJob(
      {
        category: "audio",
        modelId: request.model,
        modelLabel,
        upstreamModel,
        projectId: request.projectId,
        nodeId: request.nodeId,
        prompt: request.prompt,
        referenceCount,
      },
      async ({ noteProviderTaskId, noteSubmitBody }) => {
        const {
          localGenerateAudio,
          persistLocalAudioResult,
          normalizeApiKey,
        } = await import("@/lib/local/generate");
        const { localStore } = await import("@/lib/local/store");
        const raw = await localGenerateAudio({
          modelId: request.model,
          prompt: request.prompt,
          generationOptions: request.generationOptions as Record<string, unknown> | undefined,
          onProviderTaskId: noteProviderTaskId,
          onSubmitBody: noteSubmitBody,
          signal: options?.signal,
        });
        const model = await findLocalModel(request.model);
        const providers = await localStore().listProviders();
        const provider = model?.providerId
          ? providers.find((p) => p.id === model.providerId)
          : undefined;
        const apiKey = normalizeApiKey(model?.apiKey || provider?.apiKey || "");
        if (raw.url) {
          try {
            options?.onUpstreamPreview?.({ url: raw.url });
          } catch {
            /* 预览失败不阻断落盘 */
          }
        }
        const persisted = await persistLocalAudioResult({
          projectId: request.projectId,
          nodeId: request.nodeId,
          url: raw.url,
          b64: raw.b64,
          apiKey,
          assetTitle: request.assetTitle,
        });
        return {
          result: {
            jobId: persisted.assetId,
            status: "succeeded" as const,
            resultUrl: persisted.url,
            assetId: persisted.assetId,
            outputAssets: [
              { url: persisted.url, id: persisted.assetId, assetId: persisted.assetId },
            ],
            message: "本地音频生成完成",
            creditCost: 0,
          },
          resultUrlPreview: persisted.url,
          resultAssetId: persisted.assetId,
          upstreamModel: model?.upstreamModel || upstreamModel,
          providerTaskId: raw.providerTaskId,
        };
      }
    );
  }

  if (request.category === "video") {
    return withLocalGenerationJob(
      {
        category: "video",
        modelId: request.model,
        modelLabel,
        upstreamModel,
        projectId: request.projectId,
        nodeId: request.nodeId,
        prompt: request.prompt,
        referenceCount,
      },
      async ({ noteProviderTaskId, noteSubmittedRefs }) => {
        const {
          localGenerateVideo,
          persistLocalVideoResult,
          normalizeApiKey,
          isJumengSubtitleEraseModel,
        } = await import("@/lib/local/generate");
        const {
          isLikelyAudioMediaUrl,
          isLikelyVideoMediaUrl,
          prepareUpstreamMediaRefs,
        } = await import("@/lib/local/upstreamMediaRefs");
        const { isVolcVideoEnhanceModel } = await import("@/lib/local/volcVideoEnhance");
        // 顶栏视频工具与节点参考同链路：OSS → 官方 /files/upload → base64
        const { localStore } = await import("@/lib/local/store");
        const subtitleErase = isJumengSubtitleEraseModel({
          canvasTool: request.canvasTool,
          upstreamModel,
          name: modelMeta?.name,
          displayName: modelMeta?.displayName,
        });
        const volcEnhance = isVolcVideoEnhanceModel({
          canvasTool: request.canvasTool,
          upstreamModel,
          name: modelMeta?.name,
          displayName: modelMeta?.displayName,
        });
        const singleSourceVideo = subtitleErase || volcEnhance;
        // 去字幕 / 画质增强：优先用片长计费秒；通用视频仍用 generationOptions.duration
        const durationRaw = singleSourceVideo
          ? request.generationOptions?.inputVideoSeconds ||
            request.generationOptions?.outputVideoSeconds ||
            request.generationOptions?.seconds ||
            request.generationOptions?.duration ||
            "5"
          : request.generationOptions?.duration ||
            request.generationOptions?.seconds ||
            "5";
        const durationSec =
          Number.parseInt(String(durationRaw).replace(/[^\d]/g, ""), 10) || 5;
        const resolution = volcEnhance
          ? String(
              request.generationOptions?.enhanceResolution ||
                request.generationOptions?.resolution ||
                "1080p"
            )
          : pickCanvasClarityFromOptions(request.generationOptions, "2K");
        const ratio = pickCanvasAspectFromOptions(request.generationOptions, "16:9");
        // 勿写死 category:"audio"：isLikelyAudioMediaUrl 会把任意 URL 都判成音频，
        // 导致图片节点进 referenceAudio / audio_urls（如 .jpg 与 .wav 混在一起）。
        const isAudioRef = (r: { type?: string; url?: string }) =>
          isLikelyAudioMediaUrl(String(r.url || ""), { type: r.type });

        // 本机 /api/local/asset 常无扩展名：按 ref.type 区分；sourceUrl 在视频任务中强制当视频
        const rawImageUrls = (request.references ?? [])
          .filter((r) => {
            const u = String(r.url || "").trim();
            if (!u || isAudioRef(r)) return false;
            if (isLikelyVideoMediaUrl(u, { type: r.type, canvasTool: request.canvasTool })) {
              return false;
            }
            if (r.type === "image" || r.type === "file" || r.type === "link") return true;
            if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) return true;
            if (u.startsWith("data:image")) return true;
            // 无 type 的本机资产：视频任务里默认不当图片（避免把源视频当图）
            if (/\/api\/local\//i.test(u) && request.category === "video" && !r.type) {
              return false;
            }
            if (/\/api\/local\//i.test(u)) return true;
            return false;
          })
          .map((r) => String(r.url || "").trim())
          .filter(Boolean);

        const rawVideoUrls: string[] = [];
        for (const r of request.references ?? []) {
          const u = String(r.url || "").trim();
          if (!u) continue;
          if (isLikelyVideoMediaUrl(u, { type: r.type, canvasTool: request.canvasTool })) {
            rawVideoUrls.push(u);
            continue;
          }
          // 视频任务 + 无 type 的本机 URL：视为视频参考（顶栏工具常只传 sourceUrl/未标 type）
          if (
            request.category === "video" &&
            !r.type &&
            /\/api\/local\//i.test(u) &&
            !isAudioRef(r)
          ) {
            rawVideoUrls.push(u);
          }
        }
        if (request.sourceUrl?.trim()) {
          const su = request.sourceUrl.trim();
          // 视频节点 / 顶栏视频工具：sourceUrl 一律当视频参考（与节点带参考同链路）
          if (request.category === "video") {
            rawVideoUrls.unshift(su);
          } else if (
            isLikelyVideoMediaUrl(su, {
              canvasTool: request.canvasTool,
              forceVideo: true,
            })
          ) {
            rawVideoUrls.unshift(su);
          } else if (!isAudioRef({ url: su })) {
            rawImageUrls.unshift(su);
          }
        }

        // 去字幕 / 画质增强：只要 1 条源视频（优先 sourceUrl）
        let dedupedVideoUrls = rawVideoUrls;
        if (singleSourceVideo) {
          const preferred = String(request.sourceUrl || "").trim();
          const uniq: string[] = [];
          const seen = new Set<string>();
          for (const u of preferred ? [preferred, ...rawVideoUrls] : rawVideoUrls) {
            const key = u.split("?")[0] || u;
            if (seen.has(key)) continue;
            seen.add(key);
            uniq.push(u);
          }
          dedupedVideoUrls = uniq.slice(0, 1);
          if (!dedupedVideoUrls.length) {
            throw new Error(
              volcEnhance
                ? "画质增强需要源视频（请先上传视频）"
                : "去字幕需要源视频（请先上传视频）"
            );
          }
        }

        const prepared = await prepareUpstreamMediaRefs({
          modelId: request.model,
          imageUrls: singleSourceVideo ? [] : rawImageUrls,
          videoUrls: dedupedVideoUrls,
          audioUrls: singleSourceVideo
            ? []
            : (request.references ?? [])
                .filter((r) => isAudioRef(r))
                .map((r) => String(r.url || "").trim())
                .filter(Boolean),
        });
        const imageUrls = prepared.imageUrls;
        const videoUrls = prepared.videoUrls;
        const audioUrls = prepared.audioUrls;
        if (dedupedVideoUrls.length > 0 && videoUrls.length === 0) {
          throw new Error(
            "画布有参考视频，但未能提交给上游。未配 OSS 时请保证单段 ≤20MB，或启用「参考图 OSS」"
          );
        }
        if (
          !singleSourceVideo &&
          (request.references ?? []).some((r) => isAudioRef(r)) &&
          audioUrls.length === 0
        ) {
          throw new Error(
            "画布有参考音频，但未能提交给上游。请确认音频节点已有文件后重试"
          );
        }

        const opts = request.generationOptions ?? {};
        const raw = await localGenerateVideo({
          modelId: request.model,
          prompt: request.prompt,
          durationSec,
          resolution: String(opts.enhanceResolution || opts.resolution || resolution),
          ratio: String(ratio),
          imageUrls,
          videoUrls,
          audioUrls,
          canvasTool: request.canvasTool,
          eraseType: opts.eraseType,
          encodeMode: opts.encodeMode,
          eraseRatioLocation: opts.eraseRatioLocation,
          enhanceOptions: opts,
          onProviderTaskId: noteProviderTaskId,
          onSubmittedRefs: noteSubmittedRefs,
          signal: options?.signal,
        });
        const model = await findLocalModel(request.model);
        const providers = await localStore().listProviders();
        const provider = model?.providerId
          ? providers.find((p) => p.id === model.providerId)
          : undefined;
        const apiKey = normalizeApiKey(model?.apiKey || provider?.apiKey || "");
        // 先预览上游 URL，再落盘；避免大视频下载期间节点一直转圈
        if (raw.url) {
          try {
            options?.onUpstreamPreview?.({ url: raw.url });
          } catch {
            /* 预览失败不阻断落盘 */
          }
        }
        const persisted = await persistLocalVideoResult({
          projectId: request.projectId,
          nodeId: request.nodeId,
          url: raw.url,
          apiKey,
        });
        const resultUrl = persisted.url;
        const assetId = persisted.assetId;
        return {
          result: {
            // 与图片路径一致：用真实 assetId 作 jobId，避免假轮询
            jobId: assetId,
            status: "succeeded" as const,
            resultUrl,
            assetId,
            outputAssets: [{ url: resultUrl, id: assetId, assetId }],
            message: "本地视频生成完成",
            creditCost: 0,
          },
          resultUrlPreview: resultUrl,
          resultAssetId: assetId,
          upstreamModel: model?.upstreamModel || upstreamModel,
          providerTaskId: raw.providerTaskId,
          submittedReferenceCount: raw.submittedReferenceCount,
          submittedRefHostPreview: raw.submittedRefHostPreview,
          submittedRefUrls: raw.submittedRefUrls,
        };
      }
    );
  }

  return withLocalGenerationJob(
    {
      category: request.category === "tool" ? "tool" : "image",
      modelId: request.model,
      modelLabel,
      upstreamModel,
      projectId: request.projectId,
      nodeId: request.nodeId,
      prompt: request.prompt,
      referenceCount,
    },
    async ({ noteProviderTaskId, noteSubmittedRefs }) => {
      const { localGenerateImage, persistLocalImageResult } = await import(
        "@/lib/local/generate"
      );
      const { prepareUpstreamMediaRefs } = await import("@/lib/local/upstreamMediaRefs");
      // 顶栏图片工具与节点参考同链路：官方 /files/upload → OSS → base64
      const opts = request.generationOptions ?? {};
      const canvasToolId = String(request.canvasTool || "").trim();
      // HD / 扩图：固定 gemini-nano-banana-2.1 + 官方文件
      const isFixedNanoBanana =
        canvasToolId === "hd_upscale" || canvasToolId === "outpaint";
      const sizeRaw = String(
        opts.size || opts.hdOutputSize || opts.outpaintOutputSize || ""
      ).trim();
      const pixelSize = /^\d+[xX*]\d+$/.test(sizeRaw)
        ? sizeRaw.replace(/[xX]/g, "x")
        : "";
      const aspectRatio = pixelSize ? "" : pickCanvasAspectFromOptions(opts, "1:1");
      const hdClarity = String(opts.hdClarityTier || opts.hdMpTier || "").trim();
      const resolutionFromHd = /^(1|2|4)k$/i.test(hdClarity)
        ? hdClarity.toUpperCase()
        : sizeRaw && /^(1|2|4)[kK]$/.test(sizeRaw)
          ? sizeRaw.toUpperCase()
          : "";
      const resolution = pixelSize
        ? ""
        : resolutionFromHd || pickCanvasClarityFromOptions(opts, "2K");
      const rawImageUrls = (request.references ?? [])
        .filter((r) => {
          const u = String(r.url || "").trim();
          if (!u) return false;
          // 本地资产常无扩展名（/api/local/asset?...），不能只靠后缀判断
          if (r.type === "image" || r.type === "file" || r.type === "link") return true;
          if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u)) return true;
          if (u.startsWith("data:image")) return true;
          if (/\/api\/local\//i.test(u)) return true;
          return false;
        })
        .map((r) => String(r.url || "").trim())
        .filter(Boolean);
      if (request.sourceUrl?.trim()) rawImageUrls.unshift(request.sourceUrl.trim());
      const intendedRefs = (request.references ?? []).filter((r) => String(r.url || "").trim())
        .length;
      if (intendedRefs > 0 && rawImageUrls.length === 0) {
        throw new Error(
          `画布已连接/提及 ${intendedRefs} 个参考，但未解析到可用图片 URL。请确认「图片节点」已有图，并重新连接后重试`
        );
      }
      // HD / 扩图：目录 name 取凭据；上游 model 一律固定 gemini-nano-banana-2.1；参考图强制官方 /files/upload
      let submitModelId = request.model;
      let forcedUpstreamModel: string | undefined;
      if (isFixedNanoBanana) {
        const {
          HD_NANO_BANANA_I2I_UPSTREAM,
          pickHdNanoBananaCatalogModel,
        } = await import("@/lib/local/topazHdUpscale");
        const { listModels } = await import("@/lib/api/models");
        const imageModels = await listModels({ category: "image" });
        const hdHit = pickHdNanoBananaCatalogModel(imageModels);
        if (hdHit?.name) submitModelId = hdHit.name;
        forcedUpstreamModel = HD_NANO_BANANA_I2I_UPSTREAM;
      }
      const prepared = await prepareUpstreamMediaRefs({
        modelId: submitModelId,
        imageUrls: rawImageUrls,
        forceJumengOfficialFiles: isFixedNanoBanana,
      });
      const imageUrls = prepared.imageUrls;
      if (rawImageUrls.length > 0 && imageUrls.length === 0) {
        throw new Error(
          prepared.jumengOfficial || isFixedNanoBanana
            ? "参考图未能经聚梦官方文件上传转换成上游可用地址，已中止（避免变成纯文生图）"
            : "参考图未能转换成公网直链，已中止。第三方接口请先配置「参考图 OSS」"
        );
      }
      const raw = await localGenerateImage({
        modelId: submitModelId,
        prompt: request.prompt,
        // HD 已算出像素 WxH，优先提交；其余走画幅 + 清晰度
        size: pixelSize || aspectRatio || undefined,
        aspectRatio: pixelSize ? undefined : aspectRatio || undefined,
        resolution: pixelSize ? undefined : resolution || undefined,
        imageUrls,
        forcedUpstreamModel,
        onProviderTaskId: noteProviderTaskId,
        onSubmittedRefs: noteSubmittedRefs,
        signal: options?.signal,
      });
      // 先把上游结果画到节点，再本机落盘（大图/慢网时体感差主要在落盘）
      if (raw.url || raw.b64) {
        try {
          options?.onUpstreamPreview?.({ url: raw.url, b64: raw.b64 });
        } catch {
          /* 预览失败不阻断落盘 */
        }
      }
      const persisted = await persistLocalImageResult({
        projectId: request.projectId,
        nodeId: request.nodeId,
        url: raw.url,
        b64: raw.b64,
        assetTitle: request.assetTitle,
        assetSubcategory: request.assetSubcategory ?? null,
      });
      const resultUrl = persisted.url;
      const assetId = persisted.assetId;
      const model = await findLocalModel(request.model);
      return {
        result: {
          // 本地已同步完成：不要用 Date.now() 假 jobId 诱使分镜去轮询 /api/v1/generations
          jobId: assetId,
          status: "succeeded" as const,
          resultUrl,
          assetId,
          outputAssets: [{ url: resultUrl, id: assetId, assetId }],
          message: "本地生成完成",
          creditCost: 0,
        },
        resultUrlPreview: resultUrl,
        resultAssetId: assetId,
        upstreamModel: model?.upstreamModel || upstreamModel,
        providerTaskId: raw.providerTaskId,
        submittedReferenceCount: raw.submittedReferenceCount,
        submittedRefHostPreview: raw.submittedRefHostPreview,
        submittedRefUrls: raw.submittedRefUrls,
      };
    }
  );
}

export async function generateFromMediaNode(
  request: MediaGenerationRequest,
  options?: GenerationSubmitOptions
): Promise<MediaGenerationResponse> {
  if (isLocalDesktop) {
    return generateFromMediaNodeLocal(request, options);
  }
  const controller = new AbortController();
  const timeoutMs =
    request.category === "video"
      ? VIDEO_GENERATE_TIMEOUT_MS
      : request.category === "audio"
        ? AUDIO_GENERATE_TIMEOUT_MS
        : DEFAULT_GENERATE_TIMEOUT_MS;
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onUserAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onUserAbort, { once: true });
  if (options?.signal?.aborted) controller.abort();

  try {
    try {
      return await postMediaGenerate(request, options, controller.signal);
    } catch (err) {
      // 服务端权威用量与前端 quoteToken 不一致时：用 409 content 内新凭证静默重试一次
      const retry = pricingChangedRetryPayload(err);
      if (!retry) throw err;
      const retryKey = options?.idempotencyKey
        ? `${options.idempotencyKey}-pr`
        : undefined;
      return await postMediaGenerate(
        {
          ...request,
          generationOptions: {
            ...(request.generationOptions ?? {}),
            ...retry.optionSnapshot,
          },
        },
        {
          ...options,
          idempotencyKey: retryKey,
          quoteToken: retry.quoteToken,
          expectedPricingVersion: undefined,
        },
        controller.signal
      );
    }
  } catch (err) {
    if (options?.signal?.aborted) {
      const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
      throw new AgentTurnAbortedError();
    }
    if (shouldAttemptRecovery(err)) {
      const recovered = await recoverLatestNodeGeneration(request.projectId, request.nodeId);
      if (recovered) return recovered;
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onUserAbort);
  }
}
