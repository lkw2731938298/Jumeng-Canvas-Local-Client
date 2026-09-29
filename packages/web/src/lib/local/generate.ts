/**
 * 本地生成：经本机 /api/local/upstream 代发（避免浏览器 CORS），
 * 再按用户配置走 OpenAI 兼容或自定义模板。
 */

import { localStore } from "./store";
import type { LocalModel, LocalProvider } from "./types";
import {
  collapseDoubleV1,
  isJumengaiUpstream,
  joinApiUrl,
  normalizeApiBase,
  openAiCompatibleUrl,
} from "./endpointHelpers";
import { LocalUpstreamJobError } from "./generationJobs";
import type { SubmittedRefsNote } from "./withLocalGenerationJob";
import {
  asModelCapsInput,
  clampCanvasClarity,
  mapVideoClarityToUpstream,
  normalizeClarityTierId,
  resolveModelCanvasCaps,
  type CanvasClarityTier,
  type ImageSizeMode,
  type ModelCanvasCaps,
  type ModelCapsInput,
  type VideoSizeMode,
} from "./modelGenerationCaps";

type UpstreamProxyResult = {
  ok?: boolean;
  error?: string;
  status?: number;
  contentType?: string;
  text?: string;
  json?: unknown;
  base64?: string;
};

/** 经 Next 服务端转发上游请求（本机代发，绕过 CORS） */
async function proxyUpstream(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<UpstreamProxyResult> {
  const res = await callLocalProxyRoute("/api/local/upstream", params, params.signal);
  const data = (await res.json()) as UpstreamProxyResult;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `上游代理失败 HTTP ${res.status}`);
  }
  return data;
}

/** 流式代发：返回可读 Response（SSE / chunked） */
async function proxyUpstreamStream(params: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const res = await callLocalProxyRoute(
    "/api/local/upstream",
    {
      url: params.url,
      method: params.method,
      headers: params.headers,
      body: params.body,
      timeoutMs: params.timeoutMs,
      stream: true,
    },
    params.signal
  );
  if (!res.ok) {
    let detail = `上游流式代理失败 HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) detail = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res;
}

/**
 * 调本机代理路由。裸 fetch 失败时浏览器只给 "Failed to fetch"，
 * 这里补上是哪条路由、多大负载，便于区分「本机服务没起来」和「上游拒绝」。
 */
async function callLocalProxyRoute(
  route: string,
  params: unknown,
  signal?: AbortSignal
): Promise<Response> {
  const body = JSON.stringify(params);
  try {
    return await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    });
  } catch (err) {
    if (
      (err instanceof Error && err.name === "AbortError") ||
      signal?.aborted
    ) {
      const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
      throw new AgentTurnAbortedError();
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `本机代理 ${route} 连接失败（${reason}）。负载约 ${(body.length / (1024 * 1024)).toFixed(1)}MB。` +
        `请确认画布服务窗口仍在运行、未被防火墙拦截；若刚改过设置可刷新页面重试`
    );
  }
}

/** multipart 代发（本地参考图以文件字段直传聚梦，避免 JSON 里塞 data: URL） */
async function proxyUpstreamMultipart(params: {
  url: string;
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  files?: Array<{
    field: string;
    filename?: string;
    contentType?: string;
    base64: string;
  }>;
  timeoutMs?: number;
}): Promise<UpstreamProxyResult> {
  const res = await callLocalProxyRoute("/api/local/upstream-multipart", params);
  const data = (await res.json()) as UpstreamProxyResult;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `上游 multipart 代理失败 HTTP ${res.status}`);
  }
  return data;
}

/** 聚梦官方上传凭据；无则退回 OSS / base64 */
export type JumengUploadCreds = { apiBase: string; apiKey: string };

/** 官方文件上传限额：图片 10MB、视频 100MB（超出直接 400） */
const JUMENG_UPLOAD_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const JUMENG_UPLOAD_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/**
 * 聚梦官方文件上传 API：POST {base}/files/upload，multipart 字段名固定 file。
 * 返回约 1 小时有效的公网直链，专供后续生图 / 生视频当参考素材，免配 OSS。
 * 限制：图片 JPEG/PNG/GIF/WEBP ≤10MB，视频 MP4/MOV/WebM ≤100MB，同一密钥每小时 50 个。
 */
async function uploadRefToJumengFiles(params: {
  creds: JumengUploadCreds;
  /** data URL 或裸 base64 */
  base64OrDataUrl: string;
  contentType: string;
  filename: string;
}): Promise<string> {
  const { apiBase, apiKey } = params.creds;
  if (!apiBase || !apiKey) throw new Error("缺少聚梦接口地址或密钥，无法上传参考素材");

  const isVideo = /^video\//i.test(params.contentType);
  const bytes = dataUrlApproxBytes(params.base64OrDataUrl);
  const limit = isVideo ? JUMENG_UPLOAD_MAX_VIDEO_BYTES : JUMENG_UPLOAD_MAX_IMAGE_BYTES;
  if (bytes > limit) {
    throw new Error(
      `参考${isVideo ? "视频" : "图"}约 ${(bytes / (1024 * 1024)).toFixed(1)}MB，` +
        `超过聚梦文件上传上限 ${Math.round(limit / (1024 * 1024))}MB。请压缩后重试，或配置「参考图 OSS」`
    );
  }

  const url = joinApiUrl(apiBase, "/files/upload");
  const res = await proxyUpstreamMultipart({
    url,
    headers: { Authorization: `Bearer ${apiKey}` },
    files: [
      {
        field: "file",
        filename: params.filename,
        contentType: params.contentType,
        base64: params.base64OrDataUrl,
      },
    ],
    timeoutMs: isVideo ? 300_000 : 120_000,
  });

  const status = res.status ?? 500;
  if (status >= 400) {
    const detail = upstreamErrorDetail(res);
    if (status === 401) throw new Error(`聚梦文件上传 401：密钥无效或未生效。详情：${detail.slice(0, 160)}`);
    // 未实名的账号调不了文件上传：这是账号侧限制，重试多少次都没用
    if (/real_name_required|实名认证/.test(detail)) {
      throw new Error(
        "聚梦账号未实名认证，官方文件上传接口不可用（HTTP 403 real_name_required）。" +
          "请到聚梦控制台完成实名认证，或改为配置「参考图 OSS」"
      );
    }
    if (status === 429) throw new Error("聚梦文件上传 429：该密钥本小时已传满 50 个文件，请稍后再试");
    if (status === 503) throw new Error("聚梦文件上传 503：上游存储未配置，请稍后再试或改用「参考图 OSS」");
    throw new Error(`聚梦文件上传失败 HTTP ${status}：${detail.slice(0, 200)}`);
  }

  const payload = asRecord(res.json ?? (res.text ? safeJson(res.text) : null));
  const uploaded = String(payload?.url || "").trim();
  if (!/^https?:\/\//i.test(uploaded)) {
    throw new Error(`聚梦文件上传未返回可用 url：${JSON.stringify(res.json ?? res.text ?? "").slice(0, 200)}`);
  }
  return uploaded;
}

/** data URL 头 → contentType / 扩展名 */
function dataUrlMime(raw: string): { contentType: string; ext: string } {
  const m = /^data:([^;,]+)[;,]/i.exec((raw || "").trim());
  const contentType = (m?.[1] || "image/jpeg").toLowerCase();
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  return { contentType, ext };
}

/**
 * 通道拒收 base64 参考图时的兜底：改走 OpenAI 兼容 images/edits，
 * 以 multipart 文件字段直传本机图片（无需公网 URL / OSS）。
 * 上游不支持该端点或仍失败时返回 null，由调用方抛出配置指引。
 */
async function tryImagesEditWithFiles(params: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  dataRefs: string[];
}): Promise<{ url?: string; b64?: string } | null> {
  const editsUrl = params.endpoint.replace(/\/images\/generations\/?$/i, "/images/edits");
  if (editsUrl === params.endpoint) return null;
  const refs = params.dataRefs.slice(0, 4);
  if (refs.length === 0) return null;

  const files = refs.map((d, i) => {
    const { contentType, ext } = dataUrlMime(d);
    return {
      // 多图用 image[]，单图用 image（两种写法上游各有支持）
      field: refs.length > 1 ? "image[]" : "image",
      filename: `ref-${i + 1}.${ext}`,
      contentType,
      base64: d,
    };
  });

  let res: UpstreamProxyResult;
  try {
    res = await proxyUpstreamMultipart({
      url: editsUrl,
      headers: { Authorization: `Bearer ${params.apiKey}` },
      fields: {
        model: params.model,
        prompt: params.prompt,
        n: "1",
        size: params.size,
        response_format: "url",
      },
      files,
      timeoutMs: 180_000,
    });
  } catch {
    return null;
  }
  if ((res.status ?? 500) >= 400) return null;
  const payload = res.json ?? (res.text ? safeJson(res.text) : null);
  const parsed = parseLocalImageUpstreamResult(payload, undefined);
  return parsed.url || parsed.b64 ? parsed : null;
}

function upstreamErrorDetail(data: UpstreamProxyResult): string {
  if (typeof data.text === "string" && data.text.trim()) return data.text.slice(0, 300);
  if (data.json != null) {
    try {
      return JSON.stringify(data.json).slice(0, 300);
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** 将上游图片结果落成本地素材，并注册 assetId（分镜主体图等依赖此 id） */
export async function persistLocalImageResult(params: {
  projectId: string;
  nodeId: string;
  url?: string;
  b64?: string;
  /** 素材库标题 */
  assetTitle?: string;
  /** 素材子分类（人物/场景/物品等） */
  assetSubcategory?: string | null;
}): Promise<{ url: string; assetId: string }> {
  const title =
    (params.assetTitle || "").trim() ||
    String(params.nodeId || "").replace(/^sb-subject-img-/i, "") ||
    "主体图";

  const saveB64 = async (b64Raw: string, ext: string) => {
    const b64 = b64Raw.replace(/^data:image\/\w+;base64,/, "").trim();
    if (!b64) {
      throw new Error("本地图片结果为空：base64 无效");
    }
    const id = crypto.randomUUID();
    const fileName = `${id}.${ext}`;
    const saved = await localStore().writeAsset(params.projectId, fileName, b64);
    await localStore().registerAssetMeta(params.projectId, {
      id,
      fileName,
      title,
      category: "image",
      subcategory: params.assetSubcategory ?? null,
      fileType: `image/${ext === "jpg" ? "jpeg" : ext}`,
      fileSize: Math.floor((b64.length * 3) / 4),
      createdAt: new Date().toISOString(),
    });
    const url = saved.fileUrl.startsWith("data:application/octet-stream")
      ? `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${b64}`
      : saved.fileUrl;
    return { url, assetId: id };
  };

  const rawUrl = (params.url || "").trim();

  // 已是 data: — 直接落盘注册
  if (rawUrl.startsWith("data:image")) {
    const mime = rawUrl.match(/^data:image\/([\w+.-]+);base64,/i)?.[1] || "png";
    const ext = mime.includes("jpeg") || mime === "jpg" ? "jpg" : mime.replace(/[^a-z0-9]/gi, "") || "png";
    const b64 = rawUrl.replace(/^data:image\/[\w+.-]+;base64,/i, "");
    return saveB64(b64, ext === "jpeg" ? "jpg" : ext);
  }
  if (rawUrl.startsWith("file:")) {
    // file: 无法可靠读盘时仍返回占位 id，避免分镜去轮询假 job
    const id = crypto.randomUUID();
    return { url: rawUrl, assetId: id };
  }

  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    try {
      const proxied = await proxyUpstream({
        url: rawUrl,
        method: "GET",
        timeoutMs: 120_000,
      });
      if (!(proxied.status && proxied.status >= 400) && proxied.base64) {
        const ext = guessImageExt(proxied.contentType || null, rawUrl);
        return saveB64(proxied.base64, ext);
      }
      if (typeof proxied.text === "string" && proxied.text.startsWith("data:image")) {
        const mime = proxied.text.match(/^data:image\/([\w+.-]+);base64,/i)?.[1] || "png";
        const ext = mime.includes("jpeg") || mime === "jpg" ? "jpg" : "png";
        return saveB64(proxied.text.replace(/^data:image\/[\w+.-]+;base64,/i, ""), ext);
      }
    } catch {
      /* fall through */
    }
    throw new Error(
      `上游已出图，但下载到本机失败（${rawUrl.slice(0, 96)}）。请检查网络后点该主体「重试」`
    );
  }

  let b64Raw = (params.b64 || "").trim();
  if (b64Raw.startsWith("data:image")) {
    const mime = b64Raw.match(/^data:image\/([\w+.-]+);base64,/i)?.[1] || "png";
    const ext = mime.includes("jpeg") || mime === "jpg" ? "jpg" : "png";
    return saveB64(b64Raw.replace(/^data:image\/[\w+.-]+;base64,/i, ""), ext);
  }
  b64Raw = b64Raw.replace(/^data:image\/\w+;base64,/, "");
  if (!b64Raw && rawUrl && !rawUrl.startsWith("http")) {
    b64Raw = rawUrl.replace(/^data:image\/\w+;base64,/, "");
  }
  if (!b64Raw) {
    throw new Error(
      "本地图片结果为空：上游响应里没有可用的 url / b64_json（或只有空字符串 url）。请硬刷新后重试；若仍失败，到「生成任务」看详情"
    );
  }
  return saveB64(b64Raw, "png");
}

function guessImageExt(contentType: string | null, url: string): string {
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("gif")) return "gif";
  if (contentType?.includes("png")) return "png";
  const m = url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
  return m?.[1]?.toLowerCase().replace("jpeg", "jpg") || "png";
}

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function resolveCreds(model: LocalModel, providers: LocalProvider[]) {
  const provider = model.providerId
    ? providers.find((p) => p.id === model.providerId)
    : undefined;
  const apiBase = normalizeApiBase(model.apiBase || provider?.apiBase || "");
  // 模型级 Key 优先，否则用绑定供应商；去掉粘贴时的 Bearer/引号/空白
  const apiKey = normalizeApiKey(model.apiKey || provider?.apiKey || "");
  return { apiBase, apiKey, provider };
}

/** 规范化 API Key：去空白、去包裹引号、去掉用户误粘的 Bearer 前缀 */
export function normalizeApiKey(raw: string): string {
  let key = (raw || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Bearer\s+/i, "").trim();
  return key;
}

function assertApiKeyReady(apiKey: string, model: LocalModel, provider?: LocalProvider) {
  if (apiKey) return;
  const bound = Boolean(model.providerId && provider);
  if (!bound) {
    throw new Error(
      `模型「${model.displayName || model.name}」未绑定供应商，且未填写 API Key。请到「本地设置」绑定供应商（含有效 Key）后保存`
    );
  }
  throw new Error(
    `供应商「${provider?.name || ""}」的 API Key 为空。请在「本地设置 → 供应商」粘贴供应商控制台的 Key（不要带 Bearer 前缀）并保存`
  );
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

export async function findLocalModel(modelId: string): Promise<LocalModel | null> {
  const key = (modelId || "").trim();
  if (!key) return null;
  const models = await localStore().listModels();
  return (
    models.find(
      (m) =>
        m.id === key ||
        m.name === key ||
        m.displayName === key ||
        m.upstreamModel === key
    ) ?? null
  );
}

/**
 * 该模型是否走聚梦官方 /v1。
 * 官方接口参考图可直接 base64（与技能 / jumeng-media 插件一致，免 OSS）；
 * 第三方 OpenAI 兼容网关维持原画布行为，参考图需用户自配 OSS 公网直链。
 */
export async function isJumengOfficialModel(modelId: string): Promise<boolean> {
  return (await resolveJumengUploadCreds(modelId)) !== null;
}

/**
 * 取该模型的聚梦官方凭据；非聚梦或缺 Base/Key 时返回 null。
 * 拿到后即可调用官方文件上传把本机参考素材换成公网直链。
 */
export async function resolveJumengUploadCreds(
  modelId: string
): Promise<JumengUploadCreds | null> {
  const model = await findLocalModel(modelId);
  if (!model) return null;
  try {
    const providers = await localStore().listProviders();
    const { apiBase, apiKey } = resolveCreds(model, providers);
    const base = apiBase || model.url || "";
    if (!isJumengaiUpstream(model.upstreamModel, model.name, base)) return null;
    if (!base || !normalizeApiKey(apiKey || "")) return null;
    return { apiBase: base, apiKey: normalizeApiKey(apiKey) };
  } catch {
    return null;
  }
}

/** 文本生成（聊天补全） */
export async function localGenerateText(params: {
  modelId: string;
  prompt: string;
  system?: string;
  /** 多轮对话历史（按时间顺序，不含本轮 prompt）；自定义模板模式下拼进 prompt 文本 */
  history?: { role: "user" | "assistant"; content: string }[];
  /** 本轮附带的图片（本机素材地址 / data URL / https）；需所选模型支持看图，仅 OpenAI 兼容模式生效 */
  images?: string[];
  signal?: AbortSignal;
}): Promise<string> {
  if (params.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  const model = await findLocalModel(params.modelId);
  if (!model) throw new Error(`未找到模型：${params.modelId}，请先在「本地设置」中配置并保存`);
  const history = (params.history || []).filter((m) => m.content.trim());
  const rawImages = (params.images || []).map((u) => String(u || "").trim()).filter(Boolean);
  if (model.enabled === false) {
    throw new Error(`模型「${model.displayName || model.name}」未启用，请在设置中勾选启用`);
  }
  const providers = await localStore().listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);

  if (model.mode === "custom_template") {
    if (rawImages.length) {
      throw new Error(
        `模型「${model.displayName || model.name}」是自定义模板接入，无法附带图片。请换一个 OpenAI 兼容接入、支持看图的对话模型`
      );
    }
    // 自定义模板只有单条 prompt 占位：把历史以文本形式拼在前面
    const joined = history.length
      ? `${history
          .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
          .join("\n")}\n用户: ${params.prompt}\n助手:`
      : params.prompt;
    return runCustomTemplate(model, {
      prompt: joined,
      system: params.system || "",
      apiKey,
      apiBase,
      model: model.upstreamModel || model.name,
    });
  }

  if (!apiBase) throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base（可在供应商或模型上填写）`);
  // apiKey 已在 assertApiKeyReady 校验

  const messages: { role: string; content: unknown }[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  for (const m of history) messages.push({ role: m.role, content: m.content });
  if (rawImages.length) {
    // 多模态消息：图片转成 data URL（本机素材上游访问不到）；助手侧不截断张数
    const parts: unknown[] = [{ type: "text", text: params.prompt }];
    for (const u of rawImages) {
      const resolved = await resolveLocalImageUrlForUpstream(u, { preferDataUrl: true });
      if (!resolved) throw new Error(`参考图读取失败（${u.slice(0, 80)}），请换一张图`);
      parts.push({ type: "image_url", image_url: { url: resolved } });
    }
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: params.prompt });
  }

  const endpoint = openAiCompatibleUrl(apiBase, "text");
  const data = await proxyUpstream({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.upstreamModel || model.name,
      messages,
    }),
    signal: params.signal,
  });
  if ((data.status ?? 500) >= 400) {
    throw new Error(
      `上游文本生成失败 HTTP ${data.status}（${endpoint}）: ${upstreamErrorDetail(data)}`
    );
  }
  const payload = data.json ?? (data.text ? safeJson(data.text) : null);
  const path = model.responsePath || "choices.0.message.content";
  const content = getByPath(payload, path);
  if (typeof content !== "string" || !content) {
    throw new Error("上游响应中未解析到文本内容，请检查 responsePath");
  }
  return content;
}

