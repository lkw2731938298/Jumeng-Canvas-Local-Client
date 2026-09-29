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

/** 当前助手回合的 AbortController：点停止时 abort，打断流式 fetch */
let turnAbort: AbortController | null = null;

/** 用户主动停止（勿当瞬时错误重试） */
export class AgentTurnAbortedError extends Error {
  constructor(message = "已停止") {
    super(message);
    this.name = "AgentTurnAbortedError";
  }
}

export function isAgentTurnAbortedError(err: unknown): boolean {
  if (err instanceof AgentTurnAbortedError) return true;
  return err instanceof Error && err.name === "AgentTurnAbortedError";
}

/** 新回合开始时调用：拿到 signal + 本轮 stop token */
export function beginAgentTurnControl(): { signal: AbortSignal; stopAt: number } {
  try {
    turnAbort?.abort();
  } catch {
    /* ignore */
  }
  turnAbort = new AbortController();
  return { signal: turnAbort.signal, stopAt: stopToken };
}

/** 回合结束（无论成功/失败/停止）释放引用 */
export function endAgentTurnControl(): void {
  turnAbort = null;
}

export function requestAgentCanvasStop(): void {
  stopToken += 1;
  try {
    turnAbort?.abort();
  } catch {
    /* ignore */
  }
  // 立刻清忙碌态，避免 UI 仍显示「思考中」和停止按钮空转
  clearAgentCanvasBusy();
}

export function getAgentCanvasStopToken(): number {
  return stopToken;
}

/** 当前回合 AbortSignal（无进行中回合时为 null） */
export function getAgentTurnAbortSignal(): AbortSignal | null {
  return turnAbort?.signal ?? null;
}

export function subscribeAgentCanvasBusy(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
