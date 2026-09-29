"use client";

/**
 * 导演台 · 浮动导演监视器（画中画）。
 * 选中摄像机时出现：实时显示该机位取景（R3F View 追踪中间透明区域）、FOV / 等效焦距、
 * 三分线；底部提供「拍摄」与「第一/第三人称」切换。
 *
 * 取景约束：
 * - track 必须保持透明，全屏 Canvas（z-25）的 View 才能透出；
 * - 父级不能设不透明背景（会盖住透明子元素，画面全黑）；
 * - 切换画幅后 View scissor 变小，旧帧会残留在两侧 → 用超大 box-shadow
 *   做信箱遮罩（overflow:hidden 裁切），既挡鬼影又不挡 track。
 */

/** 取景区容器固定高度（px），画幅在此信箱内 contain 适配 */
const TRACK_SLOT_HEIGHT = 240;
/** 与顶栏/底栏一致的不透明底色 */
const MONITOR_CHROME = "rgb(12,12,20)";

import type { RefObject } from "react";
import { Camera, Eye, Loader2, Move3d, X } from "lucide-react";
import type { CameraPropViewMode, DirectorAspectRatio, DirectorObject } from "@/types/director-scene";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import { fovToFocalMm } from "./directorUi";

export function DirectorLensMonitor({
  camera,
  trackRef,
  aspectRatio,
  viewMode,
  capturing,
  onViewModeChange,
  onCapture,
  onClose,
}: {
  camera: DirectorObject;
  trackRef: RefObject<HTMLDivElement | null>;
  aspectRatio: DirectorAspectRatio;
  viewMode: CameraPropViewMode;
  capturing: boolean;
  onViewModeChange: (mode: CameraPropViewMode) => void;
  onCapture: () => void;
  onClose: () => void;
}) {
  const fov = camera.fov ?? 45;
  const firstPerson = viewMode === "firstPerson";
  const aspect = aspectRatioToNumber(aspectRatio);

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.55)] ring-1 ring-white/15">
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: MONITOR_CHROME }}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/85">{camera.name}</span>
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
          {fovToFocalMm(fov)}mm
        </span>
        <span className="font-mono text-[10px] text-white/35">FOV {Math.round(fov)}°</span>
        <button
          type="button"
          onClick={onClose}
          title="取消选中"
          className="flex h-5 w-5 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* 槽本身无背景；track 透明透出 Canvas；box-shadow 信箱挡旧帧鬼影 */}
      <div
        className="relative flex w-full items-center justify-center overflow-hidden"
        style={{ height: TRACK_SLOT_HEIGHT }}
      >
        <div
          ref={trackRef}
          className="pointer-events-none relative bg-transparent"
          style={{
            aspectRatio: aspect,
            width: `min(100%, ${Math.round(TRACK_SLOT_HEIGHT * aspect)}px)`,
            maxHeight: TRACK_SLOT_HEIGHT,
            // 向外铺开的不透明阴影 = 信箱条；父级 overflow:hidden 裁掉多余部分
            boxShadow: `0 0 0 9999px ${MONITOR_CHROME}`,
          }}
        >
          <span className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
          <span className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
          <span className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
          <span className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
          <span className="absolute bottom-1.5 left-2 font-mono text-[9px] tracking-wider text-white/60 [text-shadow:0_1px_2px_#000]">
            {aspectRatio}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 p-2" style={{ background: MONITOR_CHROME }}>
        <div className="flex flex-1 rounded-lg bg-white/[0.05] p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange("thirdPerson")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[10px] transition-colors ${
              !firstPerson ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80"
            }`}
          >
            <Move3d className="h-3 w-3" />
            摆机位
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("firstPerson")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[10px] transition-colors ${
              firstPerson ? "bg-amber-400/25 text-amber-100" : "text-white/45 hover:text-white/80"
            }`}
          >
            <Eye className="h-3 w-3" />
            进机位
          </button>
        </div>
        <button
          type="button"
          disabled={capturing}
          onClick={onCapture}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-red-500 to-rose-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg shadow-red-500/20 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          拍摄
        </button>
      </div>
    </div>
  );
}
