"use client";

import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import { incomingOptionForGroup, isDurationSliderGroup, resolvePresetItem } from "@/lib/canvas/generationPresets";
import { patchGenerationOptionSelect } from "@/lib/local/presetTemplates";
import { getOptionCreditCost } from "@/lib/api/credits";
import { formatOptionCreditSuffix } from "@/lib/canvas/generationCreditHelpers";
import { GenerationOptionsDurationSlider } from "./GenerationOptionsDurationSlider";
import {
  CANVAS_SELECT_CONTENT_CLASS,
  CANVAS_SELECT_ITEM_CLASS,
  CANVAS_SELECT_TRIGGER_CLASS,
} from "@/lib/canvas/canvasSelectStyles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface GenerationOptionsDropdownsProps {
  presets: GenerationPresetsConfig;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  className?: string;
  pricing?: Record<string, unknown>;
  /** 紧凑横排：标签嵌在触发器内，适合音频节点参数条 */
  compact?: boolean;
}

/** Inline generation option groups as parallel label + dropdown rows. */
export function GenerationOptionsDropdowns({
  presets,
  value,
  onChange,
  className,
  pricing,
  compact = false,
}: GenerationOptionsDropdownsProps) {
  const groups = presets.groups.filter((g) => {
    if (g.id === "watermark" || g.id === "refVideo" || g.uiHidden) return false;
    return g.items.some((i) => i.enabled !== false);
  });

  if (groups.length === 0) return null;

  return (
    <div
      className={cn(
        compact
          ? "flex flex-wrap items-center gap-1.5"
          : "flex flex-wrap items-end gap-x-3 gap-y-2",
        className
      )}
    >
      {groups.map((group) => {
        if (isDurationSliderGroup(group)) {
          return (
            <GenerationOptionsDurationSlider
              key={group.id}
              group={group}
              value={value}
              onChange={onChange}
              pricing={pricing}
              layout="stacked"
            />
          );
        }

        const items = group.items.filter((i) => i.enabled !== false);
        const selected = resolvePresetItem(group, incomingOptionForGroup(group, value));
        const currentId = selected?.id ?? items[0]?.id ?? "";
        const currentLabel = selected?.label ?? items[0]?.label ?? group.label;

        if (compact) {
          // 紧凑：单行「标签 · 当前值」触发器，避免上下堆叠与过大字号
          return (
            <Select
              key={group.id}
              value={currentId}
              onValueChange={(nextId) => {
                if (!nextId) return;
                onChange(patchGenerationOptionSelect(value, group.id, nextId));
              }}
            >
              <SelectTrigger
                title={group.label}
                className={cn(
                  CANVAS_SELECT_TRIGGER_CLASS,
                  "h-7 min-w-0 gap-1 rounded-md border-white/10 bg-white/[0.04] px-2 text-[12px] text-white/80 hover:bg-white/[0.08] data-[size=default]:h-7"
                )}
              >
                <SelectValue placeholder={`${group.label} · ${currentLabel}`}>
                  <span className="inline-flex items-center gap-1 truncate">
                    <span className="shrink-0 text-white/40">{group.label}</span>
                    <span className="text-white/25" aria-hidden>
                      ·
                    </span>
                    <span className="truncate text-white/90">{currentLabel}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
                {items.map((item) => {
                  const optionCost = getOptionCreditCost(pricing, group.id, item.id, value);
                  const suffix = formatOptionCreditSuffix(pricing, group.id, optionCost);
                  return (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      label={item.label}
                      className={CANVAS_SELECT_ITEM_CLASS}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span>{item.label}</span>
                        {suffix ? (
                          <span className="text-[11px] text-white/40">{suffix}</span>
                        ) : null}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          );
        }

        return (
          <label key={group.id} className="flex min-w-[88px] flex-col gap-1" title={group.label}>
            <span className="text-[12px] font-medium text-white/55">{group.label}</span>
            <Select
              value={currentId}
              onValueChange={(nextId) => {
                if (!nextId) return;
                onChange(patchGenerationOptionSelect(value, group.id, nextId));
              }}
            >
              <SelectTrigger className={CANVAS_SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={CANVAS_SELECT_CONTENT_CLASS}>
                {items.map((item) => {
                  const optionCost = getOptionCreditCost(pricing, group.id, item.id, value);
                  const suffix = formatOptionCreditSuffix(pricing, group.id, optionCost);
                  return (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      className={CANVAS_SELECT_ITEM_CLASS}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span>{item.label}</span>
                        {suffix ? (
                          <span className="text-[11px] text-white/40">{suffix}</span>
                        ) : null}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </label>
        );
      })}
    </div>
  );
}
