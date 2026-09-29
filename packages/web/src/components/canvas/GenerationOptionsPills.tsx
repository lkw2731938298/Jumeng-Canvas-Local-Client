"use client";

import type { GenerationOptions, GenerationPresetsConfig } from "@/types/generationPresets";
import { incomingOptionForGroup, isDurationSliderGroup, resolvePresetItem } from "@/lib/canvas/generationPresets";
import { patchGenerationOptionSelect } from "@/lib/local/presetTemplates";
import { getOptionCreditCost } from "@/lib/api/credits";
import { formatOptionCreditSuffix } from "@/lib/canvas/generationCreditHelpers";
import { GenerationOptionsDurationSlider } from "./GenerationOptionsDurationSlider";
import { cn } from "@/lib/utils";

interface GenerationOptionsPillsProps {
  presets: GenerationPresetsConfig;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  /** compact: single-row inline bar; modal: stacked rows like main platform */
  variant?: "compact" | "modal";
  className?: string;
  pricing?: Record<string, unknown>;
}

export function GenerationOptionsPills({
  presets,
  value,
  onChange,
  variant = "modal",
  className,
  pricing,
}: GenerationOptionsPillsProps) {
  const isModal = variant === "modal";

  return (
    <div className={cn(isModal ? "space-y-5" : "flex flex-wrap items-center gap-2", className)}>
      {presets.groups.map((group) => {
        if (group.uiHidden || group.id === "refVideo") return null;
        const selected = resolvePresetItem(group, incomingOptionForGroup(group, value));
        const items = group.items.filter((i) => i.enabled !== false);
        if (items.length === 0) return null;

        if (isDurationSliderGroup(group)) {
          return (
            <GenerationOptionsDurationSlider
              key={group.id}
              group={group}
              value={value}
              onChange={onChange}
              pricing={pricing}
              layout={isModal ? "inline" : "inline"}
            />
          );
        }

        return (
          <div
            key={group.id}
            className={cn(
              isModal
                ? "flex items-center gap-5"
                : "flex items-center gap-1.5 text-[13px] text-white/55"
            )}
          >
            <span
              className={cn(
                "shrink-0 font-medium",
                isModal ? "min-w-[4.5em] text-[13px] text-white/90" : "text-white/55"
              )}
            >
              {group.label}
            </span>
            <div
              className={cn(
                "flex min-w-0 flex-1 gap-2 overflow-x-auto",
                isModal ? "flex-nowrap gap-3" : "flex-wrap"
              )}
            >
              {items.map((item) => {
                const active = selected?.id === item.id;
                const optionCost = getOptionCreditCost(pricing, group.id, item.id, value);
                const suffix = formatOptionCreditSuffix(pricing, group.id, optionCost);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChange(patchGenerationOptionSelect(value, group.id, item.id))}
                    className={cn(
                      "shrink-0 rounded-[10px] border font-semibold transition-colors",
                      isModal ? "px-3.5 py-2 text-sm" : "px-2.5 py-1 text-[13px]",
                      active
                        ? "border-white/25 bg-white/15 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                        : "border-white/10 bg-white/[0.06] text-white/75 hover:border-white/20 hover:bg-white/[0.1]"
                    )}
                  >
                    {item.label}
                    {suffix ? (
                      <span className="ml-1 text-[11px] font-normal text-white/45">{suffix}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
