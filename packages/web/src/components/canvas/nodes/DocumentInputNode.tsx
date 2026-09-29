"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { NodeProps } from "@xyflow/react";
import {
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { BaseNode } from "./BaseNode";
import type { WorkflowNodeData } from "@/types/workflow";
import { useCanvasStore } from "@/stores/canvasStore";
import { useMediaUpload } from "./useMediaUpload";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_FORMAT_HINT,
  validateDocumentFile,
} from "@/lib/canvas/documentUploadPolicy";
import {
  getDocumentLinkPreviewNodeId,
  setDocumentLinkPreviewNodeId,
  subscribeDocumentLinkPreview,
} from "@/lib/canvas/documentLinkPreview";

/** 预览态推荐尺寸（unbounded，可超过普通节点上限） */
const PREVIEW_WIDTH = 520;
const PREVIEW_HEIGHT = 560;
/** 嵌入失败无法可靠探测，超时后提示用户可新标签打开 */
const EMBED_HINT_MS = 3500;

function normalizeHttpUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[\w.-]+/.test(value)) return `https://${value}`;
  return value;
}

function isLikelyHttpUrl(raw: string): boolean {
  try {
    const u = new URL(normalizeHttpUrl(raw));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function openInNewTab(url: string) {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/** 画布文档/链接节点：上传多格式文档（单文件），或填写网页网址并内嵌预览 */
export const DocumentInputNode = memo(function DocumentInputNode(props: NodeProps) {
  const nodeId = props.id;
  const data = props.data as WorkflowNodeData;
  const params = useMemo(
    () => (data.params ?? {}) as Record<string, unknown>,
    [data.params]
  );
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeSize = useCanvasStore((s) => s.updateNodeSize);
  const rawKind = String(params.resourceKind || "file");
  const resourceKind: "file" | "link" | "html" =
    rawKind === "link" ? "link" : rawKind === "html" ? "html" : "file";
  const fileName = String(params.fileName || "").trim();
  const linkUrl = String(params.linkUrl || "").trim();
  const fileUrl = String(params.fileUrl || "").trim();
  const htmlContent = String(params.htmlContent || "").trim();
  const [linkDraft, setLinkDraft] = useState(linkUrl);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [showEmbedHint, setShowEmbedHint] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const pendingFileNameRef = useRef("");
  /** 进入预览前的节点尺寸，关闭时还原 */
  const sizeBeforePreviewRef = useRef<{ width: number; height: number } | null>(null);

  const previewOpen = useSyncExternalStore(
    subscribeDocumentLinkPreview,
    () => getDocumentLinkPreviewNodeId() === nodeId,
    () => false
  );

  useEffect(() => {
    setLinkDraft(linkUrl);
  }, [linkUrl]);

  // 切到文件模式或清空可预览内容时关闭预览
  useEffect(() => {
    const canPreview =
      (resourceKind === "link" && !!linkUrl) || (resourceKind === "html" && !!htmlContent);
    if (!canPreview) {
      if (getDocumentLinkPreviewNodeId() === nodeId) {
        setDocumentLinkPreviewNodeId(null);
      }
    }
  }, [resourceKind, linkUrl, htmlContent, nodeId]);

  // 预览开关：放大节点 / 还原尺寸；提示计时
  useEffect(() => {
    if (!previewOpen) {
      setIframeLoading(false);
      setShowEmbedHint(false);
      const prev = sizeBeforePreviewRef.current;
      if (prev) {
        updateNodeSize(nodeId, prev.width, prev.height, true);
        sizeBeforePreviewRef.current = null;
      }
      return;
    }
    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!sizeBeforePreviewRef.current && node) {
      sizeBeforePreviewRef.current = {
        width: Number(node.width) || 280,
        height: Number(node.height) || 200,
      };
    }
    updateNodeSize(nodeId, PREVIEW_WIDTH, PREVIEW_HEIGHT, true);
    setIframeLoading(true);
    setShowEmbedHint(false);
    const t = window.setTimeout(() => setShowEmbedHint(true), EMBED_HINT_MS);
    return () => window.clearTimeout(t);
  }, [previewOpen, nodeId, updateNodeSize, linkUrl, htmlContent]);

  const mergeParamsUpdate = useCallback(
    (id: string, next: Partial<WorkflowNodeData>) => {
      const current =
        useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.params || {};
      const incoming = (next.params || {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = {
        ...current,
        ...incoming,
        resourceKind: "file",
        linkUrl: "",
      };
      if (pendingFileNameRef.current) {
        merged.fileName = pendingFileNameRef.current;
        pendingFileNameRef.current = "";
      }
      updateNodeData(id, { ...next, params: merged });
    },
    [updateNodeData]
  );

  const {
    inputRef,
    handleUpload,
    handleFileChange: baseFileChange,
    uploading,
    accept,
  } = useMediaUpload(
    {
      urlParamKey: "fileUrl",
      accept: DOCUMENT_FILE_ACCEPT,
      category: "document",
    },
    nodeId,
    mergeParamsUpdate,
    anchorRef
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // 单次仅 1 个文件：input 无 multiple；此处再兜底
      if (e.target.files && e.target.files.length > 1) {
        toast.error("单次仅可上传 1 个文档文件");
        e.target.value = "";
        return;
      }
      if (file) {
        const err = await validateDocumentFile(file);
        if (err) {
          toast.error(err);
          e.target.value = "";
          return;
        }
      }
      pendingFileNameRef.current = file?.name?.trim() || "";
      await baseFileChange(e);
    },
    [baseFileChange]
  );

  const setKind = useCallback(
    (kind: "file" | "link" | "html") => {
      if (kind === "file" && getDocumentLinkPreviewNodeId() === nodeId) {
        setDocumentLinkPreviewNodeId(null);
      }
      updateNodeData(nodeId, {
        params: {
          ...params,
          resourceKind: kind,
        },
      });
    },
    [nodeId, params, updateNodeData]
  );

  const commitLink = useCallback(() => {
    const normalized = normalizeHttpUrl(linkDraft);
    if (!normalized) {
      if (getDocumentLinkPreviewNodeId() === nodeId) {
        setDocumentLinkPreviewNodeId(null);
      }
      updateNodeData(nodeId, {
        params: {
          ...params,
          resourceKind: "link",
          linkUrl: "",
          fileUrl: "",
          fileName: "",
          assetId: "",
        },
      });
      return;
    }
    if (!isLikelyHttpUrl(normalized)) {
      toast.error("请输入有效的 http(s) 网址");
      return;
    }
    updateNodeData(nodeId, {
      params: {
        ...params,
        resourceKind: "link",
        linkUrl: normalized,
        fileUrl: "",
        fileName: "",
        assetId: "",
      },
    });
    setLinkDraft(normalized);
  }, [linkDraft, nodeId, params, updateNodeData]);

  const togglePreview = useCallback(() => {
    if (resourceKind === "html") {
      if (!htmlContent) {
        toast.message("还没有 HTML 内容，可让 AI 助手用「做网页」生成");
        return;
      }
      if (previewOpen) {
        setDocumentLinkPreviewNodeId(null);
        return;
      }
      setDocumentLinkPreviewNodeId(nodeId);
      return;
    }
    const url = linkUrl || normalizeHttpUrl(linkDraft);
    if (!url || !isLikelyHttpUrl(url)) {
      toast.message("请先填写并保存有效网址");
      return;
    }
    if (!linkUrl) commitLink();
    if (previewOpen) {
      setDocumentLinkPreviewNodeId(null);
      return;
    }
    setDocumentLinkPreviewNodeId(nodeId);
  }, [resourceKind, htmlContent, linkUrl, linkDraft, previewOpen, nodeId, commitLink]);

  const displayTitle = useMemo(() => {
    if (resourceKind === "link") return linkUrl || "未填写网址";
    if (resourceKind === "html") return fileName || (htmlContent ? "本地 HTML 预览" : "未生成网页");
    return fileName || (fileUrl ? "已上传文档" : "未上传文件");
  }, [resourceKind, linkUrl, fileName, fileUrl, htmlContent]);

  return (
    <BaseNode
      {...props}
      data={data}
      icon="FileText"
      color="#a78bfa"
      status={data.status ?? "idle"}
      unboundedResize={previewOpen}
    >
      <div ref={anchorRef} className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-1 rounded-lg bg-white/5 p-0.5">
          <button
            type="button"
            className={cn(
              "nodrag nopan flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px]",
              resourceKind === "file"
                ? "bg-violet-500/30 text-white"
                : "text-white/50 hover:text-white/80"
            )}
            onClick={() => setKind("file")}
          >
            <FileText className="h-3 w-3" />
            文件
          </button>
          <button
            type="button"
            className={cn(
              "nodrag nopan flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px]",
              resourceKind === "link"
                ? "bg-violet-500/30 text-white"
                : "text-white/50 hover:text-white/80"
            )}
            onClick={() => setKind("link")}
          >
            <Globe className="h-3 w-3" />
            网址
          </button>
          <button
            type="button"
            className={cn(
              "nodrag nopan flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-[11px]",
              resourceKind === "html"
                ? "bg-violet-500/30 text-white"
                : "text-white/50 hover:text-white/80"
            )}
            onClick={() => setKind("html")}
            title="AI 生成的静态 HTML"
          >
            HTML
          </button>
        </div>

        {resourceKind === "file" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="line-clamp-2 break-all text-xs text-white/75" title={displayTitle}>
              {displayTitle}
            </p>
            <p className="text-[10px] leading-snug text-white/35">{DOCUMENT_FORMAT_HINT}</p>
            <button
              type="button"
              className="nodrag nopan mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] text-white/80 hover:bg-white/10"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {fileUrl ? "重新上传" : "上传文档"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        ) : resourceKind === "html" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="line-clamp-2 break-all text-xs text-white/75" title={displayTitle}>
              {displayTitle}
            </p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className={cn(
                  "nodrag nopan inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px]",
                  previewOpen
                    ? "border-violet-400/50 bg-violet-500/25 text-white"
                    : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                )}
                onClick={togglePreview}
                disabled={!htmlContent}
                title={previewOpen ? "关闭预览" : "预览生成的 HTML"}
              >
                {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {previewOpen ? "关闭预览" : "预览"}
              </button>
            </div>
            {previewOpen && htmlContent ? (
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                <iframe
                  key={htmlContent.slice(0, 80)}
                  title="HTML 预览"
                  srcDoc={htmlContent}
                  className="nodrag nopan h-full w-full bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms"
                  onLoad={() => setIframeLoading(false)}
                />
              </div>
            ) : (
              <p className="text-[10px] text-white/40">
                {htmlContent
                  ? `已保存约 ${Math.max(1, Math.round(htmlContent.length / 1024))} KB HTML，点预览查看`
                  : "可让 AI 助手生成静态网页后自动写入此处"}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <input
              type="url"
              value={linkDraft}
              placeholder="https://example.com/page"
              className="nodrag nopan w-full shrink-0 rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-[11px] text-white/90 outline-none placeholder:text-white/30 focus:border-violet-400/50"
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={commitLink}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLink();
                }
              }}
            />

            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className={cn(
                  "nodrag nopan inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px]",
                  previewOpen
                    ? "border-violet-400/50 bg-violet-500/25 text-white"
                    : "border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                )}
                onClick={togglePreview}
                disabled={!linkUrl && !linkDraft.trim()}
                title={previewOpen ? "关闭内嵌预览" : "在节点内嵌预览网页"}
              >
                {previewOpen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {previewOpen ? "关闭预览" : "预览"}
              </button>
              <button
                type="button"
                className="nodrag nopan inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-40"
                disabled={!linkUrl}
                title="在浏览器新标签打开"
                onClick={() => linkUrl && openInNewTab(linkUrl)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                新标签
              </button>
            </div>

            {previewOpen && linkUrl ? (
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                {iframeLoading ? (
                  <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-black/40 text-[11px] text-white/70">
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    加载网页…
                  </div>
                ) : null}
                {/* 第三方页可能禁止嵌入；sandbox 限制脚本危害面，仍允许基础展示 */}
                <iframe
                  key={linkUrl}
                  title="网页预览"
                  src={linkUrl}
                  className="nodrag nopan h-full w-full bg-white"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  referrerPolicy="no-referrer-when-downgrade"
                  onLoad={() => setIframeLoading(false)}
                />
                {showEmbedHint ? (
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 z-[2] rounded-md border border-amber-500/40 bg-black/80 px-2 py-1.5 text-[10px] leading-snug text-amber-100/90">
                    若预览空白，该网站可能禁止嵌入。
                    <button
                      type="button"
                      className="nodrag nopan ml-1 underline hover:text-white"
                      onClick={() => openInNewTab(linkUrl)}
                    >
                      新标签打开
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="line-clamp-2 break-all text-[10px] text-white/40" title={linkUrl}>
                {linkUrl
                  ? "已保存网址。可点「预览」内嵌打开，或作视频参考连线。"
                  : "填写网页地址后失焦或回车保存"}
              </p>
            )}
          </div>
        )}
      </div>
    </BaseNode>
  );
});
