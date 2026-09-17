import { apiFetch } from "./client";
import type { PromptToolConfig } from "@/lib/canvas/renderToolPrompt";

export interface PromptConfigResponse {
  version: number;
  tools: Record<string, PromptToolConfig>;
}

export interface PromptToolResponse {
  tool: string;
  config: PromptToolConfig;
}

export interface PromptPreviewResponse {
  tool: string;
  prompt: string;
  errors: string[];
}

export function getPromptConfig() {
  return apiFetch<PromptConfigResponse>("/api/v1/prompt-config");
}

export function getPromptToolConfig(toolId: string) {
  return apiFetch<PromptToolResponse>(`/api/v1/prompt-config/${encodeURIComponent(toolId)}`);
}

export function previewPromptTool(tool: string, runtime: Record<string, unknown>) {
  return apiFetch<PromptPreviewResponse>("/api/v1/prompt-config/preview", {
    method: "POST",
    body: JSON.stringify({ tool, runtime }),
  });
}
