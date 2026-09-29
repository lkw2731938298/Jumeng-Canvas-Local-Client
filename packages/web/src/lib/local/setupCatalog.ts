/**
 * 普通用户接入向导：拉 /v1/models、聚梦常用清单、按分类绑画布工具。
 */

import {
  LOCAL_CANVAS_TOOL_DEFS,
  type LocalToolModelsMap,
} from "./canvasToolDefs";
import { isJumengaiApiBase, joinApiUrl } from "./endpointHelpers";
import { imageAspectPresets, videoDurationPresetsForUpstream } from "./presetTemplates";
import type { LocalModel, LocalModelCategory, LocalProvider } from "./types";

export type CatalogSource = "account" | "builtin" | "manual";

export type CatalogPick = {
  /** 上游 model id（提交给网关的名字） */
  id: string;
  displayName: string;
  category: LocalModelCategory;
  source: CatalogSource;
  /** create 页式说明（下拉副文案） */
  description?: string;
  /** 是否优惠版（id 含 discount） */
  isDiscount?: boolean;
};

/**
 * 对齐 https://www.jumengai.com/create 展示名（仅展示，提交仍用 id）。
 * 例：g-image-2-Medium/discount → 全能G生图-Medium/discount
 */
const CREATE_PAGE_DISPLAY_ALIASES: Record<string, string> = {
  "g-image-2-Medium/discount": "全能G生图-Medium/discount",
  "g-image-2-medium/discount": "全能G生图-Medium/discount",
  "g-image-2-Low/discount": "全能G生图-Low/discount",
  "g-image-2-low/discount": "全能G生图-Low/discount",
  "g-image-2-high/discount": "全能G生图-High/discount",
  "g-image-2-High/discount": "全能G生图-High/discount",
};

const CREATE_PAGE_DESC_ALIASES: Record<string, string> = {
  "g-image-2-Medium/discount":
    "图片-GPT Image 2-推荐-Medium，支持文生图和参考图生图，比例16:9 / 9:16 / 1:1 / 4:3 / 3:4，支持1/2/4K",
  "g-image-2-medium/discount":
    "图片-GPT Image 2-推荐-Medium，支持文生图和参考图生图，比例16:9 / 9:16 / 1:1 / 4:3 / 3:4，支持1/2/4K",
  "g-image-2-Low/discount":
    "图片-GPT Image 2-特价-Low，支持文生图和参考图生图，比例16:9 / 9:16 / 1:1 / 4:3 / 3:4，支持1/2/4K",
  "g-image-2-low/discount":
    "图片-GPT Image 2-特价-Low，支持文生图和参考图生图，比例16:9 / 9:16 / 1:1 / 4:3 / 3:4，支持1/2/4K",
  "g-image-2-high/discount":
    "图片-GPT Image 2-高清-High，支持文生图和参考图生图，比例16:9 / 9:16 / 1:1 / 4:3 / 3:4，支持1/2/4K",
  "g-image-2-High/discount":
    "图片-GPT Image 2-高清-High，支持文生图和参考图生图，比例16:9 / 9:16 / 1:1 / 4:3 / 3:4，支持1/2/4K",
};

/** 可选常用清单：开源副本不预置任何商业网关型号，由用户拉取 /v1/models */
export const JUMENG_BUILTIN_CATALOG: CatalogPick[] = [];

const SOURCE_LABEL: Record<CatalogSource, string> = {
  account: "账号已有",
  builtin: "常用（未必开通）",
  manual: "手动添加",
};

export function catalogSourceLabel(source: CatalogSource): string {
  return SOURCE_LABEL[source];
}

/**
 * 按模型 id 推断画布分类。顺序：音频 → 视频 → 图片 → 文本。
 * 上游 /v1/models 不给 category，只能靠 id 关键词。
 */
