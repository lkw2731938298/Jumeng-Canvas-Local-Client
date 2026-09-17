import { toast } from "sonner";
import { fetchAssetById, notifyAssetsUpdated } from "@/lib/api/assets";
import { normalizeStorageUrl } from "@/lib/api/storageUrl";
import { ensureHttpsOssUrl, isSignedOssUrl } from "@/lib/signedUrl";
import { getEditorConfig, isEditorNodeType } from "@/lib/canvas/nodeEditorConfig";
import { getAbsolutePosition } from "@/lib/canvas/nodeGroup";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import {
  reflowShotToStoryboardGrid,
  reflowShotToProjectGraph,
  reflowCharacterSheetToProjectGraph,
  reflowProductSheetToProjectGraph,
} from "@/lib/canvas/shotReflow";
import { maybeChainCinematicContinuity } from "@/lib/canvas/cinematicContinuity";
import { maybeAutoMergeCinematic } from "@/lib/canvas/cinematicMerge";
import { formatTimelineDuration } from "@/types/storyboard-table";
import { clipTextNodeGeneratedContent } from "@/lib/canvas/textNodeGenerationLimit";
import { useCanvasStore } from "@/stores/canvasStore";

export interface PolledGenerationJob {
  status?: string;
  assetId?: string;
  asset_id?: string;
  resultUrl?: string;
  result_url?: string;
  outputAssets?: Array<{ url?: string; id?: string; assetId?: string }>;
  output_assets?: Array<{ url?: string; id?: string; assetId?: string }>;
  errorMessage?: string;
  error_message?: string;
  resultText?: string;
  result_text?: string;
}

function resolveJobMediaUrl(job: PolledGenerationJob): string {
  const fromTop = String(job.resultUrl ?? job.result_url ?? "").trim();
  if (fromTop) {
    return isSignedOssUrl(fromTop) ? fromTop : normalizeStorageUrl(fromTop);
  }

  const outputs = job.outputAssets ?? job.output_assets ?? [];
  for (const item of outputs) {
    const url = String(item?.url ?? "").trim();
    if (url) return isSignedOssUrl(url) ? url : normalizeStorageUrl(url);
  }
  return "";
}

function resolveJobAssetId(job: PolledGenerationJob): string {
  const direct = String(job.assetId ?? job.asset_id ?? "").trim();
  if (direct) return direct;

  const outputs = job.outputAssets ?? job.output_assets ?? [];
  for (const item of outputs) {
    const id = String(item?.assetId ?? item?.id ?? "").trim();
    if (id) return id;
  }
  return "";
}

