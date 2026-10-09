/**
 * Agent 网页工具：生成静态 HTML 并落到文档节点，用 iframe srcDoc 预览。
 * srcDoc 页面无法可靠加载同源相对路径，画布素材须内联为 data URL。
 */

import { resolveNodeRef } from "@/lib/canvas/projectAgentCanvasOps";
import { resolveAgentNodePosition } from "@/lib/canvas/agentPlaceNode";
import { setDocumentLinkPreviewNodeId } from "@/lib/canvas/documentLinkPreview";
import { uploadAsset } from "@/lib/api/assets";
import type { LocalChatToolCall } from "@/lib/local/generate";
import { useCanvasStore } from "@/stores/canvasStore";
import type { LocalAgentOpResult } from "../executor";
import { resolveNodeImageUrlAsync } from "./resolveCanvasMedia";
import { parseToolArgs } from "./parseToolArgs";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => str(x)).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  if (s.includes(",")) return s.split(",").map((x) => x.trim()).filter(Boolean);
  return [s];
}

/** 从模型参数里取出完整 HTML（可含 ```html 包裹） */
function extractHtml(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const fenced = /```(?:html|HTML)?\s*\n?([\s\S]*?)```/.exec(t);
  if (fenced?.[1]) return fenced[1].trim();
  return t;
}