export function inferModelCategory(modelId: string): LocalModelCategory {
  const s = modelId.toLowerCase();

  // 3D 生成优先（Tripo 走 /v1/videos，网关元数据常标成视频，须抢在视频规则前）
  if (isModel3dId(s)) return "model3d";

  // 音频优先（含 music / tts，避免被 minimax 视频规则抢走）
  if (
    /(tts|whisper|speech|suno|voice|cosyvoice|asr|vocal|music)/.test(s) ||
    /(^|[/_\-])audio([/_\-]|$)/.test(s)
  ) {
    return "audio";
  }

  // 视频：路径后缀 + 常见家族（含 ltx / minimax / seedance）
  if (
    /(text-to-video|image-to-video|ref-to-video|video-to-video)/.test(s) ||
    /(seedance|kling|runway|luma|veo|sora|hailuo|ltx)/.test(s) ||
    /(minimax-h|minimax_h|x-image-video)/.test(s) ||
    /(^|[/_\-])(i2v|t2v|r2v|v2v)([/_\-]|$)/.test(s) ||
    /(^|[/_\-])video([/_\-]|$)/.test(s)
  ) {
    return "video";
  }
  // 裸 minimax（非 music）多为视频 H 系列
  if (/minimax/.test(s) && !/(music|tts|speech)/.test(s)) return "video";

  // 图片：x-imagine / seedream / g-image / 路径后缀
  if (
    /(text-to-image|image-to-image|image-edit)/.test(s) ||
    /(x-imagine|imagine-image|dall-?e|dalle|flux)/.test(s) ||
    /(seedream|jimeng|midjourney|niji|youchuan)/.test(s) ||
    /(stable-?diff|sdxl|imagen|gpt-image|g-image)/.test(s) ||
    /(gemini[^a-z0-9]*image|z-image|qwen.?image|wanx|kolors)/.test(s) ||
    /(^|[/_\-])image([/_\-]|$)/.test(s)
  ) {
    return "image";
  }

  return "text";
}

/** 路径段可读标签（仅展示，不改提交 id） */
const PATH_SEGMENT_LABEL: Record<string, string> = {
  "text-to-image": "文生图",
  "image-to-image": "图生图",
  "image-edit": "修图",
  "text-to-video": "文生视频",
  "image-to-video": "图生视频",
  "ref-to-video": "参考生视频",
  discount: "优惠",
  discount1: "优惠1",
  discount2: "优惠2",
  discount3: "优惠3",
  discount4: "优惠4",
  discount5: "优惠5",
  stable: "Stable",
  preview: "预览",
  fast: "Fast",
};

/**
 * 把上游原始 id 收成可读显示名；提交仍用完整 id。
 * 优先对齐 create 页（全能G生图…），否则路径段可读化。
 */
export function humanizeModelDisplayName(modelId: string): string {
  const raw = (modelId || "").trim();
  if (!raw) return raw;
  if (CREATE_PAGE_DISPLAY_ALIASES[raw]) return CREATE_PAGE_DISPLAY_ALIASES[raw];
  // g-image-2-Xxx/discount → 全能G生图-Xxx/discount
  const gImage = raw.match(/^g-image-2-([^/]+)\/(discount\d*)$/i);
  if (gImage) {
    const tier = gImage[1];
    const disc = gImage[2];
    const pretty =
      /^med/i.test(tier) ? "Medium" : /^low/i.test(tier) ? "Low" : /^high/i.test(tier) ? "High" : tier;
    return `全能G生图-${pretty}/${disc}`;
  }
  const parts = raw.split("/").filter(Boolean);
  const head = parts[0] || raw;
  const title = head
    .split(/[-_]+/)
    .filter(Boolean)
    .map((tok) => {
      if (/^\d+(\.\d+)*$/.test(tok)) return tok;
      if (/^v\d/i.test(tok)) return tok.toUpperCase();
      if (/^(gpt|ltx|sd|hd|ai)$/i.test(tok)) return tok.toUpperCase();
      if (tok.length <= 2) return tok.toUpperCase();
      return tok.charAt(0).toUpperCase() + tok.slice(1);
    })
    .join(" ");
  const tail = parts
    .slice(1)
    .map((p) => PATH_SEGMENT_LABEL[p.toLowerCase()] || p)
    .filter(Boolean);
  if (!tail.length) return title;
  return `${title} · ${tail.join(" · ")}`;
}

/** create 页副文案；无则空 */
export function createPageModelDescription(modelId: string): string {
  const raw = (modelId || "").trim();
  return CREATE_PAGE_DESC_ALIASES[raw] || "";
}

