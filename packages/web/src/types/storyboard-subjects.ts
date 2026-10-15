/** 分镜表节点 · 准备资产（角色/场景/道具） */

export const STORYBOARD_SUBJECT_PROMPT_KIND = "text_subject" as const;
export const STORYBOARD_SUBJECT_IMAGE_MODEL = "doubao_image" as const;

/** shots=分镜表 · assets=准备资产（成片为独立节点 finished_clips_grid，不在此切换） */
export type StoryboardViewMode = "shots" | "assets";
export type StoryboardSubjectKind = "role" | "scene" | "prop";

/** 准备资产主体图在素材面板中的子分类 */
export const SUBJECT_KIND_ASSET_SUBCATEGORY: Record<StoryboardSubjectKind, string> = {
  role: "人物",
  scene: "场景",
  prop: "物品",
};

export const STORYBOARD_SKETCH_ASSET_SUBCATEGORY = "素材" as const;

const SUBJECT_KIND_LABELS: Record<StoryboardSubjectKind, string> = {
  role: "角色",
  scene: "场景",
  prop: "道具",
};

/**
 * 准备资产生图锚点（按类型拆开）：
 * - 角色：设定表三视图，供后续短剧/漫剧参考一致性
 * - 场景：纯环境空镜，禁止人物/道具抢戏，便于当视频场景底板
 * - 道具：单件静物 + 干净空背景，便于当参考物
 */
const ROLE_IMAGE_STYLE_ANCHOR =
  "高质量角色设定参考图，五官清晰、服装细节可读，统一光源，无文字无水印无logo，suitable as AI short-drama / comic-drama character bible";

const SCENE_IMAGE_STYLE_ANCHOR =
  "高质量空场景环境参考图，广角完整交代空间结构与光影氛围，无文字无水印，empty establishing environment plate for AI video background";

const PROP_IMAGE_STYLE_ANCHOR =
  "高质量单件道具产品参考图，主体居中、材质纹理清晰，无文字无水印，isolated prop product shot for AI reference";

/**
 * 角色主体图布局：同一张图「面部特写 + 全身正/侧/背」四联排。
 * 仅用于 role；场景/道具不适用。
 */
const ROLE_REFERENCE_SHEET_LAYOUT =
  "严格输出一张横向角色设定表（character turnaround sheet）：从左到右四格同一人物、同一发型服装配色、脸型五官完全一致——" +
  "第1格：面部特写正脸（头顶到下巴完整，双眼对视镜头，五官清晰）；" +
  "第2格：全身正面站姿（从头顶到鞋底完整入画，双臂自然下垂，不裁切）；" +
  "第3格：全身左侧立面站姿（同样全身完整）；" +
  "第4格：全身背面站姿（同样全身完整）；" +
  "四格等大对齐，浅灰或纯白无缝背景，格间仅留白、不要边框线与标注文字；" +
  "禁止第二个人物、禁止场景道具抢戏、禁止动态动作姿态、禁止抠图残影";

/** 场景：只要环境，不要人/车/杂物特写，避免后期当视频场景时串戏 */
const SCENE_REFERENCE_CONSTRAINTS =
  "只画空场景环境本身：建筑、室内陈设结构、自然地貌与固定光影；" +
  "画面中禁止出现任何人物、人脸、剪影人、手部；" +
  "禁止突出可移动道具特写、禁止海报字幕UI、禁止分屏拼贴；" +
  "构图当作可直接用作 AI 短剧/漫剧的空镜场景底板，空间纵深清楚";

/** 道具：单件 + 干净空背景，便于当视频参考物 */
const PROP_REFERENCE_CONSTRAINTS =
  "只画这一件道具：居中完整展示，可略带透视以看清形体；" +
  "背景必须是干净纯色或浅灰渐变空背景，禁止桌面杂物、禁止室内外场景、禁止手持/人物；" +
  "不要包装文案、条码、水印、品牌假logo；一件一图，边缘清晰";

/** 布局/约束升级后并入幂等键，使历史主体图按新规则重绘 */
const ROLE_IMAGE_PROMPT_VERSION = "role-turnaround-v2-drama";
const SCENE_IMAGE_PROMPT_VERSION = "scene-empty-v2-drama";
const PROP_IMAGE_PROMPT_VERSION = "prop-isolated-v2-drama";

export type StoryboardGenStatus = "idle" | "pending" | "running" | "succeeded" | "failed";

export interface StoryboardSubjectItem {
  id: string;
  name: string;
  extractPrompt: string;
  imageAssetId?: string;
  imageStatus?: StoryboardGenStatus;
  imageError?: string;
  /** extractPrompt 等内容 hash，用于判断提示词变更后需重绘 */
  imageSourceHash?: string;
}

export interface StoryboardSubjectsBundle {
  roles: StoryboardSubjectItem[];
  scenes: StoryboardSubjectItem[];
  props: StoryboardSubjectItem[];
}

