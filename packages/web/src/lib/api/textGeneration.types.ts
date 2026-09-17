export interface GenerationReference {
  nodeId: string;
  /** file=文档（Office/PDF/文本/iWork 等）；link=网页网址（万相 3.0 等） */
  type: "text" | "image" | "video" | "audio" | "file" | "link";
  label?: string;
  content?: string;
  url?: string;
  /** 参考视频时长（秒），供 MiniMax-H3 等素材用量计费与报价对齐 */
  durationSec?: number;
}

export interface TextGenerationRequest {
  projectId: string;
  nodeId: string;
  workflowId?: string;
  content: string;
  model: string;
  textPromptKind?: string;
  references?: GenerationReference[];
  /** 管理端生成日志：分镜表等批量场景传 auto */
  submitSource?: "manual" | "auto" | "dedupe";
  /** 分镜表等固定算力工具 */
  canvasTool?: string;
}

export interface TextGenerationResponse {
  jobId: number;
  status: "pending" | "awaiting_approval" | "succeeded" | "failed";
  content: string;
  model: string;
  message?: string;
  creditCost?: number;
}
