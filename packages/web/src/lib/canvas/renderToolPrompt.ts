import type { ShotScale } from "@/lib/canvas/multiAnglePresets";
import {
  describeAzimuthForPrompt,
  describeElevationForPrompt,
  formatAngleNumber,
  normalizeAzimuth,
  normalizeElevation,
} from "@/lib/canvas/multiAnglePresets";

export type PromptToolKind =
  | "composer"
  | "append"
  | "text_gen"
  | "visual_styles"
  | "creative_tools";

export interface VisualStyleItem {
  id: string;
  label: string;
  prompt: string;
  imageUrl?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface VisualStylesPromptToolConfig {
  kind: "visual_styles";
  menuLabel: string;
  joiner?: string;
  items: VisualStyleItem[];
}

export type ComposerBaseMode = "merge" | "admin" | "canvas";

export interface ComposerPromptToolConfig {
  kind: "composer";
  template: string;
  static: {
    j?: string;
    /** Admin-configured base prompt; merged into {base} per baseMode. */
    b?: string;
    base?: string;
    /** merge = admin + canvas; admin = admin only; canvas = canvas/node only */
    baseMode?: ComposerBaseMode;
    c?: string;
  };
  /** Prompt text patterns for continuous angles from 3D ball / sliders. */
  formats?: {
    h?: string;
    e?: string;
    bright?: string;
    color?: string;
  };
  lookups: {
    h?: Record<string, string>;
    e?: Record<string, string>;
    s?: Record<string, string>;
    dir?: Record<string, string>;
    rim?: Record<string, string>;
    smart?: Record<string, string>;
  };
  labels?: {
    h?: Record<string, string>;
    e?: Record<string, string>;
    s?: Record<string, string>;
    dir?: Record<string, string>;
  };
}

export interface AppendPromptToolConfig {
  kind: "append";
  menuLabel: string;
  appendText: string;
  joiner?: string;
}

/** 图片节点「九宫格」弹层：各创作工具独立提示词（后台可改） */
export interface CreativeToolPromptItem {
  id: string;
  label: string;
  prompt: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface CreativeToolsPromptToolConfig {
  kind: "creative_tools";
  menuLabel: string;
  /** 兼容旧版顶栏后缀 I2I（多机位九宫格默认追加） */
  appendText?: string;
  joiner?: string;
  items: CreativeToolPromptItem[];
}

/** Text node generation prompts — system + optional user prefix / subject rules. */
export interface TextGenPromptToolConfig {
  kind: "text_gen";
  menuLabel: string;
  systemPrompt: string;
  /** Prepended to user message before editor content. */
  userPrefix?: string;
  /** Subject extract: role/scene/prop rules (参考主平台 admin prompt rules). */
  roleRule?: string;
  sceneRule?: string;
  propRule?: string;
}

export type PromptToolConfig =
  | ComposerPromptToolConfig
  | AppendPromptToolConfig
  | TextGenPromptToolConfig
  | VisualStylesPromptToolConfig
  | CreativeToolsPromptToolConfig;

export interface MultiAngleRuntime {
  base: string;
  extra?: string;
  /** Exact horizontal angle in degrees (0–360), from 3D ball or preset buttons. */
  azimuth: number;
  /** Exact elevation in degrees (-90–90), from 3D ball or preset buttons. */
  elevation: number;
  shot: ShotScale;
}

export interface AppendRuntime {
  base: string;
}

export type LightDirection = "front" | "back" | "left" | "right" | "top" | "bottom";

export interface LightingRuntime {
  base: string;
  extra?: string;
  direction: LightDirection;
  brightness: number;
  color: string | null;
  rimLight: boolean;
  smartMode: boolean;
}

export type ComposerRuntime = MultiAngleRuntime | LightingRuntime;

const DEFAULT_H_FORMAT = "水平环绕{azimuth}度（{azimuthDesc}）";
const DEFAULT_E_FORMAT = "俯仰{elevation}度（{elevationDesc}）";
const DEFAULT_BRIGHT_FORMAT = "光照强度{brightness}%（{brightnessDesc}）";
const DEFAULT_COLOR_FORMAT = "{colorDesc}";

export const LIGHT_DIRECTION_KEYS: LightDirection[] = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
];

export function getComposerStaticBase(config: ComposerPromptToolConfig): string {
  const staticCfg = config.static ?? {};
  return String(staticCfg.base ?? staticCfg.b ?? "").trim();
}

/** Pull image/subject body from markdown sections or JSON wrappers. */
export function extractSubjectPromptForMultiAngle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const sectionMatch = trimmed.match(
    /(?:^|\n)#{1,3}\s*(?:正向提示词|图片提示词|Image Prompt|Prompt)(?:[（(][^）)]*[）)])?[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/i
  );
  if (sectionMatch?.[1]?.trim()) return sectionMatch[1].trim();

  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const fromJson = obj.imagePrompt ?? obj["图片提示词"] ?? obj.image_prompt;
      if (typeof fromJson === "string" && fromJson.trim()) return fromJson.trim();
    } catch {
      /* not json */
    }
  }

  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Clean canvas-side base before merging with admin static.base. */