/** OpenAI 兼容：函数工具定义 */
export type LocalChatTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

/** OpenAI 兼容：多轮消息（含 tool 回传） */
export type LocalChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type?: "function";
    function: { name: string; arguments: string };
  }>;
};

export type LocalChatToolCall = {
  id: string;
  name: string;
  /** 模型返回的 arguments JSON 字符串 */
  arguments: string;
};

export type LocalChatResult = {
  content: string;
  toolCalls: LocalChatToolCall[];
};

/**
 * 多轮聊天补全（支持 tools / tool_calls / vision）。
 * 仅 OpenAI 兼容模式；自定义模板不支持函数调用。
 */
export async function localGenerateChat(params: {
  modelId: string;
  messages: LocalChatMessage[];
  tools?: LocalChatTool[];
  toolChoice?: "auto" | "none";
  /** 附加到最后一条 user 消息的图片（看图） */
  images?: string[];
  /** 输出 token 上限；不传则用上游默认 */
  maxTokens?: number;
  /** 用户点停止时 abort */
  signal?: AbortSignal;
}): Promise<LocalChatResult> {
  if (params.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  const model = await findLocalModel(params.modelId);
  if (!model) throw new Error(`未找到模型：${params.modelId}，请先在「本地设置」中配置并保存`);
  if (model.enabled === false) {
    throw new Error(`模型「${model.displayName || model.name}」未启用，请在设置中勾选启用`);
  }
  if (model.mode === "custom_template") {
    throw new Error(
      `模型「${model.displayName || model.name}」是自定义模板接入，不支持工具调用。请改用 OpenAI 兼容接入的对话模型`
    );
  }
  const providers = await localStore().listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);
  if (!apiBase) {
    throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base（可在供应商或模型上填写）`);
  }

  const rawImages = (params.images || []).map((u) => String(u || "").trim()).filter(Boolean);
  const messages: LocalChatMessage[] = params.messages.map((m) => ({ ...m }));
  if (rawImages.length) {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) throw new Error("附带图片时至少需要一条 user 消息");
    const text =
      typeof messages[lastUser].content === "string"
        ? String(messages[lastUser].content)
        : JSON.stringify(messages[lastUser].content ?? "");
    const parts: unknown[] = [{ type: "text", text }];
    for (const u of rawImages) {
      const resolved = await resolveLocalImageUrlForUpstream(u, { preferDataUrl: true });
      if (!resolved) throw new Error(`参考图读取失败（${u.slice(0, 80)}），请换一张图`);
      parts.push({ type: "image_url", image_url: { url: resolved } });
    }
    messages[lastUser] = { ...messages[lastUser], content: parts };
  }

  const body: Record<string, unknown> = {
    model: model.upstreamModel || model.name,
    messages,
  };
  if (params.tools?.length) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice || "auto";
  }
  if (typeof params.maxTokens === "number" && params.maxTokens > 0) {
    body.max_tokens = Math.floor(params.maxTokens);
  }

  const endpoint = openAiCompatibleUrl(apiBase, "text");
  const data = await proxyUpstream({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });
  if ((data.status ?? 500) >= 400) {
    throw new Error(
      `上游文本生成失败 HTTP ${data.status}（${endpoint}）: ${upstreamErrorDetail(data)}`
    );
  }
  const payload = (data.json ?? (data.text ? safeJson(data.text) : null)) as Record<
    string,
    unknown
  > | null;
  const message = getByPath(payload, "choices.0.message") as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") {
    throw new Error("上游响应中未解析到 message，请检查是否为 OpenAI 兼容聊天接口");
  }
  const contentRaw = message.content;
  const content =
    typeof contentRaw === "string"
      ? contentRaw
      : contentRaw == null
        ? ""
        : JSON.stringify(contentRaw);
  const toolCalls: LocalChatToolCall[] = [];
  const rawCalls = message.tool_calls;
  if (Array.isArray(rawCalls)) {
    for (const c of rawCalls) {
      if (!c || typeof c !== "object") continue;
      const rec = c as Record<string, unknown>;
      const fn = (rec.function || {}) as Record<string, unknown>;
      const name = String(fn.name || "").trim();
      if (!name) continue;
      toolCalls.push({
        id: String(rec.id || `call_${toolCalls.length + 1}`),
        name,
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      });
    }
  }
  return { content, toolCalls };
}

/**
 * 流式聊天补全：边收边回调 onDelta；最终仍返回完整 content + toolCalls。
 * 解析 OpenAI 兼容 SSE（data: {...} / [DONE]）。
 */
export async function localGenerateChatStream(params: {
  modelId: string;
  messages: LocalChatMessage[];
  tools?: LocalChatTool[];
  toolChoice?: "auto" | "none";
  images?: string[];
  /** 输出 token 上限 */
  maxTokens?: number;
  /** 累计正文变化时回调（用于 UI 流式渲染） */
  onDelta?: (content: string) => void;
  /** 用户点停止时 abort */
  signal?: AbortSignal;
}): Promise<LocalChatResult> {
  if (params.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  const model = await findLocalModel(params.modelId);
  if (!model) throw new Error(`未找到模型：${params.modelId}，请先在「本地设置」中配置并保存`);
  if (model.enabled === false) {
    throw new Error(`模型「${model.displayName || model.name}」未启用，请在设置中勾选启用`);
  }
  if (model.mode === "custom_template") {
    throw new Error(
      `模型「${model.displayName || model.name}」是自定义模板接入，不支持工具调用。请改用 OpenAI 兼容接入的对话模型`
    );
  }
  const providers = await localStore().listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);
  if (!apiBase) {
    throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base（可在供应商或模型上填写）`);
  }

  const rawImages = (params.images || []).map((u) => String(u || "").trim()).filter(Boolean);
  const messages: LocalChatMessage[] = params.messages.map((m) => ({ ...m }));
  if (rawImages.length) {
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) throw new Error("附带图片时至少需要一条 user 消息");
    const text =
      typeof messages[lastUser].content === "string"
        ? String(messages[lastUser].content)
        : JSON.stringify(messages[lastUser].content ?? "");
    const parts: unknown[] = [{ type: "text", text }];
    for (const u of rawImages) {
      const resolved = await resolveLocalImageUrlForUpstream(u, { preferDataUrl: true });
      if (!resolved) throw new Error(`参考图读取失败（${u.slice(0, 80)}），请换一张图`);
      parts.push({ type: "image_url", image_url: { url: resolved } });
    }
    messages[lastUser] = { ...messages[lastUser], content: parts };
  }

  const body: Record<string, unknown> = {
    model: model.upstreamModel || model.name,
    messages,
    stream: true,
  };
  if (params.tools?.length) {
    body.tools = params.tools;
    body.tool_choice = params.toolChoice || "auto";
  }
  if (typeof params.maxTokens === "number" && params.maxTokens > 0) {
    body.max_tokens = Math.floor(params.maxTokens);
  }

  const endpoint = openAiCompatibleUrl(apiBase, "text");
  const res = await proxyUpstreamStream({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    timeoutMs: 300_000,
    signal: params.signal,
  });

  if (res.status >= 400) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `上游文本流式失败 HTTP ${res.status}（${endpoint}）: ${errText.slice(0, 400)}`
    );
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("上游未返回可读流");

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  params.signal?.addEventListener("abort", onAbort, { once: true });

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

  const flushDelta = () => {
    params.onDelta?.(content);
  };

  const ingestLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") return;
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const choices = json.choices;
    if (!Array.isArray(choices) || !choices[0]) return;
    const choice = choices[0] as Record<string, unknown>;
    const delta = (choice.delta || choice.message || {}) as Record<string, unknown>;
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      flushDelta();
    }
    const calls = delta.tool_calls;
    if (Array.isArray(calls)) {
      for (const c of calls) {
        if (!c || typeof c !== "object") continue;
        const rec = c as Record<string, unknown>;
        const idx = Number(rec.index ?? 0);
        const fn = (rec.function || {}) as Record<string, unknown>;
        const prev = toolAcc.get(idx) || {
          id: String(rec.id || `call_${idx + 1}`),
          name: "",
          arguments: "",
        };
        if (rec.id) prev.id = String(rec.id);
        if (typeof fn.name === "string" && fn.name) prev.name = fn.name;
        if (typeof fn.arguments === "string") prev.arguments += fn.arguments;
        toolAcc.set(idx, prev);
      }
    }
  };

  try {
    for (;;) {
      if (params.signal?.aborted) {
        const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
        throw new AgentTurnAbortedError();
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) ingestLine(line);
    }
    if (buffer.trim()) ingestLine(buffer);
  } catch (err) {
    if (params.signal?.aborted) {
      const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
      throw new AgentTurnAbortedError();
    }
    if (err instanceof Error && err.name === "AbortError") {
      const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
      throw new AgentTurnAbortedError();
    }
    throw err;
  } finally {
    params.signal?.removeEventListener("abort", onAbort);
  }

  const toolCalls: LocalChatToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id,
      name: t.name,
      arguments: t.arguments || "{}",
    }))
    .filter((t) => t.name);

  return { content, toolCalls };
}

/** 是否为画幅比例（1:1 / 16:9 …） */
function isAspectRatioValue(raw: string): boolean {
  const t = (raw || "").trim();
  return /^\d+(\.\d+)?\s*:\s*\d+(\.\d+)?$/.test(t);
}

/** 是否为清晰度档（480p / 720p / 768p / 1080p / 1K / 2K / 4K） */
function isImageResolutionTier(raw: string): boolean {
  return normalizeClarityTierId(raw) != null;
}

const CANVAS_ASPECTS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4"]);

/** 归一化画幅；五个通用画幅之外回落 1:1 */
function normalizeImageAspectRatio(raw: string | undefined | null): string {
  const t = String(raw || "").trim().replace(/\s+/g, "");
  if (CANVAS_ASPECTS.has(t)) return t;
  return "1:1";
}

/**
 * 归一化图片清晰度档：识别到哪档就用哪档原样提交，
 * 不再把 480p/720p 这类压成 2K（那样用户点了等于没点）。
 * 完全无法识别时才默认 2K；只写 resolution，绝不放进 size/aspectRatio。
 */
function normalizeImageResolutionTier(raw: string | undefined | null): string {
  return normalizeClarityTierId(raw) || "2K";
}

/** 图片 size 语义：走四级能力解析 */
function jumengImageSizeMode(
  upstreamModel: string,
  displayName: string,
  model?: LocalModel
): ImageSizeMode {
  return resolveModelCanvasCaps({
    category: "image",
    upstreamModel,
    name: model?.name,
    displayName: displayName || model?.displayName,
    canvasCaps: model?.canvasCaps,
    generationPresets: model?.generationPresets,
  }).imageSizeMode;
}

/**
 * 画幅 + 清晰度 → width*height（Qwen 等要求星号格式）。
 * 每档各有一张表，点 480p 就真的出 480p，不再并到 1K/2K 两档。
 * Qwen-Image 3.0 上限约 2048*2048，故 4K 档沿用 2K 表。
 */
const STAR_PIXEL_TABLES: Record<CanvasClarityTier, Record<string, string>> = {
  "480p": { "16:9": "854*480", "9:16": "480*854", "1:1": "640*640", "4:3": "640*480", "3:4": "480*640" },
  "720p": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "960*720", "3:4": "720*960" },
  "768p": { "16:9": "1366*768", "9:16": "768*1366", "1:1": "1024*1024", "4:3": "1024*768", "3:4": "768*1024" },
  "1080p": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1440*1080", "3:4": "1080*1440" },
  "1K": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "1024*1024", "4:3": "1152*864", "3:4": "864*1152" },
  "2K": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "2048*2048", "4:3": "1664*1248", "3:4": "1248*1664" },
  "4K": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "2048*2048", "4:3": "1664*1248", "3:4": "1248*1664" },
};

function toStarPixelSize(aspect: string, resolution: string): string {
  const a = normalizeImageAspectRatio(aspect);
  const tier = (normalizeClarityTierId(resolution) || "2K") as CanvasClarityTier;
  const table = STAR_PIXEL_TABLES[tier] || STAR_PIXEL_TABLES["2K"];
  return table[a] || table["1:1"];
}

/**
 * 参考素材提交摘要：host 列表 + base64 标注。
 * base64 会标成 `base64(约 1.2MB)`，任务页一眼看出这条没换成公网直链。
 */