function ensureDocumentShell(html: string, title: string): string {
  const body = extractHtml(html);
  if (!body) return "";
  if (/<html[\s>]/i.test(body) || /<!doctype/i.test(body)) return body;
  const safeTitle = title.replace(/[<>&"]/g, "") || "预览页";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.55; color: #1a1a1a; background: #faf9f7; }
  main { max-width: 720px; margin: 0 auto; padding: 28px 20px 48px; }
  h1,h2,h3 { line-height: 1.25; }
  img { max-width: 100%; height: auto; }
  a { color: #0b5fff; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/** 内联后软预算：超过则跳过后续大图，尽量仍能写入预览（约 4.5MB） */
const HTML_EMBED_SOFT_BUDGET = 4_500_000;
/** 硬上限：仍超则失败（浏览器 srcDoc / 工作流 JSON 压力，约 6.5MB） */
const HTML_EMBED_HARD_MAX = 6_500_000;
const HTML_EMBED_MAX_EDGE = 1280;
const HTML_EMBED_JPEG_QUALITY = 0.82;
const HTML_EMBED_MAX_BYTES = 520_000;

/** 把可 fetch 的图片地址转成 data URL（供 srcDoc 预览） */
async function urlToDataUrl(url: string): Promise<string | null> {
  const raw = str(url);
  if (!raw) return null;
  if (raw.startsWith("data:image")) return raw;
  try {
    const res = await fetch(raw);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") && !/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(raw)) {
      // 本机 asset 可能无正确 mime，仍尝试当图读
    }
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const out = String(reader.result || "");
        resolve(out.startsWith("data:") ? out : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 压缩位图 data URL（SVG 原样保留），控制 srcDoc 体积 */
async function compressEmbedDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:image") || dataUrl.startsWith("data:image/svg")) {
    return dataUrl;
  }
  if (typeof document === "undefined") return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("load"));
      el.src = dataUrl;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) return dataUrl;
    const scale = Math.min(1, HTML_EMBED_MAX_EDGE / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    let quality = HTML_EMBED_JPEG_QUALITY;
    let out = canvas.toDataURL("image/jpeg", quality);
    for (let i = 0; i < 4 && out.length > HTML_EMBED_MAX_BYTES * 1.37; i += 1) {
      quality = Math.max(0.45, quality - 0.12);
      if (i >= 2) {
        w = Math.max(320, Math.round(w * 0.75));
        h = Math.max(320, Math.round(h * 0.75));
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
      }
      out = canvas.toDataURL("image/jpeg", quality);
    }
    return out && out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

/**
 * 若 HTML 仍超硬上限，按 data URL 长度从大到小剥离，腾出空间。
 * 返回剥离次数与剩余长度。
 */
function stripLargestDataImages(html: string, budget: number): { html: string; stripped: number } {
  let out = html;
  let stripped = 0;
  while (out.length > budget) {
    const re = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
    let best: { start: number; end: number; len: number } | null = null;
    for (const m of out.matchAll(re)) {
      const start = m.index ?? -1;
      if (start < 0 || !m[0]) continue;
      const len = m[0].length;
      if (!best || len > best.len) best = { start, end: start + len, len };
    }
    if (!best) break;
    out = `${out.slice(0, best.start)}${out.slice(best.end)}`;
    stripped += 1;
  }
  return { html: out, stripped };
}

/**
 * 把 HTML 里的画布素材占位符 / 本机 asset 地址，替换为 data URL，
 * 否则 srcDoc iframe（about:srcdoc）读不到 /api/local/asset。
 */
async function embedCanvasAssetsInHtml(
  html: string,
  opts: { projectId: string; imageNodeIds: string[]; tempMap: Map<string, string> }
): Promise<{ html: string; embedded: number; missing: string[]; skipped: string[]; stripped: number }> {
  let out = html;
  const missing: string[] = [];
  const skipped: string[] = [];
  let embedded = 0;
  const dataByNode = new Map<string, string>();

  const resolveId = (raw: string) =>
    resolveNodeRef(raw, undefined, opts.tempMap) || raw;

  const tryAcceptData = (label: string, data: string): string => {
    if (!data) return "";
    // 已超软预算则不再追加大图，避免撑爆 srcDoc
    if (out.length + data.length > HTML_EMBED_SOFT_BUDGET) {
      skipped.push(label);
      return "";
    }
    return data;
  };

  const ensureData = async (nodeId: string): Promise<string> => {
    const id = resolveId(nodeId);
    if (dataByNode.has(id)) return dataByNode.get(id)!;
    const src = await resolveNodeImageUrlAsync(opts.projectId, id);
    if (!src) {
      missing.push(id);
      dataByNode.set(id, "");
      return "";
    }
    const raw = await urlToDataUrl(src);
    if (!raw) {
      missing.push(id);
      dataByNode.set(id, "");
      return "";
    }
    const data = await compressEmbedDataUrl(raw);
    const accepted = tryAcceptData(id, data);
    dataByNode.set(id, accepted);
    if (accepted) embedded += 1;
    return accepted;
  };

  // 显式传入的图片节点（占位 canvas-asset:0 / canvas-node:id）；助手层不截断
  const ids = opts.imageNodeIds.map(resolveId).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1) {
    const data = await ensureData(ids[i]);
    if (!data) continue;
    const idxRe = new RegExp(`canvas-asset:${i}(?![0-9])`, "gi");
    out = out.replace(idxRe, () => data);
  }

  // 扫 HTML 中的 canvas-node:<id>
  const placeholderIds = new Set<string>();
  for (const m of out.matchAll(/canvas-node:([0-9a-zA-Z_-]+)/gi)) {
    if (m[1]) placeholderIds.add(m[1]);
  }
  for (const id of placeholderIds) {
    const data = await ensureData(id);
    if (!data) continue;
    const re = new RegExp(`canvas-node:${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    out = out.replace(re, () => data);
  }

  // 未写占位符但传了 imageNodeIds：若 HTML 里完全没有 data:image / canvas-，在主区域前插入图
  const hasAnyImg =
    /data:image/i.test(out) || /<img[\s>]/i.test(out) || /canvas-node:/i.test(out);
  if (!hasAnyImg && ids.length) {
    const figs: string[] = [];
    for (const id of ids) {
      const data = await ensureData(id);
      if (!data) continue;
      const node = useCanvasStore.getState().nodes.find((n) => n.id === id);
      const label = String(
        (node?.data as { label?: string } | undefined)?.label || id
      ).replace(/[<>&"]/g, "");
      const fig = `<figure style="margin:16px 0"><img src="${data}" alt="${label}" style="max-width:100%;border-radius:8px"/><figcaption style="font-size:12px;opacity:.7;margin-top:6px">${label}</figcaption></figure>`;
      if (out.length + fig.length > HTML_EMBED_SOFT_BUDGET) {
        skipped.push(id);
        continue;
      }
      figs.push(fig);
    }
    if (figs.length) {
      if (/<\/main>/i.test(out)) {
        out = out.replace(/<\/main>/i, `${figs.join("\n")}</main>`);
      } else if (/<\/body>/i.test(out)) {
        out = out.replace(/<\/body>/i, `${figs.join("\n")}</body>`);
      } else {
        out = `${out}\n${figs.join("\n")}`;
      }
    }
  }

  // 把仍指向本机 /api/local/asset 的 img/src 内联（模型可能直接抄了节点 URL）
  const assetUrls = new Set<string>();
  for (const m of out.matchAll(
    /(?:src|href)=["'](\/api\/local\/asset\?[^"']+)["']/gi
  )) {
    if (m[1]) assetUrls.add(m[1]);
  }
  for (const m of out.matchAll(/\/api\/local\/asset\?projectId=[^\s"'<>]+/gi)) {
    assetUrls.add(m[0]);
  }
  for (const u of assetUrls) {
    const raw = await urlToDataUrl(u);
    if (!raw) continue;
    const data = await compressEmbedDataUrl(raw);
    if (!tryAcceptData(u.slice(0, 48), data)) continue;
    out = out.split(u).join(data);
    embedded += 1;
  }

  let stripped = 0;
  if (out.length > HTML_EMBED_HARD_MAX) {
    const trimmed = stripLargestDataImages(out, HTML_EMBED_SOFT_BUDGET);
    out = trimmed.html;
    stripped = trimmed.stripped;
  }

  return {
    html: out,
    embedded,
    missing: [...new Set(missing)],
    skipped: [...new Set(skipped)],
    stripped,
  };
}

/** web_create_page：写入 HTML 到文档节点并打开预览 */
export async function applyWebCreatePage(
  call: LocalChatToolCall,
  opts?: {
    projectId?: string;
    tempMap?: Map<string, string>;
    /** 用户本轮 @ 的媒体节点，自动并入 imageNodeIds */
    preferReferenceNodeIds?: string[];
  }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const tempMap = opts?.tempMap || new Map<string, string>();
  const projectId = str(opts?.projectId) || str(useCanvasStore.getState().projectId);
  const title = str(a.title) || str(a.label) || "AI 网页";
  let html = ensureDocumentShell(str(a.html) || str(a.content), title);
  if (!html) {
    return { op: call.name, ok: false, message: "缺少 html 内容" };
  }

  const fromArgs = asStringList(
    a.imageNodeIds ?? a.imageNodeId ?? a.referenceNodeIds ?? a.referenceNodeId
  );
  // 模型已点名 imageNodeIds 则尊重；未点名才并入本轮 @
  const imageNodeIds = fromArgs.length
    ? [...new Set(fromArgs.map(str).filter(Boolean))]
    : [...new Set((opts?.preferReferenceNodeIds || []).map(str).filter(Boolean))];

  let embedNote = "";
  if (projectId) {
    const embedded = await embedCanvasAssetsInHtml(html, {
      projectId,
      imageNodeIds,
      tempMap,
    });
    html = embedded.html;
    if (embedded.embedded > 0) {
      embedNote = `，已内联 ${embedded.embedded} 张画布图`;
    }
    if (embedded.missing.length) {
      embedNote += `（未读到图：${embedded.missing.join(", ")}）`;
    }
    if (embedded.skipped.length) {
      embedNote += `（体积限制跳过 ${embedded.skipped.length} 张）`;
    }
    if (embedded.stripped > 0) {
      embedNote += `（已剥离 ${embedded.stripped} 张过大内联图）`;
    }
  }

  if (html.length > HTML_EMBED_HARD_MAX) {
    return {
      op: call.name,
      ok: false,
      message: `HTML 过大（约 ${Math.round(html.length / 1024)} KB，上限约 ${Math.round(HTML_EMBED_HARD_MAX / 1024)} KB）。请减少内联图或缩短页面后再试`,
    };
  }

  let nodeId =
    resolveNodeRef(str(a.nodeId) || str(a.tempId) || undefined, str(a.nodeName) || undefined, tempMap) ||
    "";
  const createIfMissing = a.createIfMissing !== false;
  const alias = str(a.tempId);

  if (!nodeId && createIfMissing) {
    const { x, y } = resolveAgentNodePosition({}, useCanvasStore.getState().nodes);
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNode("document_input", { x, y }, { label: title });
    const created = useCanvasStore.getState().nodes.find((n) => !before.has(n.id));
    nodeId = created?.id || "";
    if (nodeId && alias) tempMap.set(alias, nodeId);
  }
  if (!nodeId) {
    return { op: call.name, ok: false, message: "找不到文档节点且未创建" };
  }

  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const fileName = `${title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40) || "page"}.html`;

  // 同步写入项目「资产 → 文档」，便于素材库下载与复用
  let assetId = "";
  let fileUrl = "";
  let assetNote = "";
  if (projectId) {
    try {
      const file = new File([html], fileName, { type: "text/html;charset=utf-8" });
      const asset = await uploadAsset({
        file,
        projectId,
        category: "document",
        title: title || "AI 网页",
      });
      assetId = asset.id;
      fileUrl = asset.fileUrl;
      assetNote = "，已存入资产文档";
    } catch (err) {
      assetNote = `（资产入库失败：${err instanceof Error ? err.message : String(err)}）`;
    }
  }

  useCanvasStore.getState().updateNodeData(nodeId, {
    label: title || String(node?.data?.label || "网页"),
    params: {
      ...((node?.data?.params as Record<string, unknown>) || {}),
      resourceKind: "html",
      htmlContent: html,
      linkUrl: "",
      fileUrl,
      fileName,
      assetId,
    },
  });
  useCanvasStore.getState().scheduleAutoSave();

  const openPreview = a.openPreview !== false;
  if (openPreview) setDocumentLinkPreviewNodeId(nodeId);

  return {
    op: call.name,
    ok: true,
    message: openPreview
      ? `已写入 HTML 并打开预览（约 ${Math.round(html.length / 1024)} KB${embedNote}${assetNote}）`
      : `已写入 HTML（约 ${Math.round(html.length / 1024)} KB${embedNote}${assetNote}）`,
    nodeId,
  };
}

/** web_open_preview：打开文档节点预览（网址或 HTML） */
export async function applyWebOpenPreview(
  call: LocalChatToolCall,
  opts?: { tempMap?: Map<string, string> }
): Promise<LocalAgentOpResult> {
  const parsed = parseToolArgs(call.arguments);
  if (parsed.error) return { op: call.name, ok: false, message: parsed.error };
  const a = parsed.args;
  const tempMap = opts?.tempMap || new Map<string, string>();
  const nodeId =
    resolveNodeRef(
      str(a.nodeId) || str(a.tempId) || undefined,
      str(a.nodeName) || undefined,
      tempMap
    ) || "";
  if (!nodeId) {
    return { op: call.name, ok: false, message: "找不到节点" };
  }
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const params = ((node?.data as { params?: Record<string, unknown> } | undefined)?.params ||
    {}) as Record<string, unknown>;
  const kind = str(params.resourceKind);
  const hasHtml = Boolean(str(params.htmlContent));
  const hasLink = Boolean(str(params.linkUrl));
  if (kind !== "html" && kind !== "link" && !hasHtml && !hasLink) {
    return {
      op: call.name,
      ok: false,
      message: "该节点没有可预览的网址或 HTML，请先用 web_create_page 或 canvas_set_document_link",
      nodeId,
    };
  }
  setDocumentLinkPreviewNodeId(nodeId);
  return { op: call.name, ok: true, message: "已打开预览", nodeId };
}
