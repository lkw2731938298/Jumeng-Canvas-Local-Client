/**
 * 画布操控模式：用户指定的生图 / 生视频模型偏好（前端投影与快照共用）。
 */

/** 与后端 agent_default_models 对齐 */
export const AGENT_DEFAULT_IMAGE_T2I = "";
export const AGENT_DEFAULT_VIDEO_R2V = "";

const STORAGE_KEY = "jumeng:agent_canvas_media_models_v1";

export type AgentCanvasMediaModels = {
  imageModel: string;
  videoModel: string;
};

type Listener = () => void;

let state: AgentCanvasMediaModels = {
  imageModel: AGENT_DEFAULT_IMAGE_T2I,
  videoModel: AGENT_DEFAULT_VIDEO_R2V,
};
const listeners = new Set<Listener>();

function readStored(): AgentCanvasMediaModels | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AgentCanvasMediaModels>;
    const imageModel = String(parsed?.imageModel || "").trim();
    const videoModel = String(parsed?.videoModel || "").trim();
    if (!imageModel && !videoModel) return null;
    return {
      imageModel: imageModel || AGENT_DEFAULT_IMAGE_T2I,
      videoModel: videoModel || AGENT_DEFAULT_VIDEO_R2V,
    };
  } catch {
    return null;
  }
}

function persist(next: AgentCanvasMediaModels): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** 客户端首次读取 localStorage */
export function hydrateAgentCanvasMediaModels(): AgentCanvasMediaModels {
  const stored = readStored();
  if (stored) state = stored;
  return state;
}

export function getAgentCanvasMediaModels(): AgentCanvasMediaModels {
  return state;
}

export function setAgentCanvasMediaModels(
  patch: Partial<AgentCanvasMediaModels>
): AgentCanvasMediaModels {
  const next: AgentCanvasMediaModels = {
    imageModel: String(patch.imageModel ?? state.imageModel).trim() || AGENT_DEFAULT_IMAGE_T2I,
    videoModel: String(patch.videoModel ?? state.videoModel).trim() || AGENT_DEFAULT_VIDEO_R2V,
  };
  state = next;
  persist(next);
  listeners.forEach((fn) => fn());
  return next;
}

export function subscribeAgentCanvasMediaModels(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
