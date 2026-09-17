export type NodeCategory = "input" | "model" | "generation" | "control" | "postprocess" | "output";

export type PortType =
  | "image"
  | "latent"
  | "text"
  | "video"
  | "audio"
  | "document"
  | "model"
  | "vae"
  | "condition"
  | "reference";

export type NodeStatus = "idle" | "running" | "success" | "error";

export interface PortDefinition {
  id: string;
  type: PortType;
  label: string;
  required?: boolean;
}

export interface ParamDefinition {
  key: string;
  label: string;
  type: "string" | "number" | "select" | "slider" | "seed" | "toggle";
  default: unknown;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: NodeCategory;
  icon: string;
  color: string;
  defaultWidth: number;
  defaultHeight: number;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: ParamDefinition[];
}

export const PORT_COLORS: Record<PortType, string> = {
  image: "#f59e0b",
  latent: "#8b5cf6",
  text: "#10b981",
  video: "#ef4444",
  audio: "#ec4899",
  document: "#a78bfa",
  model: "#3b82f6",
  vae: "#06b6d4",
  condition: "#f97316",
  reference: "#94a3b8",
};

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  input: "#e2e8f0",
  model: "#3b82f6",
  generation: "#8b5cf6",
  control: "#f97316",
  postprocess: "#10b981",
  output: "#f59e0b",
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  input: "输入",
  model: "模型",
  generation: "生成",
  control: "控制",
  postprocess: "后处理",
  output: "输出",
};
