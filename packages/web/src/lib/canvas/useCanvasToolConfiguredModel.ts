"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { canvasToolModelPrimary, getCanvasToolModels } from "@/lib/api/canvasTools";
import { listModels } from "@/lib/api/models";
import {
  CANVAS_TOOL_I2I_MODEL,
  useCanvasToolImageModel,
} from "@/lib/canvas/canvasToolImageModel";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
} from "@/lib/canvas/generationPresets";
import { useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";
import { useGlobalWatermark } from "@/components/providers/GlobalWatermarkProvider";
import type { GenerationOptions } from "@/types/generationPresets";

/**
 * 读取后台「模型开关」为某画布工具配置的主模型，并用于固定算力报价。
 * 图片工具未配置时回退全能 Pro 图生图；视频工具须后台配置主模型；文本工具回退 doubao_pro。
 */
export function useCanvasToolConfiguredModel(
  toolId: string,
  enabled = true,
  category: "image" | "video" | "audio" | "text" = "image",
  extraGenerationOptions?: GenerationOptions
) {
  const { enabled: globalWatermarkEnabled } = useGlobalWatermark();
  const fallback = useCanvasToolImageModel();

  const { data: toolModels } = useQuery({
    queryKey: ["canvas-tool-models"],
    queryFn: getCanvasToolModels,
    staleTime: 30_000,
    enabled,
  });

  const { data: catalogModels } = useQuery({
    queryKey: ["models", category],
    queryFn: () => listModels({ category }),
    staleTime: 60_000,
    enabled,
  });

  const primaryName = useMemo(() => {
    // 须走 canvasToolModelPrimary：tools 字典 key 可能已被转成驼峰
    const fromAdmin = canvasToolModelPrimary(toolModels?.tools, toolId);
    if (fromAdmin) return fromAdmin;
    // 本地版：回退到目录中该类目第一个可用模型
    const firstLocal = (catalogModels ?? []).find((m) => m.isAvailable)?.name;
    if (firstLocal) return firstLocal;
    if (category === "image") {
      if (fallback.modelName) return fallback.modelName;
      return CANVAS_TOOL_I2I_MODEL;
    }
    if (category === "video") return "rh_seedance_20_r2v";
    if (category === "text") return "doubao_pro";
    return "";
  }, [catalogModels, category, fallback.modelName, toolId, toolModels?.tools]);

  const selectedModel = useMemo(() => {
    const list = catalogModels ?? [];
    return list.find((m) => m.name === primaryName) ?? null;
  }, [catalogModels, primaryName]);

  const displayName =
    selectedModel?.displayName?.trim() || primaryName || "未配置模型";

  const generationPresets = useMemo(
    () =>
      getModelGenerationPresets(
        selectedModel ?? (category === "image" ? fallback.selectedModel ?? undefined : undefined)
      ),
    [category, fallback.selectedModel, selectedModel]
  );

  const extraOptionsKey = extraGenerationOptions
    ? JSON.stringify(
        Object.keys(extraGenerationOptions)
          .sort()
          .map((key) => [key, extraGenerationOptions[key]])
      )
    : "";

  const generationOptions = useMemo(
    () => ({
      ...defaultGenerationOptions(generationPresets),
      ...(extraGenerationOptions ?? {}),
    }),
    // extraOptionsKey 覆盖 extraGenerationOptions 引用变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generationPresets, globalWatermarkEnabled, extraOptionsKey]
  );

  const quote = useGenerationCreditQuote({
    model: primaryName || undefined,
    category,
    generationOptions,
    canvasTool: toolId,
    enabled: enabled && Boolean(primaryName),
  });

  return {
    modelName: primaryName,
    displayName,
    // 有后台/回退模型名即可提交；目录缺展示名时仍允许（后端会再解析）
    hasModel: Boolean(primaryName),
    selectedModel,
    defaultGenerationOptions: generationOptions,
    ...quote,
  };
}
