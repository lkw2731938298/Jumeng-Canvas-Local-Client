/** 文档/链接节点与素材面板：统一上传白名单与限制文案 */

/** 单文件大小上限 100MB */
export const CANVAS_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
export const CANVAS_DOCUMENT_MAX_SIZE_LABEL = "100MB";

/** 页数上限（后端权威校验；前端 PDF 可做预检） */
export const CANVAS_DOCUMENT_MAX_PAGES = 50;

export const DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "md",
  "txt",
  "key",
  "pages",
  "numbers",
] as const;

/** `<input accept>`：扩展名 + 常见 MIME */
export const DOCUMENT_FILE_ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".md",
  ".txt",
  ".key",
  ".pages",
  ".numbers",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/vnd.apple.keynote",
  "application/x-iwork-keynote-sffkey",
  "application/vnd.apple.pages",
  "application/x-iwork-pages-sffpages",
  "application/vnd.apple.numbers",
  "application/x-iwork-numbers-sffnumbers",
].join(",");

export const DOCUMENT_FORMAT_HINT =
  "支持 doc/docx、xls/xlsx、ppt/pptx、pdf、md、txt、key、pages、numbers；单文件≤100MB、≤50页；网页请用「网址」";

const DOCUMENT_EXT_SET = new Set<string>(DOCUMENT_EXTENSIONS);

const DOCUMENT_MIME_PREFIXES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/vnd.apple.",
  "application/x-iwork-",
] as const;

export function isDocumentFileName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return DOCUMENT_EXT_SET.has(ext);
}

export function isDocumentMime(mime: string): boolean {
  const m = (mime || "").toLowerCase();
  if (!m) return false;
  return DOCUMENT_MIME_PREFIXES.some((p) => m === p || m.startsWith(p));
}

/** 轻量 PDF 页数预检（与后端正则策略一致）；非 PDF 或解析失败返回 null */
export async function estimatePdfPageCount(file: File): Promise<number | null> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "pdf") return null;
  try {
    const buf = await file.arrayBuffer();
    const text = new TextDecoder("latin1").decode(buf);
    const matches = text.match(/\/Type\s*\/Page(?!\s*s)\b/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

/** 前端上传前校验：大小、扩展名、可选 PDF 页数；失败返回中文原因 */
export async function validateDocumentFile(file: File): Promise<string | null> {
  if (file.size > CANVAS_DOCUMENT_MAX_BYTES) {
    return `文档不能超过 ${CANVAS_DOCUMENT_MAX_SIZE_LABEL}`;
  }
  const extOk = isDocumentFileName(file.name);
  const mimeOk = isDocumentMime(file.type);
  if (!extOk && !mimeOk) {
    return "不支持的文档格式";
  }
  const pages = await estimatePdfPageCount(file);
  if (pages != null && pages > CANVAS_DOCUMENT_MAX_PAGES) {
    return `文档不能超过 ${CANVAS_DOCUMENT_MAX_PAGES} 页（当前约 ${pages} 页）`;
  }
  return null;
}
