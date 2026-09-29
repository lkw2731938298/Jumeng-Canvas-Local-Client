/**
 * 本地模型接入：API Base 归一化、按分类拼 OpenAI 兼容路径、切换接入方式时的默认模板。
 *
 * 聚梦官方 Base URL 约定（https://doc.jumengai.com/api/base-url）：
 * - SDK / ComfyUI 自定义节点：填 `https://www.jumengai.com/v1`（**必须带 /v1**）
 * - 仅作上游通道：可用 `https://www.jumengai.com`（不带 /v1，拼接时自动补）
 * 与官方文档、ComfyUI 自定义节点填法一致。
 */

import type { LocalEndpointMode, LocalModel, LocalModelCategory } from "./types";
import { imageAspectPresets, videoDurationPresets } from "./presetTemplates";

/** 官方文档 SDK / ComfyUI 推荐 Base（含 /v1） */
export const JUMENGAI_SDK_API_BASE = "https://www.jumengai.com/v1";
/** 自定义 HTTP 模板示例，默认与官方 Base 一致 */
export const OPENAI_COMPAT_EXAMPLE_BASE = JUMENGAI_SDK_API_BASE;

/** 仅去掉末尾斜杠；保留尾部 /v1（勿再 strip，以免与文档/ComfyUI 不一致） */
export function normalizeApiBase(apiBase: string): string {
  return (apiBase || "").trim().replace(/\/+$/, "");
}

/**
 * 相对「已含 /v1 的 Base」的路径（与商业 jumengai.py：`{base}/images/generations` 一致）。
 * 文档完整路径形如 POST /v1/images/generations、/v1/video/generations。
 */
export function openAiCompatiblePath(category: LocalModelCategory): string {
  if (category === "image") return "/images/generations";
  if (category === "video") return "/video/generations";
  if (category === "audio") return "/audio/speech";
  // 3D 生成（Tripo 等）走聚梦网关异步任务 /v1/videos（非 chat/completions）
  if (category === "model3d") return "/videos";
  return "/chat/completions";
}

/**
 * 拼接完整请求 URL。兼容用户把 Base 写成带 /v1 或不带 /v1，以及 path 误带 /v1。
 */
export function joinApiUrl(apiBase: string, path: string): string {
  const base = normalizeApiBase(apiBase);
  let p = (path || "").trim();
  if (!p) return base;
  if (!p.startsWith("/")) p = `/${p}`;

  // base 已含 /v1，path 又写了 /v1/... → 去掉 path 前缀，避免 /v1/v1
  if (/\/v1$/i.test(base) && /^\/v1(\/|$)/i.test(p)) {
    p = p.replace(/^\/v1/i, "") || "/";
  }

  if (!base) {
    return /^\/v1(\/|$)/i.test(p) ? p : `/v1${p}`;
  }

  // base 无 /v1，path 也无 → 按 OpenAI 兼容自动补 /v1（上游通道写法）
  if (!/\/v1$/i.test(base) && !/^\/v1(\/|$)/i.test(p)) {
    return `${base}/v1${p}`;
  }

  return `${base}${p}`;
}

export function openAiCompatibleUrl(apiBase: string, category: LocalModelCategory): string {
  return joinApiUrl(apiBase, openAiCompatiblePath(category));
}

/** 自定义模板渲染后压缩误拼的 /v1/v1 */
export function collapseDoubleV1(url: string): string {
  return (url || "").replace(/\/v1\/v1(?=\/|$)/gi, "/v1");
}

export function defaultResponsePath(
  category: LocalModelCategory,
  mode: LocalEndpointMode
): string {
  if (mode === "custom_template") {
    if (category === "image") return "data.0.url";
    if (category === "video") return "data.id";
    if (category === "audio") return "";
    if (category === "model3d") return "id";
    return "choices.0.message.content";
  }
  if (category === "image") return "data.0.url";
  if (category === "video") return "data.id";
  if (category === "model3d") return "id";
  return "choices.0.message.content";
}

