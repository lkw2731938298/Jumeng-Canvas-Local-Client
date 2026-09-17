/**
 * 故事板 / 调度故事板：用户描述 + 参考图 → 后台追加提示词 → 一张多镜合成图（图文一体）。
 */
import type { QueryClient } from "@tanstack/react-query";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { PROMPT_SUFFIX_FALLBACKS } from "@/lib/admin/promptToolCategories";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { runCreativeToolDirectGenerate } from "@/lib/canvas/runCreativeToolDirectGenerate";
import type { GenerationOptions } from "@/types/generationPresets";
import { toast } from "sonner";

export type StoryboardSheetKind = "storyboard" | "blocking_storyboard";

export const STORYBOARD_SHEET_TOOLS: Record<
  StoryboardSheetKind,
  { canvasTool: string; label: string }
> = {
  storyboard: { canvasTool: "storyboard", label: "故事板" },
  blocking_storyboard: { canvasTool: "blocking_storyboard", label: "调度故事板" },
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

/** 用户剧情说明优先，后台版式/约束提示词追加 */
export function buildStoryboardSheetPrompt(userPrompt: string, adminSuffix: string): string {
  const user = userPrompt.trim();
  const admin = adminSuffix.trim();
  if (user && admin) return `${user}\n\n${admin}`;
  return user || admin;
}

/** 从节点 prompt 剥掉历史误写入的后台版式追加词，只保留用户剧情 */
export function stripStoryboardAdminAppend(prompt: string): string {
  const text = prompt.trim();
  if (!text) return "";
  const markers = [
    "生成一张完整的电影故事板合成长图",
    "生成一张完整的「调度故事板」合成长图",
  ];
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx >= 0) return text.slice(0, idx).trim();
  }
  return text;
}

/**
 * 故事板 / 调度故事板：参考图 + 文字 → 固定算力一张合成图。
 */
export async function runStoryboardSheetGenerate(opts: {
  kind: StoryboardSheetKind;
  projectId: string;
  sourceNodeId: string;
  modelName: string;
  generationOptions: GenerationOptions;
  workflowId?: string | null;
  creditsEnabled: boolean;
  queryClient: QueryClient;
  userPrompt: string;
  /** 额外参考图（角色三视图、设定图等）；源节点图由 runCreativeToolDirectGenerate 作为 sourceUrl */
  references?: GenerationReference[];
  onRefetchPricing?: () => void;
  /** 失败时回传真实原因（Agent 聊天旁白用） */
  onError?: (message: string) => void;
}): Promise<string | null> {
  const meta = STORYBOARD_SHEET_TOOLS[opts.kind];
  const userPrompt = opts.userPrompt.trim();
  if (!userPrompt) {
    toast.error(`请填写${meta.label}剧情描述`);
    opts.onError?.(`请填写${meta.label}剧情描述`);
    return null;
  }

  const adminSuffix = await loadAdminAppendPrompt(meta.canvasTool);
  const prompt = buildStoryboardSheetPrompt(userPrompt, adminSuffix);
  if (!prompt.trim()) {
    toast.error(`请在后台「Prompt 模板」配置「${meta.label}」提示词`);
    return null;
  }

  return runCreativeToolDirectGenerate({
    projectId: opts.projectId,
    sourceNodeId: opts.sourceNodeId,
    label: meta.label,
    prompt,
    /** 结果节点卡片只保留用户剧情，不展示后台版式追加词 */
    nodePrompt: userPrompt,
    modelName: opts.modelName,
    generationOptions: opts.generationOptions,
    workflowId: opts.workflowId,
    creditsEnabled: opts.creditsEnabled,
    queryClient: opts.queryClient,
    canvasTool: meta.canvasTool,
    references: opts.references,
    /** 允许纯文字 + 上传参考（无源节点图时由 references[0] 作 sourceUrl） */
    allowMissingSourceImage: true,
    onRefetchPricing: opts.onRefetchPricing,
    onError: opts.onError,
  });
}
