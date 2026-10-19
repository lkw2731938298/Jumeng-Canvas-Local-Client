import type { QueryClient } from "@tanstack/react-query";
import { getPromptConfig } from "@/lib/api/promptConfig";
import {
  PROMPT_SUFFIX_FALLBACKS,
} from "@/lib/admin/promptToolCategories";
import type { AppendPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { runCreativeToolDirectGenerate } from "@/lib/canvas/runCreativeToolDirectGenerate";
import {
  type InlineImageOutpaintState,
  type OutpaintMargins,
  outpaintOutputSize,
} from "@/lib/canvas/imageOutpaint";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { listModels } from "@/lib/api/models";
import {
  HD_NANO_BANANA_I2I_CATALOG,
  HD_NANO_BANANA_I2I_DISPLAY,
  HD_NANO_BANANA_I2I_UPSTREAM,
  pickHdNanoBananaCatalogModel,
  probeImageNaturalSize,
} from "@/lib/local/topazHdUpscale";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import { toast } from "sonner";

export const OUTPAINT_CANVAS_TOOL = "outpaint";

/** 单边上限（与 HD 一致） */
const OUTPAINT_MAX_SIDE_PX = 8192;

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

/** 固定扩图上游模型 gemini-nano-banana-2.1 */
async function resolveOutpaintNanoBananaModel(fallback?: string): Promise<string> {
  try {
    const list = await listModels({ category: "image" });
    const hit = pickHdNanoBananaCatalogModel(list);
    if (hit?.name) return hit.name;
  } catch {
    /* ignore */
  }
  return fallback || HD_NANO_BANANA_I2I_CATALOG;
}

/**
 * 扩图参数 → generationOptions。
 * 有扩图画布像素 size（WxH）时优先写入，上游按扩展后尺寸出图。
 */
export function outpaintStateToGenerationOptions(
  defaults: GenerationOptions,
  state: InlineImageOutpaintState,
  outputSizePx?: { width: number; height: number } | null
): GenerationOptions {
  const next: GenerationOptions = { ...defaults };
  if (outputSizePx && outputSizePx.width >= 2 && outputSizePx.height >= 2) {
    let w = Math.round(outputSizePx.width);
    let h = Math.round(outputSizePx.height);
    const long = Math.max(w, h);
    if (long > OUTPAINT_MAX_SIDE_PX) {
      const shrink = OUTPAINT_MAX_SIDE_PX / long;
      w = Math.max(2, Math.round(w * shrink));
      h = Math.max(2, Math.round(h * shrink));
    }
    w -= w % 2;
    h -= h % 2;
    const size = `${w}x${h}`;
    next.size = size;
    next.hdOutputSize = size;
    next.outpaintOutputSize = size;
    // 有像素 size 时不再塞画幅/清晰度档，避免盖成 1:1 / 2K 方图
    delete next.aspect;
    delete next.aspectRatio;
    delete next.aspect_ratio;
    delete next.ratio;
  } else if (state.aspectRatio && state.aspectRatio !== "original") {
    next.aspect = state.aspectRatio;
    next.aspectRatio = state.aspectRatio;
  }
  const resKey = state.resolution; // 1k | 2k | 4k
  if (!(outputSizePx && outputSizePx.width >= 2)) {
    next.resolution = resKey;
    next.quality = resKey;
  }
  next.count = String(state.count);
  next.n = String(state.count);
  next.hdModel = HD_NANO_BANANA_I2I_UPSTREAM;
  return next;
}

/**
 * 扩图：固定 gemini-nano-banana-2.1；按外扩框换算输出像素 WxH 提交。
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

  const store = useCanvasStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === opts.sourceNodeId);
  if (!sourceNode) {
    toast.error("源节点不存在");
    return false;
  }

  const modelName = await resolveOutpaintNanoBananaModel(opts.modelName);
  if (!modelName) {
    toast.error(`扩图模型未配置（请确保设置中已添加「${HD_NANO_BANANA_I2I_DISPLAY}」）`);
    return false;
  }

  const params = (sourceNode.data?.params ?? {}) as Record<string, unknown>;
  const sourceUrl = await resolveNodeMediaUrl(opts.projectId, params, "imageUrl");
  if (!sourceUrl) {
    toast.error("请先上传参考图片");
    return false;
  }

  // 按外扩框相对节点尺寸，换算成原图像素上的目标宽高
  let outputSizePx: { width: number; height: number } | null = null;
  try {
    const nat = await probeImageNaturalSize(sourceUrl);
    const nodeW = Math.max(1, Number(sourceNode.width) || 280);
    const nodeH = Math.max(1, Number(sourceNode.height) || 280);
    outputSizePx = outpaintOutputSize({
      nodeWidth: nodeW,
      nodeHeight: nodeH,
      naturalWidth: nat.width,
      naturalHeight: nat.height,
      margins: opts.outpaint.margins,
    });
  } catch {
    toast.error("无法读取原图像素尺寸，请确认参考图已加载后重试");
    return false;
  }

  const adminPrompt = await loadOutpaintAdminPrompt();
  const hint = buildOutpaintMarginHint(opts.outpaint.margins);
  const sizeHint = outputSizePx
    ? `输出尺寸 ${outputSizePx.width}x${outputSizePx.height}`
    : "";
  const prompt = [adminPrompt, hint, sizeHint].filter(Boolean).join("，");
  const generationOptions = outpaintStateToGenerationOptions(
    opts.generationOptions,
    opts.outpaint,
    outputSizePx
  );

  const nodeId = await runCreativeToolDirectGenerate({
    projectId: opts.projectId,
    sourceNodeId: opts.sourceNodeId,
    label: "扩图",
    prompt,
    modelName,
    generationOptions,
    workflowId: opts.workflowId,
    creditsEnabled: opts.creditsEnabled,
    queryClient: opts.queryClient,
    canvasTool: OUTPAINT_CANVAS_TOOL,
    onRefetchPricing: opts.onRefetchPricing,
  });
  return Boolean(nodeId);
}
