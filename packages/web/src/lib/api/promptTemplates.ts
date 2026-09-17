import { apiFetch } from "./client";

export interface PromptTemplate {
  id: string;
  tool: string;
  category: string;
  key: string;
  label: string;
  content: string;
  enabled: boolean;
  sortOrder: number;
}

export interface PromptTemplateList {
  tool: string;
  templates: PromptTemplate[];
}

export function listPromptTemplates(tool = "multi_angle") {
  return apiFetch<PromptTemplateList>(`/api/v1/prompt-templates?tool=${encodeURIComponent(tool)}`);
}
