/**
 * 解析九宫格子功能的后台主模型与默认生成参数。
 * 优先 toolId 独立配置，其次兼容旧 grid_9，最后回退全能 Pro 图生图。
 */
import { canvasToolModelPrimary, getCanvasToolModels } from "@/lib/api/canvasTools";
import { listModels, type CanvasModel } from "@/lib/api/models";
import { CANVAS_TOOL_I2I_MODEL } from "@/lib/canvas/canvasToolImageModel";
import {
  defaultGenerationOptions,
  getModelGenerationPresets,
} from "@/lib/canvas/generationPresets";
import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import { CREATIVE_TOOLS_CANVAS_TOOL } from "@/lib/canvas/runCreativeToolDirectGenerate";

function isUsableModel(m: CanvasModel): boolean {
  return Boolean(m.isAvailable && m.isConfigured !== false && m.isImplemented !== false);
}

export async function resolveCreativeGridToolModel(toolId: string): Promise<{
  modelName: string;
  generationOptions: GenerationOptions;
  generationPresets: GenerationPresetsConfig | null;
  catalogModel: CanvasModel | null;
}> {
  const tid = toolId.trim() || CREATIVE_TOOLS_CANVAS_TOOL;
  const [toolModels, imageModels] = await Promise.all([
    getCanvasToolModels(),
    listModels({ category: "image" }),
  ]);

  const primary =
    canvasToolModelPrimary(toolModels.tools, tid) ||
    canvasToolModelPrimary(toolModels.tools, CREATIVE_TOOLS_CANVAS_TOOL) ||
    CANVAS_TOOL_I2I_MODEL;

  const catalog =
    (imageModels ?? []).find((m) => m.name === primary) ??
    (imageModels ?? []).find((m) => m.name === CANVAS_TOOL_I2I_MODEL && isUsableModel(m)) ??
    (imageModels ?? []).find((m) => m.name.endsWith("_i2i") && isUsableModel(m)) ??
    (imageModels ?? []).find(isUsableModel) ??
    null;

  const modelName = catalog?.name || primary;
  const generationPresets = getModelGenerationPresets(catalog ?? undefined);
  const generationOptions = defaultGenerationOptions(generationPresets);

  return { modelName, generationOptions, generationPresets, catalogModel: catalog };
}