export function maskApiKey(raw: string): string {
  const key = (raw || "").trim();
  if (!key) return "未填写";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export type UpstreamModelEntry = {
  id: string;
  /** NewAPI / 聚梦：supported_endpoint_types */
  endpointTypes: string[];
  /** 部分网关：owned_by / modalities / output_modalities */
  ownedBy?: string;
  modalities?: string[];
  outputModalities?: string[];
  /** 上游展示名（若有） */
  displayName?: string;
  /** 上游描述 */
  description?: string;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function readUpstreamEntry(row: Record<string, unknown>): UpstreamModelEntry | null {
  const idRaw = row.id ?? row.model ?? row.model_name ?? row.modelId;
  if (typeof idRaw !== "string" || !idRaw.trim()) return null;
  const id = idRaw.trim();
  if (id.length > 180 || /\s/.test(id)) return null;
  if (["list", "model", "models", "object", "data"].includes(id.toLowerCase())) return null;

  const endpointTypes = asStringArray(
    row.supported_endpoint_types ??
      row.supportedEndpointTypes ??
      row.endpoint_types ??
      row.endpointTypes
  );
  const ownedBy =
    typeof row.owned_by === "string"
      ? row.owned_by
      : typeof row.ownedBy === "string"
        ? row.ownedBy
        : undefined;
  const modalities = asStringArray(row.modalities ?? row.input_modalities ?? row.inputModalities);
  const outputModalities = asStringArray(
    row.output_modalities ?? row.outputModalities ?? row.output_modality ?? row.outputModality
  );
  // 少数网关把单个 modality 写成字符串
  if (typeof row.modality === "string" && row.modality.trim()) {
    modalities.push(row.modality.trim());
  }
  if (typeof row.output_type === "string" && row.output_type.trim()) {
    outputModalities.push(row.output_type.trim());
  }
  if (typeof row.outputType === "string" && row.outputType.trim()) {
    outputModalities.push(row.outputType.trim());
  }

  // 展示名：不要用与 id 相同的 name 字段覆盖 create 风格别名
  const nameCandidates = [row.display_name, row.displayName, row.title, row.label];
  let displayName: string | undefined;
  for (const c of nameCandidates) {
    if (typeof c === "string" && c.trim() && c.trim() !== id) {
      displayName = c.trim();
      break;
    }
  }
  // row.name 有时是 id，有时是中文名
  if (!displayName && typeof row.name === "string") {
    const n = row.name.trim();
    if (n && n !== id && /[\u4e00-\u9fff]/.test(n)) displayName = n;
  }
  const descRaw = row.description ?? row.desc ?? row.remark ?? row.intro;
  const description = typeof descRaw === "string" && descRaw.trim() ? descRaw.trim() : undefined;

  return {
    id,
    endpointTypes,
    ownedBy,
    modalities: modalities.length ? modalities : undefined,
    outputModalities: outputModalities.length ? outputModalities : undefined,
    displayName,
    description,
  };
}

/**
 * 优先用上游声明的端点/输出模态分类（比猜 id 准）。
 * NewAPI：image-generation / openai-video；部分网关还有 video-generation、audio。
 * 没有可靠字段时返回 null，交给 id 关键词兜底。
 */
export function inferCategoryFromUpstreamMeta(
  entry: Pick<UpstreamModelEntry, "endpointTypes" | "outputModalities" | "modalities" | "ownedBy">
): LocalModelCategory | null {
  const endpoints = (entry.endpointTypes || []).map((x) => x.toLowerCase());
  const outputs = (entry.outputModalities || []).map((x) => x.toLowerCase());
  const mods = (entry.modalities || []).map((x) => x.toLowerCase());
  const owned = (entry.ownedBy || "").toLowerCase();
  const blob = [...endpoints, ...outputs, ...mods, owned].join(" ");

  // 输出模态 / 端点类型（权威）
  if (
    /(openai-video|video-generation|video_generation|text-to-video|image-to-video)/.test(blob) ||
    outputs.some((o) => o === "video" || o.includes("video"))
  ) {
    return "video";
  }
  if (
    /(image-generation|image_generation|images\.generations|text-to-image)/.test(blob) ||
    outputs.some((o) => o === "image" || o.includes("image"))
  ) {
    return "image";
  }
  if (
    /(audio|speech|tts|music|suno|voice)/.test(blob) ||
    outputs.some((o) => o === "audio" || o.includes("audio") || o.includes("speech"))
  ) {
    return "audio";
  }

  // 仅有对话类端点且没有媒体端点 → 文本
  const chatOnly =
    endpoints.length > 0 &&
    endpoints.every((t) =>
      /^(openai|openai-response|openai-response-compact|anthropic|gemini|openai-alpha-search)$/.test(t)
    );
  if (chatOnly) return "text";

  // embeddings / rerank 对本画布无用，不当成媒体
  if (endpoints.length > 0 && endpoints.every((t) => /^(embeddings|jina-rerank)$/.test(t))) {
    return "text";
  }

  return null;
}

/** 3D 生成模型 id 关键词（Tripo / Rodin / 混元 3D / *-to-model） */
export function isModel3dId(modelId: string): boolean {
  const s = (modelId || "").toLowerCase();
  return (
    /(tripo|rodin|hunyuan-?3d|hunyuan3d|trellis|meshy)/.test(s) ||
    /(text-to-model|image-to-model|text_to_model|image_to_model|to-3d|img2mesh)/.test(s)
  );
}

/** 综合上游元数据 + id 关键词 */
export function resolveModelCategory(
  modelId: string,
  meta?: Partial<UpstreamModelEntry> | null
): LocalModelCategory {
  // 3D 模型 id 明确时不看元数据（网关把 Tripo 标成 openai-video）
  if (isModel3dId(modelId)) return "model3d";
  const fromMeta = meta
    ? inferCategoryFromUpstreamMeta({
        endpointTypes: meta.endpointTypes || [],
        outputModalities: meta.outputModalities,
        modalities: meta.modalities,
        ownedBy: meta.ownedBy,
      })
    : null;
  if (fromMeta) return fromMeta;
  return inferModelCategory(modelId);
}

/** 从 OpenAI / 聚梦 / NewAPI JSON 收集完整模型条目（含端点类型） */
export function collectUpstreamModelEntries(body: unknown): UpstreamModelEntry[] {
  const out: UpstreamModelEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: UpstreamModelEntry | null) => {
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    out.push(entry);
  };

  const o = asRecord(body);
  const takeList = (list: unknown[]): number => {
    let n = 0;
    for (const item of list) {
      if (typeof item === "string") {
        push({ id: item.trim(), endpointTypes: [] });
        n += 1;
        continue;
      }
      const row = asRecord(item);
      if (!row) continue;
      const entry = readUpstreamEntry(row);
      if (entry) {
        push(entry);
        n += 1;
      }
    }
    return n;
  };

  if (o && Array.isArray(o.data) && takeList(o.data) > 0) return out;
  if (o && Array.isArray(o.models) && takeList(o.models) > 0) return out;

  // 兜底：浅层遍历
  const walk = (v: unknown, depth: number) => {
    if (depth > 3 || v == null) return;
    if (typeof v === "string") return;
    if (Array.isArray(v)) {
      takeList(v);
      return;
    }
    const obj = asRecord(v);
    if (!obj) return;
    if (obj.data != null) walk(obj.data, depth + 1);
    if (obj.models != null) walk(obj.models, depth + 1);
  };
  walk(body, 0);
  return out;
}

/** 从 OpenAI / 聚梦 / 各种包装 JSON 里收集模型 id（兼容旧调用） */
export function collectUpstreamModelIds(body: unknown): string[] {
  return collectUpstreamModelEntries(body).map((e) => e.id);
}

export async function fetchAccountCatalog(params: {
  apiBase: string;
  apiKey: string;
  /** 只要图片+视频（开源画布聚梦接法默认） */
  mediaOnly?: boolean;
}): Promise<{ picks: CatalogPick[]; error: string }> {
  const url = joinApiUrl(params.apiBase, "/models");
  const res = await fetch("/api/local/upstream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: "GET",
      headers: { Authorization: `Bearer ${params.apiKey}` },
      timeoutMs: 45_000,
    }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    status?: number;
    json?: unknown;
    text?: string;
  };
  if (!res.ok || data.ok === false) {
    return { picks: [], error: data.error || `拉取失败 HTTP ${res.status}` };
  }
  if ((data.status ?? 500) >= 400) {
    const detail =
      typeof data.text === "string" && data.text.trim()
        ? data.text.slice(0, 180)
        : data.json
          ? JSON.stringify(data.json).slice(0, 180)
          : `HTTP ${data.status}`;
    return { picks: [], error: `上游拒绝拉取模型列表：${detail}` };
  }
  const body = data.json ?? (data.text ? safeJson(data.text) : null);
  const entries = collectUpstreamModelEntries(body);
  if (!entries.length) {
    return { picks: [], error: "上游返回了列表，但里面没有模型名。可以手动填写。" };
  }
  const withMeta = entries.filter(
    (e) =>
      (e.endpointTypes && e.endpointTypes.length > 0) ||
      (e.outputModalities && e.outputModalities.length > 0)
  ).length;
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "[fetchAccountCatalog] models=%s withEndpointOrOutputMeta=%s",
      entries.length,
      withMeta
    );
  }
  let picks: CatalogPick[] = entries.map((e) => {
    const category = resolveModelCategory(e.id, e);
    const displayName = e.displayName || humanizeModelDisplayName(e.id);
    const description = e.description || createPageModelDescription(e.id) || undefined;
    return {
      id: e.id,
      displayName,
      category,
      source: "account" as const,
      description,
      isDiscount: /discount/i.test(e.id),
    };
  });
  if (params.mediaOnly) {
    picks = picks.filter((p) => p.category === "image" || p.category === "video");
  }
  // 优惠版靠前，贴近 create 页
  picks.sort((a, b) => {
    if (Boolean(a.isDiscount) !== Boolean(b.isDiscount)) return a.isDiscount ? -1 : 1;
    if (a.category !== b.category) {
      const order = { image: 0, video: 1, text: 2, audio: 3, model3d: 4 } as const;
      return (order[a.category] ?? 9) - (order[b.category] ?? 9);
    }
    return a.displayName.localeCompare(b.displayName, "zh");
  });
  return { picks, error: "" };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function shouldOfferJumengBuiltin(account: CatalogPick[]): boolean {
  if (account.length === 0) return true;
  const hasImage = account.some((p) => p.category === "image");
  const hasVideo = account.some((p) => p.category === "video");
  return !hasImage || !hasVideo;
}

