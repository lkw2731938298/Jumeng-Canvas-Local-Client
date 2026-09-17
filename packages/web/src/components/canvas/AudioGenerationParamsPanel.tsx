"use client";

import { useState, type ReactNode } from "react";
import { ChevronUp, HelpCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUDIO_SOUND_EFFECTS,
  DEFAULT_AUDIO_GENERATION_PARAMS,
  type AudioGenerationParams,
  type AudioSoundEffectId,
} from "@/lib/canvas/audioGenerationParams";

interface AudioGenerationParamsPanelProps {
  value: AudioGenerationParams;
  onChange: (next: AudioGenerationParams) => void;
  disabled?: boolean;
}

function Section({
  title,
  defaultOpen = true,
  headerRight,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.08] last:border-b-0">
      <div className="flex items-center gap-2 py-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] font-medium text-white/90"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="truncate">{title}</span>
          <ChevronUp
            className={cn(
              "size-3.5 shrink-0 text-white/40 transition-transform",
              !open && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {headerRight}
      </div>
      {open ? <div className="space-y-3 pb-3">{children}</div> : null}
    </div>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  help,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  help?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-[4.5rem] shrink-0 items-center gap-0.5 text-[13px] text-white/55">
        {label}
        {help ? (
          <span title={help} className="inline-flex text-white/30">
            <HelpCircle className="size-3" strokeWidth={1.75} aria-hidden />
          </span>
        ) : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-sky-400 disabled:opacity-40 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
      />
      <span className="w-12 shrink-0 rounded-md bg-white/[0.06] px-1.5 py-1 text-center text-[12px] tabular-nums text-white/80">
        {display}
      </span>
    </div>
  );
}

/** 音频「生成参数」下拉面板：基础调节 / 音色效果 / 音效 */
export function AudioGenerationParamsPanel({
  value,
  onChange,
  disabled = false,
}: AudioGenerationParamsPanelProps) {
  const patch = (partial: Partial<AudioGenerationParams>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div
      className="w-[340px] max-w-[min(340px,calc(100vw-24px))] rounded-xl border border-white/10 bg-[rgba(28,28,34,0.98)] px-3.5 py-1 shadow-2xl backdrop-blur-xl"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Section
        title="基础调节"
        headerRight={
          <button
            type="button"
            disabled={disabled}
            title="一键重置"
            onClick={() => onChange({ ...DEFAULT_AUDIO_GENERATION_PARAMS })}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/85 disabled:opacity-35"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
            一键重置
          </button>
        }
      >
        <ParamSlider
          label="语速"
          value={value.speechRate}
          min={0.5}
          max={2}
          step={0.01}
          display={value.speechRate.toFixed(2)}
          disabled={disabled}
          onChange={(speechRate) => patch({ speechRate })}
        />
        <ParamSlider
          label="声调"
          value={value.tone}
          min={-12}
          max={12}
          step={1}
          display={String(Math.round(value.tone))}
          disabled={disabled}
          onChange={(tone) => patch({ tone })}
        />
        <ParamSlider
          label="音量"
          value={value.volume}
          min={0}
          max={2}
          step={0.1}
          display={value.volume.toFixed(1)}
          disabled={disabled}
          onChange={(volume) => patch({ volume })}
        />
      </Section>

      <Section title="音色效果调节">
        <ParamSlider
          label="音高"
          value={value.pitch}
          min={-12}
          max={12}
          step={1}
          display={String(Math.round(value.pitch))}
          help="调整合成音高偏移"
          disabled={disabled}
          onChange={(pitch) => patch({ pitch })}
        />
        <ParamSlider
          label="强度"
          value={value.intensity}
          min={-100}
          max={100}
          step={1}
          display={String(Math.round(value.intensity))}
          help="CosyVoice 暂无对应参数，调节不会影响合成"
          disabled={disabled}
          onChange={(intensity) => patch({ intensity })}
        />
        <ParamSlider
          label="音色调节"
          value={value.timbre}
          min={-100}
          max={100}
          step={1}
          display={String(Math.round(value.timbre))}
          help="CosyVoice 暂无对应参数，调节不会影响合成"
          disabled={disabled}
          onChange={(timbre) => patch({ timbre })}
        />
      </Section>

      <div className="py-2.5">
        <p className="mb-2 text-[13px] font-medium text-white/90">
          音效
          <span className="ml-1.5 text-[11px] font-normal text-white/35">暂未接入上游</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {AUDIO_SOUND_EFFECTS.map((fx) => {
            const active = value.soundEffect === fx.id;
            return (
              <button
                key={fx.id}
                type="button"
                disabled={disabled}
                onClick={() => patch({ soundEffect: fx.id as AudioSoundEffectId })}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[12px] transition-colors disabled:opacity-35",
                  active
                    ? "bg-white/[0.14] text-white"
                    : "bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white/85"
                )}
              >
                {fx.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