function describeSubmittedRefs(urls: string[]): {
  submittedReferenceCount: number;
  submittedRefHostPreview: string;
  submittedRefUrls: string[];
} {
  const parts = urls.map((u) => {
    const raw = String(u || "");
    if (raw.startsWith("data:")) {
      const mb = (raw.length * 0.75) / (1024 * 1024);
      return `base64(约 ${mb.toFixed(1)}MB)`;
    }
    try {
      return new URL(raw).host;
    } catch {
      return raw.slice(0, 40);
    }
  });
  return {
    submittedReferenceCount: urls.length,
    submittedRefHostPreview: parts.join(", ").slice(0, 160),
    submittedRefUrls: urls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 9),
  };
}

/**
 * 上游超时 / 断连时补齐现场：参考带了几个、是不是 base64、请求体多大、
 * 以及参考为何没能换成公网直链。没有这些，任务页只会剩一句「上游请求超时」。
 */
function enrichUpstreamFailure(
  err: unknown,
  ctx: { endpoint: string; payloadBytes: number; refPreview: string; refCount: number }
): Error {
  const reason = err instanceof Error ? err.message : String(err);
  if (!/超时|timeout|aborted|fetch failed|连接失败/i.test(reason)) {
    return err instanceof Error ? err : new Error(reason);
  }
  const mb = (ctx.payloadBytes / (1024 * 1024)).toFixed(1);
  const refPart = ctx.refCount
    ? `已带 ${ctx.refCount} 个参考（${ctx.refPreview || "未知来源"}）`
    : "本次为纯文生（未带参考）";
  const base64Part = /base64/.test(ctx.refPreview)
    ? "参考是以 base64 内联提交的，请求体大、上传慢，最容易超时；" +
      (lastRefUploadIssue ? `没换成公网直链的原因：${lastRefUploadIssue}；` : "") +
      "建议到「本地设置 → 参考图 OSS」配置公共读直链后重试。"
    : "";
  return new Error(
    `${reason}（${ctx.endpoint}）。${refPart}，请求体约 ${mb}MB。${base64Part}` +
      "上游可能仍在出图，可稍后在任务页重试；若反复超时请换模型或减小参考图尺寸"
  );
}

/** 上游挑 size 写法时的统一指引（设置里可按模型切换） */
const SIZE_MODE_SWITCH_HINT =
  "请到「本地设置 → 高级设置 → 该模型 → 画布可选项 → 尺寸提交方式」换一种写法后重试";

/** 官方文档 /api/images 的 size 写法：1024x1024（小写 x），比例靠宽高本身表达 */
function toPixelSize(aspect: string, resolution: string): string {
  return toStarPixelSize(aspect, resolution).replace("*", "x");
}

/** 按 size 语义算出最终提交的 size 字符串 */
function imageSizeForUpstream(
  mode: ImageSizeMode,
  aspect: string,
  resolution: string
): string {
  if (mode === "aspect") return aspect;
  if (mode === "tier") return resolution;
  if (mode === "star") return toStarPixelSize(aspect, resolution);
  return toPixelSize(aspect, resolution);
}

/** 把用户点选的画幅写进聚梦生图请求体：别名三键 + 像素宽高 + metadata。
 *  官方文档只认 size（像素宽高），别名键是给各家兼容网关兜底用的；
 *  若 size 传了 2K 这类清晰度档而上游又不读别名键，就会按默认方图出图，
 *  用户就会觉得「比例没传进去」——所以默认走 pixel 模式。 */
function writeJumengImageAspect(
  body: Record<string, unknown>,
  aspect: string,
  resolution: string,
  sizeMode: ImageSizeMode
): void {
  const star = toStarPixelSize(aspect, resolution);
  const [wRaw, hRaw] = star.split("*");
  const width = Number.parseInt(wRaw || "1024", 10) || 1024;
  const height = Number.parseInt(hRaw || "1024", 10) || 1024;
  body.aspect_ratio = aspect;
  body.aspectRatio = aspect;
  body.ratio = aspect;
  body.width = width;
  body.height = height;
  body.image_size = star;
  if (sizeMode !== "aspect") {
    body.resolution = resolution;
  }
  const prevMeta =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};
  const prevParams =
    prevMeta.parameters && typeof prevMeta.parameters === "object" && !Array.isArray(prevMeta.parameters)
      ? (prevMeta.parameters as Record<string, unknown>)
      : {};
  body.metadata = {
    ...prevMeta,
    ratio: aspect,
    resolution,
    width,
    height,
    parameters: { ...prevParams, ratio: aspect, resolution, width, height },
  };
}

/**
 * 聚梦 OpenAI 兼容通道的 model id。
 * 必须原样提交控制台 /v1/models 里的完整 id（含 /image-to-image、/text-to-video、/discount）。
 * 以前剥掉图片后缀会导致 z-image-turbo/image-to-image → z-image-turbo 报 No available channel。
 */
function normalizeJumengOpenAiModelId(raw: string): string {
  return (raw || "").trim();
}

/** 图片生成（OpenAI images 或自定义模板返回 URL/base64） */
export async function localGenerateImage(params: {
  modelId: string;
  prompt: string;
  /** 兼容旧调用：可能是 1:1 / 1024x1024 / 2K，需再拆分 */
  size?: string;
  /** 画幅比例，如 1:1、16:9（聚梦部分模型映射为 aspectRatio） */
  aspectRatio?: string;
  /** 清晰度 1K/2K/4K，禁止写入 size/aspectRatio */
  resolution?: string;
  /** 参考图：公网 URL 或 data:（有用户 OSS 时应已是公网 URL） */
  imageUrls?: string[];
  /** 拿到上游 task_id 时回调（写入本机任务列表） */
  onProviderTaskId?: (taskId: string) => void | Promise<void>;
  /** POST 前回调实际带上的参考（失败也能在任务页查证） */
  onSubmittedRefs?: (note: SubmittedRefsNote) => void | Promise<void>;
  /** 用户停止助手时中断提交/轮询 */
  signal?: AbortSignal;
}): Promise<{
  url?: string;
  b64?: string;
  providerTaskId?: string;
  submittedReferenceCount?: number;
  submittedRefHostPreview?: string;
  submittedRefUrls?: string[];
}> {
  if (params.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  const model = await findLocalModel(params.modelId);
  if (!model) throw new Error(`未找到模型：${params.modelId}，请先在「本地设置」中配置并保存`);
  if (model.enabled === false) {
    throw new Error(`模型「${model.displayName || model.name}」未启用，请在设置中勾选启用`);
  }
  const providers = await localStore().listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);

  let allRefs = (params.imageUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 3);

  // 从 size / aspectRatio / resolution 拆出「比例」与「清晰度」，避免把 2K 塞进 aspectRatio
  const sizeRaw = String(params.size || "").trim();
  let aspect =
    String(params.aspectRatio || "").trim() ||
    (isAspectRatioValue(sizeRaw) ? sizeRaw : "");
  let resolution =
    String(params.resolution || "").trim() ||
    (isImageResolutionTier(sizeRaw) ? sizeRaw : "");
  if (!aspect && sizeRaw && /^\d+x\d+$/i.test(sizeRaw)) {
    aspect = "1:1";
  }
  if (!aspect && sizeRaw && /^\d+\*\d+$/i.test(sizeRaw)) {
    // 已是 width*height：从比例表反推画幅，size 稍后原样可用
    aspect = "1:1";
  }
  aspect = normalizeImageAspectRatio(aspect || "1:1");
  resolution = normalizeImageResolutionTier(resolution || "2K");

  if (!apiBase && model.mode !== "custom_template") {
    throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base（可在供应商或模型上填写）`);
  }

  if (model.category === "audio") {
    throw new Error(
      "音频请用「自定义 HTTP 模板」，接口地址填完整 URL（如 https://www.jumengai.com/v1/audio/speech）"
    );
  }

  const configuredModel = (model.upstreamModel || model.name || "").trim();
  const jumeng = isJumengaiUpstream(
    model.upstreamModel,
    model.name,
    apiBase || model.url || ""
  );
  if (jumeng && !configuredModel) {
    throw new Error(
      `模型「${model.displayName || model.name}」未填写平台模型名（upstreamModel）。请到本地设置填写供应商控制台里的准确模型 ID，或重新拉取模型目录后勾选`
    );
  }
  const upstreamModel = jumeng
    ? normalizeJumengOpenAiModelId(configuredModel)
    : configuredModel;
  // 尺寸写法按模型的「画布可选项 → 尺寸提交方式」走，第三方兼容网关同样适用
  const sizeMode = jumengImageSizeMode(upstreamModel, model.displayName || model.name, model);
  // 自定义模板 / 上游 body 用的 size 字符串
  const sizeForUpstream =
    sizeRaw && /^\d+\*\d+$/i.test(sizeRaw)
      ? sizeRaw.replace(/x/gi, "*")
      : imageSizeForUpstream(sizeMode, aspect, resolution);

  const requestedRefCount = allRefs.length;
  // 聚梦：本机/blob 参考 → OSS 直链 → 官方 files/upload 直链 → base64 兜底
  if (jumeng && allRefs.length > 0) {
    const uploadCreds: JumengUploadCreds = { apiBase, apiKey };
    const httpsRefs: string[] = [];
    for (const u of allRefs) {
      httpsRefs.push(await resolveJumengImageRef(u, uploadCreds));
    }
    allRefs = httpsRefs;
  }

  if (model.mode === "custom_template") {
    const raw = await runCustomTemplate(model, {
      prompt: jumeng
        ? rewriteJumengImagePromptRefs(params.prompt, allRefs.length)
        : params.prompt,
      size: sizeForUpstream,
      aspect_ratio: aspect,
      aspectRatio: aspect,
      resolution,
      apiKey,
      apiBase,
      model: upstreamModel || model.upstreamModel || model.name,
      image: allRefs[0] || "",
      image_urls: JSON.stringify(allRefs),
      images: JSON.stringify(allRefs),
    }, {
      // 模板常只写 size/prompt：有参考时强制补 image_urls，避免静默文生图
      jumengInjectImageRefs: jumeng ? allRefs : undefined,
    });
    if (raw.startsWith("data:") || raw.startsWith("http")) {
      return {
        url: raw,
        submittedReferenceCount: allRefs.length,
        submittedRefHostPreview: allRefs
          .map((u) => {
            try {
              return new URL(u).host;
            } catch {
              return u.slice(0, 40);
            }
          })
          .join(", ")
          .slice(0, 160),
        submittedRefUrls: allRefs.filter((u) => /^https?:\/\//i.test(u)).slice(0, 9),
      };
    }
    return {
      b64: raw,
      submittedReferenceCount: allRefs.length,
      submittedRefHostPreview: allRefs.length ? "custom-template" : "",
      submittedRefUrls: allRefs.filter((u) => /^https?:\/\//i.test(u)).slice(0, 9),
    };
  }

  if (!apiBase) throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base（可在供应商或模型上填写）`);

  const endpoint = openAiCompatibleUrl(apiBase, "image");

  const publicImgs = allRefs.filter((u) => isUpstreamUsableRef(u));
  const dataImgs = allRefs.filter((u) => u.startsWith("data:image"));
  // 聚梦与技能一致：https 与 data URL 均可作为参考
  const jumengRefs = jumeng
    ? allRefs.filter((u) => isUpstreamUsableRef(u) || u.startsWith("data:image"))
    : [];

  // 画布带了参考却最终一张都没进包 → 禁止默默改走文生图
  if (requestedRefCount > 0 && publicImgs.length === 0 && dataImgs.length === 0) {
    throw new Error(
      `已选择 ${requestedRefCount} 张参考图，但未能打进上游请求。请换一张图后重试`
    );
  }
  if (jumeng && requestedRefCount > 0 && jumengRefs.length === 0) {
    throw new Error(
      `参考图未能转换成上游可用格式（https 或 base64）。请确认图片节点已有图后重试`
    );
  }

  const refsForBody = jumeng ? jumengRefs : publicImgs;
  const refCountForPrompt = refsForBody.length;
  const body: Record<string, unknown> = {
    model: upstreamModel,
    // 聚梦多参考：@节点名 → [Image N]，否则网关常当纯文生图
    prompt: jumeng
      ? rewriteJumengImagePromptRefs(params.prompt, refCountForPrompt)
      : params.prompt,
    n: 1,
  };
  if (jumeng) {
    // 像素型（默认，对齐官方文档）：size 为 1080x1920，比例由宽高直接表达。
    // 比例型（Gemini）：size 才是 16:9，不要带 resolution=2K。
    // 清晰度型（x-imagine 等旧通道）：size 必须是 1K/2K/4K，画幅另写三键。
    // 星号型（Qwen）：size 为 1920*1080。
    body.size = sizeForUpstream;
    body.response_format = "url";
    writeJumengImageAspect(body, aspect, resolution, sizeMode);
  } else if (sizeRaw && /^\d+[x*]\d+$/i.test(sizeRaw)) {
    // 调用方已给了具体像素，原样透传
    body.size = sizeRaw;
  } else {
    // 第三方 OpenAI 兼容网关：默认也按标准像素宽高提交，比例三键同写兜底
    body.size = sizeForUpstream;
    body.aspect_ratio = aspect;
    body.aspectRatio = aspect;
    body.ratio = aspect;
  }

  // 仅聚梦官方通道：base64 参考只能走 image（与技能/插件一致）；
  // images / image_urls 被网关当 URL 列表校验，塞 data: 会报「参考图片 URL 必须以 http:// 开头」。
  // 第三方网关维持原画布行为（参考图需用户自配 OSS）。
  const refsAreDataUrls = jumeng && refsForBody.some((u) => u.startsWith("data:image"));

  // 参考图写入 body：聚梦 = https 或 data URL；其它上游优先 https，可回退 data
  if (refsForBody.length === 1) {
    body.image = refsForBody[0];
    if (!refsAreDataUrls) {
      body.images = refsForBody;
      body.image_urls = refsForBody;
    }
  } else if (refsForBody.length > 1) {
    body.image = refsForBody;
    if (!refsAreDataUrls) {
      body.images = refsForBody;
      body.image_urls = refsForBody;
    }
  } else if (!jumeng && dataImgs.length === 1) {
    body.image = dataImgs[0];
    body.images = dataImgs;
  } else if (!jumeng && dataImgs.length > 1) {
    body.images = dataImgs;
    body.image = dataImgs[0];
  }

  // base64 参考：不要把 images/image_urls 列表字段带上（网关按 URL 校验 data:）。
  // 画幅/清晰度必须留下，否则点了 9:16 实际按默认方图出。
  if (jumeng && refsAreDataUrls && refsForBody.length > 0) {
    const minimal: Record<string, unknown> = {
      model: body.model,
      prompt: body.prompt,
      size: body.size,
      n: 1,
      image: refsForBody.length === 1 ? refsForBody[0] : refsForBody,
    };
    writeJumengImageAspect(minimal, aspect, resolution, sizeMode);
    for (const key of Object.keys(body)) delete body[key];
    Object.assign(body, minimal);
  }

  // body 里实际携带的参考（base64 只写 image，https 另有列表字段）
  const bodyRefUrls: string[] = Array.isArray(body.image_urls)
    ? (body.image_urls as string[])
    : Array.isArray(body.image)
      ? (body.image as string[])
      : typeof body.image === "string" && body.image
        ? [body.image]
        : [];

  // 最终确认：聚梦有参考时须打进 https 或 data:
  if (jumeng && requestedRefCount > 0) {
    const ok = bodyRefUrls.length > 0 && bodyRefUrls.every(
      (u) => isUpstreamUsableRef(u) || String(u).startsWith("data:image")
    );
    if (!ok) {
      throw new Error("内部错误：参考图未写入请求体。请重试或换一张图");
    }
  }

  const submittedUrls = bodyRefUrls.length > 0 ? bodyRefUrls : refsForBody;
  const submittedMeta = describeSubmittedRefs(submittedUrls);
  // 超时 / 报错时任务页也能看出参考到底带没带、带的是直链还是 base64
  await params.onSubmittedRefs?.({
    count: submittedMeta.submittedReferenceCount,
    hostPreview: submittedMeta.submittedRefHostPreview,
    urls: submittedMeta.submittedRefUrls,
  });
  if (requestedRefCount > 0 || jumeng) {
    // 便于对照：所选画幅是否真正进了请求体
    console.info(
      "[localGenerateImage] size=%s aspect=%s resolution=%s sizeMode=%s refs requested=%s submitted=%s hosts=%s",
      String(body.size || ""),
      aspect,
      resolution,
      jumeng ? sizeMode : "n/a",
      requestedRefCount,
      submittedMeta.submittedReferenceCount,
      submittedMeta.submittedRefHostPreview
    );
  }

  const imageReqBody = JSON.stringify(body);
  const data = await proxyUpstream({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: imageReqBody,
    // base64 参考会把请求体撑到数 MB，上传本身就要时间，放宽到 5 分钟
    timeoutMs: imageReqBody.length > 1_000_000 ? 300_000 : 180_000,
    signal: params.signal,
  }).catch((err) => {
    throw enrichUpstreamFailure(err, {
      endpoint,
      payloadBytes: imageReqBody.length,
      refPreview: submittedMeta.submittedRefHostPreview,
      refCount: submittedMeta.submittedReferenceCount,
    });
  });

  if ((data.status ?? 500) >= 400) {
    const detail = upstreamErrorDetail(data);
    if (data.status === 401) {
      throw new Error(
        `上游返回 401 Invalid token（${endpoint}）。请核对供应商 API Key（控制台复制，勿带 Bearer），模型已绑定供应商并已保存。详情：${detail.slice(0, 200)}`
      );
    }
    if (/model_not_found|No available channel for model/i.test(detail)) {
      const mentioned = detail.match(/model\s+([^\s]+)(?:\s+under)?/i)?.[1] || "";
      throw new Error(
        `上游没有可用通道。本地配置模型「${configuredModel}」，实际提交「${upstreamModel}」` +
          (mentioned ? `，上游报的是「${mentioned}」` : "") +
          `。请到供应商控制台核对 /v1/models 里的准确 id（含 /discount 等后缀），在高级设置改「平台模型名」后保存。` +
          ` 详情：${detail.slice(0, 200)}`
      );
    }
    if (/必须以 http|http:\/\/ 或 https/i.test(detail)) {
      // 该通道只认公网 URL：先试 multipart 文件直传（images/edits），失败再给配置指引
      const dataRefs = refsForBody.filter((u) => u.startsWith("data:image"));
      const edited = dataRefs.length
        ? await tryImagesEditWithFiles({
            endpoint,
            apiKey,
            model: upstreamModel,
            prompt: String(body.prompt || params.prompt || ""),
            size: String(body.size || sizeForUpstream),
            dataRefs,
          })
        : null;
      if (edited) return { ...edited, ...submittedMeta };
      throw new Error(
        (lastRefUploadIssue ? `${lastRefUploadIssue}。` : "") +
          "该模型通道只认公网 http(s) 参考图：已按技能写法单用 image 传 base64、也试过文件直传，仍被拒。" +
          "解决办法二选一：完成聚梦实名认证以启用官方文件上传，或在「本地设置 → 参考图 OSS」配置公共读直链" +
          "（配好后所有通道的图生图 / 图生视频都可用）；纯文生图不受影响。" +
          ` 上游原文：${detail.slice(0, 140)}`
      );
    }
    if (/Expected format.*width.*height|width\s*\*\s*height/i.test(detail)) {
      throw new Error(
        `上游要求 size 为「宽*高」（如 1024*1024），当前提交 size=${String(body.size)}。` +
          `${SIZE_MODE_SWITCH_HINT}（选「星号 宽*高」）。详情：${detail.slice(0, 200)}`
      );
    }
    if (/bad_response_body|required field is missing/i.test(detail)) {
      throw new Error(
        `上游拒绝请求体（多半是 size 写法不合它的口味）。` +
          `当前提交 model=${upstreamModel} size=${String(body.size)} aspect=${aspect} resolution=${String(body.resolution || "")}。` +
          `${SIZE_MODE_SWITCH_HINT}（x-imagine 等旧通道选「清晰度档」）。详情：${detail.slice(0, 180)}`
      );
    }
    if (/aspectRatio|aspect_ratio|allowed values:\s*1:1/i.test(detail)) {
      throw new Error(
        `上游要求 size 为画幅比例（1:1 / 16:9 等）。当前 size=${String(body.size)}。` +
          `${SIZE_MODE_SWITCH_HINT}（选「画幅比例」）。详情：${detail.slice(0, 200)}`
      );
    }
    if (/size|尺寸|resolution|分辨率/i.test(detail)) {
      throw new Error(
        `上游拒绝了尺寸参数。当前 size=${String(body.size)} resolution=${String(body.resolution || "")}。` +
          `${SIZE_MODE_SWITCH_HINT}。详情：${detail.slice(0, 200)}`
      );
    }
    throw new Error(
      `上游图片生成失败 HTTP ${data.status}（${endpoint}）: ${detail}`
    );
  }
  const payload = data.json ?? (data.text ? safeJson(data.text) : null);
  // 对齐商业 jumengai：勿采信空字符串 url；支持异步 task_id 轮询
  const parsed = parseLocalImageUpstreamResult(payload, model.responsePath);
  if (parsed.url || parsed.b64) return { ...parsed, ...submittedMeta };

  const taskId = extractUpstreamTaskId(payload);
  if (taskId) {
    try {
      await params.onProviderTaskId?.(taskId);
    } catch {
      /* ignore */
    }
  }
  if (taskId && jumeng) {
    try {
      const polled = await pollLocalJumengImageTask({
        apiBase,
        apiKey,
        taskId,
        signal: params.signal,
      });
      if (polled.url || polled.b64) return { ...polled, providerTaskId: taskId, ...submittedMeta };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LocalUpstreamJobError(msg, taskId);
    }
  }

  throw new LocalUpstreamJobError(
    "上游响应中未解析到图片（无非空 url / b64_json" +
      (taskId ? `，且轮询 task_id=${taskId} 仍无图` : "") +
      "）。请检查高级设置里的 responsePath，或到「生成任务」点「同步上游」。",
    taskId || undefined
  );
}

