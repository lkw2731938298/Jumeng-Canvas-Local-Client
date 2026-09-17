/**
 * 单一产品电影级宣传片 Skill 专用：多镜自动尾帧续接。
 *
 * 背景：该 Skill 走画布操控 followup（LLM 逐镜 JSON plan + 用户确认后逐镜独立
 * generate），天然缺少「Team 一次性编排」那种确定性衔接——多段视频若各自独立
 * 生成，镜头之间的运动/构图容易跳变。此模块在某镜生成成功后：截取该镜尾帧 →
 * 上传为图片素材 → 新建小型「承接帧」图片节点 → 连线到下一镜（cinematicShotIndex+1）
 * 的 `ref_in` → 在下一镜 prompt 头部插入 `@承接帧标签`，确保
 * videoFrameReferences.ts 的 collectImageReferencesByMentionOrder 把它排为首帧。
 *
 * 仅对带 `params.cinematicBatchId` + `params.cinematicShotIndex`（由
 * agent_canvas_manual.py §S 规则要求 addVideoNodes 写入）的视频节点生效；其它
 * Skill / 手动生成的视频节点直接跳过，不产生副作用。仅对下一镜模型支持首帧
 * 参考（I2V）时才连线，不支持时静默跳过，不阻塞、不报错。
 */

import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import { uploadAsset, NODE_IMAGE_SUBCATEGORY } from "@/lib/api/assets";
import { captureVideoFrameAtTime } from "@/lib/canvas/captureVideoLastFrame";
import { getVideoFrameInputSpec } from "@/lib/canvas/videoFrameReferences";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { getAbsolutePosition } from "@/lib/canvas/nodeGroup";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";

function nodeParams(node: { data: unknown } | undefined): Record<string, unknown> {
  return (node?.data as WorkflowNodeData | undefined)?.params ?? {};
}

/**
 * 视频镜头生成成功后调用：若该镜头属于某个 cinematicBatchId 且存在下一镜，
 * 自动截尾帧续接为下一镜首帧参考。非本 Skill 节点 / 已续接过 / 下一镜模型
 * 不支持首帧参考时静默跳过。
 */
export async function maybeChainCinematicContinuity(nodeId: string): Promise<void> {
  const store = useCanvasStore.getState();
  const { projectId } = store;
  if (!projectId) return;

  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "video_input") return;

  const params = nodeParams(node);
  const batchId = String(params.cinematicBatchId ?? "").trim();
  if (!batchId) return;

  const shotIndex = Number(params.cinematicShotIndex);
  if (!Number.isFinite(shotIndex) || shotIndex <= 0) return;

  const videoUrl = String(params.videoUrl ?? "").trim();
  if (!videoUrl) return;

  const siblings = store.nodes.filter(
    (n) => n.type === "video_input" && String(nodeParams(n).cinematicBatchId ?? "").trim() === batchId
  );
  const nextNode = siblings.find((n) => Number(nodeParams(n).cinematicShotIndex) === shotIndex + 1);
  if (!nextNode) return; // 已是本批次最后一镜，无需续接

  const nextParams = nodeParams(nextNode);
  // 幂等：已续接过同一来源镜头则跳过，避免轮询重入重复建节点/连线
  if (Number(nextParams.cinematicContinuityAppliedFromShotIndex) === shotIndex) return;

  const nextModel = String(nextParams.model ?? "").trim();
  const spec = nextModel ? getVideoFrameInputSpec(nextModel) : null;
  if (!spec?.isFrameModel) return; // 下一镜模型不支持首帧参考，静默跳过

  let blob: Blob;
  try {
    // 传大数由 capture 侧在 metadata 就绪后按实际时长 clamp，与手动「截取尾帧」一致
    blob = await captureVideoFrameAtTime(videoUrl, Number.MAX_SAFE_INTEGER);
  } catch (err) {
    console.warn("[cinematicContinuity] 截取尾帧失败，跳过续接", err);
    return;
  }

  const label = `承接·镜${shotIndex}尾帧`;
  let asset: { id: string; fileUrl: string };
  try {
    const file = new File([blob], `cinematic-continuity-${nodeId.slice(0, 8)}.jpg`, {
      type: "image/jpeg",
    });
    asset = await uploadAsset({
      file,
      projectId,
      category: "image",
      subcategory: NODE_IMAGE_SUBCATEGORY,
      title: label,
    });
  } catch (err) {
    console.warn("[cinematicContinuity] 尾帧上传失败，跳过续接", err);
    return;
  }

  const fresh = useCanvasStore.getState();
  const targetNode = fresh.nodes.find((n) => n.id === nextNode.id);
  if (!targetNode) return; // 下一镜节点已被删除

  const { width, height } = resolveNodeSize(targetNode.width, targetNode.height);
  const world = getAbsolutePosition(targetNode, fresh.nodes);
  fresh.addNodeFromAsset(
    { id: asset.id, category: "image", fileUrl: asset.fileUrl, title: label },
    { x: world.x - width - 64, y: world.y + height + 24 }
  );
  const newNodeId = useCanvasStore.getState().selectedNodeId;
  if (!newNodeId) return;

  useCanvasStore.getState().connectNodes({
    source: newNodeId,
    target: nextNode.id,
    sourceHandle: "image",
    targetHandle: REFERENCE_INPUT_ID,
  });

  const currentPrompt = String(nextParams.prompt ?? "");
  if (!currentPrompt.includes(`@${label}`)) {
    const nextPrompt = `@${label} ${currentPrompt}`.trim();
    useCanvasStore.getState().updateNodeParam(nextNode.id, "prompt", nextPrompt);
  }
  useCanvasStore.getState().updateNodeParam(nextNode.id, "cinematicContinuityAppliedFromShotIndex", shotIndex);

  toast.message(`已自动截取第 ${shotIndex} 镜尾帧并连接为第 ${shotIndex + 1} 镜首帧参考，保持运动连贯`);
}
