import type { CanvasModel } from "@/lib/api/models";
import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";

export interface ModelPickerTab {
  id: string;
  label: string;
  models: CanvasModel[];
}

type TabRule = {
  id: string;
  label: string;
  match: (model: CanvasModel) => boolean;
};

const IMAGE_TAB_RULES: TabRule[] = [
  { id: "wan", label: "万相", match: (m) => m.name.startsWith("wan27_image") },
  {
    id: "qwen",
    label: "千问",
    match: (m) => m.name.startsWith("qwen_image"),
  },
  {
    id: "jimeng",
    label: "即梦",
    match: (m) => m.provider === "ark" || m.name === "doubao_image",
  },
  { id: "nano", label: "全能图片", match: (m) => m.name.startsWith("nano_pro") },
  { id: "nano_g", label: "全能图片G", match: (m) => m.name.startsWith("nano_g") },
  { id: "mj", label: "mj文生图", match: (m) => m.name.startsWith("mj_") },
  { id: "nodyhub", label: "NodyHub", match: (m) => m.provider === "nodyhub" },
  { id: "jumengai", label: "聚梦", match: (m) => m.provider === "jumengai" },
  { id: "comfyui", label: "ComfyUI", match: (m) => m.provider === "comfyui" },
];

/** 与主平台分镜「选取视频模型」Tab 顺序对齐 */
const VIDEO_TAB_RULES: TabRule[] = [
  { id: "vidu", label: "Vidu", match: (m) => m.provider === "vidu" },
  {
    id: "wan",
    label: "万相",
    match: (m) =>
      (m.name.startsWith("wan27") || m.name.startsWith("wan30")) &&
      !m.name.startsWith("wan27_image"),
  },
  { id: "happyhorse", label: "HappyHorse", match: (m) => m.name.startsWith("happyhorse") },
  { id: "pixverse", label: "爱诗", match: (m) => m.name.startsWith("pixverse") },
  { id: "kling", label: "可灵", match: (m) => m.provider === "kling" },
  { id: "seedance", label: "即梦Seedance", match: (m) => m.provider === "ark" },
  {
    id: "rh_seedance",
    label: "RH Seedance",
    match: (m) => m.name.startsWith("rh_seedance"),
  },
  {
    id: "hailuo",
    label: "海螺",
    match: (m) =>
      m.name.startsWith("rh_minimax_hailuo") || /hailuo|海螺/i.test(m.name + (m.displayName || "")),
  },
  {
    id: "huahu_seedance",
    label: "华狐Seedance",
    match: (m) => m.name.startsWith("huahu_seedance") || m.provider === "huahu",
  },
  {
    id: "subtitle_erase",
    label: "去字幕",
    match: (m) =>
      m.name.includes("subtitle_erase") ||
      m.name.includes("volc_subtitle"),
  },
  {
    id: "jumengai",
    label: "聚梦",
    match: (m) =>
      m.provider === "jumengai" &&
      !m.name.includes("subtitle_erase") &&
      !m.name.includes("volc_subtitle"),
  },
  {
    id: "nodyhub",
    label: "NodyHub",
    match: (m) => m.provider === "nodyhub" || m.name.startsWith("nodyhub_sd20"),
  },
  {
    id: "ltx",
    label: "LTX",
    match: (m) =>
      (m.provider === "runninghub" || m.provider === "ltx_runninghub") &&
      !m.name.startsWith("rh_seedance") &&
      !m.name.startsWith("rh_minimax_hailuo") &&
      !m.name.includes("subtitle"),
  },
];

const AUDIO_TAB_RULES: TabRule[] = [
  { id: "cosyvoice", label: "CosyVoice", match: (m) => m.name.startsWith("cosyvoice") },
  {
    id: "rh_separate",
    label: "分离音频",
    match: (m) => m.name.startsWith("rh_audio_extract"),
  },
  {
    id: "music",
    label: "音乐",
    match: (m) => m.name.startsWith("minimax_") || m.name.startsWith("suno_"),
  },
];

function buildTabs(rules: TabRule[], models: CanvasModel[]): ModelPickerTab[] {
  const tabs: ModelPickerTab[] = [];
  const assigned = new Set<string>();

  for (const rule of rules) {
    const matched = models.filter((m) => !assigned.has(m.name) && rule.match(m));
    if (matched.length === 0) continue;
    matched.forEach((m) => assigned.add(m.name));
    tabs.push({ id: rule.id, label: rule.label, models: matched });
  }

  const rest = models.filter((m) => !assigned.has(m.name));
  if (rest.length > 0) {
    tabs.push({ id: "other", label: "其他", models: rest });
  }

  return tabs;
}

export function buildModelPickerTabs(
  category: ModelCategory,
  models: CanvasModel[]
): ModelPickerTab[] {
  // 按节点类别再过滤一遍，避免图片选取弹窗混入视频模型
  const available = models.filter((m) => {
    if (m.isAvailable === false) return false;
    const cat = (m.category || "").trim().toLowerCase();
    if (cat !== category) return false;
    if (category === "image") {
      const n = m.name.toLowerCase();
      return !/_(?:r2v|i2v|t2v)$/i.test(n) && !n.includes("lip_sync");
    }
    if (category === "video") {
      return !m.name.startsWith("wan27_image") && !/_image(?:_|$)/i.test(m.name);
    }
    return true;
  });
  if (category === "video") return buildTabs(VIDEO_TAB_RULES, available);
  if (category === "audio") return buildTabs(AUDIO_TAB_RULES, available);
  return buildTabs(IMAGE_TAB_RULES, available);
}

export function findTabForModel(tabs: ModelPickerTab[], modelName: string): string {
  return tabs.find((t) => t.models.some((m) => m.name === modelName))?.id ?? tabs[0]?.id ?? "";
}
