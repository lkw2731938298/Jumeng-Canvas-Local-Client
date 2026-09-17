"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGlobalWatermark } from "@/components/providers/GlobalWatermarkProvider";
import { listModels, type CanvasModel } from "@/lib/api/models";
import { buildModelOptions, getNodeModelCategory } from "@/lib/canvas/nodeModelRouting";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import {
  pickModelOption,
  resolvePreferredModel,
  setLastSelectedModel,
} from "@/lib/canvas/lastSelectedModel";
import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";

/** Model list for node editor popups — aligned with admin category switches per node type. */
export function useNodeEditorModels(sourceNodeType: string | undefined, selectedModelName?: string) {
  const { enabled: globalWatermarkEnabled } = useGlobalWatermark();
  const modelCategory = getNodeModelCategory(sourceNodeType ?? "");
  const modelCategories = useMemo(
    () => (modelCategory ? [modelCategory] : []),
    [modelCategory]
  );

  const categoriesKey = modelCategories.join(",");

  const { data: apiModels } = useQuery({
    queryKey: ["models", categoriesKey],
    queryFn: () =>
      modelCategory ? listModels({ category: modelCategory }) : listModels(),
    staleTime: 60_000,
    enabled: modelCategories.length > 0,
  });

  const configuredModels = useMemo(
    () =>
      (apiModels ?? []).filter(
        (m) => m.isConfigured !== false && m.isImplemented !== false && m.isAvailable
      ),
    [apiModels]
  );

  const modelsForOptions = configuredModels.length > 0 ? configuredModels : (apiModels ?? []);

  const modelOptions = useMemo(
    () => buildModelOptions(modelsForOptions, modelCategories, []),
    [modelsForOptions, modelCategories]
  );

  const defaultModel = useMemo(
    () => resolvePreferredModel(modelCategory, modelOptions),
    [modelCategory, modelOptions]
  );

  const selectedModel = useMemo(
    () => apiModels?.find((m) => m.name === selectedModelName) ?? apiModels?.[0],
    [apiModels, selectedModelName]
  );

  const generationPresets: GenerationPresetsConfig | null = useMemo(
    () => getModelGenerationPresets(selectedModel),
    [selectedModel]
  );

  const normalizedDefaults = useMemo(
    () => defaultGenerationOptions(generationPresets),
    [generationPresets, globalWatermarkEnabled]
  );

  return {
    modelOptions,
    defaultModel,
    pickModelOption,
    rememberModelChoice: (modelName: string) => {
      if (modelCategory) setLastSelectedModel(modelCategory, modelName);
    },
    modelCategories,
    categoriesKey,
    apiModels: apiModels ?? ([] as CanvasModel[]),
    selectedModel,
    generationPresets,
    defaultGenerationOptions: normalizedDefaults,
    normalizeGenerationOptions: (options: GenerationOptions | undefined) =>
      normalizeGenerationOptions(generationPresets, options),
  };
}
