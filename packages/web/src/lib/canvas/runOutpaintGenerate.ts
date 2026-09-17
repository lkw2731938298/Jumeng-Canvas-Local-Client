import type { QueryClient } from "@tanstack/react-query";
import { getPromptConfig } from "@/lib/api/promptConfig";
import {
  PROMPT_SUFFIX_FALLBACKS,
} from "@/lib/admin/promptToolCategories";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { runCreativeToolDirectGenerate } from "@/lib/canvas/runCreativeToolDirectGenerate";
import type { InlineImageOutpaintState, OutpaintMargins } from "@/lib/canvas/imageOutpaint";
import type { GenerationOptions } from "@/types/generationPresets";
import { toast } from "sonner";

export const OUTPAINT_CANVAS_TOOL = "outpaint";

/** 根据外扩边距拼一段方向说明，拼进后台扩图提示词 */
export function buildOutpaintMarginHint(margins: OutpaintMargins): string {
  const parts: string[] = [];
  if (margins.top > 0) parts.push(`向上扩展`);
  if (margins.right > 0) parts.push(`向右扩展`);
  if (margins.bottom > 0) parts.push(`向下扩展`);
  if (margins.left > 0) parts.push(`向左扩展`);
  if (!parts.length) return "适度向外扩展画面四周";
  return `${parts.join("、")}画面，补全延伸区域`;
}

function hasOutpaintMargins(margins: OutpaintMargins): boolean {
  return margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0;
}

/** 读取后台「扩图」追加提示词 */
export async function loadOutpaintAdminPrompt(): Promise<string> {
  const fallback = PROMPT_SUFFIX_FALLBACKS.outpaint.content;
  try {
    const cfg = await getPromptConfig();
    const tool = cfg.tools?.outpaint as AppendPromptToolConfig | undefined;
    if (tool?.kind === "append" && tool.appendText?.trim()) {
      return tool.appendText.trim();
    }
  } catch {
    /* 回退默认 */
  }
  return fallback;
}

/** 扩图参数 → generationOptions（尽量映射到模型预设键） */
export function outpaintStateToGenerationOptions(
  defaults: GenerationOptions,
  state: InlineImageOutpaintState
): GenerationOptions {
  const next: GenerationOptions = { ...defaults };
  if (state.aspectRatio && state.aspectRatio !== "original") {
    next.aspect = state.aspectRatio;
    next.aspectRatio = state.aspectRatio;
  }
  const resKey = state.resolution; // 1k | 2k | 4k
  next.resolution = resKey;
  next.quality = resKey;
  next.count = String(state.count);
  next.n = String(state.count);
  return next;
}

/**
 * 扩图：后台提示词 + 外扩说明 → 固定算力图生图 → 右侧结果节点。
 */
export async function runOutpaintGenerate(opts: {
  projectId: string;
  sourceNodeId: string;
  outpaint: InlineImageOutpaintState;
  modelName: string;
  generationOptions: GenerationOptions;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  onRefetchPricing?: () => void;
}): Promise<boolean> {
  if (!hasOutpaintMargins(opts.outpaint.margins)) {
    toast.error("请先拖动边缘或点击「+」扩展画布区域");
    return false;
  }

  const adminPrompt = await loadOutpaintAdminPrompt();
  const hint = buildOutpaintMarginHint(opts.outpaint.margins);
  const prompt = [adminPrompt, hint].filter(Boolean).join("，");
  const generationOptions = outpaintStateToGenerationOptions(
    opts.generationOptions,
    opts.outpaint
  );

  const nodeId = await runCreativeToolDirectGenerate({
    projectId: opts.projectId,
    sourceNodeId: opts.sourceNodeId,
    label: "扩图",
    prompt,
    modelName: opts.modelName,
    generationOptions,
    workflowId: opts.workflowId,
    creditsEnabled: opts.creditsEnabled,
    queryClient: opts.queryClient,
    canvasTool: OUTPAINT_CANVAS_TOOL,
    onRefetchPricing: opts.onRefetchPricing,
  });
  return Boolean(nodeId);
}
