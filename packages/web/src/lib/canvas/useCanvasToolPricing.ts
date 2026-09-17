"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCanvasToolPricing } from "@/lib/api/credits";
import {
  estimateCanvasVideoToolCredits,
  isCanvasVideoBillingTool,
} from "@/lib/canvas/canvasVideoToolBilling";
import {
  useCanvasToolImageModel,
} from "@/lib/canvas/canvasToolImageModel";
import { useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";

/** 画布工具算力配置（顶栏按钮展示；视频工具 creditCost=每秒单价） */
export function useCanvasToolPricingMap(enabled = true) {
  const query = useQuery({
    queryKey: ["credits", "canvas-tool-pricing"],
    queryFn: getCanvasToolPricing,
    staleTime: 30_000,
    enabled,
  });

  const costByTool = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of query.data?.items ?? []) {
      map[item.toolId] = item.creditCost;
    }
    return map;
  }, [query.data?.items]);

  const billingModeByTool = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of query.data?.items ?? []) {
      map[item.toolId] =
        item.billingMode ||
        (isCanvasVideoBillingTool(item.toolId)
          ? "video_input_plus_output_per_second"
          : "fixed");
    }
    return map;
  }, [query.data?.items]);

  /** 顶栏展示用：视频工具按 (输入+输出)×每秒 估算总价 */
  const displayCostForTool = useMemo(() => {
    return (toolId: string, durationSec: number): number | undefined => {
      const rate = costByTool[toolId];
      if (rate == null) return undefined;
      if (
        billingModeByTool[toolId] === "video_input_plus_output_per_second" ||
        isCanvasVideoBillingTool(toolId)
      ) {
        return estimateCanvasVideoToolCredits(rate, durationSec);
      }
      return rate;
    };
  }, [costByTool, billingModeByTool]);

  return {
    ...query,
    costByTool,
    billingModeByTool,
    displayCostForTool,
    creditsEnabled: query.data?.creditsEnabled ?? true,
    version: query.data?.version ?? 0,
  };
}

/** 指定画布工具的提交报价（主模型档位价 / 本地固定价兜底） */
export function useCanvasToolFixedCreditQuote(canvasTool: string, enabled = true) {
  const tool = useCanvasToolImageModel();
  const quote = useGenerationCreditQuote({
    model: tool.modelName || undefined,
    category: tool.category,
    generationOptions: tool.defaultGenerationOptions,
    canvasTool,
    pricingVersion: undefined,
    enabled: enabled && tool.hasModel && Boolean(tool.modelName) && Boolean(canvasTool),
  });

  return {
    ...tool,
    ...quote,
  };
}
