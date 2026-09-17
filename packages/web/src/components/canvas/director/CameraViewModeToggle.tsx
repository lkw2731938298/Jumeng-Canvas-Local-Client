"use client";

import { Eye, Move3d } from "lucide-react";
import type { CameraPropViewMode } from "@/types/director-scene";

export function CameraViewModeToggle({
  mode,
  onChange,
}: {
  mode: CameraPropViewMode;
  onChange: (mode: CameraPropViewMode) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] text-white/45">观察模式</span>
      <div className="flex gap-1 rounded-lg border border-white/10 bg-black/20 p-0.5">
        <button
          type="button"
          onClick={() => onChange("firstPerson")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] transition-colors ${
            mode === "firstPerson"
              ? "bg-amber-500/25 text-amber-100"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          <Eye className="h-3 w-3" />
          摄像机视角
        </button>
        <button
          type="button"
          onClick={() => onChange("thirdPerson")}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] transition-colors ${
            mode === "thirdPerson"
              ? "bg-indigo-500/25 text-indigo-100"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          <Move3d className="h-3 w-3" />
          第三人称
        </button>
      </div>
      <p className="text-[9px] leading-relaxed text-white/30">
        {mode === "firstPerson"
          ? "主视口为镜头画面；可在右侧调整朝向与 FOV。"
          : "轨道控制自由观察，可拖动造具移动机位。"}
      </p>
    </div>
  );
}
