"use client";

import { HelpCircle, Volume2 } from "lucide-react";
import type {
  GenerationOptions,
  GenerationPresetGroup,
  GenerationPresetsConfig,
} from "@/types/generationPresets";
import { incomingOptionForGroup, resolvePresetItem } from "@/lib/canvas/generationPresets";
import { patchGenerationOptionSelect } from "@/lib/local/presetTemplates";
import { getOptionCreditCost } from "@/lib/api/credits";
import { formatOptionCreditSuffix } from "@/lib/canvas/generationCreditHelpers";
import { GenerationOptionsDurationSlider } from "./GenerationOptionsDurationSlider";
import { AspectRatioIcon } from "./AspectRatioIcon";
import { cn } from "@/lib/utils";

interface VideoGenerationOptionsPanelProps {
  presets: GenerationPresetsConfig;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  className?: string;
}

const SECTION_LABEL = "mb-2 text-[12px] font-medium tracking-wide text-white/40";

/** Screenshot-style option chip: white ring when active (matches Pro/G product UI). */
function optionBtn(active: boolean, className?: string) {
  return cn(
    "rounded-[10px] border text-[13px] font-semibold transition-colors",
    active
      ? "border-white bg-transparent text-white"
      : "border-white/18 bg-transparent text-white/50 hover:border-white/35 hover:text-white/75",
    className
  );
}

function findGroup(presets: GenerationPresetsConfig, id: string): GenerationPresetGroup | undefined {
  return presets.groups.find((g) => g.id === id);
}