export function normalizeCanvasBaseForComposer(
  canvasBase: string,
  config: ComposerPromptToolConfig
): string {
  let text = extractSubjectPromptForMultiAngle(canvasBase);
  const adminBase = getComposerStaticBase(config);
  if (adminBase && text.startsWith(adminBase)) {
    const joiner = config.static?.j ?? "，";
    text = text.slice(adminBase.length).replace(new RegExp(`^${escapeRegExp(joiner)}\\s*`), "");
  }
  const staticC = config.static?.c?.trim();
  if (staticC && text.includes(staticC)) {
    text = text.replace(staticC, "").trim();
  }
  return text.trim();
}

/** Resolve {base} from admin static.base + canvas runtime.base. */
export function mergeComposerBase(
  config: ComposerPromptToolConfig,
  runtimeBase: string | undefined
): string {
  const joiner = config.static?.j ?? "，";
  const mode = config.static?.baseMode ?? "admin";
  const adminBase = getComposerStaticBase(config);
  const canvasBase = normalizeCanvasBaseForComposer(String(runtimeBase ?? "").trim(), config);

  if (mode === "admin") return adminBase;
  if (mode === "canvas") return canvasBase;
  if (adminBase && canvasBase) return `${adminBase}${joiner}${canvasBase}`;
  return adminBase || canvasBase;
}

function applyAngleFormat(
  pattern: string,
  runtime: MultiAngleRuntime
): string {
  const azimuth = formatAngleNumber(normalizeAzimuth(runtime.azimuth));
  const elevation = formatAngleNumber(normalizeElevation(runtime.elevation));
  const azimuthDesc = describeAzimuthForPrompt(runtime.azimuth);
  const elevationDesc = describeElevationForPrompt(runtime.elevation);
  return pattern
    .replace(/\{azimuth\}/g, azimuth)
    .replace(/\{elevation\}/g, elevation)
    .replace(/\{azimuthDesc\}/g, azimuthDesc)
    .replace(/\{elevationDesc\}/g, elevationDesc);
}

function resolveHorizontal(
  config: ComposerPromptToolConfig,
  runtime: MultiAngleRuntime
): string {
  const pattern = config.formats?.h?.trim() || DEFAULT_H_FORMAT;
  return applyAngleFormat(pattern, runtime);
}

function resolveElevation(
  config: ComposerPromptToolConfig,
  runtime: MultiAngleRuntime
): string {
  const pattern = config.formats?.e?.trim() || DEFAULT_E_FORMAT;
  return applyAngleFormat(pattern, runtime);
}

function lookupShot(
  lookups: ComposerPromptToolConfig["lookups"],
  runtime: MultiAngleRuntime
): string {
  const table = lookups.s ?? {};
  return table[String(runtime.shot ?? "")] ?? "";
}

export function describeBrightnessForPrompt(brightness: number): string {
  const value = Math.max(0, Math.min(100, brightness));
  const rounded = Math.round(value);
  if (rounded <= 20) return "极弱环境光，低对比柔和阴影";
  if (rounded <= 40) return "柔和低对比，自然辅光";
  if (rounded <= 60) return "自然均衡照明，明暗适中";
  if (rounded <= 80) return "高对比戏剧光，明暗分界清晰";
  return "强高光与深阴影，高戏剧张力";
}

