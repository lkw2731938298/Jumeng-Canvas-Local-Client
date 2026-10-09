"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { X, Upload, Trash2, Image, Video, Music, FileText, Download } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AssetThumbnail, assetDragPreviewElement } from "@/components/canvas/panels/AssetThumbnail";
import { uploadAsset, projectAssetsKey, deleteAsset, type Asset } from "@/lib/api/assets";
import { setAssetDragData } from "@/lib/canvas/assetDrag";
import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_FORMAT_HINT,
  validateDocumentFile,
} from "@/lib/canvas/documentUploadPolicy";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";

const CATEGORIES = [
  { key: "image", label: "图片", icon: <Image className="h-3.5 w-3.5" /> },
  { key: "video", label: "视频", icon: <Video className="h-3.5 w-3.5" /> },
  { key: "audio", label: "音频", icon: <Music className="h-3.5 w-3.5" /> },
  { key: "document", label: "文档", icon: <FileText className="h-3.5 w-3.5" /> },
] as const;

const IMAGE_SUBS = ["人物","场景","物品","风格","素材"];

const GRID_COLS = 4;
const ROW_HEIGHT = 132;
const ROW_GAP = 8;

const FILE_ACCEPT: Record<string, string> = {
  image: "image/jpeg,image/png,image/gif,image/webp,image/bmp,image/svg+xml",
  video: "video/mp4,video/webm,video/quicktime,.mov,.avi,.mkv",
  audio: "audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,audio/aac,.mp3,.m4a,.wav,.flac,.ogg",
  document: DOCUMENT_FILE_ACCEPT,
};

