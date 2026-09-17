"use client";

import type { GenerationOptions, GenerationPresetGroup } from "@/types/generationPresets";
import { getDurationRangeFromGroup, resolvePresetItem } from "@/lib/canvas/generationPresets";
import { getDurationCreditHint } from "@/lib/canvas/generationCreditHelpers";
import {
  CANVAS_SELECT_CONTENT_CLASS,
  CANVAS_SELECT_ITEM_CLASS,
  CANVAS_SELECT_TRIGGER_CLASS,
} from "@/lib/canvas/canvasSelectStyles";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface GenerationOptionsDurationSliderProps {
  group: GenerationPresetGroup;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  /** inline: horizontal label + slider; stacked: label above slider */
  layout?: "inline" | "stacked";
  /** video: reference UI — blue track, dropdown for seconds on the right */
  variant?: "default" | "video";
  className?: string;
}

function durationOptions(min: number, max: number): number[] {
  const out: number[] = [];
  for (let s = min; s <= max; s += 1) out.push(s);
  return out;
}

function DurationSecondsSelect({
  group,
  seconds,
  min,
  max,
  value,
  onChange,
  pricing,
  triggerClassName,
}: {
  group: GenerationPresetGroup;
  seconds: number;
  min: number;
  max: number;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  triggerClassName?: string;
}) {
  const options = durationOptions(min, max);

  return (
    <Select
      value={String(seconds)}
      onValueChange={(nextId) => {
        if (!nextId) return;
        onChange({ ...value, [group.id]: nextId });
      }}
    >
      <SelectTrigger className={cn(CANVAS_SELECT_TRIGGER_CLASS, "h-8 w-[72px] shrink-0", triggerClassName)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={CANVAS_SELECT_CONTENT_CLASS}>
        {options.map((sec) => {
          const hint = getDurationCreditHint(pricing, String(sec), value);
          return (
            <SelectItem key={sec} value={String(sec)} className={CANVAS_SELECT_ITEM_CLASS}>
              <span className="flex w-full items-center justify-between gap-2">
                <span>{sec}s</span>
                {hint ? <span className="text-[11px] text-white/40">{hint}</span> : null}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

interface GenerationOptionsDurationSliderProps {
  group: GenerationPresetGroup;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  /** inline: horizontal label + slider; stacked: label above slider */
  layout?: "inline" | "stacked";
  /** video: reference UI — blue track, value on right, no inline label */
  variant?: "default" | "video";
  className?: string;
}

export function GenerationOptionsDurationSlider({
  group,
  value,
  onChange,
  pricing,
  layout = "stacked",
  variant = "default",
  className,
}: GenerationOptionsDurationSliderProps) {
  const range = getDurationRangeFromGroup(group);
  if (!range) return null;

  const selected = resolvePresetItem(group, value[group.id]);
  const parsed = selected?.id ? parseInt(selected.id, 10) : range.min;
  const seconds = Number.isFinite(parsed)
    ? Math.min(range.max, Math.max(range.min, parsed))
    : range.min;

  const creditHint = getDurationCreditHint(pricing, String(seconds), value);
  const isVideo = variant === "video";
  const stacked = layout === "stacked" && !isVideo;

  const slider = (
    <Slider
      className={cn(
        "min-w-0 flex-1",
        isVideo
          ? "[&_[data-slot=slider-range]]:bg-sky-500 [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/15"
          : "[&_[data-slot=slider-range]]:bg-purple-500 [&_[data-slot=slider-track]]:bg-white/15"
      )}
      min={range.min}
      max={range.max}
      step={1}
      value={[seconds]}
      onValueChange={(val) => {
        const next = Array.isArray(val) ? val[0] : val;
        if (typeof next !== "number" || !Number.isFinite(next)) return;
        const clamped = Math.min(range.max, Math.max(range.min, Math.round(next)));
        onChange({ ...value, [group.id]: String(clamped) });
      }}
    />
  );

  if (isVideo) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className="min-w-0 flex-1">{slider}</div>
        <DurationSecondsSelect
          group={group}
          seconds={seconds}
          min={range.min}
          max={range.max}
          value={value}
          onChange={onChange}
          pricing={pricing}
        />
        {creditHint ? (
          <span className="shrink-0 text-[11px] text-white/35">{creditHint} 算力</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        stacked ? "flex min-w-[160px] flex-col gap-1.5" : "flex min-w-0 flex-1 items-center gap-3",
        className
      )}
    >
      <span
        className={cn(
          "shrink-0 font-medium text-white/55",
          stacked ? "text-[20px]" : "min-w-[4.5em] text-[13px] text-white/90"
        )}
      >
        {group.label}
      </span>
      <div className={cn("flex min-w-0 items-center gap-2", stacked ? "w-full" : "flex-1")}>
        {slider}
        <DurationSecondsSelect
          group={group}
          seconds={seconds}
          min={range.min}
          max={range.max}
          value={value}
          onChange={onChange}
          pricing={pricing}
        />
        {creditHint ? (
          <span className="shrink-0 text-[11px] text-white/40">{creditHint} 算力</span>
        ) : null}
      </div>
    </div>
  );
}
