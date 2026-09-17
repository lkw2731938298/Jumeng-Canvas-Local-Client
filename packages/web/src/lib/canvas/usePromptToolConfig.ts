"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPromptToolConfig } from "@/lib/api/promptConfig";
import {
  lightingUiLabels,
  multiAngleUiLabels,
  type ComposerPromptToolConfig,
  type PromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";
import {
  CREATIVE_TOOLS_FALLBACK,
  PROMPT_SUFFIX_FALLBACKS,
  type PromptToolId,
} from "@/lib/admin/promptToolCategories";

const DEFAULT_MULTI_ANGLE: ComposerPromptToolConfig = {
  kind: "composer",
  template: "{base} → $h → $e → $s → $c → {extra?}",
  static: {
    j: "，",
    base: "基于参考图对同一主体重新取景，除摄像机机位外人物、服装、场景与画风保持不变",
    baseMode: "admin",
    c: "严格保持参考图同一人物身份与造型，禁止换脸换衣或改变场景，仅改变观察角度与构图",
  },
  formats: {
    h: "水平环绕{azimuth}度（{azimuthDesc}）",
    e: "俯仰{elevation}度（{elevationDesc}）",
  },
  lookups: {
    h: {
      "0": "正面机位",
      "45": "右前45度机位",
      "90": "右侧机位",
      "135": "右后45度机位",
      "180": "背面机位",
      "225": "左后45度机位",
      "270": "左侧机位",
      "315": "左前45度机位",
    },
    e: {
      "-90": "仰拍机位",
      "-45": "微仰机位",
      "0": "平视机位",
      "45": "微俯机位",
      "90": "顶视机位",
    },
    s: {
      close: "特写镜头，主体占画面主体且细节清晰",
      medium: "中景镜头，主体半身或全身可见",
      wide: "全景镜头，完整呈现主体与环境关系",
    },
  },
  labels: {
    h: {
      "0": "正面",
      "45": "右前45°",
      "90": "右侧",
      "135": "右后45°",
      "180": "背面",
      "225": "左后45°",
      "270": "左侧",
      "315": "左前45°",
    },
    e: { "-90": "仰拍", "-45": "微仰", "0": "平视", "45": "微俯", "90": "顶视" },
    s: { close: "特写", medium: "中景", wide: "全景" },
  },
};

const DEFAULT_LIGHTING: ComposerPromptToolConfig = {
  kind: "composer",
  template: "$smart → {base} → $dir → $bright → $color → $rim → $c → {extra?}",
  static: {
    j: "，",
    base: "基于参考图对同一主体重新布光，除光照外人物、服装、场景与画风保持不变",
    baseMode: "admin",
    c: "严格保持参考图同一人物身份与造型，仅改变光照方向、强度与色温",
  },
  formats: {
    bright: "光照强度{brightness}%（{brightnessDesc}）",
    color: "{colorDesc}",
  },
  lookups: {
    dir: {
      front: "主光源来自正前方，面部均匀受光",
      back: "主光源来自正后方，形成逆光轮廓",
      left: "主光源来自左侧，右侧形成阴影",
      right: "主光源来自右侧，左侧形成阴影",
      top: "主光源来自顶部，形成顶光与下阴影",
      bottom: "主光源来自底部，形成戏剧性底光",
    },
    rim: {
      on: "启用轮廓光，边缘高光分离主体与背景",
      off: "",
    },
    smart: {
      on: "智能分析场景并优化布光，电影级照明",
      off: "",
    },
  },
  labels: {
    dir: {
      front: "前方",
      back: "后方",
      left: "左侧",
      top: "顶部",
      right: "右侧",
      bottom: "底部",
    },
  },
};

function appendFallback(toolId: PromptToolId): PromptToolConfig {
  if (toolId === "grid_9") {
    return {
      kind: "creative_tools",
      menuLabel: CREATIVE_TOOLS_FALLBACK.label,
      appendText: CREATIVE_TOOLS_FALLBACK.appendText,
      joiner: "，",
      items: [],
    };
  }
  const fallback = PROMPT_SUFFIX_FALLBACKS[toolId as keyof typeof PROMPT_SUFFIX_FALLBACKS];
  return {
    kind: "append",
    menuLabel: fallback?.label ?? toolId,
    appendText: fallback?.content ?? "",
  };
}

export function usePromptToolConfig<T extends PromptToolId>(toolId: T) {
  const { data, isLoading, isFetching, isError, isFetched } = useQuery({
    queryKey: ["prompt-config", toolId],
    queryFn: () => getPromptToolConfig(toolId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const config = useMemo((): PromptToolConfig | null => {
    const loaded = data?.config;
    if (loaded) return loaded;
    if (isLoading || isFetching || !isFetched) return null;
    if (isError) {
      if (toolId === "multi_angle") return DEFAULT_MULTI_ANGLE;
      if (toolId === "lighting") return DEFAULT_LIGHTING;
      return appendFallback(toolId);
    }
    if (toolId === "multi_angle") return DEFAULT_MULTI_ANGLE;
    if (toolId === "lighting") return DEFAULT_LIGHTING;
    return appendFallback(toolId);
  }, [data?.config, toolId, isLoading, isFetching, isFetched, isError]);

  const multiAngle = useMemo(() => {
    if (!config || config.kind !== "composer" || toolId !== "multi_angle") return null;
    return {
      config,
      ui: multiAngleUiLabels(config),
    };
  }, [config, toolId]);

  const lighting = useMemo(() => {
    if (!config || config.kind !== "composer" || toolId !== "lighting") return null;
    return {
      config,
      ui: lightingUiLabels(config),
    };
  }, [config, toolId]);

  const isReady = config !== null;

  return {
    config,
    multiAngle,
    lighting,
    isLoading: !isReady && (isLoading || isFetching),
    isError,
    isReady,
  };
}
