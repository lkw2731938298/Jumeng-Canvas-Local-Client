"use client";

import { useQuery } from "@tanstack/react-query";
import { previewPromptTool } from "@/lib/api/promptConfig";
import type { ShotScale } from "@/lib/canvas/multiAnglePresets";

export interface MultiAngleComposeRuntime {
  base: string;
  extra: string;
  azimuth: number;
  elevation: number;
  shot: ShotScale;
}

/** Render multi-angle prompt via backend — same path as admin preview API. */
export function useMultiAngleComposedPrompt(runtime: MultiAngleComposeRuntime, enabled: boolean) {
  const { base, extra, azimuth, elevation, shot } = runtime;

  return useQuery({
    queryKey: ["prompt-preview", "multi_angle", base, extra, azimuth, elevation, shot],
    queryFn: () =>
      previewPromptTool("multi_angle", {
        base,
        extra,
        azimuth,
        elevation,
        shot,
      }),
    enabled,
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}