export function describeColorForPrompt(color: string | null | undefined): string {
  const raw = String(color ?? "").trim();
  if (!raw || raw.toLowerCase() === "none" || raw.toLowerCase() === "transparent") return "";
  let hex = raw.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((ch) => ch + ch).join("");
  if (hex.length !== 6) return "有色光源";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "有色光源";
  if (r > 230 && g > 230 && b > 230) return "";
  if (r > 200 && g > 170 && b < 140) return "暖黄色光源";
  if (b > 200 && r < 150) return "冷蓝色光源";
  if (g > Math.max(r, b) + 30) return "绿色调光源";
  if (r > Math.max(g, b) + 30) return "暖红色光源";
  return "有色光源";
}

function lookupDirection(
  lookups: ComposerPromptToolConfig["lookups"],
  runtime: LightingRuntime
): string {
  const table = lookups.dir ?? {};
  return table[String(runtime.direction ?? "front")] ?? "";
}

function lookupRim(
  lookups: ComposerPromptToolConfig["lookups"],
  runtime: LightingRuntime
): string {
  const table = lookups.rim ?? {};
  return table[runtime.rimLight ? "on" : "off"] ?? "";
}

function lookupSmart(
  lookups: ComposerPromptToolConfig["lookups"],
  runtime: LightingRuntime
): string {
  const table = lookups.smart ?? {};
  return table[runtime.smartMode ? "on" : "off"] ?? "";
}

function resolveBrightness(config: ComposerPromptToolConfig, runtime: LightingRuntime): string {
  const pattern = config.formats?.bright?.trim() || DEFAULT_BRIGHT_FORMAT;
  const brightness = Math.max(0, Math.min(100, runtime.brightness ?? 50));
  const rounded = Math.round(brightness);
  const brightnessDesc = describeBrightnessForPrompt(brightness);
  return pattern
    .replace(/\{brightness\}/g, String(rounded))
    .replace(/\{brightnessDesc\}/g, brightnessDesc);
}

function resolveColor(config: ComposerPromptToolConfig, runtime: LightingRuntime): string {
  const pattern = config.formats?.color?.trim() || DEFAULT_COLOR_FORMAT;
  const colorDesc = describeColorForPrompt(runtime.color);
  if (!colorDesc) return "";
  return pattern.replace(/\{colorDesc\}/g, colorDesc);
}

function isLightingRuntime(runtime: ComposerRuntime): runtime is LightingRuntime {
  return "direction" in runtime;
}

function resolveSegment(
  segment: string,
  config: ComposerPromptToolConfig,
  runtime: ComposerRuntime
): string {
  const token = segment.trim();
  if (!token) return "";
  const staticCfg = config.static ?? {};
  const lookups = config.lookups ?? {};

  if (token === "{base}" || token === "{basePrompt}") {
    return mergeComposerBase(config, runtime.base);
  }
  if (token === "{extra}" || token === "{extra?}") {
    const extra = String(runtime.extra ?? "").trim();
    if (token === "{extra?}" && !extra) return "";
    return extra;
  }
  if (token === "$j") return staticCfg.j ?? "，";
  if (token === "$b") return getComposerStaticBase(config);
  if (token === "$c") return staticCfg.c ?? "";
  if (token === "$h") return resolveHorizontal(config, runtime as MultiAngleRuntime);
  if (token === "$e") return resolveElevation(config, runtime as MultiAngleRuntime);
  if (token === "$s") return lookupShot(lookups, runtime as MultiAngleRuntime);
  if (isLightingRuntime(runtime)) {
    if (token === "$dir") return lookupDirection(lookups, runtime);
    if (token === "$bright") return resolveBrightness(config, runtime);
    if (token === "$color") return resolveColor(config, runtime);
    if (token === "$rim") return lookupRim(lookups, runtime);
    if (token === "$smart") return lookupSmart(lookups, runtime);
  }
  return token;
}

export function renderComposerPrompt(
  config: ComposerPromptToolConfig,
  runtime: ComposerRuntime
): string {
  const joiner = config.static?.j ?? "，";
  const segments = config.template
    .split("→")
    .map((part) => part.trim())
    .filter(Boolean);
  const parts: string[] = [];
  for (const segment of segments) {
    const value = resolveSegment(segment, config, runtime).trim();
    if (value) parts.push(value);
  }
  return parts.join(joiner);
}

export function renderAppendPrompt(config: AppendPromptToolConfig, runtime: AppendRuntime): string {
  const base = String(runtime.base ?? "").trim();
  const appendText = String(config.appendText ?? "").trim();
  const joiner = config.joiner ?? "，";
  if (!base) return appendText;
  if (!appendText) return base;
  return `${base}${joiner}${appendText}`;
}