export function emptySubjectsBundle(): StoryboardSubjectsBundle {
  return { roles: [], scenes: [], props: [] };
}

export function newSubjectId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `subj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function subjectKindToKey(kind: StoryboardSubjectKind): keyof StoryboardSubjectsBundle {
  if (kind === "role") return "roles";
  if (kind === "scene") return "scenes";
  return "props";
}

export function enrichSubjectItem(
  partial: Partial<StoryboardSubjectItem> & { id: string; name: string }
): StoryboardSubjectItem {
  return {
    id: partial.id,
    name: partial.name.trim(),
    extractPrompt: partial.extractPrompt?.trim() ?? "",
    imageAssetId: partial.imageAssetId?.trim() || undefined,
    imageStatus: partial.imageStatus,
    imageError: partial.imageError?.trim() || undefined,
    imageSourceHash: partial.imageSourceHash?.trim() || undefined,
  };
}

export function createEmptySubject(name: string): StoryboardSubjectItem {
  return enrichSubjectItem({ id: newSubjectId(), name, extractPrompt: "" });
}

function normalizeSubjectItem(raw: Record<string, unknown>, fallbackName: string): StoryboardSubjectItem {
  return enrichSubjectItem({
    id: String(raw.id ?? newSubjectId()),
    name: String(raw.name ?? fallbackName).trim() || fallbackName,
    extractPrompt: String(raw.extractPrompt ?? raw.prompt ?? "").trim(),
    imageAssetId: String(raw.imageAssetId ?? "").trim() || undefined,
    imageStatus: raw.imageStatus as StoryboardGenStatus | undefined,
    imageError: String(raw.imageError ?? ""),
    imageSourceHash: String(raw.imageSourceHash ?? "").trim() || undefined,
  });
}

function normalizeSubjectList(raw: unknown): StoryboardSubjectItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, i) => normalizeSubjectItem(item as Record<string, unknown>, `主体${i + 1}`));
}

export function parseSubjectsParam(value: unknown): StoryboardSubjectsBundle {
  if (!value || typeof value !== "object") return emptySubjectsBundle();
  const obj = value as Record<string, unknown>;
  return {
    roles: normalizeSubjectList(obj.roles),
    scenes: normalizeSubjectList(obj.scenes),
    props: normalizeSubjectList(obj.props),
  };
}

export function countSubjects(bundle: StoryboardSubjectsBundle): {
  roles: number;
  scenes: number;
  props: number;
  total: number;
} {
  const roles = bundle.roles.length;
  const scenes = bundle.scenes.length;
  const props = bundle.props.length;
  return { roles, scenes, props, total: roles + scenes + props };
}

export function computeSubjectImageSourceHash(
  item: Pick<StoryboardSubjectItem, "name" | "extractPrompt">,
  kind: StoryboardSubjectKind
): string {
  const parts = [kind, item.name, item.extractPrompt];
  // 布局/约束升级后并入版本号，历史图会被判定为需重绘
  if (kind === "role") parts.push(ROLE_IMAGE_PROMPT_VERSION);
  else if (kind === "scene") parts.push(SCENE_IMAGE_PROMPT_VERSION);
  else parts.push(PROP_IMAGE_PROMPT_VERSION);
  const payload = parts.join("|");
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

/** 准备资产生图 prompt：角色三视图 / 纯场景 / 干净道具，面向 AI 短剧·漫剧复用 */
export function buildSubjectImagePrompt(item: StoryboardSubjectItem, kind: StoryboardSubjectKind): string {
  const kindLabel = SUBJECT_KIND_LABELS[kind];
  const core = item.extractPrompt.trim() || item.name.trim();
  if (kind === "role") {
    return [
      `${kindLabel}设定名：${item.name}`,
      `外形描述：${core}`,
      ROLE_IMAGE_STYLE_ANCHOR,
      ROLE_REFERENCE_SHEET_LAYOUT,
    ].join("。");
  }
  if (kind === "scene") {
    return [
      `${kindLabel}名：${item.name}`,
      `环境描述：${core}`,
      SCENE_IMAGE_STYLE_ANCHOR,
      SCENE_REFERENCE_CONSTRAINTS,
    ].join("。");
  }
  return [
    `${kindLabel}名：${item.name}`,
    `外形描述：${core}`,
    PROP_IMAGE_STYLE_ANCHOR,
    PROP_REFERENCE_CONSTRAINTS,
  ].join("。");
}

export function needsSubjectImageGeneration(
  item: StoryboardSubjectItem,
  kind: StoryboardSubjectKind
): boolean {
  if (!item.extractPrompt.trim() && !item.name.trim()) return false;
  if (item.imageAssetId && item.imageStatus === "succeeded") {
    const hash = computeSubjectImageSourceHash(item, kind);
    if (item.imageSourceHash === hash) return false;
  }
  return true;
}

export function subjectImageNodeId(gridNodeId: string, subjectId: string): string {
  return `${gridNodeId}::subject-image::${subjectId}`;
}