/** 切换「接入方式 / 分类」时套用合理默认模板（不覆盖用户已改过的 upstream 名） */
export function applyEndpointDefaults(
  model: LocalModel,
  next: { mode?: LocalEndpointMode; category?: LocalModelCategory }
): LocalModel {
  const mode = next.mode ?? model.mode ?? "openai_compatible";
  const category = next.category ?? model.category ?? "text";
  const categoryChanged =
    next.category !== undefined && next.category !== model.category;
  const out: LocalModel = {
    ...model,
    mode,
    category,
    responsePath: defaultResponsePath(category, mode),
  };

  // 分类变更时同步默认 generationPresets，并清掉手改 caps，避免图片仍挂视频时长
  if (categoryChanged) {
    const capsInput = {
      category,
      upstreamModel: out.upstreamModel,
      name: out.name,
      displayName: out.displayName,
    };
    if (category === "image") {
      out.canvasCaps = undefined;
      out.generationPresets = imageAspectPresets(capsInput);
    } else if (category === "video") {
      out.canvasCaps = undefined;
      out.generationPresets = videoDurationPresets(capsInput);
    } else {
      out.canvasCaps = undefined;
      out.generationPresets = undefined;
    }
  }

  if (mode === "openai_compatible") {
    // OpenAI 兼容不依赖 url/body；保留字段以免用户切回自定义时丢内容
    return out;
  }

  // 自定义模板：默认给出「完整第三方接口地址」示例（可直接改成自己的 URL）
  out.method = "POST";
  out.headersJson =
    '{\n  "Authorization": "Bearer {{apiKey}}",\n  "Content-Type": "application/json"\n}';
  if (category === "image") {
    out.url = `${OPENAI_COMPAT_EXAMPLE_BASE}/images/generations`;
    out.bodyTemplate =
      '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "n": 1,\n  "size": "{{size}}"\n}';
    out.responsePath = "data.0.url";
  } else if (category === "video") {
    out.url = `${OPENAI_COMPAT_EXAMPLE_BASE}/video/generations`;
    out.bodyTemplate =
      '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}"\n}';
    out.responsePath = "data.id";
  } else if (category === "audio") {
    out.url = `${OPENAI_COMPAT_EXAMPLE_BASE}/audio/speech`;
    out.bodyTemplate =
      '{\n  "model": "{{model}}",\n  "input": "{{prompt}}",\n  "voice": "alloy"\n}';
    out.responsePath = "";
  } else if (category === "model3d") {
    // 3D 生成固定走 Tripo 任务接口（type 由画布按文生/图生自动填写）
    out.url = `${OPENAI_COMPAT_EXAMPLE_BASE}/videos`;
    out.bodyTemplate =
      '{\n  "model": "{{model}}",\n  "type": "text_to_model",\n  "prompt": "{{prompt}}"\n}';
    out.responsePath = "id";
  } else {
    out.url = `${OPENAI_COMPAT_EXAMPLE_BASE}/chat/completions`;
    out.bodyTemplate =
      '{\n  "model": "{{model}}",\n  "messages": [{"role":"user","content":"{{prompt}}" }]\n}';
    out.responsePath = "choices.0.message.content";
  }
  return out;
}

export function endpointModeLabel(mode: LocalEndpointMode): string {
  if (mode === "custom_template") return "自定义 HTTP 模板";
  return "OpenAI 兼容（含聚梦 / ComfyUI）";
}

/** 是否聚梦网关 Base（www / 裸域） */
export function isJumengaiApiBase(apiBase?: string): boolean {
  const raw = normalizeApiBase(apiBase || "");
  if (!raw) return false;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
    return host === "jumengai.com" || host === "www.jumengai.com" || host.endsWith(".jumengai.com");
  } catch {
    return /jumengai\.com/i.test(raw);
  }
}

/** 部分网关 upstream id 带 /discount；或 Base/名称指向聚梦 */
export function isJumengaiUpstream(
  upstreamModel?: string,
  name?: string,
  apiBase?: string
): boolean {
  if (isJumengaiApiBase(apiBase)) return true;
  const u = (upstreamModel || "").trim();
  const n = (name || "").trim();
  return u.includes("/discount") || n.startsWith("jumengai_");
}
