import type { CanvasModel } from "@/lib/api/models";

/**
 * Seedance 2.0 产品截图「视频生成模式」五项。
 * 其它视频模型仍用精简 t2v/i2v/r2v。
 */
export type Seedance20UiMode =
  | "text_to_video"
  | "omni_reference"
  | "image_to_video"
  | "first_last_frame"
  | "image_reference";

export type VideoGenModeId = Seedance20UiMode | "t2v" | "i2v" | "r2v" | "lip_sync";

export interface VideoGenModeOption {
  mode: VideoGenModeId;
  label: string;
  /** 无可用模型时为空：展示但禁用 */
  modelName: string | null;
  disabled?: boolean;
}

/** 是否即梦 / RH / 华狐 Seedance 2.0 线（展示截图五项菜单） */
export function isSeedance20Model(modelName: string | undefined): boolean {
  if (!modelName) return false;
  return /(?:^|_)(?:rh_|huahu_)?seedance_20/i.test(modelName) || modelName.includes("seedance_20");
}

export const SEEDANCE20_UI_MODE_LABELS: Record<Seedance20UiMode, string> = {
  text_to_video: "文生视频",
  omni_reference: "全能参考",
  image_to_video: "图生视频",
  first_last_frame: "首尾帧",
  image_reference: "图片参考",
};

const SEEDANCE20_MODE_ORDER: Seedance20UiMode[] = [
  "text_to_video",
  "omni_reference",
  "image_to_video",
  "first_last_frame",
  "image_reference",
];

const SIMPLE_MODE_LABELS: Record<"t2v" | "i2v" | "r2v" | "lip_sync", string> = {
  t2v: "文生视频",
  i2v: "图生视频",
  r2v: "参考生",
  lip_sync: "对口型",
};

type SpeedTier = "std" | "fast" | "mini" | "4k";

function seedance20SpeedTier(name: string): SpeedTier {
  if (name.includes("_fast_")) return "fast";
  if (name.includes("_mini_")) return "mini";
  if (name.includes("_4k_")) return "4k";
  return "std";
}

function seedance20Provider(name: string): "ark" | "rh" | "huahu" {
  if (name.startsWith("rh_")) return "rh";
  if (name.startsWith("huahu_")) return "huahu";
  return "ark";
}

function isUsableVideo(model: CanvasModel): boolean {
  return model.isAvailable !== false && (model.category || "").toLowerCase() === "video";
}

function resolveSimpleMode(modelName: string, videoMode?: string | null): VideoGenModeId | null {
  const mode = typeof videoMode === "string" ? videoMode.trim().toLowerCase() : "";
  if (mode === "t2v" || mode === "i2v" || mode === "r2v" || mode === "lip_sync") return mode;
  const n = modelName.trim().toLowerCase();
  if (n.includes("lip_sync")) return "lip_sync";
  if (/_t2v$/i.test(n)) return "t2v";
  if (/_i2v$/i.test(n)) return "i2v";
  if (/_r2v$/i.test(n)) return "r2v";
  return null;
}

function videoModelFamilyKey(modelName: string): string {
  return modelName
    .trim()
    .replace(/_lip_sync$/i, "")
    .replace(/_(?:t2v|i2v|r2v)$/i, "");
}

function modelVideoModeParam(model: CanvasModel): string | null {
  const mode = model.parameters?.videoMode;
  return typeof mode === "string" ? mode : null;
}

/**
 * 从当前模型推断 Seedance 2.0 UI 模式。
 * ark r2v → 图片参考；rh/huahu r2v → 全能参考；i2v 默认首尾帧。
 */
export function inferSeedance20UiMode(modelName: string): Seedance20UiMode {
  const n = modelName.toLowerCase();
  if (/_t2v$/i.test(n)) return "text_to_video";
  if (/_i2v$/i.test(n)) return "first_last_frame";
  if (/_r2v$/i.test(n)) {
    if (n.startsWith("rh_") || n.startsWith("huahu_")) return "omni_reference";
    return "image_reference";
  }
  return "image_reference";
}

function pickPreferred(
  candidates: CanvasModel[],
  preferProviders: Array<"ark" | "rh" | "huahu">
): CanvasModel | undefined {
  for (const p of preferProviders) {
    const hit = candidates.find((m) => seedance20Provider(m.name) === p);
    if (hit) return hit;
  }
  return candidates[0];
}

/**
 * Seedance 2.0：固定五项，按速度档（std/fast/mini/4k）在目录中找对应模型。
 * 找不到则 disabled（仍展示，对齐截图完整列表）。
 */