export function buildLightingPrompt(
  composer: ComposerPromptToolConfig,
  runtime: LightingRuntime
): string {
  return renderComposerPrompt(composer, runtime);
}

export function renderToolPrompt(
  config: PromptToolConfig,
  runtime: ComposerRuntime | AppendRuntime | TextGenRuntime
): string {
  if (config.kind === "composer") {
    return renderComposerPrompt(config, runtime as ComposerRuntime);
  }
  if (config.kind === "text_gen") {
    return buildTextGenUserContent(config, runtime as TextGenRuntime);
  }
  if (config.kind === "visual_styles") {
    return "";
  }
  if (config.kind === "creative_tools") {
    return renderAppendPrompt(
      {
        kind: "append",
        menuLabel: config.menuLabel,
        appendText: config.appendText || "",
        joiner: config.joiner,
      },
      runtime as AppendRuntime
    );
  }
  return renderAppendPrompt(config, runtime as AppendRuntime);
}

export interface TextGenRuntime {
  content: string;
  referenceBlocks?: string[];
}

export function buildTextGenUserContent(
  config: TextGenPromptToolConfig,
  runtime: TextGenRuntime
): string {
  const parts: string[] = [];
  const prefix = String(config.userPrefix ?? "").trim();
  if (prefix) parts.push(prefix);

  const roleRule = String(config.roleRule ?? "").trim();
  const sceneRule = String(config.sceneRule ?? "").trim();
  const propRule = String(config.propRule ?? "").trim();
  if (roleRule) parts.push(`## 角色提取规则\n${roleRule}`);
  if (sceneRule) parts.push(`## 场景提取规则\n${sceneRule}`);
  if (propRule) parts.push(`## 道具提取规则\n${propRule}`);

  for (const block of runtime.referenceBlocks ?? []) {
    const trimmed = block.trim();
    if (trimmed) parts.push(trimmed);
  }

  const content = String(runtime.content ?? "").trim();
  if (content) {
    if (parts.length) {
      parts.push(`## 用户输入\n${content}`);
    } else {
      parts.push(content);
    }
  }

  return parts.join("\n\n");
}

export function lightingUiLabels(config: ComposerPromptToolConfig) {
  return {
    directionLabels: config.labels?.dir ?? {},
    joiner: config.static?.j ?? "，",
    consistency: config.static?.c ?? "",
    defaultBase: getComposerStaticBase(config),
    baseMode: config.static?.baseMode ?? "admin",
  };
}

export function multiAngleUiLabels(config: ComposerPromptToolConfig) {
  return {
    horizontalLabels: config.labels?.h ?? {},
    elevationLabels: config.labels?.e ?? {},
    shotLabels: config.labels?.s ?? {},
    joiner: config.static?.j ?? "，",
    consistency: config.static?.c ?? "",
    defaultBase: getComposerStaticBase(config),
    baseMode: config.static?.baseMode ?? "admin",
  };
}

export const HORIZONTAL_KEYS = ["0", "45", "90", "135", "180", "225", "270", "315"] as const;
export const ELEVATION_KEYS = ["-90", "-45", "0", "45", "90"] as const;
export const SHOT_KEYS: ShotScale[] = ["close", "medium", "wide"];

export function validateComposerConfig(
  config: ComposerPromptToolConfig,
  toolId?: string
): string[] {
  const errors: string[] = [];
  const template = config.template?.trim() ?? "";
  if (!template) errors.push("template 不能为空");

  const isLighting = toolId === "lighting" || template.includes("$dir");
  const isMultiAngle = toolId === "multi_angle" || template.includes("$h");

  if (isMultiAngle) {
    const shotTable = config.lookups?.s ?? {};
    const missingShots = SHOT_KEYS.filter((key) => !String(shotTable[key] ?? "").trim());
    if (missingShots.length) errors.push(`lookups.s 缺少: ${missingShots.join(", ")}`);
  }

  if (isLighting) {
    const dirTable = config.lookups?.dir ?? {};
    const missingDirs = LIGHT_DIRECTION_KEYS.filter((key) => !String(dirTable[key] ?? "").trim());
    if (missingDirs.length) errors.push(`lookups.dir 缺少: ${missingDirs.join(", ")}`);
  }

  return errors;
}

