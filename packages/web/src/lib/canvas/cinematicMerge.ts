/**
 * 单一产品电影级宣传片 Skill 专用：全部镜头完成后自动合并成片。
 *
 * 复用「一键出海」`mergeOverseasShotVideos`（overseasShotVideos.ts）验证过的
 * composeVideoAssets 拼接模式：按 cinematicShotIndex 顺序收集本批次
 * （cinematicBatchId）全部视频节点，一旦全部生成成功，自动调用
 * /api/v1/assets/video-compose 首尾相接导出成片，并落一个新的视频节点到画布。
 *
 * 合并本身为本地 ffmpeg 拼接、不产生生成任务、不扣算力，故做成全自动执行，
 * 无需二次用户确认；已合并过的批次（打了 cinematicMergedBatchId 标记）不会
 * 重复合并。非本 Skill 节点（无 cinematicBatchId）直接跳过。
 */

import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import { notifyAssetsUpdated } from "@/lib/api/assets";
import { composeVideoAssets } from "@/lib/canvas/videoTrim";

function nodeParams(node: { data: unknown } | undefined): Record<string, unknown> {
  return (node?.data as WorkflowNodeData | undefined)?.params ?? {};
}

/**
 * 视频镜头生成成功后调用：若同批次（cinematicBatchId）全部镜头已生成成功，
 * 自动合并为完整成片并落画布节点。批次未齐、已合并过、或非本 Skill 节点时
 * 静默跳过。
 */
export async function maybeAutoMergeCinematic(nodeId: string): Promise<void> {
  const store = useCanvasStore.getState();
  const { projectId } = store;
  if (!projectId) return;

  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "video_input") return;

  const params = nodeParams(node);
  const batchId = String(params.cinematicBatchId ?? "").trim();
  if (!batchId) return;

  // 幂等：本批次已合并过则不再重复
  const alreadyMerged = store.nodes.some(
    (n) => n.type === "video_input" && String(nodeParams(n).cinematicMergedBatchId ?? "").trim() === batchId
  );
  if (alreadyMerged) return;

  const siblings = store.nodes.filter(
    (n) => n.type === "video_input" && String(nodeParams(n).cinematicBatchId ?? "").trim() === batchId
  );
  if (siblings.length < 2) return; // 单镜无需合并

  const withIndex = siblings
    .map((n) => ({ node: n, shotIndex: Number(nodeParams(n).cinematicShotIndex) }))
    .filter((x) => Number.isFinite(x.shotIndex) && x.shotIndex > 0);
  if (withIndex.length !== siblings.length) return; // 有节点缺 shotIndex，数据不全，跳过

  withIndex.sort((a, b) => a.shotIndex - b.shotIndex);

  const allReady = withIndex.every((x) => Boolean(String(nodeParams(x.node).assetId ?? "").trim()));
  if (!allReady) return; // 尚有镜头未完成

  let result: Awaited<ReturnType<typeof composeVideoAssets>>;
  try {
    result = await composeVideoAssets({
      projectId,
      title: `电影级宣传片·成片（${withIndex.length}镜）`,
      clips: withIndex.map((x) => {
        const p = nodeParams(x.node);
        const durationSec = Number(p.durationSec);
        return {
          videoAssetId: String(p.assetId ?? "").trim(),
          inSec: 0,
          outSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 5,
          trackIndex: 0,
        };
      }),
    });
  } catch (err) {
    console.warn("[cinematicMerge] 自动合并成片失败", err);
    return;
  }

  notifyAssetsUpdated();

  const fresh = useCanvasStore.getState();
  const lastShot = withIndex[withIndex.length - 1]!.node;
  const pos = {
    x: (lastShot.position?.x ?? 80) + 360,
    y: lastShot.position?.y ?? 80,
  };
  const label = "电影级宣传片·成片";
  fresh.addNodeFromAsset(
    {
      id: result.asset.id,
      category: "video",
      fileUrl: result.asset.fileUrl,
      title: result.asset.title || label,
    },
    pos
  );
  const newNodeId = useCanvasStore.getState().selectedNodeId;
  if (newNodeId) {
    useCanvasStore.getState().updateNodeData(newNodeId, { label });
    useCanvasStore.getState().updateNodeParam(newNodeId, "cinematicMergedBatchId", batchId);
  }

  toast.success(`已自动合并全部 ${withIndex.length} 个镜头为完整成片`);
}