/** 从单条 data[] 项取可用图片引用（空 url 不算） */
function imageRefFromItem(item: Record<string, unknown>): { url?: string; b64?: string } | null {
  const nested =
    item.image_url && typeof item.image_url === "object"
      ? (item.image_url as Record<string, unknown>)
      : null;
  const candidates = [
    item.url,
    typeof item.image_url === "string" ? item.image_url : undefined,
    item.imageUrl,
    item.image,
    item.result_url,
    item.resultUrl,
    nested?.url,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:image")) {
      return { url: s };
    }
  }
  const b64 = String(
    item.b64_json || item.b64Json || item.b64 || item.base64 || ""
  ).trim();
  if (b64) {
    if (b64.startsWith("data:image")) return { url: b64 };
    return { b64 };
  }
  return null;
}

/** 解析 images/generations 同步响应；兼容 data.0 / 顶层字段 / 嵌套 image_url */
function parseLocalImageUpstreamResult(
  payload: unknown,
  responsePath?: string
): { url?: string; b64?: string } {
  if (!payload || typeof payload !== "object") return {};

  const tryPath = (path: string): { url?: string; b64?: string } => {
    const item = getByPath(payload, path);
    if (typeof item === "string") {
      const s = item.trim();
      if (s.startsWith("http") || s.startsWith("data:image")) return { url: s };
      if (s.length > 64) return { b64: s };
      return {};
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return imageRefFromItem(item as Record<string, unknown>) || {};
    }
    return {};
  };

  if (responsePath?.trim()) {
    const fromCustom = tryPath(responsePath.trim());
    if (fromCustom.url || fromCustom.b64) return fromCustom;
  }
  for (const p of ["data.0", "data.0.url", "data.url", "url", "image_url", "result_url"]) {
    const hit = tryPath(p);
    if (hit.url || hit.b64) return hit;
  }

  const root = payload as Record<string, unknown>;
  const dataField = root.data;
  if (Array.isArray(dataField)) {
    for (const el of dataField) {
      if (typeof el === "string") {
        const s = el.trim();
        if (s.startsWith("http") || s.startsWith("data:image")) return { url: s };
      } else if (el && typeof el === "object") {
        const ref = imageRefFromItem(el as Record<string, unknown>);
        if (ref?.url || ref?.b64) return ref;
      }
    }
  } else if (dataField && typeof dataField === "object") {
    const ref = imageRefFromItem(dataField as Record<string, unknown>);
    if (ref?.url || ref?.b64) return ref;
  }

  const top = imageRefFromItem(root);
  if (top?.url || top?.b64) return top;
  return {};
}

/** 聚梦图片异步任务轮询（对齐商业 poll_jumengai_image_task） */
async function pollLocalJumengImageTask(params: {
  apiBase: string;
  apiKey: string;
  taskId: string;
  signal?: AbortSignal;
}): Promise<{ url?: string; b64?: string }> {
  const base = normalizeApiBase(params.apiBase);
  const tid = encodeURIComponent(params.taskId);
  const pollUrls = [
    `${base}/images/generations/${tid}`,
    `${base}/images/${tid}`,
  ];
  const deadline = Date.now() + LOCAL_IMAGE_POLL_TIMEOUT_MS;
  let lastErr = "";
  while (Date.now() < deadline) {
    if (params.signal?.aborted) {
      const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
      throw new AgentTurnAbortedError();
    }
    for (const qurl of pollUrls) {
      const polled = await proxyUpstream({
        url: qurl,
        method: "GET",
        headers: { Authorization: `Bearer ${params.apiKey}` },
        timeoutMs: 60_000,
        signal: params.signal,
      });
      if (polled.status === 404) continue;
      if ((polled.status ?? 500) >= 400) {
        lastErr = upstreamErrorDetail(polled) || `HTTP ${polled.status}`;
        continue;
      }
      const body = polled.json ?? (polled.text ? safeJson(polled.text) : null);
      const status = extractUpstreamStatus(body);
      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(
          (typeof body === "object" && body
            ? JSON.stringify(body).slice(0, 300)
            : String(body || "")) || "上游图片任务失败"
        );
      }
      const got = parseLocalImageUpstreamResult(body);
      if (got.url || got.b64) return got;
      if (
        status === "succeeded" ||
        status === "success" ||
        status === "completed" ||
        status === "done"
      ) {
        throw new Error("上游图片任务完成但 url 与 b64_json 均为空");
      }
      break;
    }
    await sleep(LOCAL_IMAGE_POLL_INTERVAL_MS, params.signal);
  }
  throw new Error(
    `上游图片任务超时（task_id=${params.taskId}）${lastErr ? `，末次：${lastErr}` : ""}`
  );
}

/**
 * 公网 https 可直接把 URL 交给上游拉取；本机 / data / localhost / 内网不能被云端上游访问。
 */
