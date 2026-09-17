/**
 * Agent 操控画布忙碌态：供投影器写入、画布横幅订阅展示。
 *
 * 注意：getSnapshot 必须返回引用稳定的对象，否则 useSyncExternalStore 会无限重渲染（React #185）。
 */

export type AgentCanvasBusyPhase =
  | "idle"
  | "orchestrating"
  | "projecting"
  | "tool"
  | "generating";

export type AgentCanvasBusyState = {
  phase: AgentCanvasBusyPhase;
  message: string;
  busy: boolean;
};

type Listener = () => void;

let phase: AgentCanvasBusyPhase = "idle";
let message = "";
let snapshot: AgentCanvasBusyState = { phase: "idle", message: "", busy: false };
const listeners = new Set<Listener>();

function rebuildSnapshot(): void {
  snapshot = {
    phase,
    message,
    busy: phase !== "idle",
  };
}

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** 稳定引用；仅 phase/message 变化时换新对象 */
export function getAgentCanvasBusy(): AgentCanvasBusyState {
  return snapshot;
}

export function setAgentCanvasBusy(next: AgentCanvasBusyPhase, msg = ""): void {
  if (phase === next && message === msg) return;
  phase = next;
  message = msg;
  rebuildSnapshot();
  emit();
}

export function clearAgentCanvasBusy(): void {
  if (phase === "idle" && message === "") return;
  phase = "idle";
  message = "";
  rebuildSnapshot();
  emit();
}

/** 用户点「停止」后递增；本轮投影用开始时的 token 对比，避免下一轮误伤 */
let stopToken = 0;

export function requestAgentCanvasStop(): void {
  stopToken += 1;
}

export function getAgentCanvasStopToken(): number {
  return stopToken;
}

export function subscribeAgentCanvasBusy(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
