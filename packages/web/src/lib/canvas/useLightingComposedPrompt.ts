"use client";

import { useQuery } from "@tanstack/react-query";
import { previewPromptTool } from "@/lib/api/promptConfig";
import type { LightDirection } from "@/lib/canvas/renderToolPrompt";

export interface LightingComposeRuntime {
  base: string;
  extra: string;
  direction: LightDirection;
  brightness: number;
  color: string | null;
  rimLight: boolean;
  smartMode: boolean;
}

/** Render lighting prompt via backend — same path as admin preview API. */
export function useLightingComposedPrompt(runtime: LightingComposeRuntime, enabled: boolean) {
  const { base, extra, direction, brightness, color, rimLight, smartMode } = runtime;

  return useQuery({
    queryKey: [
      "prompt-preview",
      "lighting",
      base,
      extra,
      direction,
      brightness,
      color,
      rimLight,
      smartMode,
    ],
    queryFn: () =>
      previewPromptTool("lighting", {
        base,
        extra,
        direction,
        brightness,
        color,
        rimLight,
        smartMode,
      }),
    enabled,
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}