export function validateAppendConfig(config: AppendPromptToolConfig): string[] {
  const errors: string[] = [];
  if (!config.menuLabel?.trim()) errors.push("menuLabel 不能为空");
  if (!config.appendText?.trim()) errors.push("appendText 不能为空");
  return errors;
}

export function validateCreativeToolsConfig(config: CreativeToolsPromptToolConfig): string[] {
  const errors: string[] = [];
  if (!config.menuLabel?.trim()) errors.push("menuLabel 不能为空");
  if (!config.items?.length) {
    errors.push("items 至少包含一个创作工具提示词");
    return errors;
  }
  const seen = new Set<string>();
  config.items.forEach((item, idx) => {
    const id = item.id?.trim();
    if (!id) {
      errors.push(`items[${idx}].id 不能为空`);
      return;
    }
    if (seen.has(id)) errors.push(`工具 id 重复：${id}`);
    seen.add(id);
    if (!item.label?.trim()) errors.push(`items[${idx}].label 不能为空`);
    if (item.enabled !== false && !item.prompt?.trim()) {
      errors.push(`工具「${id}」的 prompt 不能为空`);
    }
  });
  return errors;
}

export function findCreativeToolPrompt(
  config: CreativeToolsPromptToolConfig | null | undefined,
  toolId: string | null | undefined
): CreativeToolPromptItem | undefined {
  const id = toolId?.trim();
  if (!id || !config?.items?.length) return undefined;
  return config.items.find((item) => item.id === id && item.enabled !== false);
}

export function validateTextGenConfig(config: TextGenPromptToolConfig): string[] {
  const errors: string[] = [];
  if (!config.menuLabel?.trim()) errors.push("menuLabel 不能为空");
  if (!config.systemPrompt?.trim()) errors.push("systemPrompt 不能为空");
  return errors;
}

export function validateVisualStylesConfig(config: VisualStylesPromptToolConfig): string[] {
  const errors: string[] = [];
  if (!config.menuLabel?.trim()) errors.push("menuLabel 不能为空");
  if (!config.items?.length) {
    errors.push("items 至少包含一个风格");
    return errors;
  }
  const seen = new Set<string>();
  let hasNone = false;
  config.items.forEach((item, idx) => {
    const id = item.id?.trim();
    if (!id) {
      errors.push(`items[${idx}].id 不能为空`);
      return;
    }
    if (seen.has(id)) errors.push(`风格 id 重复：${id}`);
    seen.add(id);
    if (id === "none") hasNone = true;
    if (!item.label?.trim()) errors.push(`items[${idx}].label 不能为空`);
    if (id !== "none" && !item.prompt?.trim()) {
      errors.push(`风格「${id}」的 prompt 不能为空`);
    }
  });
  if (!hasNone) errors.push("必须包含固定风格 id=none（无）");
  return errors;
}

export const DEFAULT_VISUAL_STYLE_ID = "none";

export function listEnabledVisualStyles(config: VisualStylesPromptToolConfig | null | undefined) {
  if (!config?.items?.length) {
    return [{ id: DEFAULT_VISUAL_STYLE_ID, label: "无", prompt: "", imageUrl: "", enabled: true, sortOrder: 0 }];
  }
  return [...config.items]
    .filter((item) => item.enabled !== false && item.id?.trim())
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id === DEFAULT_VISUAL_STYLE_ID ? -1 : 0));
}

export function findVisualStyle(
  config: VisualStylesPromptToolConfig | null | undefined,
  styleId: string | null | undefined
): VisualStyleItem | undefined {
  const id = styleId?.trim() || DEFAULT_VISUAL_STYLE_ID;
  return listEnabledVisualStyles(config).find((item) => item.id === id);
}

export function applyVisualStyleToPrompt(
  userPrompt: string,
  config: VisualStylesPromptToolConfig | null | undefined,
  styleId: string | null | undefined
): string {
  const style = findVisualStyle(config, styleId);
  const stylePrompt = style?.id === DEFAULT_VISUAL_STYLE_ID ? "" : style?.prompt?.trim() ?? "";
  if (!stylePrompt) return userPrompt.trim();
  const user = userPrompt.trim();
  const joiner = config?.joiner?.trim() || "，";
  return user ? `${user}${joiner}${stylePrompt}` : stylePrompt;
}
