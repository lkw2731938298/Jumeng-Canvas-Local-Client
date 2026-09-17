import { fetchAssetById, notifyAssetsUpdated } from "@/lib/api/assets";
import type { MediaGenerationResponse } from "@/lib/api/mediaGeneration";
import { getJobStatus, pollGenerationJob } from "@/lib/api/workflows";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import type { Edge } from "@xyflow/react";

async function resolveJobAssetId(jobId: number | string): Promise<string | undefined> {
  const raw = (await getJobStatus(jobId)) as Record<string, unknown>;
  const direct = String(raw.assetId ?? raw.asset_id ?? "").trim();
  if (direct) return direct;

  const outputs = (raw.outputAssets ?? raw.output_assets ?? []) as Array<Record<string, unknown>>;
  for (const item of outputs) {
    const id = String(item?.assetId ?? item?.id ?? "").trim();
    if (id) return id;
  }
  return undefined;
}

async function pollMediaJobAssetId(
  jobId: number | string
): Promise<{ assetId?: string; errorMessage?: string }> {
  const polled = await pollGenerationJob(jobId, { maxWaitMs: 600_000 });
  if (polled.status !== "succeeded") {
    return { errorMessage: polled.errorMessage || "生成失败" };
  }
  const assetId = await resolveJobAssetId(jobId);
  if (assetId) {
    notifyAssetsUpdated();
    return { assetId };
  }
  return { errorMessage: "未返回图片资产" };
}

/** 同步/异步媒体生成统一解析 assetId（多角度、打光等画布工具复用） */
export async function resolveMediaGenerationAssetId(
  result: MediaGenerationResponse
): Promise<{ assetId?: string; errorMessage?: string }> {
  if (result.status === "awaiting_approval") {
    return { errorMessage: result.message || "已提交审批，等待项目创建者确认" };
  }

  if (result.status === "succeeded") {
    if (result.assetId) {
      notifyAssetsUpdated();
      return { assetId: result.assetId };
    }
    if (result.jobId) return pollMediaJobAssetId(result.jobId);
    return { errorMessage: result.message || "生成失败" };
  }

  if (result.status === "pending" && result.jobId) {
    return pollMediaJobAssetId(result.jobId);
  }

  return { errorMessage: result.message || "生成失败" };
}

/** 在源图片节点右侧创建结果节点并连线（不修改源节点媒体） */
export function attachToolGeneratedImageNode(opts: {
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  sourceLabel?: string;
  edges: Edge[];
  asset: { id: string; fileUrl: string; title: string };
  prompt: string;
  model: string;
  generationOptions: GenerationOptions;
}): string | null {
  const { width } = resolveNodeSize(opts.sourceWidth, opts.sourceHeight);
  const siblingOffset =
    opts.edges.filter((e) => e.source === opts.sourceNodeId && e.sourceHandle === "image").length * 32;

  const store = useCanvasStore.getState();
  store.addNodeFromAsset(
    {
      id: opts.asset.id,
      category: "image",
      fileUrl: opts.asset.fileUrl,
      title: opts.asset.title,
    },
    { x: opts.sourcePosition.x + width + 48, y: opts.sourcePosition.y + siblingOffset }
  );

  const newNodeId = useCanvasStore.getState().selectedNodeId;
  if (!newNodeId) return null;

  store.connectNodes({
    source: opts.sourceNodeId,
    target: newNodeId,
    sourceHandle: "image",
    targetHandle: REFERENCE_INPUT_ID,
  });
  store.updateNodeParam(newNodeId, "prompt", opts.prompt);
  store.updateNodeParam(newNodeId, "model", opts.model);
  if (Object.keys(opts.generationOptions).length > 0) {
    store.updateNodeParam(newNodeId, "generationOptions", opts.generationOptions);
  }

  return newNodeId;
}

/** 解析 asset 并在画布创建连线节点 */
export async function attachMediaGenerationResultNode(opts: {
  projectId: string;
  result: MediaGenerationResponse;
  sourceNodeId: string;
  sourcePosition: { x: number; y: number };
  sourceWidth?: number;
  sourceHeight?: number;
  sourceLabel?: string;
  edges: Edge[];
  nodeTitle: string;
  prompt: string;
  model: string;
  generationOptions: GenerationOptions;
}): Promise<{ ok: true; nodeId: string } | { ok: false; errorMessage: string }> {
  const resolved = await resolveMediaGenerationAssetId(opts.result);
  if (!resolved.assetId) {
    return { ok: false, errorMessage: resolved.errorMessage || "生成失败" };
  }

  const asset = await fetchAssetById(opts.projectId, resolved.assetId);
  if (!asset?.fileUrl) {
    return { ok: false, errorMessage: "生成结果无法加载" };
  }

  const nodeId = attachToolGeneratedImageNode({
    sourceNodeId: opts.sourceNodeId,
    sourcePosition: opts.sourcePosition,
    sourceWidth: opts.sourceWidth,
    sourceHeight: opts.sourceHeight,
    sourceLabel: opts.sourceLabel,
    edges: opts.edges,
    asset: {
      id: asset.id,
      fileUrl: asset.fileUrl,
      title: opts.nodeTitle,
    },
    prompt: opts.prompt,
    model: opts.model,
    generationOptions: opts.generationOptions,
  });

  if (!nodeId) {
    return { ok: false, errorMessage: "无法在画布创建图片节点" };
  }

  notifyAssetsUpdated();
  return { ok: true, nodeId };
}
