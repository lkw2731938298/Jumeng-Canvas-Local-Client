"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPromptConfig } from "@/lib/api/promptConfig";
import {
  CREATIVE_TOOLS_FALLBACK,
  PROMPT_SUFFIX_FALLBACKS,
  PROMPT_SUFFIX_TOOLS,
  type PromptToolId,
} from "@/lib/admin/promptToolCategories";
import type {
  AppendPromptToolConfig,
  CreativeToolsPromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";

export interface PromptSuffixMenuItem {
  tool: PromptToolId;
  label: string;
  content: string;
  joiner: string;
}

/** Load append-tool configs for canvas top menu. */
export function usePromptSuffixTools() {
  const { data, isLoading } = useQuery({
    queryKey: ["prompt-config"],
    queryFn: getPromptConfig,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const items = useMemo((): PromptSuffixMenuItem[] => {
    const tools = data?.tools ?? {};
    // 显式标注：后续会 push grid_9（creative_tools），避免被推断成仅 simpleSuffix 联合类型
    const suffixItems: PromptSuffixMenuItem[] = PROMPT_SUFFIX_TOOLS.map((tool) => {
      const cfg = tools[tool] as AppendPromptToolConfig | undefined;
      const fallback = PROMPT_SUFFIX_FALLBACKS[tool];
      if (cfg?.kind === "append") {
        return {
          tool,
          label: cfg.menuLabel?.trim() || fallback.label,
          content: cfg.appendText?.trim() || fallback.content,
          joiner: cfg.joiner ?? "，",
        };
      }
      return { tool, label: fallback.label, content: fallback.content, joiner: "，" };
    });
    // 九宫格：菜单名取 creative_tools.menuLabel，兼容旧后缀 content
    const gridCfg = tools.grid_9 as CreativeToolsPromptToolConfig | AppendPromptToolConfig | undefined;
    if (gridCfg?.kind === "creative_tools") {
      suffixItems.push({
        tool: "grid_9",
        label: gridCfg.menuLabel?.trim() || CREATIVE_TOOLS_FALLBACK.label,
        content: gridCfg.appendText?.trim() || CREATIVE_TOOLS_FALLBACK.appendText,
        joiner: gridCfg.joiner ?? "，",
      });
    } else if (gridCfg?.kind === "append") {
      suffixItems.push({
        tool: "grid_9",
        label: gridCfg.menuLabel?.trim() || CREATIVE_TOOLS_FALLBACK.label,
        content: gridCfg.appendText?.trim() || CREATIVE_TOOLS_FALLBACK.appendText,
        joiner: gridCfg.joiner ?? "，",
      });
    } else {
      suffixItems.push({
        tool: "grid_9",
        label: CREATIVE_TOOLS_FALLBACK.label,
        content: CREATIVE_TOOLS_FALLBACK.appendText,
        joiner: "，",
      });
    }
    return suffixItems;
  }, [data?.tools]);

  return { items, isLoading };
}
