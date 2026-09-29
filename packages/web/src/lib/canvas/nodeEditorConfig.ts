import type { AssetCategory } from "@/lib/api/assets";
import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";

export const EDITOR_NODE_TYPES = [
  "text_input",
  "image_input",
  "video_input",
  "audio_input",
] as const;

export type EditorNodeType = (typeof EDITOR_NODE_TYPES)[number];

export interface EditorNodeConfig {
  promptParamKey: string;
  urlParamKey?: string;
  category: ModelCategory;
  assetCategory?: AssetCategory;
  label: string;
  placeholder: string;
}

export const EDITOR_NODE_CONFIG: Record<EditorNodeType, EditorNodeConfig> = {
  text_input: {
    promptParamKey: "content",
    category: "text",
    label: "文本",
    placeholder: "输入文本，或用 @ 引用上游…",
  },
  image_input: {
    promptParamKey: "prompt",
    urlParamKey: "imageUrl",
    category: "image",
    assetCategory: "image",
    label: "图片",
    placeholder: "描述画面，用 @ 引用上游文本或图片…",
  },
  video_input: {
    promptParamKey: "prompt",
    urlParamKey: "videoUrl",
    category: "video",
    assetCategory: "video",
    label: "视频",
    placeholder: "描述视频，用 @ 引用上游素材…",
  },
  audio_input: {
    promptParamKey: "prompt",
    urlParamKey: "audioUrl",
    category: "audio",
    assetCategory: "audio",
    label: "音频",
    placeholder: "描述音频，用 @ 引用上游素材…",
  },
};

export function isEditorNodeType(type: string | undefined): type is EditorNodeType {
  return !!type && EDITOR_NODE_TYPES.includes(type as EditorNodeType);
}

export function getEditorConfig(type: string | undefined): EditorNodeConfig | null {
  if (!isEditorNodeType(type)) return null;
  return EDITOR_NODE_CONFIG[type];
}
