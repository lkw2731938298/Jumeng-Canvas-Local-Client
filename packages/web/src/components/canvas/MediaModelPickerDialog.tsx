"use client";

import { useEffect, useMemo, useState } from "react";
import type { CanvasModel } from "@/lib/api/models";
import { formatCreditLabel } from "@/lib/api/credits";
import {
  buildModelPickerTabs,
  findTabForModel,
  type ModelPickerTab,
} from "@/lib/canvas/modelPickerTabs";
import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";
import { getVideoModelReferenceGuide } from "@/lib/canvas/videoModelReferenceGuide";
import { useGlobalWatermark } from "@/components/providers/GlobalWatermarkProvider";
import {
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import { useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";
import type { GenerationOptions } from "@/types/generationPresets";
import { GenerationOptionsPills } from "./GenerationOptionsPills";
import { VideoGenerationOptionsPanel } from "./VideoGenerationOptionsPanel";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface MediaModelPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: ModelCategory;
  models: CanvasModel[];
  modelName: string;
  generationOptions: GenerationOptions;
  onConfirm: (modelName: string, options: GenerationOptions) => void;
}

export function MediaModelPickerDialog({
  open,
  onOpenChange,
  category,
  models,
  modelName,
  generationOptions,
  onConfirm,
}: MediaModelPickerDialogProps) {
  const tabs = useMemo(() => buildModelPickerTabs(category, models), [category, models]);

  const [activeTabId, setActiveTabId] = useState("");
  const [draftModel, setDraftModel] = useState(modelName);
  const [draftOptions, setDraftOptions] = useState<GenerationOptions>(generationOptions);

  useEffect(() => {
    if (!open) return;
    setDraftModel(modelName);
    setDraftOptions(generationOptions);
    setActiveTabId(findTabForModel(tabs, modelName));
  }, [open, modelName, generationOptions, tabs]);

  const activeTab: ModelPickerTab | undefined =
    tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const draftModelMeta = useMemo(
    () => models.find((m) => m.name === draftModel) ?? activeTab?.models[0],
    [models, draftModel, activeTab]
  );

  const draftPresets = useMemo(
    () => getModelGenerationPresets(draftModelMeta),
    [draftModelMeta]
  );

  const { enabled: globalWatermarkEnabled } = useGlobalWatermark();

  const normalizedDraftOptions = useMemo(
    () => normalizeGenerationOptions(draftPresets, draftOptions),
    [draftPresets, draftOptions, globalWatermarkEnabled]
  );

  const modelPricing = draftModelMeta?.parameters?.pricing as Record<string, unknown> | undefined;

  const { total: creditTotal, creditsEnabled, isLoading: quoteLoading } = useGenerationCreditQuote({
    model: draftModel || undefined,
    category,
    generationOptions: normalizedDraftOptions,
    pricing: modelPricing,
    enabled: open && Boolean(draftModel),
  });

  const creditLabel = quoteLoading ? "…" : formatCreditLabel(creditTotal, creditsEnabled);

  const referenceGuide =
    category === "video" && draftModelMeta ? getVideoModelReferenceGuide(draftModelMeta) : null;

  const handleTabChange = (tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    const nextModel = tab?.models[0]?.name;
    if (!nextModel) return;
    setDraftModel(nextModel);
    const presets = getModelGenerationPresets(tab.models[0]);
    setDraftOptions(normalizeGenerationOptions(presets, draftOptions));
  };

  const handleModelPick = (name: string) => {
    setDraftModel(name);
    const meta = models.find((m) => m.name === name);
    const presets = getModelGenerationPresets(meta);
    setDraftOptions(normalizeGenerationOptions(presets, draftOptions));
  };

  const handleConfirm = () => {
    const presets = getModelGenerationPresets(draftModelMeta);
    onConfirm(draftModel, normalizeGenerationOptions(presets, draftOptions));
    onOpenChange(false);
  };

  const title =
    category === "video" ? "选取视频模型" : category === "audio" ? "选取音频模型" : "选取模型";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="max-w-[min(920px,calc(100vw-32px))] gap-0 border-white/10 bg-[#14141f] p-0 text-white shadow-2xl ring-white/10 sm:max-w-[min(920px,calc(100vw-32px))]"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <span className="sr-only">{title}</span>
          <div
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
            role="tablist"
            aria-label="模型线路"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab?.id === tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  activeTab?.id === tab.id
                    ? "bg-purple-500/30 text-white"
                    : "text-white/55 hover:bg-white/5 hover:text-white/80"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[min(60vh,420px)] overflow-y-auto px-5 py-4">
          {draftModelMeta ? (
            <>
              <h3 className="mb-1.5 text-[17px] font-extrabold tracking-wide text-white">
                {draftModelMeta.displayName}
              </h3>
              {draftModelMeta.description ? (
                <p className="mb-3 text-[13px] leading-relaxed text-white/45">
                  {draftModelMeta.description}
                </p>
              ) : null}
              {referenceGuide ? (
                <div className="mb-3 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-purple-100/90">
                  {referenceGuide}
                </div>
              ) : null}
              <div className="mb-4 h-px bg-white/10" aria-hidden />

              {activeTab && activeTab.models.length > 1 ? (
                <div className="mb-5 flex items-center gap-5">
                  <span className="min-w-[4.5em] shrink-0 text-[13px] font-bold text-white/90">
                    模型版本
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {activeTab.models.map((m) => (
                      <button
                        key={m.name}
                        type="button"
                        onClick={() => handleModelPick(m.name)}
                        className={cn(
                          "rounded-[10px] border px-3.5 py-2 text-sm font-semibold transition-colors",
                          draftModel === m.name
                            ? "border-purple-500 bg-purple-500/35 text-white"
                            : "border-white/10 bg-white/[0.06] text-white/75 hover:border-purple-500/45"
                        )}
                      >
                        {m.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {draftPresets ? (
                category === "video" ? (
                  <VideoGenerationOptionsPanel
                    presets={{
                      ...draftPresets,
                      groups: draftPresets.groups.filter((g) => g.id !== "watermark"),
                    }}
                    value={draftOptions}
                    onChange={setDraftOptions}
                    pricing={modelPricing}
                    className="px-0 py-0"
                  />
                ) : (
                  <GenerationOptionsPills
                    presets={{
                      ...draftPresets,
                      groups: draftPresets.groups.filter((g) => g.id !== "watermark"),
                    }}
                    value={draftOptions}
                    onChange={setDraftOptions}
                    variant="modal"
                    pricing={modelPricing}
                  />
                )
              ) : null}
            </>
          ) : (
            <p className="text-sm text-white/45">暂无可用模型</p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
          <span className="text-xs text-white/45">本次消耗 {creditLabel}</span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!draftModel}
            className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
          >
            确认 · {creditLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
