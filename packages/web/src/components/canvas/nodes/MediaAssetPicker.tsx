"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Image, Video, Music } from "lucide-react";
import { AssetThumbnail } from "@/components/canvas/panels/AssetThumbnail";
import { fetchAssets, type Asset, type AssetCategory } from "@/lib/api/assets";
import { useCanvasStore } from "@/stores/canvasStore";

const IMAGE_SUBS = ["人物", "场景", "物品", "风格", "素材"];

interface MediaAssetPickerProps {
  category: AssetCategory;
  onSelect: (asset: Asset) => void;
  onClose: () => void;
  /** 画板等高层弹窗内使用时提高层级 */
  overlayZIndex?: number;
}

export function MediaAssetPicker({
  category,
  onSelect,
  onClose,
  overlayZIndex = 60,
}: MediaAssetPickerProps) {
  const projectId = useCanvasStore((s) => s.projectId);
  const [subcategory, setSubcategory] = useState<string | null>(category === "image" ? "素材" : null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await fetchAssets({
        projectId,
        category,
        subcategory: category === "image" ? subcategory : null,
      });
      setAssets(list);
    } finally {
      setLoading(false);
    }
  }, [projectId, category, subcategory]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    category === "image" ? "选择图片" : category === "video" ? "选择视频" : "选择音频";

  return (
    <>
      {/* nowheel：弹窗（含资产列表滚动）内滚轮滚动，不被 React Flow 拦去缩放画布 */}
      <div
        className="nowheel fixed inset-0 bg-black/60"
        style={{ zIndex: overlayZIndex }}
        onClick={onClose}
      />
      <div
        className="nowheel fixed left-1/2 top-1/2 w-[520px] max-h-[560px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[rgba(10,10,30,0.98)] shadow-2xl"
        style={{ zIndex: overlayZIndex + 1 }}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-medium text-white/85">{title}</span>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {category === "image" && (
          <div className="flex flex-wrap gap-1 border-b border-white/5 px-4 py-2">
            <button
              type="button"
              onClick={() => setSubcategory(null)}
              className={`rounded px-2 py-1 text-[13px] ${!subcategory ? "bg-white/10 text-white/80" : "text-white/35 hover:text-white/60"}`}
            >
              全部
            </button>
            {IMAGE_SUBS.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setSubcategory(sub)}
                className={`rounded px-2 py-1 text-[13px] ${subcategory === sub ? "bg-white/10 text-white/80" : "text-white/35 hover:text-white/60"}`}
              >
                {sub}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[420px] overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="py-10 text-center text-[13px] text-white/30">加载中...</div>
          ) : assets.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-white/30">暂无资产，请先在资产面板上传</div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => onSelect(asset)}
                  className="group overflow-hidden rounded-lg border border-white/5 bg-white/[0.02] text-left transition-colors hover:border-purple-400/40"
                >
                  <div className="aspect-square overflow-hidden bg-black/30">
                    <AssetThumbnail
                      asset={asset}
                      imgClassName={
                        asset.category === "audio"
                          ? "h-2/3 w-2/3 object-contain opacity-50 mx-auto mt-[12%]"
                          : "h-full w-full object-cover"
                      }
                    />
                  </div>
                  <div className="truncate px-1.5 py-1 text-[10px] text-white/55">{asset.title}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2 text-[10px] text-white/35">
          {category === "image" && <Image className="h-3 w-3" />}
          {category === "video" && <Video className="h-3 w-3" />}
          {category === "audio" && <Music className="h-3 w-3" />}
          点击素材即可应用到节点
        </div>
      </div>
    </>
  );
}