function isPrivateOrLocalHostname(host: string): boolean {
  const h = (host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
  // RFC1918 / 链路本地
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function isPublicFetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (isPrivateOrLocalHostname(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** 本机预览 / blob / data / 内网地址：上游云端拉不到，须转 OSS 或（非聚梦）data: */
function isLocalUnreachableMediaUrl(url: string): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  if (raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("file:")) return true;
  if (raw.startsWith("/api/local/") || raw.startsWith("/")) return true;
  try {
    const u = new URL(raw, "http://localhost");
    if (isPrivateOrLocalHostname(u.hostname)) return true;
    if (/\/api\/local\//i.test(u.pathname)) return true;
  } catch {
    return true;
  }
  return false;
}

/** 网关图生图：把 @节点名 改成 [Image N]，避免上游当纯文生图忽略参考 */
function rewriteJumengImagePromptRefs(prompt: string, imageCount: number): string {
  let text = String(prompt || "").trim();
  if (imageCount <= 0) return text;
  const labels: string[] = [];
  const re = /@([^\s@，,。；;！!？?]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lab = (m[1] || "").trim();
    if (lab && !labels.includes(lab)) labels.push(lab);
  }
  if (labels.length > 0) {
    for (let i = 0; i < labels.length; i++) {
      const slot = Math.min(i + 1, imageCount);
      const lab = labels[i];
      text = text.split(`@${lab}`).join(`[Image ${slot}]`);
    }
  }
  const missing: number[] = [];
  for (let i = 1; i <= imageCount; i++) {
    if (!text.includes(`[Image ${i}]`)) missing.push(i);
  }
  if (missing.length) {
    const imgs = missing.map((n) => `[Image ${n}]`).join("、");
    text = `须严格参考${imgs}中的主体外貌、服装、场景与画面风格。${text}`;
  }
  return text.slice(0, 20000);
}

/** 读取用户自配 OSS；未启用或未填全则返回 null */
async function loadReadyUserOss() {
  try {
    const { isUserOssReady } = await import("./userOssConfig");
    const cfg = await localStore().readUserOss();
    return isUserOssReady(cfg) ? cfg : null;
  } catch {
    return null;
  }
}

/** 把本机/ data URL 字节上传到用户 OSS，返回公网可拉 URL */
async function uploadLocalBytesToUserOss(params: {
  base64OrDataUrl: string;
  contentType: string;
  filename?: string;
}): Promise<string> {
  const res = await fetch("/api/local/oss-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base64: params.base64OrDataUrl,
      contentType: params.contentType,
      filename: params.filename,
    }),
  });
  const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
  if (!res.ok || !data.ok || !data.url) {
    throw new Error(data.error || `参考素材上传 OSS 失败 HTTP ${res.status}`);
  }
  return data.url;
}

/** 跨域远端素材：浏览器直连 OSS 会被 CORS / 防盗链拦掉，改由本机服务端代拉 */
function needsLocalFetchProxy(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** 统一的素材读取：跨域走 /api/local/fetch-media，同源 / blob 直接 fetch */
async function fetchMediaResponse(href: string): Promise<Response> {
  if (!needsLocalFetchProxy(href)) return fetch(href);
  const proxied = `/api/local/fetch-media?url=${encodeURIComponent(href)}`;
  const res = await fetch(proxied);
  if (res.ok) return res;
  let reason = `HTTP ${res.status}`;
  try {
    const data = (await res.json()) as { error?: string; detail?: string };
    if (data?.error) reason = data.error;
  } catch {
    /* 非 JSON 响应保持原状态码 */
  }
  throw new Error(reason);
}

async function fetchUrlAsDataUrl(url: string): Promise<{ dataUrl: string; contentType: string }> {
  const href =
    url.startsWith("blob:") || url.startsWith("http") || url.startsWith("data:")
      ? url
      : new URL(url, window.location.origin).toString();
  if (href.startsWith("data:")) {
    const m = href.match(/^data:([^;]+);base64,/i);
    return { dataUrl: href, contentType: m?.[1] || "application/octet-stream" };
  }
  let res: Response;
  try {
    res = await fetchMediaResponse(href);
  } catch (err) {
    throw new Error(
      `读取参考素材失败（${href.slice(0, 100)}）：${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) throw new Error(`读取参考素材失败 HTTP ${res.status}`);
  const blob = await res.blob();
  const contentType = blob.type || "application/octet-stream";
  const dataUrl = await blobToDataUrl(blob, contentType);
  return { dataUrl, contentType };
}

/** Blob → data URL（分块 btoa，避免大文件卡死） */
async function blobToDataUrl(blob: Blob, contentType?: string): Promise<string> {
  const mime = contentType || blob.type || "application/octet-stream";
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** data URL 估算原始字节数（不含 data: 头） */
function dataUrlApproxBytes(dataUrl: string): number {
  const i = dataUrl.indexOf("base64,");
  if (i < 0) return dataUrl.length;
  const b64 = dataUrl.slice(i + "base64,".length);
  return Math.floor((b64.length * 3) / 4);
}

/** 免 OSS 参考视频上限：20MB（原始文件；base64 约再膨胀 33%） */
const REF_VIDEO_MAX_BYTES_WITHOUT_OSS = 20 * 1024 * 1024;

/** 缩放 + JPEG 压缩，控制单图体积，避免视频提交 413 */
async function compressImageSourceToJpegDataUrl(
  src: string,
  opts?: { maxEdge?: number; quality?: number; maxBytes?: number }
): Promise<string | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const maxEdge = opts?.maxEdge ?? 1280;
  const maxBytes = opts?.maxBytes ?? 450_000; // ~450KB，多图时也不易顶破网关
  let quality = opts?.quality ?? 0.82;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片加载失败"));
    el.src = src;
  });

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  // 仍过大则继续降质 / 缩小
  for (let i = 0; i < 4 && dataUrl.length > maxBytes * 1.37; i++) {
    quality = Math.max(0.45, quality - 0.12);
    if (i >= 2) {
      w = Math.max(320, Math.round(w * 0.75));
      h = Math.max(320, Math.round(h * 0.75));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
    }
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return dataUrl;
}

async function loadUrlAsObjectUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const href =
    url.startsWith("blob:") || url.startsWith("http")
      ? url
      : new URL(url, window.location.origin).toString();
  let res: Response;
  try {
    res = await fetchMediaResponse(href);
  } catch (err) {
    throw new Error(
      `读取参考图失败（${href.slice(0, 100)}）：${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) throw new Error(`读取参考图失败 HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** 公网 https 直链：无 Signature/OSSAccessKeyId，上游可匿名拉 */
function isCleanPublicHttpsUrl(url: string): boolean {
  const raw = (url || "").trim();
  if (!/^https:\/\//i.test(raw)) return false;
  if (isLocalUnreachableMediaUrl(raw)) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (!isPublicFetchableUrl(raw)) return false;
    // 预签名 query 聚梦常拒或拉失败
    if (/OSSAccessKeyId|Signature|x-oss-signature/i.test(u.search)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 已解析成上游可直接读取的参考地址。
 * 提交链路会先后在 mediaGeneration 与 generate 里各解析一次；聚梦 files/upload
 * 返回的是带签名的临时直链，第二次会被判成「不干净」而重新下载——跨域必然失败，
 * 且白白消耗每小时 50 个的上传配额。这里记一笔，二次解析直接放行。
 */
const upstreamReadyRefs = new Set<string>();
const UPSTREAM_READY_REFS_MAX = 200;

function markUpstreamReadyRef(url: string): string {
  const raw = (url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return raw;
  if (upstreamReadyRefs.size >= UPSTREAM_READY_REFS_MAX) {
    const oldest = upstreamReadyRefs.values().next().value;
    if (oldest) upstreamReadyRefs.delete(oldest);
  }
  upstreamReadyRefs.add(raw);
  return raw;
}

/**
 * 上游能直接读取的参考地址：干净公网直链，或本轮刚上传拿到的临时直链。
 * 聚梦 files/upload 返回的是带签名的 1 小时直链，isCleanPublicHttpsUrl 会判否，
 * 但那正是官方指定的参考素材提交方式，组装请求体时必须放行。
 */
function isUpstreamUsableRef(url: string): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  return isCleanPublicHttpsUrl(raw) || upstreamReadyRefs.has(raw);
}

/**
 * 聚梦官方参考图解析，优先级：
 * 1. 已是干净公网直链 → 原样
 * 2. 已配「参考图 OSS」→ 上传成永久直链（顺带省掉官方每小时 50 个的配额）
 * 3. 官方文件上传 API（POST {base}/files/upload）→ 约 1 小时有效的公网直链，**免配 OSS**
 * 4. 以上都不可用 → base64 兜底（仅部分通道收）
 */
async function resolveJumengImageRef(
  url: string,
  creds?: JumengUploadCreds | null
): Promise<string> {
  const raw = (url || "").trim();
  if (!raw) throw new Error("参考图地址为空");
  if (isCleanPublicHttpsUrl(raw)) return raw;
  if (upstreamReadyRefs.has(raw)) return raw;

  let dataUrl: string;
  if (raw.startsWith("data:image")) {
    dataUrl =
      (await compressImageSourceToJpegDataUrl(raw, {
        maxEdge: 1536,
        maxBytes: 1_200_000,
      })) || raw;
  } else {
    dataUrl = await toJpegDataUrlForUpstream(raw);
  }

  const oss = await loadReadyUserOss();
  if (oss) {
    try {
      const uploaded = await uploadLocalBytesToUserOss({
        base64OrDataUrl: dataUrl,
        contentType: "image/jpeg",
        filename: "ref.jpg",
      });
      if (isCleanPublicHttpsUrl(uploaded)) {
        lastRefUploadIssue = "";
        return markUpstreamReadyRef(uploaded);
      }
      // 上传成功但拿到的不是干净公网直链（多为 Bucket 非公共读 / 自定义域名没配好）
      lastRefUploadIssue = `OSS 已上传但返回的不是公共读直链：${String(uploaded).slice(0, 120)}`;
    } catch (err) {
      lastRefUploadIssue = `OSS 上传失败：${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
    }
  }

  // 官方文件上传：免 OSS 拿到公网直链，约 1 小时有效，提交即用
  if (creds?.apiBase && creds?.apiKey) {
    try {
      const uploaded = await uploadRefToJumengFiles({
        creds,
        base64OrDataUrl: dataUrl,
        contentType: "image/jpeg",
        filename: `ref-${Date.now()}.jpg`,
      });
      lastRefUploadIssue = "";
      return markUpstreamReadyRef(uploaded);
    } catch (err) {
      lastRefUploadIssue =
        `聚梦文件上传失败：${err instanceof Error ? err.message : String(err)}`.slice(0, 220);
    }
  } else if (!oss) {
    lastRefUploadIssue = "未拿到聚梦接口凭据，无法调用官方文件上传，已改用 base64 提交";
  }

  // 最后兜底 base64，失败原因留给上游报错时一并提示
  return dataUrl;
}

/** 最近一次参考图为何没能变成公网直链；上游拒收 base64 时附给用户 */
let lastRefUploadIssue = "";

/** @deprecated 兼容旧名；行为见 resolveJumengImageRef */
async function ensureJumengPublicHttpsRef(url: string): Promise<string> {
  return resolveJumengImageRef(url);
}

/** 任意参考源 → 压缩 JPEG data URL（非聚梦通道或 OSS 上传前的中间态） */
async function toJpegDataUrlForUpstream(url: string): Promise<string> {
  const raw = (url || "").trim();
  if (!raw) throw new Error("参考图地址为空");
  if (raw.startsWith("data:image")) {
    const compressed = await compressImageSourceToJpegDataUrl(raw, {
      maxEdge: 1536,
      maxBytes: 1_200_000,
    });
    if (!compressed) throw new Error("参考图压缩失败，请换一张图");
    return compressed;
  }
  let objectUrl: string | null = null;
  try {
    const src =
      isLocalUnreachableMediaUrl(raw) || raw.startsWith("http")
        ? await loadUrlAsObjectUrl(raw)
        : raw;
    if (src.startsWith("blob:")) objectUrl = src;
    const compressed = await compressImageSourceToJpegDataUrl(src, {
      maxEdge: 1536,
      maxBytes: 1_200_000,
    });
    if (!compressed) throw new Error("参考图读取/压缩失败，请换一张图");
    return compressed;
  } finally {
    if (objectUrl?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 把本机参考图转成上游可吃的地址：
 * - requirePublicHttps：第三方 OpenAI 兼容网关 — 必须公网直链，须用户自配 OSS
 * - preferPublicHttps：聚梦官方对齐技能/插件 — 有 OSS 则 https，否则 data URL（不必配 OSS）
 * - preferDataUrl：JPEG data URL
 * - 默认：有 OSS 则上传 https，否则 data URL
 */
export async function resolveLocalImageUrlForUpstream(
  url: string,
  opts?: {
    preferDataUrl?: boolean;
    preferPublicHttps?: boolean;
    requirePublicHttps?: boolean;
    /** 聚梦官方凭据：无 OSS 时走 /v1/files/upload */
    jumengUpload?: JumengUploadCreds | null;
  }
): Promise<string | null> {
  const raw = (url || "").trim();
  if (!raw) return null;

  if (opts?.requirePublicHttps) {
    // 第三方接口维持原画布行为：只认公网直链，本机图必须经用户自己的 OSS 中转
    if (isCleanPublicHttpsUrl(raw)) return raw;
    const oss = await loadReadyUserOss();
    if (!oss) {
      throw new Error(
        "第三方接口的参考图必须是公网 http(s) 直链。请到「本地设置 → 参考图 OSS」配置后重试（聚梦官方接口无需配置）"
      );
    }
    const dataUrl = raw.startsWith("data:image")
      ? (await compressImageSourceToJpegDataUrl(raw, { maxEdge: 1536, maxBytes: 1_200_000 })) || raw
      : await toJpegDataUrlForUpstream(raw);
    const uploaded = await uploadLocalBytesToUserOss({
      base64OrDataUrl: dataUrl,
      contentType: "image/jpeg",
      filename: "ref.jpg",
    });
    if (!isCleanPublicHttpsUrl(uploaded)) {
      throw new Error(
        `参考图已上传 OSS，但拿到的不是公共读直链：${String(uploaded).slice(0, 120)}。请关闭 Bucket 的阻止公共访问后重试`
      );
    }
    return markUpstreamReadyRef(uploaded);
  }

  if (opts?.preferPublicHttps) {
    // 名称为历史兼容；实际走聚梦参考解析（OSS → 官方 files/upload → base64）
    return resolveJumengImageRef(raw, opts.jumengUpload);
  }

  if (opts?.preferDataUrl) {
    return toJpegDataUrlForUpstream(raw);
  }

  // 已是干净公网直链：原样
  if (isCleanPublicHttpsUrl(raw)) return raw;
  // 其它公网 https（含签名）→ 尽量重传为公共读；无 OSS 则原样或转 data
  if (isPublicFetchableUrl(raw) && !isLocalUnreachableMediaUrl(raw)) {
    const oss = await loadReadyUserOss();
    if (!oss) return raw;
    // 签名链：有 OSS 则重传，否则原样
    if (!isCleanPublicHttpsUrl(raw)) {
      try {
        return await resolveJumengImageRef(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  const oss = await loadReadyUserOss();
  let objectUrl: string | null = null;
  try {
    if (oss) {
      const loaded = await fetchUrlAsDataUrl(raw);
      // 图片仍先压缩，减小上传与上游拉取成本
      let payload = loaded.dataUrl;
      let contentType = loaded.contentType;
      if (contentType.startsWith("image/") || raw.startsWith("data:image")) {
        const compressed = await compressImageSourceToJpegDataUrl(
          raw.startsWith("data:image") ? raw : loaded.dataUrl
        );
        if (compressed) {
          payload = compressed;
          contentType = "image/jpeg";
        }
      }
      return markUpstreamReadyRef(
        await uploadLocalBytesToUserOss({
          base64OrDataUrl: payload,
          contentType,
          filename: contentType.includes("jpeg") ? "ref.jpg" : undefined,
        })
      );
    }

    if (raw.startsWith("data:image")) {
      const compressed = await compressImageSourceToJpegDataUrl(raw);
      if (!compressed) {
        throw new Error("本机参考图压缩失败，请换一张图或启用「参考图 OSS」");
      }
      return compressed;
    }
    if (isLocalUnreachableMediaUrl(raw)) {
      objectUrl = await loadUrlAsObjectUrl(raw);
      const compressed = await compressImageSourceToJpegDataUrl(objectUrl);
      if (!compressed) {
        throw new Error("本机参考图读取/压缩失败，请换一张图或启用「参考图 OSS」");
      }
      return compressed;
    }
  } catch (err) {
    if (oss) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `参考图无法交给上游（${raw.slice(0, 80)}）：${msg}。` +
        `请到「本地设置 → 参考图 OSS」配置公网 OSS 并启用后重试`
    );
  } finally {
    if (objectUrl?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(
    `无法解析参考图地址（${raw.slice(0, 80)}）。聚梦图生图需要公网 https；请启用「参考图 OSS」或改用公网直链`
  );
}

/**
 * 本机视频/音频参考 → 上游可用地址。
 * - 已有干净公网 https：原样
 * - 已配 OSS：上传公共读直链（永久，大文件更稳）
 * - 聚梦官方接口未配 OSS：走官方文件上传（MP4/MOV/WebM ≤100MB，约 1 小时有效）
 * - 第三方接口：必须配 OSS
 */
export async function resolveLocalMediaUrlForUpstream(
  url: string,
  opts?: { requirePublicHttps?: boolean; jumengUpload?: JumengUploadCreds | null }
): Promise<string | null> {
  const raw = (url || "").trim();
  if (!raw) return null;
  if (isCleanPublicHttpsUrl(raw)) return raw;
  if (upstreamReadyRefs.has(raw)) return raw;

  const oss = await loadReadyUserOss();
  if (!oss && opts?.requirePublicHttps) {
    throw new Error(
      "第三方接口的参考视频必须是公网 http(s) 直链。请到「本地设置 → 参考图 OSS」配置后重试（聚梦官方接口无需配置）"
    );
  }

  // 聚梦官方：未配 OSS 时用官方文件上传拿公网直链，上限 100MB
  const jumengCreds = opts?.jumengUpload;
  if (!oss && jumengCreds?.apiBase && jumengCreds?.apiKey) {
    const loaded = await fetchUrlAsDataUrl(raw);
    const contentType = loaded.contentType || "video/mp4";
    const ext = contentType.includes("webm") ? "webm" : contentType.includes("mov") ? "mov" : "mp4";
    const uploaded = await uploadRefToJumengFiles({
      creds: jumengCreds,
      base64OrDataUrl: loaded.dataUrl,
      contentType,
      filename: `ref-${Date.now()}.${ext}`,
    });
    return markUpstreamReadyRef(uploaded);
  }
  if (oss) {
    const loaded = await fetchUrlAsDataUrl(raw);
    const uploaded = await uploadLocalBytesToUserOss({
      base64OrDataUrl: loaded.dataUrl,
      contentType: loaded.contentType || "video/mp4",
      filename: loaded.contentType.includes("webm")
        ? "ref.webm"
        : loaded.contentType.includes("mov")
          ? "ref.mov"
          : "ref.mp4",
    });
    if (!isCleanPublicHttpsUrl(uploaded)) {
      throw new Error(
        `参考视频 OSS 未得到干净公网直链（${uploaded.slice(0, 100)}）。请关闭阻止公共访问后重试`
      );
    }
    return markUpstreamReadyRef(uploaded);
  }

  // 未配 OSS：外网可拉的 https（无签名）可直接用
  if (isPublicFetchableUrl(raw) && !isLocalUnreachableMediaUrl(raw)) {
    if (/OSSAccessKeyId|Signature=/i.test(raw)) {
      throw new Error(
        "参考视频是预签名 URL，聚梦常拉不到。请启用「参考图 OSS」公共读直链，或换无签名公网链"
      );
    }
    return raw;
  }

  // 本机 / blob / data：≤20MB 用 base64，与参考图免 OSS 策略一致
  if (raw.startsWith("data:")) {
    const bytes = dataUrlApproxBytes(raw);
    if (bytes > REF_VIDEO_MAX_BYTES_WITHOUT_OSS) {
      throw new Error(
        `参考视频约 ${(bytes / (1024 * 1024)).toFixed(1)}MB，超过免 OSS 上限 20MB。请压缩到 20MB 以内，或配置「参考图 OSS」`
      );
    }
    return raw;
  }

  const href =
    raw.startsWith("blob:") || raw.startsWith("http")
      ? raw
      : new URL(raw, window.location.origin).toString();
  const res = await fetch(href);
  if (!res.ok) throw new Error(`读取参考视频失败 HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size > REF_VIDEO_MAX_BYTES_WITHOUT_OSS) {
    throw new Error(
      `参考视频约 ${(blob.size / (1024 * 1024)).toFixed(1)}MB，超过免 OSS 上限 20MB。请压缩到 20MB 以内，或配置「参考图 OSS」`
    );
  }
  const contentType = blob.type || "video/mp4";
  return blobToDataUrl(blob, contentType);
}

export async function resolveLocalImageUrlsForUpstream(
  urls: string[],
  opts?: {
    preferDataUrl?: boolean;
    preferPublicHttps?: boolean;
    requirePublicHttps?: boolean;
    jumengUpload?: JumengUploadCreds | null;
  }
): Promise<string[]> {
  const input = (urls || []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 3);
  const out: string[] = [];
  // 参考图最多 3 张；任一张失败整批失败，禁止静默少图后改走文生图
  for (const u of input) {
    const resolved = await resolveLocalImageUrlForUpstream(u, opts);
    if (!resolved) {
      throw new Error(
        `参考图未能转换成上游可用地址（${u.slice(0, 80)}）。请换一张图或启用「参考图 OSS」`
      );
    }
    out.push(resolved);
  }
  return out;
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abortErr = () => {
      const e = new Error("已停止");
      e.name = "AgentTurnAbortedError";
      return e;
    };
    if (signal?.aborted) {
      reject(abortErr());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortErr());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 本地画布在浏览器侧轮询上游：可等更久、间隔略放宽（无服务端 Worker 超时压力）。
 * 「同步上游」短查仍用 SYNC_POLL_BUDGET_MS，避免点一次卡太久。
 */
const LOCAL_IMAGE_POLL_INTERVAL_MS = 6_000;
const LOCAL_IMAGE_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const LOCAL_VIDEO_POLL_INTERVAL_MS = 8_000;
const LOCAL_VIDEO_POLL_TIMEOUT_MS = 60 * 60 * 1000;
const LOCAL_MODEL3D_POLL_INTERVAL_MS = 8_000;
const LOCAL_MODEL3D_POLL_TIMEOUT_MS = 45 * 60 * 1000;
const SYNC_POLL_BUDGET_MS = 45_000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 从提交/轮询 JSON 取 task id（对齐聚梦文档 id / task_id） */
function extractUpstreamTaskId(body: unknown): string {
  const root = asRecord(body);
  if (!root) return "";
  for (const key of ["id", "task_id", "taskId"]) {
    const v = String(root[key] ?? "").trim();
    if (v) return v;
  }
  const data = asRecord(root.data);
  if (data) {
    for (const key of ["id", "task_id", "taskId"]) {
      const v = String(data[key] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

function extractUpstreamStatus(body: unknown): string {
  const root = asRecord(body);
  if (!root) return "";
  for (const key of ["status", "task_status", "state"]) {
    const v = String(root[key] ?? "").trim();
    if (v) return v.toLowerCase();
  }
  const data = asRecord(root.data);
  if (data) {
    for (const key of ["status", "task_status", "state"]) {
      const v = String(data[key] ?? "").trim();
      if (v) return v.toLowerCase();
    }
  }
  return "";
}

function extractVideoUrl(body: unknown): string {
  const tryObj = (obj: Record<string, unknown> | null): string => {
    if (!obj) return "";
    for (const key of [
      "result_url",
      "resultUrl",
      "video_url",
      "videoUrl",
      "url",
      "output_url",
      "output",
    ]) {
      const v = String(obj[key] ?? "").trim();
      if (v.startsWith("http")) return v;
    }
    return "";
  };
  const root = asRecord(body);
  if (!root) return "";
  const direct = tryObj(root);
  if (direct) return direct;
  const data = asRecord(root.data);
  const nested = tryObj(data);
  if (nested) return nested;
  if (data) {
    const outputs = data.outputs ?? data.results ?? data.video;
    if (Array.isArray(outputs) && outputs[0]) {
      if (typeof outputs[0] === "string" && outputs[0].startsWith("http")) return outputs[0];
      const first = asRecord(outputs[0]);
      const u = tryObj(first);
      if (u) return u;
    }
  }
  return "";
}

function mapVideoPollState(body: unknown): {
  state: "pending" | "running" | "succeeded" | "failed";
  url: string;
  error: string;
} {
  const status = extractUpstreamStatus(body);
  const url = extractVideoUrl(body);
  const root = asRecord(body);
  const data = asRecord(root?.data);
  let err = "";
  for (const src of [data, root]) {
    if (!src) continue;
    const fr = String(src.fail_reason ?? src.failReason ?? "").trim();
    if (fr && !fr.startsWith("http")) {
      err = fr.slice(0, 400);
      break;
    }
    const eo = asRecord(src.error);
    const msg = String(eo?.message ?? "").trim();
    if (msg) {
      err = msg.slice(0, 400);
      break;
    }
  }
  if (
    ["failed", "failure", "error", "cancelled", "canceled"].includes(status)
  ) {
    return { state: "failed", url: "", error: err || "上游视频任务失败" };
  }
  if (["succeeded", "success", "completed", "done", "finished"].includes(status)) {
    return { state: "succeeded", url, error: "" };
  }
  if (url && !status) return { state: "succeeded", url, error: "" };
  if (["queued", "queueing", "pending", "created", "not_start", "submitted"].includes(status)) {
    return { state: "pending", url, error: "" };
  }
  if (["in_progress", "processing", "running", "generating"].includes(status)) {
    return { state: "running", url, error: "" };
  }
  if (status) return { state: "running", url, error: "" };
  return { state: "pending", url, error: "" };
}

/**
 * 本地视频：POST /v1/video/generations → 轮询 GET …/video/generations/{task_id}
 * （对齐 https://doc.jumengai.com/api/base-url 与 /api/video）
 */

/**
 * 聚梦视频分辨率：画布七档 480p/720p/768p/1080p/1K/2K/4K，默认原样提交。
 */
export function normalizeJumengVideoResolution(
  raw?: string,
  upstreamOrInput?: string | ModelCapsInput
): string {
  const input = asModelCapsInput(upstreamOrInput, undefined, "video");
  const caps = resolveModelCanvasCaps(input);
  const parsed = normalizeClarityTierId(raw);
  let tier: CanvasClarityTier = parsed || "2K";
  if (!parsed) {
    const t = (raw || "").trim().toLowerCase().replace(/\s/g, "");
    if (/^\d{3,4}p?$/.test(t)) {
      const n = Number.parseInt(t.replace(/\D/g, ""), 10);
      if (n <= 540) tier = "480p";
      else if (n <= 740) tier = "720p";
      else if (n <= 900) tier = "768p";
      else if (n <= 1440) tier = "1080p";
      else tier = "4K";
    }
  }
  // 可选档被用户在设置里收窄过才拦；默认七档全开，能否受理交给上游判定，
  // 不再静默换档（点 1K 实际发 480p 这种情况已废弃）
  if (!caps.clarity.includes(tier)) {
    throw new Error(
      `模型不支持 ${tier} 清晰度。当前可选：${caps.clarity.join(" / ")}。` +
        `如需放开，请到「本地设置 → 模型画布能力」调整`
    );
  }
  return caps.clarityMap[tier] || tier;
}

/** 视频时长：按四级能力解析允许秒数夹紧 */
export function normalizeJumengVideoDuration(
  raw: number | undefined,
  upstreamOrInput?: string | ModelCapsInput
): number {
  const allowed = resolveModelCanvasCaps(
    asModelCapsInput(upstreamOrInput, undefined, "video")
  ).durationSec;
  const min = allowed[0] ?? 5;
  const max = allowed[allowed.length - 1] ?? 15;
  const n = Math.round(Number(raw) || min);
  if (!Number.isFinite(n)) return min;
  if (allowed.includes(n)) return n;
  return Math.max(min, Math.min(max, n));
}

/** 聚梦视频模型允许的参考视频数量；null 表示未写死上限 */
function jumengModelMaxReferenceVideos(
  upstreamModel: string,
  model?: { parameters?: Record<string, unknown> | null; canvasCaps?: ModelCanvasCaps | null }
): number | null {
  const fromParam = model?.parameters?.maxReferenceVideos;
  if (typeof fromParam === "number" && fromParam >= 0) return fromParam;
  const m = (upstreamModel || "").toLowerCase();
  // 聚梦价目 minimax-h3/discount：网关明确最多 0 个参考视频（图生视频/文生视频另论）
  if (/minimax-h3|minimax\/h3/.test(m) && !/multimodal|r2v|reference/.test(m)) return 0;
  if (/hailuo-h3|hailuo\/h3/.test(m) && !/multimodal|r2v/.test(m)) return 0;
  return null;
}

export async function localGenerateVideo(params: {
  modelId: string;
  prompt: string;
  durationSec?: number;
  /** 清晰度：480p / 768p / 1080p / 2K / 4K（勿与画幅混淆） */
  resolution?: string;
  /** 画幅比例：16:9 / 9:16 …；聚梦 size 字段传此值 */
  ratio?: string;
  /** @deprecated 请用 resolution；若传入且像分辨率则当清晰度 */
  size?: string;
  imageUrls?: string[];
  /** 参考视频公网 URL（需用户 OSS 或外链） */
  videoUrls?: string[];
  /** 拿到上游 task_id 时回调（写入本机任务列表） */
  onProviderTaskId?: (taskId: string) => void | Promise<void>;
  /** POST 前回调实际带上的参考（失败也能在任务页查证） */
  onSubmittedRefs?: (note: SubmittedRefsNote) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<{
  url: string;
  providerTaskId?: string;
  submittedReferenceCount?: number;
  submittedRefHostPreview?: string;
  submittedRefUrls?: string[];
}> {
  if (params.signal?.aborted) {
    const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
    throw new AgentTurnAbortedError();
  }
  const model = await findLocalModel(params.modelId);
  if (!model) throw new Error(`未找到模型：${params.modelId}，请先在「本地设置」中配置并保存`);
  if (model.enabled === false) {
    throw new Error(`模型「${model.displayName || model.name}」未启用，请在设置中勾选启用`);
  }
  const providers = await localStore().listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);
  if (!apiBase) {
    throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base`);
  }

  // size 字段在聚梦视频接口里是画幅比例（16:9），不是 768p
  const ratioRaw = (params.ratio || "").trim();
  const ratioGuess =
    ratioRaw && ratioRaw.includes(":")
      ? ratioRaw
      : params.size && String(params.size).includes(":")
        ? String(params.size).trim()
        : "16:9";
  const ratio = CANVAS_ASPECTS.has(ratioGuess.replace(/\s+/g, ""))
    ? ratioGuess.replace(/\s+/g, "")
    : "16:9";
  const configuredModel = (model.upstreamModel || model.name || "").trim();
  const jumeng = isJumengaiUpstream(model.upstreamModel, model.name, apiBase);
  const upstreamModel = jumeng
    ? normalizeJumengOpenAiModelId(configuredModel)
    : configuredModel;
  const capsInput: ModelCapsInput = {
    category: "video",
    upstreamModel,
    name: model.name,
    displayName: model.displayName || model.name,
    canvasCaps: model.canvasCaps,
    generationPresets: model.generationPresets,
  };
  const duration = jumeng
    ? normalizeJumengVideoDuration(params.durationSec, capsInput)
    : Math.max(1, Math.min(60, Number(params.durationSec) || 5));
  const resolution = normalizeJumengVideoResolution(
    params.resolution ||
      (params.size && !String(params.size).includes(":") ? params.size : undefined),
    capsInput
  );

  // 聚梦参考素材：OSS 直链 → 官方 files/upload 直链（免 OSS）→ base64 兜底
  let publicImgs: string[] = [];
  let publicVideos: string[] = [];
  const requestedImg = (params.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  const requestedVid = (params.videoUrls || []).map((u) => String(u || "").trim()).filter(Boolean);
  if (jumeng) {
    const uploadCreds: JumengUploadCreds = { apiBase, apiKey };
    for (const u of requestedImg.slice(0, 3)) {
      publicImgs.push(await resolveJumengImageRef(u, uploadCreds));
    }
    for (const u of requestedVid.slice(0, 2)) {
      const v = await resolveLocalMediaUrlForUpstream(u, { jumengUpload: uploadCreds });
      if (!v) {
        throw new Error(
          `参考视频未能提交（${u.slice(0, 60)}）。聚梦官方上传上限 100MB，更大请压缩或配置「参考图 OSS」`
        );
      }
      publicVideos.push(v);
    }
  } else {
    publicImgs = requestedImg.filter((u) => isPublicFetchableUrl(u) || u.startsWith("data:image")).slice(0, 3);
    publicVideos = requestedVid.filter((u) => isPublicFetchableUrl(u)).slice(0, 2);
  }

  // 聚梦 minimax-h3 等通道：上游报「最多支持 0 个参考视频」
  const maxRefVideos = jumengModelMaxReferenceVideos(upstreamModel, model);
  if (publicVideos.length > 0 && maxRefVideos === 0) {
    throw new Error(
      `模型「${model.displayName || upstreamModel}」不支持参考视频（上游限制最多 0 个）。` +
        `你的提示里有 @视频节点 或连了视频参考，已被打进请求。` +
        `请改用 Seedance 等支持参考视频的模型；或去掉视频 @/连线，改用参考图，或纯文生视频。`
    );
  }
  if (typeof maxRefVideos === "number" && publicVideos.length > maxRefVideos) {
    throw new Error(
      `模型「${model.displayName || upstreamModel}」最多支持 ${maxRefVideos} 个参考视频，当前 ${publicVideos.length} 个。请减少视频参考后重试`
    );
  }

  if (requestedImg.length + requestedVid.length > 0 && publicImgs.length + publicVideos.length === 0) {
    throw new Error(
      `已选择 ${requestedImg.length + requestedVid.length} 个参考，但未能打进上游请求。请确认素材可用后重试`
    );
  }

  // 自定义模板若填了完整 video/generations URL 则用之，否则走 OpenAI 兼容路径
  let submitUrl = openAiCompatibleUrl(apiBase, "video");
  if (model.mode === "custom_template" && model.url?.trim()) {
    const rendered = collapseDoubleV1(
      renderTemplate(model.url, {
        apiBase: normalizeApiBase(apiBase),
        apiKey,
        model: upstreamModel,
        prompt: params.prompt,
      })
    );
    if (/video\/generations/i.test(rendered)) submitUrl = rendered;
  }

  let promptText = (params.prompt || "").trim();
  if (!promptText) {
    throw new Error(
      "视频提示词为空，已中止提交（避免上游按默认文案乱生成）。请在视频节点填写描述，或连接文本节点后重试"
    );
  }
  if (jumeng) {
    promptText = rewriteJumengImagePromptRefs(promptText, publicImgs.length);
    // 视频参考：补 [Video N]（与官方多模态参考提示对齐）
    if (publicVideos.length > 0) {
      const missing: number[] = [];
      for (let i = 1; i <= publicVideos.length; i++) {
        if (!promptText.includes(`[Video ${i}]`)) missing.push(i);
      }
      if (missing.length) {
        const vids = missing.map((n) => `[Video ${n}]`).join("、");
        promptText = `须参考${vids}中的动作、镜头与画面内容。${promptText}`.slice(0, 20000);
      }
    }
  }
  promptText = promptText.slice(0, 20000);

  const submittedUrls = [...publicImgs, ...publicVideos];
  const submittedMeta = describeSubmittedRefs(submittedUrls);
  // 超时 / 报错时任务页也能看出参考到底带没带、带的是直链还是 base64
  await params.onSubmittedRefs?.({
    count: submittedMeta.submittedReferenceCount,
    hostPreview: submittedMeta.submittedRefHostPreview,
    urls: submittedMeta.submittedRefUrls,
  });
  // size 语义按模型设置走：
  // - ratio（默认）：聚梦 Seedance 等网关把 size 校验成画幅比，清晰度只放 resolution
  // - tier：官方文档 /api/video 的示例写法，size 直接是 720P
  // 两种模式都会把比例写进 metadata.parameters.ratio（文档指定的比例入口）
  const videoSizeMode: VideoSizeMode = resolveModelCanvasCaps(capsInput).videoSizeMode;
  const sizeForUpstream = videoSizeMode === "tier" ? resolution : ratio;

  console.info(
    "[localGenerateVideo] promptLen=%s preview=%s sizeMode=%s size=%s ratio=%s resolution=%s duration=%s refs img=%s vid=%s",
    promptText.length,
    promptText.slice(0, 80).replace(/\s+/g, " "),
    videoSizeMode,
    sizeForUpstream,
    ratio,
    resolution,
    duration,
    requestedImg.length,
    requestedVid.length
  );

  // 对齐商业 jumengai._build_jumengai_video_payload：content + role；prompt 必须与 content[0].text 一致
  const content: Array<Record<string, unknown>> = [{ type: "text", text: promptText }];
  for (const u of publicImgs) {
    content.push({
      type: "image_url",
      image_url: { url: u },
      role: "reference_image",
    });
  }
  for (const u of publicVideos) {
    content.push({
      type: "video_url",
      video_url: { url: u },
      role: "reference_video",
    });
  }
  const metadata: Record<string, unknown> = {
    resolution,
    ratio,
    duration,
    generate_audio: true,
    content,
    // skill / 聚梦多分辨率：清晰度与画幅都进 parameters
    parameters: { ratio, resolution, watermark: false },
  };
  // 仅聚梦官方通道：base64 参考不能进 *_urls 列表字段（网关按 URL 校验，data: 会被判「必须以 http 开头」）。
  // 第三方 OpenAI 兼容网关维持原画布行为，参考图仍需用户自配 OSS 公网直链。
  const imgRefsAreDataUrls = jumeng && publicImgs.some((u) => u.startsWith("data:"));
  const vidRefsAreDataUrls = jumeng && publicVideos.some((u) => u.startsWith("data:"));

  if (publicImgs.length) {
    metadata.imageMode = "reference";
    metadata.img_url = publicImgs[0];
    if (!imgRefsAreDataUrls) metadata.image_urls = publicImgs;
  }
  if (publicVideos.length) {
    metadata.video_url = publicVideos[0];
    if (!vidRefsAreDataUrls) {
      metadata.video_urls = publicVideos;
      metadata.referenceVideos = publicVideos;
    }
  }

  const body: Record<string, unknown> = {
    model: upstreamModel,
    prompt: promptText,
    duration,
    seconds: String(duration),
    size: sizeForUpstream,
    resolution,
    ratio,
    aspect_ratio: ratio,
    generate_audio: true,
    content,
    metadata,
  };
  if (publicImgs.length) {
    body.image = publicImgs[0];
    body.input_reference = publicImgs[0];
    if (!imgRefsAreDataUrls) {
      body.images = publicImgs;
      body.image_urls = publicImgs;
    }
  }
  if (publicVideos.length) {
    body.video = publicVideos[0];
    body.video_url = publicVideos[0];
    body.videoUrl = publicVideos[0];
    if (!vidRefsAreDataUrls) {
      body.videos = publicVideos;
      body.video_urls = publicVideos;
    }
  }

  // base64 参考：对齐 jumeng-media 插件的提交体，去掉 content / 别名字段，
  // 只留 model/prompt/size/resolution/duration/seconds/image + metadata.parameters
  if (jumeng && imgRefsAreDataUrls && publicVideos.length === 0) {
    const minimal: Record<string, unknown> = {
      model: upstreamModel,
      prompt: promptText,
      size: sizeForUpstream,
      resolution,
      duration,
      seconds: String(duration),
      image: publicImgs[0],
      metadata: { parameters: { ratio, resolution, watermark: false } },
    };
    for (const key of Object.keys(body)) delete body[key];
    Object.assign(body, minimal);
  }

  const videoReqBody = JSON.stringify(body);
  const submit = await proxyUpstream({
    url: submitUrl,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: videoReqBody,
    // base64 参考视频动辄十几 MB，光上传就不止 3 分钟
    timeoutMs: videoReqBody.length > 1_000_000 ? 300_000 : 180_000,
    signal: params.signal,
  }).catch((err) => {
    throw enrichUpstreamFailure(err, {
      endpoint: submitUrl,
      payloadBytes: videoReqBody.length,
      refPreview: submittedMeta.submittedRefHostPreview,
      refCount: submittedMeta.submittedReferenceCount,
    });
  });

  if ((submit.status ?? 500) >= 400) {
    const detail = upstreamErrorDetail(submit);
    if (submit.status === 401) {
      throw new Error(
        `上游返回 401 Invalid token（${submitUrl}）。请核对供应商 API Key 并保存。详情：${detail.slice(0, 200)}`
      );
    }
    if (submit.status === 413) {
      throw new Error(
        "上游返回 413：参考素材太大。未配 OSS 时参考视频请控制在 20MB 以内，或启用「参考图 OSS」后重试"
      );
    }
    if (/必须以 http|http:\/\/ 或 https/i.test(detail)) {
      // 真正的卡点是参考没能变成公网直链，先说原因再说通道要求，最后才是上游原文
      throw new Error(
        (lastRefUploadIssue ? `${lastRefUploadIssue}。` : "") +
          "该视频通道只收公网 http(s) 参考，base64 一律拒绝。" +
          "解决办法二选一：完成聚梦实名认证以启用官方文件上传，或在「本地设置 → 参考图 OSS」配置公共读直链。" +
          ` 上游原文：${detail.slice(0, 140)}`
      );
    }
    if (/最多支持\s*0\s*个参考视频|max.*0.*reference.?video/i.test(detail)) {
      throw new Error(
        `模型「${upstreamModel}」不支持参考视频。请改用 Seedance 等支持参考视频的模型，或去掉 @视频节点 / 视频连线后重试。` +
          ` 详情：${detail.slice(0, 160)}`
      );
    }
    if (/不支持分辨率|允许的取值|允许的分辨率/i.test(detail)) {
      throw new Error(
        `模型「${upstreamModel}」不接受 ${resolution} 清晰度（本次已按你所选原样提交）。` +
          `请在节点里改选其它清晰度；上游允许的取值见下方详情。` +
          ` 详情：${detail.slice(0, 200)}`
      );
    }
    if (/仅支持\s*5\s*秒|只支持\s*5\s*秒|duration.*5/i.test(detail)) {
      throw new Error(
        `模型「${upstreamModel}」当前只支持 5 秒（本次提交 ${duration}s）。请把时长改成 5 秒后重试。`
      );
    }
    if (/model_not_found|No available channel for model/i.test(detail)) {
      throw new Error(
        `上游没有可用通道。本地平台模型名「${configuredModel}」，实际提交「${upstreamModel}」。` +
          `请到供应商控制台 /v1/models 核对完整 id（含 /text-to-video、/discount 等后缀），在设置里改「平台模型名」后保存。` +
          ` 详情：${detail.slice(0, 180)}`
      );
    }
    if (/任务创建失败|切换其他线路/i.test(detail)) {
      throw new Error(
        `上游线路创建任务失败（模型 ${upstreamModel}）。多半是该模型通道暂时不可用，请换 Seedance / 可灵 V3（kling-v3/discount）或稍后重试。` +
          ` 详情：${detail.slice(0, 160)}`
      );
    }
    throw new Error(`视频提交失败 HTTP ${submit.status}（${submitUrl}）: ${detail}`);
  }

  const submitPayload = submit.json ?? (submit.text ? safeJson(submit.text) : null);
  const immediate = extractVideoUrl(submitPayload);
  const taskId = extractUpstreamTaskId(submitPayload);
  if (immediate && !taskId) return { url: immediate, ...submittedMeta };
  if (!taskId) {
    throw new Error(
      `上游未返回视频 task_id（${submitUrl}）。请确认上游模型名正确，且接口为 POST /v1/video/generations。响应：${JSON.stringify(submitPayload).slice(0, 300)}`
    );
  }
  try {
    await params.onProviderTaskId?.(taskId);
  } catch {
    /* ignore */
  }

  const polledUrl = await pollLocalVideoTaskOnceLoop({
    apiBase,
    apiKey,
    taskId,
    timeoutMs: LOCAL_VIDEO_POLL_TIMEOUT_MS,
    signal: params.signal,
  });
  return { url: polledUrl, providerTaskId: taskId, ...submittedMeta };
}

/** 视频异步任务轮询（提交后 / 任务列表「同步上游」共用） */
async function pollLocalVideoTaskOnceLoop(params: {
  apiBase: string;
  apiKey: string;
  taskId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  const pollUrls = [
    `${normalizeApiBase(params.apiBase)}/video/generations/${encodeURIComponent(params.taskId)}`,
    `${normalizeApiBase(params.apiBase)}/videos/generations/${encodeURIComponent(params.taskId)}`,
    `${normalizeApiBase(params.apiBase)}/videos/${encodeURIComponent(params.taskId)}`,
  ];
  const deadline = Date.now() + Math.max(5_000, params.timeoutMs);
  let lastErr = "";
  while (Date.now() < deadline) {
    if (params.signal?.aborted) {
      const { AgentTurnAbortedError } = await import("@/lib/canvas/agentCanvasBusy");
      throw new AgentTurnAbortedError();
    }
    for (const qurl of pollUrls) {
      const polled = await proxyUpstream({
        url: qurl,
        method: "GET",
        headers: { Authorization: `Bearer ${params.apiKey}` },
        timeoutMs: 60_000,
        signal: params.signal,
      });
      if (polled.status === 404) continue;
      if ((polled.status ?? 500) >= 400) {
        lastErr = upstreamErrorDetail(polled) || `HTTP ${polled.status}`;
        continue;
      }
      const payload = polled.json ?? (polled.text ? safeJson(polled.text) : null);
      const mapped = mapVideoPollState(payload);
      if (mapped.state === "failed") {
        throw new Error(mapped.error || "上游视频任务失败");
      }
      if (mapped.state === "succeeded") {
        return (
          mapped.url ||
          `${normalizeApiBase(params.apiBase)}/videos/${encodeURIComponent(params.taskId)}/content`
        );
      }
      break;
    }
    await sleep(LOCAL_VIDEO_POLL_INTERVAL_MS, params.signal);
  }
  throw new Error(
    `视频任务超时（task_id=${params.taskId}）${lastErr ? `，末次错误：${lastErr}` : ""}。可在「生成任务」点「同步上游」再查`
  );
}

/**
 * 任务列表「同步上游」：按已保存的 providerTaskId 短轮询，更新本机任务状态。
 * 不重新 POST，避免重复扣费。
 */
export async function syncLocalGenerationJobFromUpstream(jobId: string): Promise<{
  status: "succeeded" | "failed" | "running";
  message: string;
  resultUrlPreview?: string;
}> {
  const api = localStore();
  const list = await api.listGenerationJobs();
  const job = list.find((j) => j.id === jobId);
  if (!job) throw new Error("本机任务不存在");
  const taskId = String(job.providerTaskId || "").trim();
  if (!taskId) {
    throw new Error("该任务没有上游 task_id，无法同步（需生成时上游返回过异步 id）");
  }
  const model = await findLocalModel(job.modelId);
  if (!model) throw new Error(`未找到模型：${job.modelId}，请先在本地设置中配置`);
  const providers = await api.listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);
  if (!apiBase) throw new Error("模型未配置 API Base");

  const isVideo = job.category === "video";
  const syncBudgetMs = SYNC_POLL_BUDGET_MS;

  // 3D 任务：只按 task_id 查询 + 重新下载 GLB，不重新 POST
  if (job.category === "model3d") {
    try {
      const url = await pollModel3dTaskLoop({ apiBase, apiKey, taskId, timeoutMs: syncBudgetMs });
      let preview = url;
      if (job.projectId) {
        const saved = await persistLocalModel3dResult({
          projectId: job.projectId,
          url,
          apiKey,
          title: job.promptPreview || "AI 3D 模型",
        });
        preview = saved.fileUrl;
      }
      await api.updateGenerationJob(jobId, {
        status: "succeeded",
        error: "",
        resultUrlPreview: String(preview).slice(0, 200),
        providerTaskId: taskId,
      });
      return {
        status: "succeeded",
        message: "上游 3D 模型已完成，已存入项目素材（导演台可选用）",
        resultUrlPreview: preview,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stillRunning = /超时/.test(msg);
      await api.updateGenerationJob(jobId, {
        status: stillRunning ? "running" : "failed",
        error: stillRunning ? "上游仍在处理中，可稍后再同步" : msg,
        providerTaskId: taskId,
      });
      return stillRunning
        ? { status: "running", message: "上游仍在处理中，请稍后再同步" }
        : { status: "failed", message: msg };
    }
  }

  if (isVideo) {
    try {
      const url = await pollLocalVideoTaskOnceLoop({
        apiBase,
        apiKey,
        taskId,
        timeoutMs: syncBudgetMs,
      });
      let preview = url;
      if (job.projectId && job.nodeId) {
        try {
          preview = await persistLocalVideoResult({
            projectId: job.projectId,
            nodeId: job.nodeId,
            url,
            apiKey,
          });
        } catch {
          /* 预览失败仍用上游 URL */
        }
      }
      await api.updateGenerationJob(jobId, {
        status: "succeeded",
        error: "",
        resultUrlPreview: String(preview).slice(0, 200),
        providerTaskId: taskId,
      });
      return { status: "succeeded", message: "上游视频已完成", resultUrlPreview: preview };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/超时/.test(msg)) {
        await api.updateGenerationJob(jobId, {
          status: "running",
          error: "上游仍在处理中，可稍后再同步",
          providerTaskId: taskId,
        });
        return { status: "running", message: "上游仍在处理中，请稍后再同步" };
      }
      await api.updateGenerationJob(jobId, {
        status: "failed",
        error: msg,
        providerTaskId: taskId,
      });
      return { status: "failed", message: msg };
    }
  }

  const deadline = Date.now() + syncBudgetMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const got = await pollLocalJumengImageTaskOnce({
        apiBase,
        apiKey,
        taskId,
      });
      if (got.url || got.b64) {
        let preview = got.url || "";
        if (job.projectId && job.nodeId) {
          try {
            preview = (
              await persistLocalImageResult({
                projectId: job.projectId,
                nodeId: job.nodeId,
                url: got.url,
                b64: got.b64,
              })
            ).url;
          } catch {
            if (got.b64) preview = "(b64)";
          }
        } else if (got.b64 && !preview) {
          preview = "(b64)";
        }
        await api.updateGenerationJob(jobId, {
          status: "succeeded",
          error: "",
          resultUrlPreview: String(preview).slice(0, 200),
          providerTaskId: taskId,
        });
        return { status: "succeeded", message: "上游图片已完成", resultUrlPreview: preview };
      }
      if (got.failed) {
        await api.updateGenerationJob(jobId, {
          status: "failed",
          error: got.failed,
          providerTaskId: taskId,
        });
        return { status: "failed", message: got.failed };
      }
      lastErr = got.pending || lastErr;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      break;
    }
    await sleep(LOCAL_IMAGE_POLL_INTERVAL_MS);
  }

  await api.updateGenerationJob(jobId, {
    status: "running",
    error: lastErr || "上游仍在处理中，可稍后再同步",
    providerTaskId: taskId,
  });
  return {
    status: "running",
    message: lastErr || "上游仍在处理中，请稍后再同步",
  };
}

/** 图片：单轮查询各 poll URL（不进入长循环） */
async function pollLocalJumengImageTaskOnce(params: {
  apiBase: string;
  apiKey: string;
  taskId: string;
}): Promise<{ url?: string; b64?: string; pending?: string; failed?: string }> {
  const base = normalizeApiBase(params.apiBase);
  const tid = encodeURIComponent(params.taskId);
  const pollUrls = [`${base}/images/generations/${tid}`, `${base}/images/${tid}`];
  let lastErr = "";
  for (const qurl of pollUrls) {
    const polled = await proxyUpstream({
      url: qurl,
      method: "GET",
      headers: { Authorization: `Bearer ${params.apiKey}` },
      timeoutMs: 60_000,
    });
    if (polled.status === 404) continue;
    if ((polled.status ?? 500) >= 400) {
      lastErr = upstreamErrorDetail(polled) || `HTTP ${polled.status}`;
      continue;
    }
    const body = polled.json ?? (polled.text ? safeJson(polled.text) : null);
    const status = extractUpstreamStatus(body);
    if (status === "failed" || status === "error" || status === "cancelled") {
      return {
        failed:
          (typeof body === "object" && body
            ? JSON.stringify(body).slice(0, 300)
            : String(body || "")) || "上游图片任务失败",
      };
    }
    const got = parseLocalImageUpstreamResult(body);
    if (got.url || got.b64) return got;
    if (
      status === "succeeded" ||
      status === "success" ||
      status === "completed" ||
      status === "done"
    ) {
      return { failed: "上游图片任务完成但 url 与 b64_json 均为空" };
    }
    return { pending: status || "processing" };
  }
  if (lastErr) return { pending: lastErr };
  return { pending: "not_found" };
}

/** 将上游视频 URL 落成本地可播地址 */
export async function persistLocalVideoResult(params: {
  projectId: string;
  nodeId: string;
  url: string;
  apiKey?: string;
}): Promise<string> {
  const rawUrl = params.url?.trim() || "";
  if (!rawUrl) throw new Error("视频结果 URL 为空");
  if (rawUrl.startsWith("data:") || rawUrl.startsWith("file:") || rawUrl.startsWith("blob:")) {
    return rawUrl;
  }
  if (!rawUrl.startsWith("http")) return rawUrl;

  try {
    const headers: Record<string, string> = {};
    if (params.apiKey) headers.Authorization = `Bearer ${normalizeApiKey(params.apiKey)}`;
    const proxied = await proxyUpstream({
      url: rawUrl,
      method: "GET",
      headers,
      timeoutMs: 300_000,
    });
    if (proxied.status && proxied.status >= 400) return rawUrl;
    if (proxied.base64) {
      const saved = await localStore().writeAsset(
        params.projectId,
        `${params.nodeId}-${Date.now()}.mp4`,
        proxied.base64
      );
      return saved.fileUrl.startsWith("data:application/octet-stream")
        ? `data:video/mp4;base64,${proxied.base64}`
        : saved.fileUrl;
    }
  } catch {
    /* 回退直链 */
  }
  return rawUrl;
}

/* ------------------------------------------------------------------ */
/* 3D 模型生成（Tripo 等）：POST {base}/videos → 轮询 GET {base}/videos/{id} → 下载 GLB */
/* ------------------------------------------------------------------ */

/** 导演台 AI 生成模型在素材库里的子分类 */
export const MODEL3D_ASSET_SUBCATEGORY = "AI 3D 模型";

export type Model3dQuality = "standard" | "detailed";

/** 结果地址优先取这些键（Tripo 原生 output.pbr_model / model / base_model，网关常见 url 字段兜底） */
const MODEL3D_URL_KEYS = [
  "pbr_model",
  "model",
  "base_model",
  "glb",
  "glb_url",
  "model_url",
  "result_url",
  "resultUrl",
  "output_url",
  "url",
  "video_url",
];

/** 在轮询 JSON 里递归找 3D 模型下载地址：.glb 直链优先，其次按键名优先级 */
function extractModel3dUrl(body: unknown): string {
  const byKey: Array<{ rank: number; url: string }> = [];
  let glbHit = "";
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node == null || glbHit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        if (/\.glb(\?|$)/i.test(value)) {
          glbHit = value;
          return;
        }
        const rank = MODEL3D_URL_KEYS.indexOf(key);
        if (rank >= 0) byKey.push({ rank, url: value });
      } else if (value && typeof value === "object") {
        visit(value, depth + 1);
      }
    }
  };
  visit(body, 0);
  if (glbHit) return glbHit;
  byKey.sort((a, b) => a.rank - b.rank);
  return byKey[0]?.url || "";
}

/** GLB 文件头为 ASCII "glTF"（base64 前缀 Z2xURg） */
function isGlbBase64(b64: string): boolean {
  return b64.startsWith("Z2xURg");
}

/** 3D 任务轮询：成功返回模型下载地址（无显式地址时回退网关 /content） */
async function pollModel3dTaskLoop(params: {
  apiBase: string;
  apiKey: string;
  taskId: string;
  timeoutMs: number;
  onProgress?: (status: string) => void;
}): Promise<string> {
  const base = normalizeApiBase(params.apiBase);
  const tid = encodeURIComponent(params.taskId);
  const pollUrl = joinApiUrl(base, `/videos/${tid}`);
  const deadline = Date.now() + Math.max(5_000, params.timeoutMs);
  let lastErr = "";
  while (Date.now() < deadline) {
    const polled = await proxyUpstream({
      url: pollUrl,
      method: "GET",
      headers: { Authorization: `Bearer ${params.apiKey}` },
      timeoutMs: 60_000,
    });
    if ((polled.status ?? 500) >= 400) {
      lastErr = upstreamErrorDetail(polled) || `HTTP ${polled.status}`;
      if (polled.status === 401) throw new Error(`上游返回 401，请核对供应商 API Key。详情：${lastErr.slice(0, 200)}`);
    } else {
      const payload = polled.json ?? (polled.text ? safeJson(polled.text) : null);
      const mapped = mapVideoPollState(payload);
      if (mapped.state === "failed") {
        throw new LocalUpstreamJobError(mapped.error || "上游 3D 任务失败", params.taskId);
      }
      if (mapped.state === "succeeded") {
        return extractModel3dUrl(payload) || joinApiUrl(base, `/videos/${tid}/content`);
      }
      params.onProgress?.(extractUpstreamStatus(payload) || mapped.state);
    }
    await sleep(LOCAL_MODEL3D_POLL_INTERVAL_MS);
  }
  throw new LocalUpstreamJobError(
    `3D 任务超时（task_id=${params.taskId}）${lastErr ? `，末次错误：${lastErr}` : ""}。可在「生成任务」点「同步上游」再查`,
    params.taskId
  );
}

/** 下载上游 3D 结果并落成本机素材（category=model，导演台可直接选用） */
export async function persistLocalModel3dResult(params: {
  projectId: string;
  url: string;
  apiKey?: string;
  title: string;
}): Promise<{ assetId: string; fileUrl: string }> {
  const rawUrl = params.url.trim();
  if (!rawUrl.startsWith("http")) throw new Error("3D 模型结果地址无效");
  const headers: Record<string, string> = {};
  // 网关 /content 需要鉴权；第三方 CDN 直链带上 Key 也无害
  if (params.apiKey) headers.Authorization = `Bearer ${normalizeApiKey(params.apiKey)}`;
  const proxied = await proxyUpstream({ url: rawUrl, method: "GET", headers, timeoutMs: 600_000 });
  if ((proxied.status ?? 500) >= 400) {
    throw new Error(`3D 模型下载失败 HTTP ${proxied.status}：${upstreamErrorDetail(proxied).slice(0, 200)}`);
  }
  const b64 = (proxied.base64 || "").trim();
  if (!b64 || !isGlbBase64(b64)) {
    const preview = proxied.text || (proxied.json ? JSON.stringify(proxied.json) : "") || proxied.contentType || "";
    throw new Error(
      `上游返回的不是 GLB 模型文件（${rawUrl.slice(0, 96)}）。响应预览：${String(preview).slice(0, 200)}`
    );
  }
  const id = crypto.randomUUID();
  const fileName = `${id}.glb`;
  const saved = await localStore().writeAsset(params.projectId, fileName, b64);
  await localStore().registerAssetMeta(params.projectId, {
    id,
    fileName,
    title: params.title.slice(0, 40) || "AI 3D 模型",
    category: "model",
    subcategory: MODEL3D_ASSET_SUBCATEGORY,
    fileType: "model/gltf-binary",
    fileSize: Math.floor((b64.length * 3) / 4),
    createdAt: new Date().toISOString(),
  });
  return { assetId: id, fileUrl: saved.fileUrl };
}

/**
 * 3D 模型生成（Tripo H3.1 等，经聚梦网关 /v1/videos）。
 * 有 imageUrl 走 image_to_model，否则 text_to_model；成功后 GLB 落本机素材。
 */
export async function localGenerateModel3d(params: {
  modelId: string;
  projectId: string;
  prompt: string;
  /** 参考图（本机素材地址 / https）；有则图生 3D */
  imageUrl?: string;
  /** 素材库标题 */
  title?: string;
  textureQuality?: Model3dQuality;
  geometryQuality?: Model3dQuality;
  onProviderTaskId?: (taskId: string) => void | Promise<void>;
  onProgress?: (status: string) => void;
}): Promise<{ assetId: string; fileUrl: string; providerTaskId: string; upstreamModel: string }> {
  const model = await findLocalModel(params.modelId);
  if (!model) throw new Error(`未找到 3D 模型：${params.modelId}，请先在「设置」中添加 3D 模型`);
  if (model.enabled === false) {
    throw new Error(`模型「${model.displayName || model.name}」未启用，请在设置中勾选启用`);
  }
  const providers = await localStore().listProviders();
  const { apiBase, apiKey, provider } = resolveCreds(model, providers);
  assertApiKeyReady(apiKey, model, provider);
  if (!apiBase) throw new Error(`模型 ${model.displayName || model.name} 未配置 API Base`);
  const upstreamModel = model.upstreamModel || model.name;
  const prompt = params.prompt.trim();

  const body: Record<string, unknown> = {
    model: upstreamModel,
    texture: true,
    pbr: true,
    texture_quality: params.textureQuality || "standard",
    geometry_quality: params.geometryQuality || "standard",
  };
  // 聚梦文档示例：Tripo-H3.1 需带 model_version
  if (/h3\.1/i.test(upstreamModel)) body.model_version = "v3.1-20260211";

  const rawImage = (params.imageUrl || "").trim();
  if (rawImage) {
    // Tripo 需要上游能下载的图片地址：聚梦官方走 OSS / 官方文件上传，第三方必须配 OSS
    const jumengCreds = await resolveJumengUploadCreds(params.modelId);
    const ref = await resolveLocalImageUrlForUpstream(rawImage, {
      preferPublicHttps: jumengCreds !== null,
      requirePublicHttps: jumengCreds === null,
      jumengUpload: jumengCreds,
    });
    if (!ref) throw new Error("参考图未能转换成上游可用地址，已中止");
    const ext = /png/i.test(ref) ? "png" : /webp/i.test(ref) ? "webp" : "jpg";
    body.type = "image_to_model";
    // Tripo 原生字段为 file{type,url}；同时给 image_url 兼容网关映射
    body.file = { type: ext, url: ref };
    body.image_url = ref;
    if (prompt) body.prompt = prompt;
  } else {
    if (!prompt) throw new Error("文生 3D 需要描述要生成的物体");
    body.type = "text_to_model";
    body.prompt = prompt;
  }

  const submitUrl = openAiCompatibleUrl(apiBase, "model3d");
  const reqBody = JSON.stringify(body);
  const submit = await proxyUpstream({
    url: submitUrl,
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: reqBody,
    timeoutMs: 180_000,
  });
  if ((submit.status ?? 500) >= 400) {
    const detail = upstreamErrorDetail(submit);
    if (submit.status === 401) {
      throw new Error(`上游返回 401（${submitUrl}）。请核对供应商 API Key。详情：${detail.slice(0, 200)}`);
    }
    if (/model_not_found|No available channel/i.test(detail)) {
      throw new Error(
        `上游没有「${upstreamModel}」的可用通道。请到供应商控制台核对模型名（如 Tripo/Tripo-H3.1）后在设置里修改。详情：${detail.slice(0, 160)}`
      );
    }
    throw new Error(`3D 生成提交失败 HTTP ${submit.status}（${submitUrl}）: ${detail}`);
  }
  const submitPayload = submit.json ?? (submit.text ? safeJson(submit.text) : null);
  const taskId = extractUpstreamTaskId(submitPayload);
  if (!taskId) {
    throw new Error(`上游未返回 3D 任务 id（${submitUrl}）。响应：${JSON.stringify(submitPayload).slice(0, 300)}`);
  }
  try {
    await params.onProviderTaskId?.(taskId);
  } catch {
    /* ignore */
  }

  const resultUrl = await pollModel3dTaskLoop({
    apiBase,
    apiKey,
    taskId,
    timeoutMs: LOCAL_MODEL3D_POLL_TIMEOUT_MS,
    onProgress: params.onProgress,
  });
  try {
    const saved = await persistLocalModel3dResult({
      projectId: params.projectId,
      url: resultUrl,
      apiKey,
      title: params.title || prompt || "AI 3D 模型",
    });
    return { ...saved, providerTaskId: taskId, upstreamModel };
  } catch (err) {
    // 上游已生成成功：保留 task_id，失败后可在「生成任务」同步重下
    throw new LocalUpstreamJobError(err instanceof Error ? err.message : String(err), taskId);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function runCustomTemplate(
  model: LocalModel,
  vars: Record<string, string>,
  opts?: { jumengInjectImageRefs?: string[] }
): Promise<string> {
  const method = model.method || "POST";
  const apiKey = normalizeApiKey(vars.apiKey || "");
  const tplVars = {
    ...vars,
    apiKey,
    apiBase: normalizeApiBase(vars.apiBase || ""),
  };
  const url = collapseDoubleV1(renderTemplate(model.url || "", tplVars));
  if (!url) throw new Error("自定义模板未填写接口地址（请粘贴第三方完整 URL）");

  let headers: Record<string, string> = { "Content-Type": "application/json" };
  if (model.headersJson?.trim()) {
    try {
      headers = { ...headers, ...(JSON.parse(model.headersJson) as Record<string, string>) };
    } catch {
      throw new Error("自定义 Header JSON 无法解析");
    }
  }
  headers = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, renderTemplate(String(v), tplVars)])
  );

  // 确保带上 Authorization；修正空 Bearer / 双 Bearer
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");
  if (authKey) {
    let authVal = headers[authKey]!.trim();
    // 模板未替换到 Key → "Bearer " 空值
    if (/^Bearer\s*$/i.test(authVal) || authVal === "") {
      if (!apiKey) {
        throw new Error("Headers 里 Authorization 为空：请绑定供应商并填写有效 API Key 后保存");
      }
      authVal = `Bearer ${apiKey}`;
    }
    // 用户 Key 本身带了 Bearer，模板又写了 Bearer {{apiKey}} → Bearer Bearer xxx
    authVal = authVal.replace(/^Bearer\s+Bearer\s+/i, "Bearer ");
    headers[authKey] = authVal;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    throw new Error("未找到 Authorization，且 API Key 为空：请绑定供应商后保存");
  }

  let body: string | undefined =
    method === "GET"
      ? undefined
      : renderTemplate(model.bodyTemplate || '{"prompt":"{{prompt}}"}', tplVars);

  // 渲染后修正：① size 必须是宽*高时覆盖错误值；② 有参考则补 image 字段
  if (body) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      let changed = false;
      const wantSize = String(vars.size || "").trim();
      if (wantSize && /^\d+\*\d+$/.test(wantSize)) {
        const cur = String(parsed.size || "");
        if (!/^\d+\*\d+$/.test(cur)) {
          parsed.size = wantSize;
          changed = true;
        }
      }
      const injectRefs = (opts?.jumengInjectImageRefs || []).filter((u) =>
        /^https?:\/\//i.test(u)
      );
      if (
        injectRefs.length > 0 &&
        !parsed.image &&
        !parsed.images &&
        !parsed.image_urls &&
        !parsed.input_reference
      ) {
        parsed.image = injectRefs[0];
        parsed.images = injectRefs;
        parsed.image_urls = injectRefs;
        parsed.input_reference = injectRefs[0];
        changed = true;
      }
      if (changed) body = JSON.stringify(parsed);
    } catch {
      /* 非 JSON 模板则不改 */
    }
  }

  const data = await proxyUpstream({
    url,
    method,
    headers,
    body: body ?? null,
    timeoutMs: 180_000,
  });
  if ((data.status ?? 500) >= 400) {
    const detail = upstreamErrorDetail(data);
    if (data.status === 401) {
      throw new Error(
        `上游返回 401 Invalid token（${url}）。请核对：① 供应商 Key 是否为控制台最新密钥；② 模型已绑定该供应商并点「保存到本地」；③ Key 不要带 Bearer 前缀、不要加引号。详情：${detail.slice(0, 200)}`
      );
    }
    if (/Expected format.*width.*height|width\s*\*\s*height/i.test(detail)) {
      throw new Error(
        `上游要求 size 为「宽*高」（如 1024*1024），不能传 1:1 / 2K。` +
          `请硬刷新后重试；若仍失败，到高级设置把该模型 body 里的 size 改成 {{size}}（已自动映射）。` +
          ` 详情：${detail.slice(0, 180)}`
      );
    }
    throw new Error(`自定义上游失败 HTTP ${data.status}（${url}）: ${detail}`);
  }
  if (data.json != null) {
    const path = model.responsePath || "";
    const extracted = path ? getByPath(data.json, path) : data.json;
    if (typeof extracted === "string") return extracted;
    return JSON.stringify(extracted);
  }
  if (data.base64) {
    const mime = data.contentType || "application/octet-stream";
    return `data:${mime};base64,${data.base64}`;
  }
  return data.text || "";
}
