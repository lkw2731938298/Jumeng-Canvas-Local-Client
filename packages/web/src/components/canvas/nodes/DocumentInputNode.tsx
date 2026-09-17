"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { FileText, Globe, Loader2, Upload } from "lucide-react";
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

/** 画布文档/链接节点：上传多格式文档（单文件），或填写网页网址 */
export const DocumentInputNode = memo(function DocumentInputNode(props: NodeProps) {
  const nodeId = props.id;
  const data = props.data as WorkflowNodeData;
  const params = data.params ?? {};
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const resourceKind = String(params.resourceKind || "file") === "link" ? "link" : "file";
  const fileName = String(params.fileName || "").trim();
  const linkUrl = String(params.linkUrl || "").trim();
  const fileUrl = String(params.fileUrl || "").trim();
  const [linkDraft, setLinkDraft] = useState(linkUrl);
  const anchorRef = useRef<HTMLDivElement>(null);
  const pendingFileNameRef = useRef("");

  useEffect(() => {
    setLinkDraft(linkUrl);
  }, [linkUrl]);

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
    (kind: "file" | "link") => {
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

  const displayTitle = useMemo(() => {
    if (resourceKind === "link") return linkUrl || "未填写网址";
    return fileName || (fileUrl ? "已上传文档" : "未上传文件");
  }, [resourceKind, linkUrl, fileName, fileUrl]);

  return (
    <BaseNode
      {...props}
      data={data}
      icon="FileText"
      color="#a78bfa"
      status={data.status ?? "idle"}
    >
      <div ref={anchorRef} className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex shrink-0 gap-1 rounded-lg bg-white/5 p-0.5">
          <button
            type="button"
            className={cn(
              "nodrag nopan flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px]",
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
              "nodrag nopan flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px]",
              resourceKind === "link"
                ? "bg-violet-500/30 text-white"
                : "text-white/50 hover:text-white/80"
            )}
            onClick={() => setKind("link")}
          >
            <Globe className="h-3 w-3" />
            网址
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
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <input
              type="url"
              value={linkDraft}
              placeholder="https://example.com/page"
              className="nodrag nopan w-full rounded-lg border border-white/15 bg-black/20 px-2 py-1.5 text-[11px] text-white/90 outline-none placeholder:text-white/30 focus:border-violet-400/50"
              onChange={(e) => setLinkDraft(e.target.value)}
              onBlur={commitLink}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLink();
                }
              }}
            />
            <p className="line-clamp-2 break-all text-[10px] text-white/40" title={linkUrl}>
              {linkUrl ? "已保存网址，可连到视频节点作参考" : "填写网页地址后失焦或回车保存"}
            </p>
          </div>
        )}
      </div>
    </BaseNode>
  );
});
