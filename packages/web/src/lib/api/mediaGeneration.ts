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
  if (request.category === "audio") {
    throw new Error(
      "本地版暂不支持音频节点直连生成；请先用文本/图片/视频模型，或在设置里用自定义 HTTP 模板接入 TTS"
    );
  }
  if (
    request.category !== "image" &&
    request.category !== "video" &&
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
          resolveLocalImageUrlsForUpstream,
          resolveLocalMediaUrlForUpstream,
          resolveJumengUploadCreds,
        } = await import("@/lib/local/generate");
        // 聚梦官方接口：参考素材走官方 /v1/files/upload 换公网直链，免配 OSS；
        // 第三方接口沿用原画布行为，参考素材需用户自配 OSS
        const jumengCreds = await resolveJumengUploadCreds(request.model);
        const jumengOfficial = jumengCreds !== null;
        const { localStore } = await import("@/lib/local/store");
        const durationRaw =
          request.generationOptions?.duration ||
          request.generationOptions?.seconds ||
          "5";
        const durationSec =
          Number.parseInt(String(durationRaw).replace(/[^\d]/g, ""), 10) || 5;
        const resolution = pickCanvasClarityFromOptions(request.generationOptions, "2K");
        const ratio = pickCanvasAspectFromOptions(request.generationOptions, "16:9");
        const rawImageUrls = (request.references ?? [])
          .filter(
            (r) =>
              r.type === "image" ||
              /\.(png|jpe?g|webp|gif)(\?|$)/i.test(String(r.url || "")) ||
              String(r.url || "").startsWith("data:image") ||
              (/\/api\/local\//i.test(String(r.url || "")) &&
                r.type !== "video" &&
                !/\.(mp4|webm|mov)(\?|$)/i.test(String(r.url || "")))
          )
          .map((r) => String(r.url || "").trim())
          .filter(Boolean);
        if (request.sourceUrl?.trim()) {
          const su = request.sourceUrl.trim();
          const sourceIsVideo =
            /\.(mp4|webm|mov)(\?|$)/i.test(su) || su.startsWith("data:video");
          if (!sourceIsVideo) rawImageUrls.unshift(su);
        }
        const imageUrls = await resolveLocalImageUrlsForUpstream(rawImageUrls, {
          preferPublicHttps: jumengOfficial,
          requirePublicHttps: !jumengOfficial,
          jumengUpload: jumengCreds,
        });

        const videoUrls: string[] = [];
        const intendedVideoRefs = (request.references ?? []).filter((r) => {
          const u = String(r.url || "").trim();
          if (!u) return false;
          return (
            r.type === "video" ||
            /\.(mp4|webm|mov)(\?|$)/i.test(u) ||
            u.startsWith("data:video") ||
            /file=[^&]*\.(mp4|webm|mov)/i.test(u)
          );
        });
        if (request.sourceUrl?.trim()) {
          const su = request.sourceUrl.trim();
          if (
            /\.(mp4|webm|mov)(\?|$)/i.test(su) ||
            su.startsWith("data:video") ||
            /file=[^&]*\.(mp4|webm|mov)/i.test(su)
          ) {
            intendedVideoRefs.unshift({
              nodeId: "source",
              type: "video",
              url: su,
              label: "source",
            } as (typeof intendedVideoRefs)[number]);
          }
        }
        for (const r of intendedVideoRefs) {
          const u = String(r.url || "").trim();
          if (!u) continue;
          const resolved = await resolveLocalMediaUrlForUpstream(u, {
            requirePublicHttps: !jumengOfficial,
            jumengUpload: jumengCreds,
          });
          if (!resolved) {
            throw new Error(
              `参考视频未能提交（${u.slice(0, 80)}）。聚梦官方上传上限 100MB；更大请压缩或启用「参考图 OSS」`
            );
          }
          videoUrls.push(resolved);
        }
        if (intendedVideoRefs.length > 0 && videoUrls.length === 0) {
          throw new Error(
            "画布有参考视频，但未能提交给上游。未配 OSS 时请保证单段 ≤20MB，或启用「参考图 OSS」"
          );
        }

        const raw = await localGenerateVideo({
          modelId: request.model,
          prompt: request.prompt,
          durationSec,
          resolution: String(resolution),
          ratio: String(ratio),
          imageUrls,
          videoUrls,
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
        const resultUrl = await persistLocalVideoResult({
          projectId: request.projectId,
          nodeId: request.nodeId,
          url: raw.url,
          apiKey,
        });
        const jobId = Date.now();
        return {
          result: {
            jobId,
            status: "succeeded" as const,
            resultUrl,
            outputAssets: [{ url: resultUrl }],
            message: "本地视频生成完成",
            creditCost: 0,
          },
          resultUrlPreview: resultUrl,
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
      const {
        localGenerateImage,
        persistLocalImageResult,
        resolveLocalImageUrlsForUpstream,
        resolveJumengUploadCreds,
      } = await import("@/lib/local/generate");
      // 聚梦官方接口：参考图走官方 /v1/files/upload 换公网直链，免配 OSS；
      // 第三方接口沿用原画布行为，参考图需用户自配 OSS
      const jumengCreds = await resolveJumengUploadCreds(request.model);
      const jumengOfficial = jumengCreds !== null;
      const opts = request.generationOptions ?? {};
      const aspectRatio = pickCanvasAspectFromOptions(opts, "1:1");
      const resolution = pickCanvasClarityFromOptions(opts, "2K");
      const sizeRaw = String(opts.size || "").trim();
      const size = aspectRatio;
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
      const imageUrls = await resolveLocalImageUrlsForUpstream(rawImageUrls, {
        // 聚梦官方：OSS → 官方 files/upload → base64
        preferPublicHttps: jumengOfficial,
        // 第三方网关：必须公网直链
        requirePublicHttps: !jumengOfficial,
        jumengUpload: jumengCreds,
      });
      if (rawImageUrls.length > 0 && imageUrls.length === 0) {
        throw new Error(
          jumengOfficial
            ? "参考图未能转换成上游可用格式（https 或 base64），已中止（避免变成纯文生图）"
            : "参考图未能转换成公网直链，已中止。第三方接口请先配置「参考图 OSS」"
        );
      }
      const raw = await localGenerateImage({
        modelId: request.model,
        prompt: request.prompt,
        size,
        aspectRatio: aspectRatio || undefined,
        resolution:
          resolution ||
          (sizeRaw && /^(1|2|4)[kK]$/.test(sizeRaw) ? sizeRaw : undefined) ||
          undefined,
        imageUrls,
        onProviderTaskId: noteProviderTaskId,
        onSubmittedRefs: noteSubmittedRefs,
        signal: options?.signal,
      });
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
