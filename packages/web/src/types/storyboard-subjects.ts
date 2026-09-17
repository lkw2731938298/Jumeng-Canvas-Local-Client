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

const SUBJECT_IMAGE_STYLE_ANCHOR =
  "高清影视资产参考图，主体清晰突出，构图完整，干净背景，无文字水印，high quality character/scene reference";

/**
 * 角色主体图布局：在同一张图片中生成「面部特写 + 全身三视图」。
 * 最左侧为面部特写（头部完整），右侧依次并排全身正面图、侧面图、后视图，
 * 四个视图为同一角色、同一造型，仅用于角色（role），场景/道具不适用。
 */
const ROLE_REFERENCE_SHEET_LAYOUT =
  "在同一张图片中从左到右横向排列展示同一角色的面部特写与全身三视图，四个视图为同一人物、同一造型，脸型五官、发型、服装与配色严格保持一致：" +
  "最左侧是该角色的面部特写（正脸，头部与五官完整清晰、不裁切）；" +
  "其右侧依次并排放置该角色的全身正面图、全身侧面图、全身后视图，三张全身图均为完整站姿、从头到脚不裁切、比例与身高一致；" +
  "纯色干净背景，各视图之间留白分隔，无文字、无水印、无分格线，character turnaround reference sheet with face close-up";

/** 角色主体图提示词版本：布局升级后并入幂等键，使历史角色图按新的三视图布局重绘 */
const ROLE_IMAGE_PROMPT_VERSION = "role-turnaround-v1";

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
  // 角色额外附带布局版本号：三视图布局升级后，历史角色图会被判定为需重绘并按新布局生成
  if (kind === "role") parts.push(ROLE_IMAGE_PROMPT_VERSION);
  const payload = parts.join("|");
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

export function buildSubjectImagePrompt(item: StoryboardSubjectItem, kind: StoryboardSubjectKind): string {
  const kindLabel = SUBJECT_KIND_LABELS[kind];
  const core = item.extractPrompt.trim() || item.name.trim();
  const base = `${kindLabel}：${item.name}。${core}。${SUBJECT_IMAGE_STYLE_ANCHOR}`;
  // 角色主体图额外生成「面部特写 + 全身三视图」：面部特写在最左，右侧为全身正/侧/后视图
  if (kind === "role") {
    return `${base}。${ROLE_REFERENCE_SHEET_LAYOUT}`;
  }
  return base;
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
