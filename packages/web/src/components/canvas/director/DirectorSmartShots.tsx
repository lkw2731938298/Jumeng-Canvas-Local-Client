"use client";

/**
 * 智能分镜条：按主体生成机位卡片，一键落入场景（可替换当前选中机位或新建）。
 */

import { Aperture, Plus, RefreshCw, Sparkles } from "lucide-react";
import { buildSmartShotSuggestions, pickFramingSubjects } from "@/lib/director/smartShots";
import type { DirectorObject } from "@/types/director-scene";
import { PanelSection } from "./directorUi";

export function DirectorSmartShots({
  objects,
  selectedCameraId,
  onApplyNew,
  onReplaceSelected,
}: {
  objects: DirectorObject[];
  selectedCameraId: string | null;
  onApplyNew: (fields: ReturnType<typeof buildSmartShotSuggestions>[number]["cameraFields"], label: string) => void;
  onReplaceSelected: (
    fields: ReturnType<typeof buildSmartShotSuggestions>[number]["cameraFields"],
    label: string
  ) => void;
}) {
  const subjects = pickFramingSubjects(objects);
  const suggestions = buildSmartShotSuggestions(objects);

  return (
    <PanelSection
      title="智能分镜"
      extra={
        <span className="font-mono text-[9px] normal-case tracking-normal text-white/30">
          {subjects.length ? `${subjects.length} 主体` : "无主体"}
        </span>
      }
    >
      {!subjects.length ? (
        <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] leading-relaxed text-white/40">
          <Sparkles className="mx-auto mb-1.5 h-4 w-4 text-white/25" />
          先在大纲里添加人物或道具，再一键生成机位建议。
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] leading-relaxed text-white/35">
            相对「{subjects[0]!.name}」自动摆机位；有两名人物时含过肩方案。
          </p>
          <ul className="flex max-h-[280px] flex-col gap-1 overflow-y-auto pr-0.5">
            {suggestions.map((s) => (
              <li
                key={s.recipeId}
                className="group flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-2 py-1.5 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${s.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-white/85">{s.label}</p>
                  <p className="truncate text-[9px] text-white/35">{s.blurb}</p>
                </div>
                {selectedCameraId ? (
                  <button
                    type="button"
                    title="用此方案替换当前选中机位"
                    onClick={() => onReplaceSelected(s.cameraFields, s.label)}
                    className="flex h-7 items-center gap-1 rounded-lg bg-white/[0.06] px-2 text-[10px] text-white/60 opacity-80 hover:bg-indigo-500/25 hover:text-indigo-100 group-hover:opacity-100"
                  >
                    <RefreshCw className="h-3 w-3" />
                    替换
                  </button>
                ) : null}
                <button
                  type="button"
                  title="新建机位"
                  onClick={() => onApplyNew(s.cameraFields, s.label)}
                  className="flex h-7 items-center gap-1 rounded-lg bg-amber-400/15 px-2 text-[10px] text-amber-100 hover:bg-amber-400/25"
                >
                  <Plus className="h-3 w-3" />
                  新建
                </button>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-1 text-[9px] text-white/25">
            <Aperture className="h-3 w-3" />
            落位后可在监视器里微调 FOV 与注视点
          </p>
        </div>
      )}
    </PanelSection>
  );
}
