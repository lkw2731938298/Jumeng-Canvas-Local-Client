/**
 * Agent 改动已有节点参数的"外部改动"信号：供节点编辑面板（NodeEditorOverlay）订阅，
 * 在自己当前打开的节点被 Agent CanvasOp（update_node_params）改动时强制重新从
 * store 灌入本地状态，避免面板本地 useState 与 store 脱节（AI 改了但面板/生成
 * 提交仍用旧的尺寸、时长等 generationOptions）。
 *
 * 沿用 agentCanvasBusy.ts 的监听器模式；每个 nodeId 独立维护版本号计数器。
 */

import { useSyncExternalStore } from "react";

type Listener = () => void;

const versions = new Map<string, number>();
const listeners = new Map<string, Set<Listener>>();

function emit(nodeId: string): void {
  const set = listeners.get(nodeId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** Agent 改动了某已有节点的参数时调用，驱动该节点若正被编辑面板打开则强制重载 */
export function touchAgentNode(nodeId: string): void {
  if (!nodeId) return;
  versions.set(nodeId, (versions.get(nodeId) ?? 0) + 1);
  emit(nodeId);
}

/** 读取当前版本号（稳定的原始值，非对象引用，可安全用于 useSyncExternalStore） */
export function getAgentNodeTouchVersion(nodeId: string | null | undefined): number {
  if (!nodeId) return 0;
  return versions.get(nodeId) ?? 0;
}

export function subscribeAgentNodeTouch(
  nodeId: string | null | undefined,
  listener: Listener
): () => void {
  if (!nodeId) return () => {};
  let set = listeners.get(nodeId);
  if (!set) {
    set = new Set();
    listeners.set(nodeId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(nodeId);
  };
}

/**
 * React 组件读取某节点当前的「被 Agent 外部改动」版本号；版本号变化时组件应
 * 重新从 store 灌入本地状态（而不是继续用挂载时缓存的旧值）。
 */
export function useAgentNodeTouchVersion(nodeId: string | null | undefined): number {
  return useSyncExternalStore(
    (listener) => subscribeAgentNodeTouch(nodeId, listener),
    () => getAgentNodeTouchVersion(nodeId),
    () => 0
  );
}
