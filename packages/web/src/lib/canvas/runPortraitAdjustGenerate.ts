/**
 * 图片顶栏「人像质感调节」：人像调节 / 情绪调节。
 * 用户说明 + 后台 Prompt 追加 → 固定算力图生图 → 右侧结果节点。
 */
import type { QueryClient } from "@tanstack/react-query";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { runCreativeToolDirectGenerate } from "@/lib/canvas/runCreativeToolDirectGenerate";
import type { GenerationOptions } from "@/types/generationPresets";
import { toast } from "sonner";

export type PortraitAdjustKind = "portrait" | "emotion";

export const PORTRAIT_ADJUST_TOOLS: Record<
  PortraitAdjustKind,
  { canvasTool: string; label: string }
> = {
  portrait: { canvasTool: "portrait_adjust", label: "人像调节" },
  emotion: { canvasTool: "emotion_adjust", label: "情绪调节" },
};

async function loadAdminAppendPrompt(canvasTool: string): Promise<string> {
  const fallback =
    PROMPT_SUFFIX_FALLBACKS[canvasTool as keyof typeof PROMPT_SUFFIX_FALLBACKS]?.content ?? "";
  try {
    const cfg = await getPromptConfig();
    const tool = cfg.tools?.[canvasTool] as AppendPromptToolConfig | undefined;
    if (tool?.kind === "append" && tool.appendText?.trim()) {
      return tool.appendText.trim();
    }
  } catch {
    /* 回退默认 */
  }
  return fallback;
}

/** 用户说明优先，后台模板追加（与主体修改一致） */
export function buildPortraitAdjustPrompt(userPrompt: string, adminSuffix: string): string {
  const user = userPrompt.trim();
  const admin = adminSuffix.trim();
  if (user && admin) return `${user}。${admin}`;
  return user || admin;
}

/**
 * 人像 / 情绪调节：弹窗收说明 → 后台提示词 → 图生图固定算力。
 */
export async function runPortraitAdjustGenerate(opts: {
  kind: PortraitAdjustKind;
  projectId: string;
  sourceNodeId: string;
  modelName: string;
  generationOptions: GenerationOptions;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  userPrompt: string;
  onRefetchPricing?: () => void;
}): Promise<boolean> {
  const meta = PORTRAIT_ADJUST_TOOLS[opts.kind];
  const userPrompt = opts.userPrompt.trim();
  if (!userPrompt) {
    toast.error(`请填写${meta.label}说明`);
    return false;
  }

  const adminSuffix = await loadAdminAppendPrompt(meta.canvasTool);
  const prompt = buildPortraitAdjustPrompt(userPrompt, adminSuffix);
  if (!prompt.trim()) {
    toast.error(`请在后台「Prompt 模板」配置「${meta.label}」提示词`);
    return false;
  }

  const nodeId = await runCreativeToolDirectGenerate({
    projectId: opts.projectId,
    sourceNodeId: opts.sourceNodeId,
    label: meta.label,
    prompt,
    modelName: opts.modelName,
    generationOptions: opts.generationOptions,
    workflowId: opts.workflowId,
    creditsEnabled: opts.creditsEnabled,
    queryClient: opts.queryClient,
    canvasTool: meta.canvasTool,
    onRefetchPricing: opts.onRefetchPricing,
  });
  return Boolean(nodeId);
}