/** 一次生成多张时，除主资产外的其余 assetId（按 output_assets 顺序） */
function resolveExtraJobAssetIds(job: PolledGenerationJob, primaryAssetId: string): string[] {
  const outputs = job.outputAssets ?? job.output_assets ?? [];
  const ids: string[] = [];
  const seen = new Set<string>();
  if (primaryAssetId) seen.add(primaryAssetId);
  for (const item of outputs) {
    const id = String(item?.assetId ?? item?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function canvasHasAssetId(assetId: string): boolean {
  if (!assetId) return false;
  return useCanvasStore.getState().nodes.some((n) => {
    const params = (n.data?.params ?? {}) as Record<string, unknown>;
    return String(params.assetId ?? "").trim() === assetId;
  });
}

/**
 * 多张结果：第 1 张已在源节点，其余在右侧纵向新建图片节点卡片（不连线，避免当成参考图）。
 */
async function fanOutExtraImageAssets(
  projectId: string,
  sourceNodeId: string,
  extraAssetIds: string[]
): Promise<void> {
  const pending = extraAssetIds.filter((id) => id && !canvasHasAssetId(id));
  if (!pending.length) return;

  const store = useCanvasStore.getState();
  const source = store.nodes.find((n) => n.id === sourceNodeId);
  if (!source || source.type !== "image_input") return;

  const world = getAbsolutePosition(source, store.nodes);
  const { width, height } = resolveNodeSize(source.width, source.height);
  const gapX = 48;
  const gapY = 24;

  for (let i = 0; i < pending.length; i++) {
    const assetId = pending[i];
    const asset = await fetchAssetById(projectId, assetId);
    if (!asset?.fileUrl) continue;
    // 右侧一列：第 2、3、4… 张各一张新卡片
    const position = {
      x: world.x + width + gapX,
      y: world.y + i * (height + gapY),
    };
    store.addNodeFromAsset(
      {
        id: asset.id,
        category: "image",
        fileUrl: asset.fileUrl,
        title: asset.title || `AI 图片生成 ${i + 2}`,
      },
      position
    );
    const newNodeId = useCanvasStore.getState().selectedNodeId;
    if (!newNodeId) continue;
    // 继承源节点模型与参数，便于继续编辑
    const srcParams = (source.data.params ?? {}) as Record<string, unknown>;
    if (srcParams.model) store.updateNodeParam(newNodeId, "model", srcParams.model);
    if (srcParams.prompt) store.updateNodeParam(newNodeId, "prompt", srcParams.prompt);
    if (srcParams.generationOptions) {
      store.updateNodeParam(newNodeId, "generationOptions", srcParams.generationOptions);
    }
  }
  // 扇出后保持选中源节点（仍显示第 1 张）
  useCanvasStore.getState().selectNode(sourceNodeId);
}

async function applyExtraImageNodes(
  projectId: string,
  nodeId: string,
  nodeType: string | undefined,
  job: PolledGenerationJob,
  primaryAssetId: string
): Promise<void> {
  if (nodeType !== "image_input" || !primaryAssetId) return;
  const extras = resolveExtraJobAssetIds(job, primaryAssetId);
  if (extras.length) {
    await fanOutExtraImageAssets(projectId, nodeId, extras);
  }
}

function isMediaAlreadyOnNode(
  params: Record<string, unknown>,
  urlParamKey: string,
  assetId: string,
  mediaUrl: string
): boolean {
  const currentAssetId = String(params.assetId ?? "").trim();
  if (assetId && currentAssetId === assetId) return true;
  const currentUrl = String(params[urlParamKey] ?? "").trim();
  if (mediaUrl && currentUrl && currentUrl === mediaUrl) return true;
  return false;
}

/**
 * 单镜重新生成后自动同步分镜表 / 成片表并轻提示（Editor 自动 reflow 整条时间线）。
 * 非绑定镜头节点、或素材未变化时静默跳过，不打扰普通生成流程。
 *
 * 两套 reflow 并存、互不冲突：有分镜表承载（爆款复刻 / 一键出海等内建 Skill）
 * 走 reflowShotToStoryboardGrid；无分镜表的自由创作 Agent Team 路径（画布操控 /
 * 智能编排）走 reflowShotToProjectGraph（载体是 Project Graph shots[]）。
 * 同一节点最多命中其中一套，都试一次即可。
 */
function notifyShotReflow(nodeId: string): void {
  const storyboardResult = reflowShotToStoryboardGrid(nodeId);
  if (storyboardResult.updated) {
    const { shotNo, totalSec, readyCount, totalCount } = storyboardResult;
    const totalLabel = typeof totalSec === "number" ? formatTimelineDuration(totalSec) : "";
    toast.message(
      `镜头${shotNo ? ` ${shotNo}` : ""}已更新，已同步到分镜表 / 成片表` +
        (totalLabel ? `（${readyCount}/${totalCount} 镜 · 总时长约 ${totalLabel}）` : "")
    );
    return;
  }

  const graphResult = reflowShotToProjectGraph(nodeId);
  if (graphResult.updated) {
    const { readyCount, totalCount } = graphResult;
    toast.message(
      `镜头已更新` +
        (typeof totalCount === "number" ? `，时间线 ${readyCount}/${totalCount} 镜已完成` : "")
    );
    return;
  }

  const sheetResult = reflowCharacterSheetToProjectGraph(nodeId);
  if (sheetResult.updated) {
    toast.message("角色定妆图已生成并锁定，后续镜头将自动引用该形象");
    return;
  }

  const productSheetResult = reflowProductSheetToProjectGraph(nodeId);
  if (productSheetResult.updated) {
    const n = productSheetResult.autoConnectedCount ?? 0;
    toast.message(
      "产品定妆图已生成并锁定" + (n > 0 ? `，已自动连线到 ${n} 个镜头，后续镜头将自动引用该形象` : "")
    );
  }
}

/**
 * 单一产品电影级宣传片 Skill 专用：视频镜头生成成功后触发两项自动化（互不阻塞
 * 主流程，均 fire-and-forget，失败不影响当前镜头已生成的结果）：
 * ① 若该镜头带 cinematicShotIndex/cinematicBatchId，截取尾帧并自动连线为下一镜
 *    首帧参考，保证多镜运动连贯；
 * ② 若同批次全部镜头已生成成功，自动合并成片并落画布节点。
 * 非该 Skill 的视频节点（无 cinematicBatchId）直接空转跳过，不产生副作用。
 */
function notifyCinematicVideoReady(nodeId: string): void {
  void maybeChainCinematicContinuity(nodeId).catch((err) => {
    console.warn("[applyMediaJobResult] maybeChainCinematicContinuity failed", err);
  });
  void maybeAutoMergeCinematic(nodeId).catch((err) => {
    console.warn("[applyMediaJobResult] maybeAutoMergeCinematic failed", err);
  });
}

function clearGenerationJobId(nodeId: string): void {
  const params =
    (useCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.data.params as
      | Record<string, unknown>
      | undefined) ?? {};
  if (String(params.generationJobId ?? "").trim()) {
    useCanvasStore.getState().updateNodeParam(nodeId, "generationJobId", "");
  }
}

/** Apply a finished generation job to the canvas node (image / video / audio). */
export async function applyMediaJobResultToNode(
  projectId: string,
  nodeId: string,
  nodeType: string | undefined,
  job: PolledGenerationJob,
  jobId: number | string
): Promise<boolean> {
  if (!isEditorNodeType(nodeType)) return false;

  const config = getEditorConfig(nodeType);
  if (!config?.urlParamKey) return false;

  const urlParamKey = config.urlParamKey;
  const rawAssetId = resolveJobAssetId(job);
  let mediaUrl = resolveJobMediaUrl(job);

  const currentNode = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const currentParams = (currentNode?.data.params ?? {}) as Record<string, unknown>;

  if (rawAssetId) {
    const asset = await fetchAssetById(projectId, rawAssetId);
    if (asset?.fileUrl) {
      mediaUrl = isSignedOssUrl(asset.fileUrl)
        ? ensureHttpsOssUrl(asset.fileUrl)
        : normalizeStorageUrl(asset.fileUrl);
    }
  }

  // 主图已在节点上时仍尝试扇出其余张，避免轮询重入丢多图
  if (isMediaAlreadyOnNode(currentParams, urlParamKey, rawAssetId, mediaUrl)) {
    await applyExtraImageNodes(projectId, nodeId, nodeType, job, rawAssetId);
    clearGenerationJobId(nodeId);
    useCanvasStore.getState().endNodeGeneration(nodeId);
    return false;
  }

  const { updateNodeData, applyNodeGeneratedMedia, endNodeGeneration } = useCanvasStore.getState();

  if (mediaUrl) {
    // 第 1 张落当前节点卡片
    applyNodeGeneratedMedia(nodeId, urlParamKey, mediaUrl, rawAssetId || undefined);
    await applyExtraImageNodes(projectId, nodeId, nodeType, job, rawAssetId);
    clearGenerationJobId(nodeId);
    notifyAssetsUpdated();
    notifyShotReflow(nodeId);
    notifyCinematicVideoReady(nodeId);
    endNodeGeneration(nodeId);
    return true;
  }

  if (rawAssetId) {
    updateNodeData(nodeId, {
      params: {
        ...currentParams,
        assetId: rawAssetId,
      },
      status: "success",
    });
    await applyExtraImageNodes(projectId, nodeId, nodeType, job, rawAssetId);
    clearGenerationJobId(nodeId);
    notifyAssetsUpdated();
    notifyShotReflow(nodeId);
    notifyCinematicVideoReady(nodeId);
    endNodeGeneration(nodeId);
    return true;
  }

  useCanvasStore.getState().setNodeStatus(nodeId, "success");
  clearGenerationJobId(nodeId);
  endNodeGeneration(nodeId);
  return false;
}

/** Apply a finished text generation job to the text node. */
export function applyTextJobResultToNode(
  nodeId: string,
  nodeType: string | undefined,
  job: PolledGenerationJob,
  jobId: number | string,
  model: string
): boolean {
  if (nodeType !== "text_input") return false;

  const text = clipTextNodeGeneratedContent(
    String(job.resultText ?? job.result_text ?? "").trim()
  );
  if (!text) {
    useCanvasStore.getState().setNodeStatus(nodeId, "success");
    useCanvasStore.getState().endNodeGeneration(nodeId);
    clearGenerationJobId(nodeId);
    return false;
  }

  const currentNode = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const currentContent = String(
    (currentNode?.data.params as Record<string, unknown> | undefined)?.content ?? ""
  ).trim();
  if (currentContent === text) {
    useCanvasStore.getState().setNodeStatus(nodeId, "success");
    useCanvasStore.getState().endNodeGeneration(nodeId);
    clearGenerationJobId(nodeId);
    return false;
  }

  const { updateNodeParam, setNodeStatus, endNodeGeneration } = useCanvasStore.getState();
  updateNodeParam(nodeId, "content", text);
  if (model) updateNodeParam(nodeId, "model", model);
  setNodeStatus(nodeId, "success");
  clearGenerationJobId(nodeId);
  endNodeGeneration(nodeId);
  return true;
}

export function jobErrorMessage(job: PolledGenerationJob): string {
  return String(job.errorMessage ?? job.error_message ?? "生成失败");
}
