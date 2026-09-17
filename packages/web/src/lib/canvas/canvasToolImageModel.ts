"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listModels, type CanvasModel } from "@/lib/api/models";
import { useGlobalWatermark } from "@/components/providers/GlobalWatermarkProvider";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import { useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";
import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";

/** 多角度 / 打光 / 全景 / 九宫格图生图 + 宫格切分本地工具：全能图片 Pro 图生图（切分仅用其模型名结算） */
export const CANVAS_TOOL_I2I_MODEL = "";

/** 顶部菜单后缀工具：点击后直接图生图（宫格切分为本地切分，不含） */
export const CANVAS_SUFFIX_I2I_TOOLS = ["panorama", "grid_9"] as const;
export type CanvasSuffixI2iToolId = (typeof CANVAS_SUFFIX_I2I_TOOLS)[number];

export function isCanvasSuffixI2iTool(tool: string): tool is CanvasSuffixI2iToolId {
  return (CANVAS_SUFFIX_I2I_TOOLS as readonly string[]).includes(tool);
}

function isUsableModel(m: CanvasModel): boolean {
  return Boolean(m.isAvailable && m.isConfigured !== false && m.isImplemented !== false);
}

/** Shared image-to-image model for canvas tool panels (multi-angle, lighting, suffix tools). */
export function useCanvasToolImageModel() {
  const { enabled: globalWatermarkEnabled } = useGlobalWatermark();
  const { data: imageModels } = useQuery({
    queryKey: ["models", "image"],
    queryFn: () => listModels({ category: "image" }),
    staleTime: 60_000,
  });

  const model = useMemo(() => {
    const preferred = (imageModels ?? []).find(
      (m) => m.name === CANVAS_TOOL_I2I_MODEL && isUsableModel(m)
    );
    if (preferred) return preferred;

    const anyI2i = (imageModels ?? []).find(
      (m) => m.name.endsWith("_i2i") && isUsableModel(m)
    );
    if (anyI2i) return anyI2i;

    return (imageModels ?? []).find(isUsableModel) ?? null;
  }, [imageModels]);

  const generationPresets: GenerationPresetsConfig | null = useMemo(
    () => getModelGenerationPresets(model ?? undefined),
    [model]
  );

  const normalizedDefaults = useMemo(
    () => defaultGenerationOptions(generationPresets),
    [generationPresets, globalWatermarkEnabled]
  );

  return {
    modelName: model?.name ?? "",
    category: "image" as const,
    selectedModel: model,
    generationPresets,
    defaultGenerationOptions: normalizedDefaults,
    normalizeGenerationOptions: (options: GenerationOptions | undefined) =>
      normalizeGenerationOptions(generationPresets, options),
    hasModel: Boolean(model),
    apiModels: imageModels ?? [],
  };
}

/**
 * Credit quote for canvas I2I tools（多角度、打光、全景/九宫格/宫格切分、画板 AI、导演台预览）.
 * Always uses the tool model's default quality/resolution — not the host node's model options.
 * 传入 canvasTool 时走画布工具报价（有主模型则跟主模型档位价）。
 */
export function useToolImageCreditQuote(enabled = true, canvasTool?: string) {
  const tool = useCanvasToolImageModel();
  const pricing = tool.selectedModel?.parameters?.pricing as Record<string, unknown> | undefined;
  const pricingVersion = Math.max(Number(pricing?.version) || 0, 0);
  const quote = useGenerationCreditQuote({
    model: tool.modelName || undefined,
    category: tool.category,
    generationOptions: tool.defaultGenerationOptions,
    pricing: canvasTool ? undefined : pricing,
    pricingVersion: canvasTool ? undefined : pricingVersion,
    canvasTool,
    enabled: enabled && tool.hasModel && Boolean(tool.modelName),
  });

  return {
    ...tool,
    ...quote,
    pricingVersion: quote.pricingVersion ?? pricingVersion,
  };
}
