"use client";

/**
 * 导演台 · 机位胶片条。
 * 以胶片卡片横排展示场景内全部摄像机：最新截图缩略图、机位名、等效焦距。
 * 单击选中机位（第三人称编辑），双击直接进入该机位第一人称取景；末尾「+」卡片新建机位。
 */

import { ImageIcon, Plus, Video } from "lucide-react";
import type { DirectorObject } from "@/types/director-scene";
import { lookupAsset, type Asset } from "@/lib/api/assets";
import { fovToFocalMm } from "./directorUi";

export function DirectorShotStrip({
  cameras,
  selectedId,
  assets,
  onSelect,
  onEnterView,
  onAdd,
}: {
  cameras: DirectorObject[];
  selectedId: string | null;
  assets: Asset[];
  onSelect: (id: string) => void;
  onEnterView: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="pointer-events-auto flex max-w-full items-end gap-2 overflow-x-auto px-1 pb-1 pt-3 [scrollbar-width:thin]">
      {cameras.map((cam, index) => {
        const active = cam.id === selectedId;
        const shots = cam.screenshots ?? [];
        const latest = shots.length ? lookupAsset(assets, shots[shots.length - 1]!.assetId) : undefined;
        return (
          <button
            key={cam.id}
            type="button"
            title="单击选中 · 双击进入机位取景"
            onClick={() => onSelect(cam.id)}
            onDoubleClick={() => onEnterView(cam.id)}
            className={`group relative w-[118px] shrink-0 overflow-hidden rounded-xl border text-left transition-all duration-200 ${
              active
                ? "-translate-y-2 border-amber-300/70 shadow-[0_8px_28px_rgba(251,191,36,0.25)]"
                : "border-white/10 hover:-translate-y-1 hover:border-white/25"
            }`}
          >
            {/* 胶片齿孔 */}
            <div className="flex h-2 items-center justify-between bg-black/70 px-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <span key={i} className="h-1 w-1.5 rounded-[1px] bg-white/15" />
              ))}
            </div>
            <div className="relative aspect-video bg-gradient-to-br from-zinc-800 to-zinc-950">
              {latest?.fileUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latest.fileUrl} alt={cam.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-4 w-4 text-white/15" />
                </div>
              )}
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 font-mono text-[9px] text-amber-200">
                #{String(index + 1).padStart(2, "0")}
              </span>
              {shots.length > 0 ? (
                <span className="absolute right-1 top-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/60">
                  {shots.length}
                </span>
              ) : null}
            </div>
            <div className={`flex items-center gap-1 px-1.5 py-1 ${active ? "bg-amber-400/15" : "bg-black/60"}`}>
              <Video className={`h-3 w-3 shrink-0 ${active ? "text-amber-300" : "text-white/40"}`} />
              <span className="min-w-0 flex-1 truncate text-[10px] text-white/80">{cam.name}</span>
              <span className="shrink-0 font-mono text-[9px] text-white/40">{fovToFocalMm(cam.fov ?? 45)}mm</span>
            </div>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        title="在当前视角新建机位"
        className="flex h-[88px] w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-black/30 text-[10px] text-white/45 transition-colors hover:border-amber-300/50 hover:text-amber-200"
      >
        <Plus className="h-4 w-4" />
        机位
      </button>
    </div>
  );
}