export function buildSeedance20ModeOptions(
  currentModel: string,
  models: CanvasModel[]
): VideoGenModeOption[] {
  const tier = seedance20SpeedTier(currentModel);
  const pool = models.filter(
    (m) => isUsableVideo(m) && isSeedance20Model(m.name) && seedance20SpeedTier(m.name) === tier
  );

  const bySuffix = (suffix: "_t2v" | "_i2v" | "_r2v") =>
    pool.filter((m) => m.name.toLowerCase().endsWith(suffix));

  const resolve = (mode: Seedance20UiMode): CanvasModel | undefined => {
    switch (mode) {
      case "text_to_video":
        return pickPreferred(bySuffix("_t2v"), ["ark", "rh", "huahu"]);
      case "omni_reference":
        // 多模态参考：RH / 华狐 r2v
        return pickPreferred(
          bySuffix("_r2v").filter((m) => seedance20Provider(m.name) !== "ark"),
          ["rh", "huahu"]
        );
      case "image_to_video":
        // 图生视频：优先 RH/华狐 i2v，否则即梦 i2v
        return pickPreferred(bySuffix("_i2v"), ["rh", "huahu", "ark"]);
      case "first_last_frame":
        // 首尾帧：优先即梦 i2v
        return pickPreferred(bySuffix("_i2v"), ["ark", "rh", "huahu"]);
      case "image_reference":
        // 图片参考：优先即梦 r2v
        return pickPreferred(
          bySuffix("_r2v").filter((m) => seedance20Provider(m.name) === "ark"),
          ["ark"]
        ) ?? pickPreferred(bySuffix("_r2v"), ["ark", "rh", "huahu"]);
      default:
        return undefined;
    }
  };

  return SEEDANCE20_MODE_ORDER.map((mode) => {
    const model = resolve(mode);
    return {
      mode,
      label: SEEDANCE20_UI_MODE_LABELS[mode],
      modelName: model?.name ?? null,
      disabled: !model,
    };
  });
}

/** 非 Seedance 2.0：同系列精简模式 */
function buildSimpleModeOptions(
  currentModel: string,
  models: CanvasModel[]
): VideoGenModeOption[] {
  const family = videoModelFamilyKey(currentModel);
  if (!family) return [];

  const order: Array<"t2v" | "i2v" | "r2v" | "lip_sync"> = ["t2v", "i2v", "r2v", "lip_sync"];
  const byMode = new Map<string, VideoGenModeOption>();

  for (const model of models) {
    if (!isUsableVideo(model)) continue;
    if (videoModelFamilyKey(model.name) !== family) continue;
    const mode = resolveSimpleMode(model.name, modelVideoModeParam(model));
    if (!mode || !(mode in SIMPLE_MODE_LABELS)) continue;
    const simple = mode as keyof typeof SIMPLE_MODE_LABELS;
    const prev = byMode.get(simple);
    if (prev && prev.modelName === currentModel) continue;
    if (!prev || model.name === currentModel) {
      byMode.set(simple, {
        mode: simple,
        label: SIMPLE_MODE_LABELS[simple],
        modelName: model.name,
      });
    }
  }

  if (byMode.size === 0) {
    const mode = resolveSimpleMode(currentModel, null);
    if (mode && mode in SIMPLE_MODE_LABELS) {
      const simple = mode as keyof typeof SIMPLE_MODE_LABELS;
      byMode.set(simple, {
        mode: simple,
        label: SIMPLE_MODE_LABELS[simple],
        modelName: currentModel,
      });
    }
  }

  return order.map((m) => byMode.get(m)).filter((x): x is VideoGenModeOption => Boolean(x));
}

/** 构建当前模型适用的生成模式下拉选项 */
export function buildVideoGenModeOptions(
  currentModel: string,
  models: CanvasModel[]
): VideoGenModeOption[] {
  if (isSeedance20Model(currentModel)) {
    return buildSeedance20ModeOptions(currentModel, models);
  }
  return buildSimpleModeOptions(currentModel, models);
}

/** 解析当前应高亮的模式 id */
export function resolveActiveVideoUiMode(
  modelName: string,
  storedUiMode: string | null | undefined,
  options: VideoGenModeOption[]
): VideoGenModeId {
  if (storedUiMode && options.some((o) => o.mode === storedUiMode)) {
    return storedUiMode as VideoGenModeId;
  }
  if (isSeedance20Model(modelName)) {
    return inferSeedance20UiMode(modelName);
  }
  return (
    options.find((o) => o.modelName === modelName)?.mode ??
    resolveSimpleMode(modelName, null) ??
    "r2v"
  );
}

/** 模式下拉触发器文案 */
export function videoUiModeLabel(mode: VideoGenModeId | undefined): string {
  if (!mode) return "文生视频";
  if (mode in SEEDANCE20_UI_MODE_LABELS) {
    return SEEDANCE20_UI_MODE_LABELS[mode as Seedance20UiMode];
  }
  if (mode in SIMPLE_MODE_LABELS) {
    return SIMPLE_MODE_LABELS[mode as keyof typeof SIMPLE_MODE_LABELS];
  }
  return "文生视频";
}
