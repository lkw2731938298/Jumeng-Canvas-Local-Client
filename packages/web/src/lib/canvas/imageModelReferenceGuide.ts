import type { CanvasModel } from "@/lib/api/models";

// 图片模型「图生图」参考图上限说明：与上游 API 文档（imageUrls 数量/大小）保持一致。
// key 为模型 name；仅图生图（i2i）变体需要，文生图（t2i）无参考图不展示。
const IMAGE_REF_HINTS: Record<string, string> = {
  nano_g_i2i: "图生图：最多支持 10 张参考图，每张 ≤ 10MB，通过 @ 或上游连线传入。",
  nano_g_i2i_official: "图生图：最多支持 10 张参考图，每张 ≤ 10MB，通过 @ 或上游连线传入。",
  qwen_image_30: "图生图/编辑：最多 3 张参考图，每张 ≤ 10MB；参考图按张计费。",
  qwen_image_30_pro: "图生图/编辑：最多 3 张参考图，每张 ≤ 10MB；参考图按张计费。",
};

/** 选择图片生成模型时展示的参考图简要说明（图生图专用）。 */
export function getImageModelReferenceGuide(model: CanvasModel): string | null {
  if (model.category !== "image") return null;
  return IMAGE_REF_HINTS[model.name] ?? null;
}