function RatioSection({
  group,
  value,
  onChange,
}: {
  group: GenerationPresetGroup;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
}) {
  const items = group.items.filter((i) => i.enabled !== false);
  const selected = resolvePresetItem(group, incomingOptionForGroup(group, value));

  return (
    <section>
      <p className={SECTION_LABEL}>{group.label || "比例"}</p>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => {
          const active = selected?.id === item.id;
          const ratioKey =
            item.id === "default" || item.id === "auto" ? "auto" : item.label || item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                onChange(patchGenerationOptionSelect(value, group.id, item.id))
              }
              className={optionBtn(active, "flex flex-col items-center gap-1.5 px-1 py-2")}
            >
              <AspectRatioIcon
                ratioId={ratioKey}
                className={active ? "text-white" : "text-white/55"}
              />
              <span className="text-[11px] font-semibold leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChipSection({
  group,
  value,
  onChange,
  pricing,
  fallbackLabel,
  layout = "wrap",
}: {
  group: GenerationPresetGroup;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  pricing?: Record<string, unknown>;
  fallbackLabel?: string;
  layout?: "wrap" | "thirds" | "halves";
}) {
  const items = group.items.filter((i) => i.enabled !== false);
  const selected = resolvePresetItem(group, incomingOptionForGroup(group, value));
  const gridClass =
    layout === "thirds"
      ? "grid grid-cols-3 gap-2"
      : layout === "halves"
        ? "grid grid-cols-2 gap-2"
        : "flex flex-wrap gap-2";

  return (
    <section>
      <p className={SECTION_LABEL}>{group.label || fallbackLabel}</p>
      <div className={gridClass}>
        {items.map((item) => {
          const active = selected?.id === item.id;
          const cost = pricing
            ? getOptionCreditCost(pricing, group.id, item.id, value)
            : 0;
          const suffix = pricing
            ? formatOptionCreditSuffix(pricing, group.id, cost)
            : "";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(patchGenerationOptionSelect(value, group.id, item.id))}
              className={optionBtn(
                active,
                layout === "thirds" || layout === "halves"
                  ? "w-full px-3 py-2.5 tabular-nums"
                  : "min-w-[4.5rem] px-3.5 py-2 tabular-nums"
              )}
            >
              {item.label}
              {suffix ? (
                <span className="ml-1 text-[10px] font-normal text-white/45">{suffix}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AudioSection({
  group,
  value,
  onChange,
}: {
  group: GenerationPresetGroup;
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
}) {
  const items = group.items.filter((i) => i.enabled !== false);
  const selected = resolvePresetItem(group, incomingOptionForGroup(group, value));

  return (
    <section>
      <p className={cn(SECTION_LABEL, "flex items-center gap-1")}>
        {group.label || "生成音频"}
        <HelpCircle className="h-3.5 w-3.5 text-white/25" aria-hidden />
      </p>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => {
          const active = selected?.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange({ ...value, [group.id]: item.id })}
              className={optionBtn(active, "py-2.5")}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Generation options panel (image/video): screenshot order —
 * 画质 → 清晰度 → 比例 → 生成数量，再接时长/音频等。
 */
export function VideoGenerationOptionsPanel({
  presets,
  value,
  onChange,
  pricing,
  className,
}: VideoGenerationOptionsPanelProps) {
  const qualityGroup = findGroup(presets, "quality") ?? findGroup(presets, "mode");
  const sizeGroup = findGroup(presets, "size");
  const sizeIsRatio = Boolean(
    sizeGroup?.items.some((i) => String(i.id).includes(":"))
  );
  const resolutionGroup =
    findGroup(presets, "resolution") ?? (sizeIsRatio ? undefined : sizeGroup);
  const ratioGroup =
    findGroup(presets, "ratio") ??
    findGroup(presets, "aspect_ratio") ??
    findGroup(presets, "aspectRatio") ??
    (sizeIsRatio ? sizeGroup : undefined);
  const countGroup = findGroup(presets, "count") ?? findGroup(presets, "n");
  const durationGroup = findGroup(presets, "duration");
  const audioGroup = findGroup(presets, "audio");

  const handled = new Set(
    [
      qualityGroup?.id,
      resolutionGroup?.id,
      ratioGroup?.id,
      countGroup?.id,
      "duration",
      "audio",
      "watermark",
      "style",
      "refVideo",
      "quality",
      "mode",
      "resolution",
      "size",
      "ratio",
      "count",
      "n",
    ].filter(Boolean) as string[]
  );

  const extraGroups = presets.groups.filter(
    (g) =>
      !handled.has(g.id) &&
      !g.uiHidden &&
      g.items.some((i) => i.enabled !== false)
  );

  const hasContent =
    qualityGroup ||
    resolutionGroup ||
    ratioGroup ||
    countGroup ||
    durationGroup ||
    audioGroup ||
    extraGroups.length > 0;
  if (!hasContent) return null;

  return (
    <div className={cn("space-y-5 px-4 py-4 text-white", className)}>
      {qualityGroup ? (
        <ChipSection
          group={qualityGroup}
          value={value}
          onChange={onChange}
          pricing={pricing}
          fallbackLabel="画质"
        />
      ) : null}
      {resolutionGroup ? (
        <ChipSection
          group={resolutionGroup}
          value={value}
          onChange={onChange}
          pricing={pricing}
          fallbackLabel="分辨率"
          layout={
            resolutionGroup.items.filter((i) => i.enabled !== false).length === 2
              ? "halves"
              : "wrap"
          }
        />
      ) : null}
      {ratioGroup ? (
        <RatioSection group={ratioGroup} value={value} onChange={onChange} />
      ) : null}
      {countGroup ? (
        <ChipSection
          group={countGroup}
          value={value}
          onChange={onChange}
          pricing={pricing}
          fallbackLabel="生成数量"
          layout="thirds"
        />
      ) : null}
      {durationGroup ? (
        <section>
          <p className={SECTION_LABEL}>视频时长</p>
          <GenerationOptionsDurationSlider
            group={durationGroup}
            value={value}
            onChange={onChange}
            pricing={pricing}
            variant="video"
          />
        </section>
      ) : null}
      {audioGroup ? (
        <AudioSection group={audioGroup} value={value} onChange={onChange} />
      ) : null}
      {extraGroups.map((group) => (
        <ChipSection
          key={group.id}
          group={group}
          value={value}
          onChange={onChange}
          pricing={pricing}
        />
      ))}
    </div>
  );
}

/** 折叠条摘要：对齐截图「16:9 · 720P · 5s · 1个」+ 喇叭图标（有声不写文字） */
export function buildVideoOptionsSummaryParts(
  presets: GenerationPresetsConfig,
  value: GenerationOptions
): string[] {
  const parts: string[] = [];
  // 顺序：比例 → 清晰度 → 时长 → 数量（有声仅用 Volume2 图标）
  const order = [
    "ratio",
    "aspect_ratio",
    "aspectRatio",
    "quality",
    "mode",
    "resolution",
    "size",
    "duration",
    "count",
    "n",
    "audio",
    // MiniMax / 音乐模型摘要顺序
    "instrumental",
    "lyricsOptimizer",
    "sampleRate",
    "bitrate",
    "format",
  ];
  const sorted = [...presets.groups].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const group of sorted) {
    if (group.id === "watermark" || group.uiHidden) continue;
    // 有声仅用喇叭图标展示，不写入文字摘要
    if (group.id === "audio") continue;
    const item = resolvePresetItem(group, incomingOptionForGroup(group, value));
    if (!item) continue;
    if (group.id === "duration" && /^\d+$/.test(item.id)) {
      parts.push(`${item.id}s`);
    } else if (group.id === "count" || group.id === "n") {
      // 视频用「个」；若标签已是「N张」则改为「N个」
      if (/[个张]/.test(item.label)) {
        parts.push(item.label.replace(/张/g, "个"));
      } else if (/^\d+$/.test(item.id)) {
        parts.push(`${item.id}个`);
      } else {
        parts.push(item.label);
      }
    } else if (group.id === "resolution" || group.id === "size") {
      // 720p → 720P（截图样式）
      parts.push(item.label.replace(/(\d+)\s*[pP]\b/g, "$1P"));
    } else {
      parts.push(item.label);
    }
  }
  return parts;
}

/** Compact summary for node toolbar. */
export function VideoOptionsSummaryPill({
  presets,
  value,
  className,
  fallback = "点击设置参数",
}: {
  presets: GenerationPresetsConfig;
  value: GenerationOptions;
  className?: string;
  fallback?: string;
}) {
  const parts = buildVideoOptionsSummaryParts(presets, value);
  const audioGroup = findGroup(presets, "audio");
  const audioOn = audioGroup && resolvePresetItem(audioGroup, value.audio)?.id === "on";
  const hasAudioInParts = parts.some((p) => p.startsWith("音频"));

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-white/70",
        className
      )}
    >
      {parts.length > 0 ? parts.join(" · ") : fallback}
      {/* 有声：文字后跟 · + 喇叭，对齐截图样式 */}
      {audioOn && !hasAudioInParts ? (
        <>
          {parts.length > 0 ? <span className="text-white/40" aria-hidden>·</span> : null}
          <Volume2 className="h-3.5 w-3.5 shrink-0 text-white/45" aria-label="音频开启" />
        </>
      ) : null}
    </span>
  );
}
