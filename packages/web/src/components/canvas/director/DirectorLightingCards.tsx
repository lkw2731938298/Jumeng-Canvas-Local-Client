"use client";

/**
 * 导演台 · 可视化布光卡片 + 灯组角度调节。
 */

import { Check, RotateCcw } from "lucide-react";
import {
  LIGHTING_PRESETS,
  type DirectorLightingState,
  type LightingPresetId,
} from "@/lib/director/lightingPresets";

export function DirectorLightingCards({
  lighting,
  onPresetChange,
  onAngleChange,
}: {
  lighting: DirectorLightingState;
  onPresetChange: (id: LightingPresetId) => void;
  onAngleChange: (patch: Pick<DirectorLightingState, "yawDeg" | "pitchDeg">) => void;
}) {
  const yaw = lighting.yawDeg ?? 0;
  const pitch = lighting.pitchDeg ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {LIGHTING_PRESETS.map((preset) => {
          const active = preset.id === lighting.preset;
          const base = Math.round(18 + preset.ambient * 60);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPresetChange(preset.id)}
              className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
                active
                  ? "border-indigo-400/60 ring-1 ring-indigo-400/30"
                  : "border-white/[0.08] hover:border-white/25"
              }`}
            >
              <div
                className="relative h-14 overflow-hidden"
                style={{
                  background: `linear-gradient(180deg, rgb(${base},${base},${base + 8}) 0%, rgb(8,8,12) 100%)`,
                }}
              >
                {preset.lights.map((light, i) => {
                  const left = Math.min(92, Math.max(8, ((light.position[0] + 8) / 16) * 100));
                  const top = Math.min(85, Math.max(10, 100 - (light.position[1] / 10) * 100));
                  const size = 18 + light.intensity * 26;
                  return (
                    <span
                      key={i}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full blur-md"
                      style={{
                        left: `${left}%`,
                        top: `${top}%`,
                        width: size,
                        height: size,
                        background: light.color,
                        opacity: Math.min(0.95, 0.35 + light.intensity * 0.4),
                      }}
                    />
                  );
                })}
                <span className="absolute bottom-0 left-1/2 h-7 w-4 -translate-x-1/2 rounded-t-full bg-black/80" />
                <span className="absolute bottom-7 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-black/80" />
                {active ? (
                  <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                ) : null}
              </div>
              <div className={`px-2 py-1.5 ${active ? "bg-indigo-500/15" : "bg-white/[0.03]"}`}>
                <p className="text-[11px] font-medium text-white/85">{preset.label}</p>
                <p className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-white/40">{preset.note}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium text-white/55">灯组角度</p>
          <button
            type="button"
            onClick={() => onAngleChange({ yawDeg: 0, pitchDeg: 0 })}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] text-white/40 hover:bg-white/10 hover:text-white/70"
            title="重置角度"
          >
            <RotateCcw className="h-3 w-3" />
            重置
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="flex justify-between text-[10px] text-white/45">
            <span>水平旋转</span>
            <span className="font-mono text-white/35">{Math.round(yaw)}°</span>
          </span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={yaw}
            onChange={(e) => onAngleChange({ yawDeg: parseFloat(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </label>
        <label className="mt-2 flex flex-col gap-1">
          <span className="flex justify-between text-[10px] text-white/45">
            <span>俯仰高度</span>
            <span className="font-mono text-white/35">{Math.round(pitch)}°</span>
          </span>
          <input
            type="range"
            min={-45}
            max={45}
            step={1}
            value={pitch}
            onChange={(e) => onAngleChange({ pitchDeg: parseFloat(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </label>
        <p className="mt-2 text-[9px] leading-relaxed text-white/30">
          水平旋转绕场景转灯；俯仰抬高或压低光源。可与上方预设叠加。
        </p>
      </div>
    </div>
  );
}
