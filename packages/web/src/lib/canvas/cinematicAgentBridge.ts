/**
 * 电影级宣传片 Skill · LibTV 黑箱：用户「确认生成」后批量出视频。
 * 按 cinematicBatchId + cinematicShotIndex 顺序提交；续接/合并由 applyMediaJobResult 钩子处理。
 */

import {
  collectNodeMediaItems,
  narrateAgentSession,
} from "@/lib/canvas/agentSessionNarrate";
import {
  setAgentCanvasBusy,
  clearAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";
import { runOneGeneratableNode } from "@/lib/canvas/runOneGeneratableNode";
import { useCanvasStore } from "@/stores/canvasStore";

function nodeParams(node: { data?: { params?: Record<string, unknown> } }): Record<string, unknown> {
  return (node.data?.params ?? {}) as Record<string, unknown>;
}

/** 收集当前画布上最新一批待生成的电影级宣传片视频节点 id（按 shotIndex 排序） */
export function collectCinematicBatchVideoNodeIds(): string[] {
  const nodes = useCanvasStore.getState().nodes.filter((n) => n.type === "video_input");
  const byBatch = new Map<string, typeof nodes>();

  for (const n of nodes) {
    const params = nodeParams(n);
    const batchId = String(params.cinematicBatchId ?? "").trim();
    const shotIndex = Number(params.cinematicShotIndex ?? 0);
    if (!batchId || !shotIndex || shotIndex < 1) continue;
    const list = byBatch.get(batchId) ?? [];
    list.push(n);
    byBatch.set(batchId, list);
  }

  let best: typeof nodes = [];
  for (const list of byBatch.values()) {
    if (list.length > best.length) best = list;
  }

  return best
    .sort(
      (a, b) =>
        Number(nodeParams(a).cinematicShotIndex ?? 0) -
        Number(nodeParams(b).cinematicShotIndex ?? 0)
    )
    .map((n) => n.id);
}

/** 对话侧「确认生成」：按批次顺序批量提交视频生成任务 */
export async function runCinematicBatchFromAgentSession(opts: {
  projectId: string;
  sessionId: string;
}): Promise<string[]> {
  const { projectId, sessionId } = opts;
  const videoIds = collectCinematicBatchVideoNodeIds();
  if (!videoIds.length) {
    throw new Error("未找到待生成的视频镜头，请先完成故事板读板分配");
  }

  setAgentCanvasBusy("generating", `正在批量生成 ${videoIds.length} 个镜头视频…`);
  try {
    const batchId = `cinematic-batch-${Date.now()}`;
    let okCount = 0;
    let failMsg: string | null = null;

    for (const nodeId of videoIds) {
      if (!useCanvasStore.getState().nodes.some((n) => n.id === nodeId)) continue;
      const outcome = await runOneGeneratableNode({ projectId, nodeId, batchId });
      if (outcome.ok) {
        okCount += 1;
        continue;
      }
      failMsg = outcome.error || "生成失败";
      if (
        outcome.abortBatch ||
        outcome.code === "INSUFFICIENT_CREDITS" ||
        outcome.code === "5501"
      ) {
        throw new Error(failMsg);
      }
    }

    if (okCount === 0) {
      throw new Error(failMsg || "未能提交任何视频生成任务");
    }

    const mediaItems = collectNodeMediaItems(videoIds.slice(0, okCount));
    await narrateAgentSession(
      sessionId,
      `已开始批量生成 ${okCount} 个镜头视频；全部完成后将自动合并为「电影级宣传片·成片」。`,
      { done: true, mediaItems: mediaItems.length > 0 ? mediaItems : undefined }
    );
    useCanvasStore.getState().scheduleAutoSave();
    return videoIds.slice(0, okCount);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "批量出视频失败";
    await narrateAgentSession(sessionId, `出视频失败：${msg}`, { done: true });
    throw err;
  } finally {
    clearAgentCanvasBusy();
  }
}
