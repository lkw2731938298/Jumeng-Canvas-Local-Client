"use client";

/**
 * 导演台 · 可视化布光卡片。
 * 按预设的真实灯位（x 横向、y 高度）与色温在小舞台上画出光斑，环境光强度决定底色明暗，
 * 让用户一眼看出「主光从哪来、反差多大」。
 */

import { Check } from "lucide-react";
import { LIGHTING_PRESETS, type LightingPresetId } from "@/lib/director/lightingPresets";

const PRESET_NOTES: Record<string, string> = {
  classic_three_point: "主光 + 辅光 + 轮廓光，通用均衡",
  dramatic_low: "低位硬光、高反差，悬疑 / 冲突",
  soft_portrait: "大面积柔光，人物肤质友好",
  backlight_silhouette: "强逆光勾边，剪影 / 氛围感",
};

export function DirectorLightingCards({
  value,
  onChange,
}: {
  value: LightingPresetId;
  onChange: (id: LightingPresetId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {LIGHTING_PRESETS.map((preset) => {
        const active = preset.id === value;
        const base = Math.round(18 + preset.ambient * 60);
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.id)}
            className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all ${
              active ? "border-indigo-400/60 ring-1 ring-indigo-400/30" : "border-white/[0.08] hover:border-white/25"
            }`}
          >
            <div
              className="relative h-16 overflow-hidden"
              style={{ background: `linear-gradient(180deg, rgb(${base},${base},${base + 8}) 0%, rgb(8,8,12) 100%)` }}
            >
              {preset.lights.map((light, i) => {
                // 灯位投影到卡片：x ∈ [-8, 8] → 0~100%，y ∈ [0, 10] → 底到顶
                const left = Math.min(92, Math.max(8, ((light.position[0] + 8) / 16) * 100));
                const top = Math.min(85, Math.max(10, 100 - (light.position[1] / 10) * 100));
                const size = 22 + light.intensity * 30;
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
              {/* 人物剪影 */}
              <span className="absolute bottom-0 left-1/2 h-9 w-5 -translate-x-1/2 rounded-t-full bg-black/80" />
              <span className="absolute bottom-9 left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-black/80" />
              {active ? (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500">
                  <Check className="h-2.5 w-2.5 text-white" />
                </span>
              ) : null}
            </div>
            <div className={`px-2 py-1.5 ${active ? "bg-indigo-500/15" : "bg-white/[0.03]"}`}>
              <p className="text-[11px] font-medium text-white/85">{preset.label}</p>
              <p className="mt-0.5 line-clamp-1 text-[9px] text-white/40">{PRESET_NOTES[preset.id] ?? ""}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
