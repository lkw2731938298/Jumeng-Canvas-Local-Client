"use client";

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Node } from "@xyflow/react";
import { canvasToolModelPrimary, getCanvasToolModels } from "@/lib/api/canvasTools";
import { getCreditQuote, resolveQuoteTotal } from "@/lib/api/credits";
import {
  CANVAS_VIDEO_BILLING_TOOL_IDS,
  canvasVideoToolBillingOptions,
} from "@/lib/canvas/canvasVideoToolBilling";
import { useNodeVideoDurationSec } from "@/lib/canvas/useNodeVideoDurationSec";
import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";

/** 与后端 CANVAS_TOOL_MODEL_DEFS 默认主模型对齐 */
const VIDEO_TOOL_DEFAULT_MODEL: Record<string, string> = {
  hd_upscale_video: "rh_seedance_20_r2v",
  video_smart_matting: "rh_seedance_20_r2v",
  video_subject_remove: "rh_seedance_20_r2v",
  video_subject_edit: "rh_seedance_20_r2v",
  video_subject_replace: "rh_seedance_20_r2v",
  video_subtitle_smart_erase: "jumengai_volc_subtitle_erase",
  video_subtitle_box_erase: "jumengai_volc_subtitle_erase",
  vocal_separate: "rh_audio_extract_vocals",
  vocal_remove: "rh_audio_extract_other",
};

/** 报价 category：人声类走 audio，其余 video */
const VIDEO_TOOL_QUOTE_CATEGORY: Record<string, ModelCategory> = {
  vocal_separate: "audio",
  vocal_remove: "audio",
};

const VIDEO_TOOL_IDS = Array.from(CANVAS_VIDEO_BILLING_TOOL_IDS);

function stableBillingOptionsKey(options: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(options)
      .sort()
      .map((key) => [key, options[key]])
  );
}

/**
 * 视频顶栏工具算力展示：与提交路径一致，走 GET /credits/quote + 后台主模型 + 节点时长。
 * 避免 canvas-tool-pricing 批量价与实扣不一致（如智能去字幕固定显示 100）。
 */
export function useCanvasVideoToolQuoteCosts(
  node: Node | null | undefined,
  enabled = true,
  videoUrl?: string | null
) {
  const params = (node?.data as { params?: Record<string, unknown> } | undefined)?.params;
  const url =
    videoUrl ??
    (typeof params?.videoUrl === "string" ? params.videoUrl : "");
  const { durationSec: billSec, isReady: durationReady } = useNodeVideoDurationSec(
    node?.id,
    url,
    enabled
  );
  const billingOptions = useMemo(
    () => (billSec != null ? canvasVideoToolBillingOptions(billSec) : {}),
    [billSec]
  );
  const optionsKey = useMemo(
    () => stableBillingOptionsKey(billingOptions),
    [billingOptions]
  );

  const { data: toolModels } = useQuery({
    queryKey: ["canvas-tool-models"],
    queryFn: getCanvasToolModels,
    staleTime: 30_000,
    enabled,
  });

  const toolModelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const toolId of VIDEO_TOOL_IDS) {
      const primary =
        canvasToolModelPrimary(toolModels?.tools, toolId) ||
        VIDEO_TOOL_DEFAULT_MODEL[toolId] ||
        "";
      if (primary) map[toolId] = primary;
    }
    return map;
  }, [toolModels?.tools]);

  const queries = useQueries({
    queries: VIDEO_TOOL_IDS.map((toolId) => ({
      queryKey: [
        "credits",
        "quote",
        "video-tool-bar",
        toolId,
        toolModelMap[toolId],
        optionsKey,
      ],
      queryFn: () =>
        getCreditQuote({
          model: toolModelMap[toolId]!,
          category: VIDEO_TOOL_QUOTE_CATEGORY[toolId] ?? "video",
          generationOptions: billingOptions,
          canvasTool: toolId,
        }),
      enabled: enabled && durationReady && Boolean(toolModelMap[toolId]),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    })),
  });

  const costByTool = useMemo(() => {
    const out: Record<string, number | undefined> = {};
    VIDEO_TOOL_IDS.forEach((toolId, index) => {
      const query = queries[index];
      if (query?.isSuccess && query.data) {
        const total = resolveQuoteTotal(query.data);
        out[toolId] = total > 0 ? total : undefined;
      }
    });
    return out;
  }, [queries]);

  const isLoading =
    (enabled && !durationReady) || queries.some((query) => query.isLoading);
  const creditsEnabled =
    queries.find((query) => query.data)?.data?.creditsEnabled ?? true;

  const refetch = () => Promise.all(queries.map((query) => query.refetch()));

  return {
    videoToolCost: (toolId: string) => costByTool[toolId],
    costByTool,
    isLoading,
    creditsEnabled,
    refetch,
    billSec,
  };
}
