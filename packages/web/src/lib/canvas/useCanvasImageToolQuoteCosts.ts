"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { canvasToolModelPrimary, getCanvasToolModels } from "@/lib/api/canvasTools";
import { getCreditQuote, resolveQuoteTotal } from "@/lib/api/credits";
import { CANVAS_TOOL_I2I_MODEL } from "@/lib/canvas/canvasToolImageModel";
import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";

/**
 * 图片节点顶栏 / 九宫格弹层会展示预扣价的工具。
 * 与提交路径一致：GET /credits/quote + 后台主模型 + canvasTool。
 */
const IMAGE_TOOL_QUOTE_IDS = [
  "multi_angle",
  "lighting",
  "panorama",
  "grid_9",
  "grid_25",
  "plot_grid_4",
  "frame_forward_3s",
  "frame_back_5s",
  "cinematic_lighting",
  "multi_cam_grid_9",
  "face_tri_view",
  "character_sheet",
  "character_tri_view",
  "scene_sheet",
  "product_sheet",
  "outpaint",
  "cutout",
  "hd_upscale",
  "portrait_adjust",
  "emotion_adjust",
  "drawing_board_ai",
  "storyboard",
  "blocking_storyboard",
] as const;

/** 视频节点「解析」分镜：文本主模型按次预扣 */
const VIDEO_PARSE_TOOL_ID = "storyboard_from_video";

const QUOTE_TOOL_IDS = [...IMAGE_TOOL_QUOTE_IDS, VIDEO_PARSE_TOOL_ID];

const TOOL_QUOTE_CATEGORY: Record<string, ModelCategory> = {
  storyboard_from_video: "text",
};

/**
 * 图片顶栏工具预扣价：跟后台主模型默认档 quote，避免 canvas-tool-pricing 预览为 0。
 */
export function useCanvasImageToolQuoteCosts(enabled = true) {
  const { data: toolModels } = useQuery({
    queryKey: ["canvas-tool-models"],
    queryFn: getCanvasToolModels,
    staleTime: 30_000,
    enabled,
  });

  const toolModelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const toolId of QUOTE_TOOL_IDS) {
      const primary =
        canvasToolModelPrimary(toolModels?.tools, toolId) ||
        (TOOL_QUOTE_CATEGORY[toolId] === "text" ? "doubao_pro" : CANVAS_TOOL_I2I_MODEL);
      if (primary) map[toolId] = primary;
    }
    return map;
  }, [toolModels?.tools]);

  const queries = useQueries({
    queries: QUOTE_TOOL_IDS.map((toolId) => ({
      queryKey: ["credits", "quote", "image-tool-bar", toolId, toolModelMap[toolId] || ""],
      queryFn: () =>
        getCreditQuote({
          model: toolModelMap[toolId]!,
          category: TOOL_QUOTE_CATEGORY[toolId] ?? "image",
          canvasTool: toolId,
        }),
      enabled: enabled && Boolean(toolModelMap[toolId]),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    })),
  });

  const costByTool = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    QUOTE_TOOL_IDS.forEach((toolId, index) => {
      const query = queries[index];
      if (query?.isSuccess && query.data) {
        const total = resolveQuoteTotal(query.data);
        out[toolId] = total > 0 ? total : undefined;
      }
    });
    return out;
  }, [queries]);

  const isLoading = queries.some((query) => query.isLoading);
  const creditsEnabled =
    queries.find((query) => query.data)?.data?.creditsEnabled ?? true;

  const refetch = () => Promise.all(queries.map((query) => query.refetch()));

  return {
    imageToolCost: (toolId: string) => costByTool[toolId],
    costByTool,
    isLoading,
    creditsEnabled,
    refetch,
  };
}