/** 账号列表优先；「常用」仅在显式 includeBuiltin 时并入（默认不并入，避免误当真实开通） */
export function mergeCatalog(params: {
  account: CatalogPick[];
  isJumeng: boolean;
  fetchFailed: boolean;
  manuals: CatalogPick[];
  /** 是否并入聚梦常用清单（未必开通）；默认 false */
  includeBuiltin?: boolean;
}): CatalogPick[] {
  const byId = new Map<string, CatalogPick>();
  const includeBuiltin = Boolean(params.includeBuiltin) && params.isJumeng;
  if (includeBuiltin) {
    for (const b of JUMENG_BUILTIN_CATALOG) byId.set(b.id, b);
  }
  for (const p of params.account) byId.set(p.id, p);
  for (const m of params.manuals) byId.set(m.id, m);
  const cats: LocalModelCategory[] = ["text", "image", "video", "audio", "model3d"];
  return Array.from(byId.values()).sort((a, b) => {
    const d = cats.indexOf(a.category) - cats.indexOf(b.category);
    if (d !== 0) return d;
    if (a.source !== b.source) {
      const order = { account: 0, manual: 1, builtin: 2 };
      return order[a.source] - order[b.source];
    }
    return a.displayName.localeCompare(b.displayName, "zh");
  });
}

