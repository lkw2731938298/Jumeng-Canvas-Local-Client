/**
 * 开源本地版：原后台「画布工具主模型」纳管清单（仅保留会调模型的功能）。
 * primary 存 LocalModel.name；未配置时由 UI/运行时回退到同类别首个启用模型。
 */

export type LocalToolModelCategory = "text" | "image" | "video" | "audio";

export interface LocalCanvasToolDef {
  toolId: string;
  category: LocalToolModelCategory;
  label: string;
  group: string;
}

/** 画布工具列表（文案面向用户） */
export const LOCAL_CANVAS_TOOL_DEFS: LocalCanvasToolDef[] = [
  { toolId: "multi_angle", category: "image", label: "多角度", group: "图片工具" },
  { toolId: "lighting", category: "image", label: "打光", group: "图片工具" },
  { toolId: "panorama", category: "image", label: "全景", group: "图片工具" },
  { toolId: "grid_9", category: "image", label: "九宫格", group: "宫格 / 设定" },
  { toolId: "grid_25", category: "image", label: "25 宫格", group: "宫格 / 设定" },
  { toolId: "plot_grid_4", category: "image", label: "四宫格推演", group: "宫格 / 设定" },
  { toolId: "frame_forward_3s", category: "image", label: "推演 · 前 3 秒", group: "宫格 / 设定" },
  { toolId: "frame_back_5s", category: "image", label: "推演 · 后 5 秒", group: "宫格 / 设定" },
  { toolId: "cinematic_lighting", category: "image", label: "电影打光九宫", group: "宫格 / 设定" },
  { toolId: "multi_cam_grid_9", category: "image", label: "多机位九宫", group: "宫格 / 设定" },
  { toolId: "face_tri_view", category: "image", label: "人脸三视图", group: "宫格 / 设定" },
  { toolId: "character_sheet", category: "image", label: "角色设定图", group: "宫格 / 设定" },
  { toolId: "character_tri_view", category: "image", label: "角色三视图", group: "宫格 / 设定" },
  { toolId: "scene_sheet", category: "image", label: "场景设定图", group: "宫格 / 设定" },
  { toolId: "product_sheet", category: "image", label: "产品设定图", group: "宫格 / 设定" },
  { toolId: "outpaint", category: "image", label: "扩图", group: "图片工具" },
  { toolId: "cutout", category: "image", label: "抠图（结算用模型名）", group: "图片工具" },
  { toolId: "hd_upscale", category: "image", label: "图片高清", group: "图片工具" },
  { toolId: "portrait_adjust", category: "image", label: "人像调节", group: "图片工具" },
  { toolId: "emotion_adjust", category: "image", label: "情绪调节", group: "图片工具" },
  { toolId: "drawing_board_ai", category: "image", label: "画板 AI", group: "图片工具" },
  { toolId: "storyboard", category: "image", label: "故事板出图", group: "分镜" },
  { toolId: "blocking_storyboard", category: "image", label: "调度故事板", group: "分镜" },
  { toolId: "storyboard_sketch", category: "image", label: "分镜草图", group: "分镜" },
  // 分镜表「准备资产」页角色/场景/道具出图
  { toolId: "storyboard_subject_image", category: "image", label: "准备资产 · 主体生图", group: "分镜" },
  { toolId: "hd_upscale_video", category: "video", label: "视频高清", group: "视频工具" },
  { toolId: "video_smart_matting", category: "video", label: "智能抠像", group: "视频工具" },
  { toolId: "video_subject_remove", category: "video", label: "主体消除", group: "视频工具" },
  { toolId: "video_subject_edit", category: "video", label: "主体修改", group: "视频工具" },
  { toolId: "video_subject_replace", category: "video", label: "主体替换", group: "视频工具" },
  { toolId: "video_subtitle_smart_erase", category: "video", label: "智能去字幕", group: "视频工具" },
  { toolId: "video_subtitle_box_erase", category: "video", label: "框选去字幕", group: "视频工具" },
  { toolId: "vocal_separate", category: "audio", label: "人声分离", group: "音频工具" },
  { toolId: "vocal_remove", category: "audio", label: "消除人声", group: "音频工具" },
  { toolId: "storyboard_table", category: "text", label: "解析剧本", group: "文本 / 分镜" },
  { toolId: "storyboard_from_video", category: "text", label: "视频拆分镜", group: "文本 / 分镜" },
  { toolId: "storyboard_from_image", category: "text", label: "图片拆分镜", group: "文本 / 分镜" },
  { toolId: "storyboard_overseas_localize", category: "text", label: "出海本地化", group: "文本 / 分镜" },
  { toolId: "text_subject", category: "text", label: "主体提取", group: "文本 / 分镜" },
  { toolId: "storyboard_camera", category: "text", label: "运镜词", group: "文本 / 分镜" },
  { toolId: "storyboard_video", category: "text", label: "视频词", group: "文本 / 分镜" },
];

export type LocalToolModelsMap = Record<
  string,
  { primary: string; secondary?: string }
>;

export function emptyToolModelsMap(): LocalToolModelsMap {
  const out: LocalToolModelsMap = {};
  for (const d of LOCAL_CANVAS_TOOL_DEFS) {
    out[d.toolId] = { primary: "", secondary: "" };
  }
  return out;
}

export function normalizeToolModelsMap(raw: unknown): LocalToolModelsMap {
  const base = emptyToolModelsMap();
  if (!raw || typeof raw !== "object") return base;
  const src =
    "tools" in (raw as object) &&
    typeof (raw as { tools?: unknown }).tools === "object" &&
    (raw as { tools: unknown }).tools
      ? ((raw as { tools: Record<string, unknown> }).tools as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  for (const d of LOCAL_CANVAS_TOOL_DEFS) {
    const entry = src[d.toolId];
    if (!entry || typeof entry !== "object") continue;
    const primary = String((entry as { primary?: unknown }).primary || "").trim();
    const secondary = String((entry as { secondary?: unknown }).secondary || "").trim();
    base[d.toolId] = { primary, secondary };
  }
  return base;
}
