/**
 * 统一标记节点生成失败，写入 params.lastError 供 Agent 快照诊断。
 */

import { useCanvasStore } from "@/stores/canvasStore";

/** 设 error 状态并记录最近一次失败原因（截断防撑爆 flow） */
export function markNodeGenerationError(nodeId: string, message?: string | null): void {
  const store = useCanvasStore.getState();
  store.setNodeStatus(nodeId, "error");
  const msg = String(message || "generation_failed").trim().slice(0, 500);
  store.updateNodeParam(nodeId, "lastError", msg || "generation_failed");
}
