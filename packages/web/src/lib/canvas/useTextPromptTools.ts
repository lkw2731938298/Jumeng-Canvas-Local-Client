"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPromptConfig } from "@/lib/api/promptConfig";
import {
  TEXT_PROMPT_TOOL_FALLBACKS,
  TEXT_PROMPT_TOOL_IDS,
  type TextPromptToolId,
} from "@/lib/admin/promptToolCategories";
import type { TextGenPromptToolConfig } from "@/lib/canvas/renderToolPrompt";

export interface TextPromptMenuItem {
  tool: TextPromptToolId;
  label: string;
}

export function isTextPromptKind(value: unknown): value is TextPromptToolId {
  return typeof value === "string" && (TEXT_PROMPT_TOOL_IDS as readonly string[]).includes(value);
}

/** Returns null when unset — use original default text generation (no menu selection). */
export function resolveTextPromptKind(value: unknown): TextPromptToolId | null {
  return isTextPromptKind(value) ? value : null;
}

/** @deprecated Use resolveTextPromptKind; empty means default output, not image prompt. */
export function normalizeTextPromptKind(value: unknown): TextPromptToolId | null {
  return resolveTextPromptKind(value);
}

/** Load text-node generation type options from prompt-config（底栏下拉）. */
export function useTextPromptTools() {
  const { data, isLoading } = useQuery({
    queryKey: ["prompt-config"],
    queryFn: getPromptConfig,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const items = useMemo((): TextPromptMenuItem[] => {
    const tools = data?.tools ?? {};
    return TEXT_PROMPT_TOOL_IDS.map((tool) => {
      const cfg = tools[tool] as TextGenPromptToolConfig | undefined;
      const fallback = TEXT_PROMPT_TOOL_FALLBACKS[tool];
      // text_script 产品文案统一为「生成剧本」，不沿用后台旧 menuLabel
      if (tool === "text_script") {
        return { tool, label: "生成剧本" };
      }
      if (cfg?.kind === "text_gen") {
        return {
          tool,
          label: cfg.menuLabel?.trim() || fallback.label,
        };
      }
      return { tool, label: fallback.label };
    });
  }, [data?.tools]);

  return { items, isLoading };
}