export function AssetPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const params = useParams<{ id: string }>();
  const projectId = params.id || "";
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<string>("image");
  const [subcategory, setSubcategory] = useState<string|null>(null);
  const [uploading, setUploading] = useState(false);
  const [draggingAsset, setDraggingAsset] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(360);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { assets: manifest, isLoading, isFetching } = useProjectAssetManifest(isOpen ? projectId : "");

  const assets = useMemo(() => {
    let list = manifest;
    if (category) list = list.filter((a) => a.category === category);
    if (category === "image" && subcategory) {
      list = list.filter((a) => a.subcategory === subcategory);
    }
    return list;
  }, [manifest, category, subcategory]);

  const loading = isOpen && (isLoading || isFetching) && manifest.length === 0;
  const canUpload = category !== "image" || subcategory !== null;

  const rowCount = Math.ceil(assets.length / GRID_COLS);
  const totalHeight = rowCount > 0 ? rowCount * (ROW_HEIGHT + ROW_GAP) - ROW_GAP : 0;
  const startRow = Math.max(0, Math.floor(scrollTop / (ROW_HEIGHT + ROW_GAP)) - 1);
  const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / (ROW_HEIGHT + ROW_GAP)) + 2);
  const visibleAssets = useMemo(
    () => assets.slice(startRow * GRID_COLS, endRow * GRID_COLS),
    [assets, startRow, endRow]
  );
  const paddingTop = startRow * (ROW_HEIGHT + ROW_GAP);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isOpen) return;
    const measure = () => setViewportHeight(el.clientHeight || 360);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, assets.length, category, subcategory]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 文档分类：单次 1 个、大小/格式/页数预检
    if (category === "document") {
      if (e.target.files && e.target.files.length > 1) {
        toast.error("单次仅可上传 1 个文档文件");
        e.target.value = "";
        return;
      }
      const err = await validateDocumentFile(file);
      if (err) {
        toast.error(err);
        e.target.value = "";
        return;
      }
    }
    setUploading(true);
    try {
      await uploadAsset({
        file,
        projectId,
        category: category as Asset["category"],
        subcategory,
      });
      await queryClient.invalidateQueries({ queryKey: projectAssetsKey(projectId) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAsset(projectId, id);
      await queryClient.invalidateQueries({ queryKey: projectAssetsKey(projectId) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  /** 从资产面板下载文件（文档 HTML 等） */
  const handleDownloadAsset = async (a: Asset) => {
    try {
      if (!a.fileUrl) {
        toast.message("该素材无可下载地址");
        return;
      }
      const res = await fetch(a.fileUrl);
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
      const blob = await res.blob();
      const ext =
        a.fileType?.includes("html") || /\.html?$/i.test(a.title)
          ? ".html"
          : "";
      const name = /\.[a-z0-9]+$/i.test(a.title) ? a.title : `${a.title || "asset"}${ext}`;
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = name;
      el.rel = "noopener";
      document.body.appendChild(el);
      el.click();
      el.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const acceptTypes = FILE_ACCEPT[category] || "";

  if (!isOpen) return null;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 ${draggingAsset ? "pointer-events-none" : ""}`}
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
        <div
          className="flex w-[600px] max-h-[640px] flex-col rounded-xl"
          style={{ background:"rgba(10,10,30,0.97)", backdropFilter:"blur(32px)", WebkitBackdropFilter:"blur(32px)", border:"1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-sm font-medium text-white/80">资产</span>
            <button onClick={onClose} className="text-white/40 hover:text-white"><X className="h-4 w-4"/></button>
          </div>

          <div className="flex gap-0.5 border-b border-white/5 px-4 py-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => { setCategory(c.key); setSubcategory(null); }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  category === c.key ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {c.icon}{c.label}
              </button>
            ))}
          </div>

          {category === "image" && (
            <div className="flex gap-1 border-b border-white/5 px-4 py-1.5">
              <button onClick={() => setSubcategory(null)}
                className={`rounded px-2 py-1 text-[11px] transition-colors ${!subcategory?"bg-white/10 text-white/80":"text-white/35 hover:text-white/60"}`}>
                全部
              </button>
              {IMAGE_SUBS.map((sub) => (
                <button key={sub} onClick={() => setSubcategory(sub)}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${subcategory===sub?"bg-white/10 text-white/80":"text-white/35 hover:text-white/60"}`}>
                  {sub}
                </button>
              ))}
            </div>
          )}

          {canUpload && (
            <div className="px-4 py-2">
              <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 py-2 text-xs text-white/40 transition-colors hover:border-white/30 hover:text-white/70 ${uploading?"opacity-50 pointer-events-none":""}`}>
                <Upload className="h-3.5 w-3.5" />
                {uploading?"上传中...":"上传素材"}
                <input ref={fileRef} type="file" accept={acceptTypes} onChange={handleUpload} className="hidden" />
              </label>
              {category === "document" ? (
                <p className="mt-1.5 text-[10px] leading-snug text-white/30">{DOCUMENT_FORMAT_HINT}</p>
              ) : null}
            </div>
          )}

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto px-4 pb-4"
          >
            {loading ? (
              <div className="py-8 text-center text-xs text-white/25">加载中...</div>
            ) : assets.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/25">暂无素材</div>
            ) : (
              <div style={{ height: totalHeight, position: "relative" }}>
                <div
                  className="grid grid-cols-4 gap-2 absolute inset-x-0"
                  style={{ top: paddingTop }}
                >
                {visibleAssets.map((a) => (
                  <div
                    key={a.id}
                    draggable
                    onDragStart={(e) => {
                      setAssetDragData(e.dataTransfer, a);
                      setDraggingAsset(true);
                      const preview = assetDragPreviewElement(e.currentTarget);
                      if (preview) e.dataTransfer.setDragImage(preview, 40, 40);
                    }}
                    onDragEnd={() => setDraggingAsset(false)}
                    className="group relative flex cursor-grab flex-col rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden transition-colors hover:border-purple-400/30 active:cursor-grabbing"
                    title="拖到画布创建节点"
                  >
                    <div className="aspect-square flex items-center justify-center bg-black/20 pointer-events-none overflow-hidden">
                      <AssetThumbnail asset={a} />
                    </div>
                    <div className="flex items-center justify-between gap-0.5 px-1.5 py-1">
                      <span className="text-[10px] text-white/60 truncate flex-1">{a.title}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownloadAsset(a);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="text-white/15 hover:text-white/70 opacity-0 group-hover:opacity-100 transition-all"
                        title="下载"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id)}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="text-white/15 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