export function newManualPick(
  rawName: string,
  category: LocalModelCategory
): CatalogPick | null {
  const id = rawName.trim();
  if (!id) return null;
  return { id, displayName: humanizeModelDisplayName(id), category, source: "manual" };
}

function slugModelName(upstream: string, providerId: string): string {
  const slug = upstream
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return `${slug || "model"}_${providerId.slice(0, 8)}`;
}

export function buildModelFromPick(
  pick: CatalogPick,
  providerId: string,
  existing?: LocalModel
): LocalModel {
  const capsInput = {
    category: pick.category,
    upstreamModel: pick.id,
    displayName: pick.displayName,
  };
  const presets =
    pick.category === "image"
      ? imageAspectPresets(capsInput)
      : pick.category === "video"
        ? videoDurationPresetsForUpstream(capsInput)
        : undefined;
  const description = pick.description || existing?.description;
  if (existing) {
    // 若展示名仍是旧的原始 id，换成可读名；用户手改过的名字保留
    const prevName = (existing.displayName || "").trim();
    const autoNames = new Set(
      [
        existing.upstreamModel,
        pick.id,
        humanizeModelDisplayName(existing.upstreamModel || ""),
        humanizeModelDisplayName(pick.id),
        CREATE_PAGE_DISPLAY_ALIASES[pick.id],
      ]
        .map((x) => (x || "").trim())
        .filter(Boolean)
    );
    const keepCustomName = Boolean(prevName) && !autoNames.has(prevName);
    return {
      ...existing,
      displayName: keepCustomName ? prevName : pick.displayName,
      description: description || existing.description,
      // 分类跟随最新推断（修 ltx/minimax 等误分）；高级设置里可再改
      category: pick.category,
      upstreamModel: pick.id,
      providerId,
      enabled: true,
      mode: existing.mode || "openai_compatible",
      generationPresets: presets || existing.generationPresets,
      canvasCaps: undefined,
    };
  }
  return {
    id: crypto.randomUUID(),
    name: slugModelName(pick.id, providerId),
    displayName: pick.displayName,
    description,
    category: pick.category,
    mode: "openai_compatible",
    providerId,
    upstreamModel: pick.id,
    enabled: true,
    sortOrder: Date.now() % 100000,
    generationPresets: presets,
  };
}

