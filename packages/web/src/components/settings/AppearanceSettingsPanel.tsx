"use client";

/**
 * 设置页「外观」：主题模式 / 强调色 / 毛玻璃 / 动态光晕 / 网格吸附 / 界面缩放。
 * 改动即时预览（不落盘）；「保存更改」才写入本机，离开设置页未保存则自动还原。
 */

import { Check } from "lucide-react";
import { toast } from "sonner";
import { useAppTheme } from "@/components/providers/AppThemeProvider";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  SCALE_MAX,
  SCALE_MIN,
  THEME_MODES,
  accentColor,
  type AppearanceSettings,
  type ThemeMode,
} from "@/lib/theme/appThemes";

/** 主题预览缩略图：左侧竖条 + 顶部横线，模拟界面 */
function ModePreview({ mode }: { mode: ThemeMode }) {
  return (
    <span className={`st-mode-preview ${mode}`} aria-hidden="true">
      <span className="bar" />
      <span className="line" />
    </span>
  );
}

const TOGGLES: { key: "glass" | "glow" | "gridSnap"; title: string; desc: string }[] = [
  { key: "glass", title: "毛玻璃效果", desc: "在卡片与面板上启用背景模糊" },
  { key: "glow", title: "动态光晕", desc: "画布背景呼吸光效" },
  { key: "gridSnap", title: "网格吸附", desc: "拖动卡片时对齐网格" },
];

export function AppearanceSettingsPanel() {
  const { appearance, dirty, previewAppearance, commitAppearance, theme } = useAppTheme();

  const set = (patch: Partial<AppearanceSettings>) => previewAppearance(patch);
  const scalePct = ((appearance.scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;

  return (
    <div className="st-appearance">
      <div className="st-section-head">
        <h2>外观</h2>
        <p>主题、强调色与界面效果</p>
      </div>

      <div className="st-modes" role="radiogroup" aria-label="主题模式">
        {THEME_MODES.map((m) => {
          const active = appearance.mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`st-mode${active ? " active" : ""}`}
              onClick={() => set({ mode: m.id })}
            >
              <ModePreview mode={m.id} />
              <span className="st-mode-label">
                <span>{m.label}</span>
                {active ? (
                  <span className="st-mode-check">
                    <Check size={11} strokeWidth={3} />
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="st-row">
        <span className="st-row-label">强调色</span>
        <div className="st-accents" role="radiogroup" aria-label="强调色">
          {ACCENTS.map((a) => {
            const active = appearance.accent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={a.label}
                title={a.label}
                className={`st-accent${active ? " active" : ""}`}
                style={{ background: accentColor(a.id, theme.isDark) }}
                onClick={() => set({ accent: a.id })}
              />
            );
          })}
        </div>
      </div>

      <div className="st-toggles">
        {TOGGLES.map((t) => (
          <div key={t.key} className="st-toggle-row">
            <div>
              <strong>{t.title}</strong>
              <span>{t.desc}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={appearance[t.key]}
              aria-label={t.title}
              className="jm-switch"
              onClick={() => set({ [t.key]: !appearance[t.key] })}
            />
          </div>
        ))}
      </div>

      <div className="st-row">
        <span className="st-row-label">界面缩放</span>
        <div className="st-scale">
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={5}
            value={appearance.scale}
            aria-label="界面缩放"
            style={{ "--st-fill": `${scalePct}%` } as React.CSSProperties}
            onChange={(e) => set({ scale: Number(e.target.value) })}
          />
          <span className="st-scale-value">{appearance.scale}%</span>
        </div>
      </div>

      <div className="st-actions">
        <button
          type="button"
          className="jm-btn jm-btn-primary"
          disabled={!dirty}
          onClick={() => {
            commitAppearance();
            toast.success("外观已保存");
          }}
        >
          保存更改
        </button>
        <button type="button" className="jm-btn" onClick={() => set({ ...DEFAULT_APPEARANCE })}>
          恢复默认
        </button>
      </div>
    </div>
  );
}
