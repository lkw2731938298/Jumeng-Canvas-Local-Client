import { generateFromTextNode } from "@/lib/api/textGeneration";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { getJobStatus, pollGenerationJob } from "@/lib/api/workflows";
import { newIdempotencyKey } from "@/lib/canvas/generationCreditHelpers";

function extractJobResultText(raw: Record<string, unknown>): string {
  const direct = String(raw.resultText ?? raw.result_text ?? "").trim();
  if (direct) return direct;
  const outputs = (raw.outputAssets ?? raw.output_assets ?? []) as Array<Record<string, unknown>>;
  for (const item of outputs) {
    const text = String(item.content ?? item.text ?? "").trim();
    if (text) return text;
  }
  return "";
}

export async function runStoryboardTextJob(opts: {
  projectId: string;
  nodeId: string;
  workflowId?: string;
  content: string;
  model: string;
  textPromptKind: string;
  canvasTool?: string;
  quoteToken?: string;
  idempotencySuffix: string;
  /** 爆款拉片等：传入参考视频 / 关键帧图 */
  references?: GenerationReference[];
}): Promise<{ text: string; creditCost?: number }> {
  const result = await generateFromTextNode(
    {
      projectId: opts.projectId,
      nodeId: opts.nodeId,
      workflowId: opts.workflowId,
      content: opts.content.trim(),
      model: opts.model,
      textPromptKind: opts.textPromptKind,
      references: opts.references ?? [],
      submitSource: "auto",
      canvasTool: opts.canvasTool,
    },
    {
      // nodeId 已含 grid+行 ID，幂等键仅用短后缀，避免超过 DB/VARCHAR(128)
      idempotencyKey: newIdempotencyKey(opts.idempotencySuffix),
      quoteToken: opts.quoteToken,
    }
  );

  let generated = result.content?.trim() ?? "";

  if (result.status === "awaiting_approval") {
    throw new Error(result.message || "已提交审批，等待项目创建者确认");
  }

  if (result.status === "pending" && result.jobId) {
    const polled = await pollGenerationJob(result.jobId, { maxWaitMs: 900_000 });
    if (polled.status !== "succeeded") {
      throw new Error(polled.errorMessage || "文本生成失败");
    }
    generated = polled.resultText?.trim() ?? "";
    if (!generated) {
      const job = (await getJobStatus(result.jobId)) as Record<string, unknown>;
      generated = extractJobResultText(job);
    }
  }

  if (result.status !== "pending" && result.status !== "succeeded") {
    throw new Error(result.message || "文本生成失败");
  }

  if (!generated) {
    throw new Error(result.message || "文本生成返回为空");
  }

  return { text: generated, creditCost: result.creditCost };
}
