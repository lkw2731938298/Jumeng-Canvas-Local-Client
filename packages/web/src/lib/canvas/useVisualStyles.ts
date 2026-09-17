"use client";

import { useQuery } from "@tanstack/react-query";
import { getPromptToolConfig } from "@/lib/api/promptConfig";
import {
  DEFAULT_VISUAL_STYLE_ID,
  listEnabledVisualStyles,
  type VisualStylesPromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";

export function useVisualStyles() {
  const query = useQuery({
    queryKey: ["prompt-config", "visual_style"],
    queryFn: () => getPromptToolConfig("visual_style"),
    staleTime: 60_000,
  });

  const config =
    query.data?.config?.kind === "visual_styles"
      ? (query.data.config as VisualStylesPromptToolConfig)
      : null;

  const styles = listEnabledVisualStyles(config);

  return {
    ...query,
    config,
    styles,
    defaultStyleId: DEFAULT_VISUAL_STYLE_ID,
  };
}
