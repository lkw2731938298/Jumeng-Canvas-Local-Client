"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPromptTemplates, type PromptTemplate } from "@/lib/api/promptTemplates";
import {
  ELEVATION_PRESET_VALUES,
  HORIZONTAL_AZIMUTH_VALUES,
  SHOT_SCALES,
  snapAzimuth,
  snapElevation,
  type ShotScale,
} from "@/lib/canvas/multiAnglePresets";

export interface MultiAngleTemplateConfig {
  joiner: string;
  consistency: string;
  horizontalLabels: Record<string, string>;
  elevationLabels: Record<string, string>;
  shotLabels: Record<string, string>;
}

const FALLBACK_CONFIG: MultiAngleTemplateConfig = {
  joiner: "，",
  consistency: "保持与原图相同的主体、服装、场景布局与风格，仅改变摄像机机位",
  horizontalLabels: Object.fromEntries(
    HORIZONTAL_AZIMUTH_VALUES.map((v) => [String(v), `${v}°`])
  ),
  elevationLabels: {
    "-30": "俯视",
    "0": "平视",
    "30": "仰视",
  },
  shotLabels: {
    close: "特写",
    medium: "中景",
    wide: "全景",
  },
};

function buildConfig(templates: PromptTemplate[]): MultiAngleTemplateConfig {
  const byCategory = (cat: string) =>
    templates.filter((t) => t.enabled && t.category === cat);

  const pick = (cat: string, key: string) =>
    byCategory(cat).find((t) => t.key === key)?.content ?? "";

  const labelsFrom = (cat: string) =>
    Object.fromEntries(byCategory(cat).map((t) => [t.key, t.label || t.content]));

  return {
    joiner: pick("joiner", "default") || FALLBACK_CONFIG.joiner,
    consistency: pick("consistency", "default") || FALLBACK_CONFIG.consistency,
    horizontalLabels: {
      ...FALLBACK_CONFIG.horizontalLabels,
      ...labelsFrom("horizontal"),
    },
    elevationLabels: {
      ...FALLBACK_CONFIG.elevationLabels,
      ...labelsFrom("elevation"),
    },
    shotLabels: {
      ...FALLBACK_CONFIG.shotLabels,
      ...labelsFrom("shot"),
    },
  };
}

function templateContent(
  templates: PromptTemplate[],
  category: string,
  key: string
): string {
  return (
    templates.find((t) => t.enabled && t.category === category && t.key === key)?.content ?? ""
  );
}

export function buildMultiAnglePromptFromConfig(
  config: MultiAngleTemplateConfig,
  templates: PromptTemplate[],
  basePrompt: string,
  angle: { azimuth: number; elevation: number; shot: ShotScale },
  extraPrompt?: string
): string {
  const joiner = config.joiner;
  const azKey = String(snapAzimuth(angle.azimuth));
  const elKey = String(snapElevation(angle.elevation));

  const horizontal =
    templateContent(templates, "horizontal", azKey) ||
    config.horizontalLabels[azKey] ||
    `水平${azKey}度视角`;
  const elevation =
    templateContent(templates, "elevation", elKey) ||
    config.elevationLabels[elKey] ||
    `俯仰${elKey}度`;
  const shot =
    templateContent(templates, "shot", angle.shot) ||
    config.shotLabels[angle.shot] ||
    angle.shot;

  const parts = [
    basePrompt.trim(),
    horizontal,
    elevation,
    shot,
    config.consistency,
    extraPrompt?.trim(),
  ].filter(Boolean);

  return parts.join(joiner);
}

export function useMultiAngleTemplates() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["prompt-templates", "multi_angle"],
    queryFn: () => listPromptTemplates("multi_angle"),
    staleTime: 120_000,
  });

  const templates = data?.templates ?? [];
  const config = useMemo(
    () => (templates.length ? buildConfig(templates) : FALLBACK_CONFIG),
    [templates]
  );

  return { config, templates, isLoading, isError };
}
