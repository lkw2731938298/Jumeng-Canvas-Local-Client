import type { CanvasModel } from "@/lib/api/models";

const R2V_HINTS: Record<string, string> = {};

const I2V_HINTS: Record<string, string> = {};

function modelVideoMode(model: CanvasModel): string | null {
  const mode = model.parameters?.videoMode;
  return typeof mode === "string" ? mode : null;
}

function modelCapabilities(model: CanvasModel): string[] {
  const caps = model.parameters?.capabilities;
  return Array.isArray(caps) ? caps.map(String) : [];
}

/** Short reference guide shown when picking a video generation model. */
export function getVideoModelReferenceGuide(model: CanvasModel): string | null {
  if (model.category !== "video") return null;

  const explicit = R2V_HINTS[model.name] ?? I2V_HINTS[model.name];
  if (explicit) return explicit;

  const mode = modelVideoMode(model);
  const caps = modelCapabilities(model);

  if (mode === "lip_sync" || caps.includes("lip_sync")) {
    return "对口型：需参考视频与音频素材。";
  }

  if (mode === "t2v") {
    return "文生视频：仅需文本提示词即可生成。";
  }

  if (mode === "r2v" || caps.includes("reference_to_video")) {
    return "参考生：通过 @ 或上游连线传入多张参考图（具体上限因模型而异）。";
  }

  if (caps.includes("start_end_to_video")) {
    return "首尾帧：提示词中 @ 引用图片，第一个为首帧、第二个为尾帧（尾帧可省略）。";
  }

  if (model.name.endsWith("_i2v")) {
    return "首尾帧：提示词中 @ 引用图片，第一个为首帧、第二个为尾帧（尾帧可省略）。";
  }

  if (caps.includes("first_frame_to_video") || mode === "i2v") {
    return "图生视频：提示词中 @ 引用 1 张首帧图片。";
  }

  return null;
}
