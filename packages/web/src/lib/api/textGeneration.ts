import { apiFetch } from "./client";
import type { TextGenerationRequest, TextGenerationResponse } from "./textGeneration.types";
import { isLocalDesktop } from "@/lib/localDesktop";
import { localGenerateText } from "@/lib/local/generate";
import { composeLocalTextGeneration } from "@/lib/local/localTextPrompt";

export type { TextGenerationRequest, TextGenerationResponse } from "./textGeneration.types";
export type { GenerationSubmitOptions } from "./mediaGeneration";

import type { GenerationSubmitOptions } from "./mediaGeneration";

/** 本地桌面：跳过云端 Worker，直连用户配置的上游文本模型；并套用 textPromptKind 内置提示词 */
async function generateFromTextNodeLocal(
  request: TextGenerationRequest,
  options?: GenerationSubmitOptions
): Promise<TextGenerationResponse> {
  if (options?.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  // 开源本地无后台 prompt-config：必须按 kind 拼 system/user，否则分镜表只会得到散文而不是 JSON
  const composed = composeLocalTextGeneration({
    content: request.content,
    textPromptKind: request.textPromptKind,
    canvasTool: request.canvasTool,
  });
  const content = await localGenerateText({
    modelId: request.model,
    prompt: composed.prompt,
    system: composed.system,
    signal: options?.signal,
  });
  return {
    jobId: Date.now(),
    status: "succeeded",
    content,
    model: request.model,
    message: "本地生成完成",
    creditCost: 0,
  };
}

export async function generateFromTextNode(
  request: TextGenerationRequest,
  options?: GenerationSubmitOptions
): Promise<TextGenerationResponse> {
  if (isLocalDesktop) {
    return generateFromTextNodeLocal(request, options);
  }
  return apiFetch<TextGenerationResponse>("/api/v1/text/generate", {
    method: "POST",
    headers: options?.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
    signal: options?.signal,
    body: JSON.stringify({
      projectId: request.projectId,
      nodeId: request.nodeId,
      workflowId: request.workflowId,
      content: request.content,
      model: request.model,
      ...(request.textPromptKind ? { textPromptKind: request.textPromptKind } : {}),
      references: request.references ?? [],
      ...(request.submitSource ? { submitSource: request.submitSource } : {}),
      ...(request.canvasTool ? { canvasTool: request.canvasTool } : {}),
      ...(options?.quoteToken ? { quoteToken: options.quoteToken } : {}),
      ...(options?.expectedPricingVersion != null
        ? { expectedPricingVersion: options.expectedPricingVersion }
        : {}),
    }),
  });
}