/**
 * 勾选顺序里每一类的第一个 → 填满该类全部画布工具（已有副模型保留）。
 */
export function bindToolsByFirstSelected(
  current: LocalToolModelsMap,
  selectedInOrder: CatalogPick[],
  models: LocalModel[]
): LocalToolModelsMap {
  const firstName: Partial<Record<LocalModelCategory, string>> = {};
  for (const pick of selectedInOrder) {
    if (firstName[pick.category]) continue;
    const found = models.find(
      (m) =>
        m.providerId &&
        m.upstreamModel === pick.id &&
        m.category === pick.category &&
        m.enabled !== false
    );
    if (found) firstName[pick.category] = found.name;
  }
  const next: LocalToolModelsMap = { ...current };
  for (const d of LOCAL_CANVAS_TOOL_DEFS) {
    const name = firstName[d.category];
    if (!name) continue;
    next[d.toolId] = {
      primary: name,
      secondary: next[d.toolId]?.secondary || "",
    };
  }
  return next;
}

export function applySelectedModels(params: {
  provider: LocalProvider;
  selectedInOrder: CatalogPick[];
  allModels: LocalModel[];
}): LocalModel[] {
  const providerId = params.provider.id;
  const selectedIds = new Set(params.selectedInOrder.map((p) => p.id));
  const next = params.allModels.map((m) => {
    if (m.providerId !== providerId) return m;
    const up = (m.upstreamModel || m.name || "").trim();
    if (selectedIds.has(up)) return { ...m, enabled: true };
    return { ...m, enabled: false };
  });
  for (const pick of params.selectedInOrder) {
    const found = next.find(
      (m) => m.providerId === providerId && (m.upstreamModel || "") === pick.id
    );
    if (found) {
      const idx = next.findIndex((m) => m.id === found.id);
      next[idx] = buildModelFromPick(pick, providerId, found);
    } else {
      next.push(buildModelFromPick(pick, providerId));
    }
  }
  return next;
}

/**
 * 拉取后覆盖：删除该供应商下全部图片/视频模型，再写入本次图+视频清单。
 * 文本/音频模型保留不动。
 */
export function applyOverwriteProviderMediaModels(params: {
  provider: LocalProvider;
  mediaPicks: CatalogPick[];
  allModels: LocalModel[];
}): LocalModel[] {
  const providerId = params.provider.id;
  const kept = params.allModels.filter(
    (m) =>
      m.providerId !== providerId || (m.category !== "image" && m.category !== "video")
  );
  const media = params.mediaPicks.filter(
    (p) => p.category === "image" || p.category === "video"
  );
  const built = media.map((pick, i) => {
    const m = buildModelFromPick(pick, providerId);
    m.sortOrder = i;
    m.enabled = true;
    return m;
  });
  return [...kept, ...built];
}

export function isProviderReady(p: LocalProvider): boolean {
  return Boolean((p.apiKey || "").trim());
}

export function isSetupComplete(providers: LocalProvider[], models: LocalModel[]): boolean {
  return (
    providers.some(isProviderReady) && models.some((m) => m.enabled !== false)
  );
}

export function isJumengProvider(p: LocalProvider): boolean {
  return isJumengaiApiBase(p.apiBase) || /聚梦/.test(p.name);
}
