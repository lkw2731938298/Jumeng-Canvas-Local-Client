"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Box, Clapperboard, Gauge, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  HD_UPSCALE_CREDIT_COST,
  HD_UPSCALE_MODELS,
  HD_UPSCALE_SCALES,
  type HdUpscaleMediaKind,
  type HdUpscaleScale,
} from "@/lib/canvas/createHdUpscaleNode";
import {
  hdUpscaleCanvasTool,
  runHdUpscaleGenerate,
} from "@/lib/canvas/runHdUpscaleGenerate";
import { canvasVideoToolBillingOptions } from "@/lib/canvas/canvasVideoToolBilling";
import { useCanvasToolConfiguredModel } from "@/lib/canvas/useCanvasToolConfiguredModel";
import { useNodeVideoDurationSec } from "@/lib/canvas/useNodeVideoDurationSec";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CANVAS_SELECT_CONTENT_CLASS,
  CANVAS_SELECT_ITEM_CLASS,
  CANVAS_SELECT_TRIGGER_CLASS,
} from "@/lib/canvas/canvasSelectStyles";
import {
  VOLC_ENHANCE_STANDARD_PRO_MODEL,
  volcEnhanceResolutions,
} from "@/lib/local/volcVideoEnhance";

export interface HdUpscalePanelValues {
  hdProvider: string;
  hdModel: string;
  hdScale: number;
  /** 画质增强：标准版 / 专业版 */
  enhanceMode?: string;
  enhanceResolution?: string;
  enhanceFps?: string;
  enhanceScene?: string;
  enhanceStyle?: string;
  enhanceBitrateLevel?: string;
  enhanceBitDepth?: string;
}

interface HdUpscalePanelProps {
  values: HdUpscalePanelValues;
  onChange: (patch: Partial<HdUpscalePanelValues>) => void;
  /** 高清 / 画质增强节点 id；用于提交生成 */
  nodeId: string | null;
  hasSourceImage?: boolean;
  /** 图片 / 视频（视频顶栏改为画质增强） */
  mediaKind?: HdUpscaleMediaKind;
}

const ENHANCE_FPS = [
  { value: "", label: "保持原帧率" },
  { value: "24", label: "24 fps" },
  { value: "25", label: "25 fps" },
  { value: "30", label: "30 fps" },
  { value: "50", label: "50 fps" },
  { value: "60", label: "60 fps" },
] as const;

const ENHANCE_SCENES = [
  { value: "common", label: "通用" },
  { value: "aigc", label: "AIGC" },
  { value: "short_series", label: "短剧" },
  { value: "ugc", label: "UGC" },
  { value: "old_film", label: "老片修复" },
] as const;

const ENHANCE_STYLES = [
  { value: "hd", label: "高清" },
  { value: "natural", label: "自然" },
] as const;

const ENHANCE_RES_LABEL: Record<string, string> = {
  "720p": "720p",
  "1080p": "1080p",
  "2k": "2K",
  "4k": "4K",
  "8k": "8K",
};

/**
 * 图片：高清放大参数面板。
 * 视频：火山画质增强（固定标准专业版模型；节点选档次/画质/帧率等）。
 */
export function HdUpscalePanel({
  values,
  onChange,
  nodeId,
  hasSourceImage = false,
  mediaKind = "image",
}: HdUpscalePanelProps) {
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const hdNode = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId) ?? null);
  const hdVideoUrl = String(
    ((hdNode?.data as WorkflowNodeData | undefined)?.params as Record<string, unknown> | undefined)
      ?.videoUrl ?? ""
  );
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const canvasTool = hdUpscaleCanvasTool(mediaKind);
  const isVideoHd = mediaKind === "video";
  const { durationSec: videoBillSec } = useNodeVideoDurationSec(
    isVideoHd ? nodeId : null,
    hdVideoUrl,
    isVideoHd && Boolean(nodeId)
  );
  const extraGenerationOptions = useMemo(() => {
    if (!isVideoHd) return undefined;
    const bill =
      videoBillSec != null ? canvasVideoToolBillingOptions(videoBillSec) : undefined;
    return {
      ...(bill || {}),
      enhanceMode: values.enhanceMode || "standard",
      enhanceResolution: values.enhanceResolution || "1080p",
      enhanceFps: values.enhanceFps || "",
      enhanceScene: values.enhanceScene || "common",
      enhanceStyle: values.enhanceStyle || "hd",
      enhanceBitrateLevel: values.enhanceBitrateLevel || "medium",
      enhanceBitDepth: values.enhanceBitDepth || "8",
      resolution: values.enhanceResolution || "1080p",
      mode: values.enhanceMode || "standard",
    };
  }, [
    isVideoHd,
    videoBillSec,
    values.enhanceMode,
    values.enhanceResolution,
    values.enhanceFps,
    values.enhanceScene,
    values.enhanceStyle,
    values.enhanceBitrateLevel,
    values.enhanceBitDepth,
  ]);

  const {
    modelName,
    displayName,
    hasModel,
    defaultGenerationOptions,
    total: creditTotal,
    creditsEnabled,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useCanvasToolConfiguredModel(
    canvasTool,
    Boolean(nodeId) && (!isVideoHd || videoBillSec != null),
    mediaKind,
    extraGenerationOptions
  );

  const scale = (HD_UPSCALE_SCALES as readonly number[]).includes(values.hdScale)
    ? (values.hdScale as HdUpscaleScale)
    : 2;
  const presetLabel =
    HD_UPSCALE_MODELS.find((o) => o.value === (values.hdModel || "general"))?.label ?? "通用";

  const enhanceMode = values.enhanceMode === "professional" ? "professional" : "standard";
  const enhanceResolutions = volcEnhanceResolutions("standard_pro");
  const enhanceResolution = enhanceResolutions.includes(
    String(values.enhanceResolution || "")
  )
    ? String(values.enhanceResolution)
    : "1080p";

  const creditNumber = quoteLoading
    ? "…"
    : creditTotal > 0
      ? String(creditTotal)
      : String(HD_UPSCALE_CREDIT_COST);
  const creditTitle =
    creditTotal > 0
      ? `本次消耗 ${creditTotal} 算力`
      : `本次消耗 ${HD_UPSCALE_CREDIT_COST} 算力（默认）`;

  const handleGenerate = async () => {
    if (!projectId || !nodeId) {
      toast.error("项目或节点未就绪");
      return;
    }
    if (!hasSourceImage) {
      toast.error(mediaKind === "video" ? "请先连接参考视频" : "请先连接参考图片");
      return;
    }
    if (!hasModel || !modelName) {
      toast.error(
        mediaKind === "video"
          ? `请先在设置中拉取并勾选「${VOLC_ENHANCE_STANDARD_PRO_MODEL}」`
          : "高清模型未配置或不可用（请在后台「模型开关」配置）"
      );
      return;
    }
    if (generating) return;

    setGenerating(true);
    try {
      await runHdUpscaleGenerate({
        projectId,
        nodeId,
        hdModel: values.hdModel || "general",
        hdScale: scale,
        hdProvider: values.hdProvider || "topazlabs",
        modelName,
        generationOptions: {
          ...defaultGenerationOptions,
          ...(extraGenerationOptions || {}),
        },
        workflowId,
        creditsEnabled,
        queryClient,
        onRefetchPricing: () => void refetchQuote(),
        mediaKind,
      });
    } finally {
      setGenerating(false);
    }
  };

  if (isVideoHd) {
    const sceneLabel =
      ENHANCE_SCENES.find((o) => o.value === (values.enhanceScene || "common"))?.label ||
      "通用";
    const styleLabel =
      ENHANCE_STYLES.find((o) => o.value === (values.enhanceStyle || "hd"))?.label || "高清";
    const fpsLabel =
      ENHANCE_FPS.find((o) => o.value === (values.enhanceFps || ""))?.label || "保持原帧率";
    const isPro = enhanceMode === "professional";

    return (
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {/* 胶片感底纹：冷青 → 暖琥珀，避免紫系默认风 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 0% 0%, rgba(45,212,191,0.16), transparent 55%)," +
              "radial-gradient(90% 70% at 100% 100%, rgba(251,191,36,0.12), transparent 50%)," +
              "linear-gradient(165deg, #12141c 0%, #0c0e14 55%, #141018 100%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(45,212,191,0.55), rgba(251,191,36,0.45), transparent)",
          }}
        />

        <div className="relative px-3.5 pb-3.5 pt-3">
          <header className="mb-3 flex items-start gap-2.5">
            <div
              className={cn(
                "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border",
                isPro
                  ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                  : "border-teal-400/35 bg-teal-400/10 text-teal-200"
              )}
            >
              <Sparkles className="size-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold tracking-wide text-white/95">
                  画质增强
                </h3>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase",
                    isPro
                      ? "bg-amber-400/15 text-amber-200/90"
                      : "bg-teal-400/15 text-teal-200/90"
                  )}
                >
                  {isPro ? "Pro" : "Std"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-white/40" title={VOLC_ENHANCE_STANDARD_PRO_MODEL}>
                {VOLC_ENHANCE_STANDARD_PRO_MODEL}
              </p>
            </div>
          </header>

          {/* 档次：双卡片对比 */}
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {(
              [
                {
                  value: "standard" as const,
                  label: "标准版",
                  hint: "均衡速度与画质",
                  accent: "teal",
                },
                {
                  value: "professional" as const,
                  label: "专业版",
                  hint: "细节与稳定性更强",
                  accent: "amber",
                },
              ] as const
            ).map((opt) => {
              const on = enhanceMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ enhanceMode: opt.value })}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border px-2.5 py-2 text-left transition-all duration-200",
                    on
                      ? opt.accent === "amber"
                        ? "border-amber-400/40 bg-amber-400/[0.12] shadow-[inset_0_0_0_1px_rgba(251,191,36,0.12)]"
                        : "border-teal-400/40 bg-teal-400/[0.12] shadow-[inset_0_0_0_1px_rgba(45,212,191,0.12)]"
                      : "border-white/[0.08] bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
                  )}
                >
                  <div
                    className={cn(
                      "text-[13px] font-medium",
                      on
                        ? opt.accent === "amber"
                          ? "text-amber-100"
                          : "text-teal-100"
                        : "text-white/70"
                    )}
                  >
                    {opt.label}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-snug text-white/35">{opt.hint}</div>
                </button>
              );
            })}
          </div>

          {/* 画质芯片 */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-white/40">
              <Gauge className="size-3.5 opacity-70" strokeWidth={1.75} />
              输出画质
            </div>
            <div className="flex flex-wrap gap-1">
              {enhanceResolutions.map((r) => {
                const on = enhanceResolution === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onChange({ enhanceResolution: r })}
                    className={cn(
                      "min-w-[52px] rounded-lg px-2 py-1.5 text-center text-[12px] font-medium tabular-nums transition-all duration-150",
                      on
                        ? "bg-white text-[#0c0e14] shadow-sm"
                        : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white/85"
                    )}
                  >
                    {ENHANCE_RES_LABEL[r] || r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 帧率 / 风格 / 场景 · 两列 */}
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-white/40">
                <Clapperboard className="size-3.5 opacity-70" strokeWidth={1.75} />
                帧率
              </span>
              <Select
                value={values.enhanceFps || "keep"}
                onValueChange={(value) =>
                  onChange({ enhanceFps: !value || value === "keep" ? "" : value })
                }
              >
                <SelectTrigger
                  className={cn(
                    CANVAS_SELECT_TRIGGER_CLASS,
                    "h-8 w-full border-white/[0.08] bg-white/[0.04] text-[12px]"
                  )}
                >
                  <SelectValue placeholder="保持原帧率">{fpsLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
                  {ENHANCE_FPS.map((opt) => (
                    <SelectItem
                      key={opt.value || "keep"}
                      value={opt.value || "keep"}
                      label={opt.label}
                      className={CANVAS_SELECT_ITEM_CLASS}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-white/40">风格</span>
              <Select
                value={values.enhanceStyle || "hd"}
                onValueChange={(value) => value && onChange({ enhanceStyle: value })}
              >
                <SelectTrigger
                  className={cn(
                    CANVAS_SELECT_TRIGGER_CLASS,
                    "h-8 w-full border-white/[0.08] bg-white/[0.04] text-[12px]"
                  )}
                >
                  <SelectValue placeholder={styleLabel}>{styleLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
                  {ENHANCE_STYLES.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      label={opt.label}
                      className={CANVAS_SELECT_ITEM_CLASS}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {!isPro && (
              <label className="col-span-2 block space-y-1">
                <span className="text-[11px] text-white/40">场景模板</span>
                <Select
                  value={values.enhanceScene || "common"}
                  onValueChange={(value) => value && onChange({ enhanceScene: value })}
                >
                  <SelectTrigger
                    className={cn(
                      CANVAS_SELECT_TRIGGER_CLASS,
                      "h-8 w-full border-white/[0.08] bg-white/[0.04] text-[12px]"
                    )}
                  >
                    <SelectValue placeholder={sceneLabel}>{sceneLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
                    {ENHANCE_SCENES.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        label={opt.label}
                        className={CANVAS_SELECT_ITEM_CLASS}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}

            {isPro && (
              <label className="col-span-2 block space-y-1">
                <span className="text-[11px] text-white/40">色深</span>
                <div className="flex gap-1">
                  {["8", "10", "12", "16"].map((d) => {
                    const on = (values.enhanceBitDepth || "8") === d;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onChange({ enhanceBitDepth: d })}
                        className={cn(
                          "flex-1 rounded-lg py-1.5 text-[12px] tabular-nums transition-colors",
                          on
                            ? "bg-amber-400/90 font-medium text-[#1a1205]"
                            : "bg-white/[0.06] text-white/55 hover:bg-white/[0.1]"
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </label>
            )}
          </div>

          <button
            type="button"
            disabled={generating || !hasSourceImage || !hasModel}
            onClick={() => void handleGenerate()}
            className={cn(
              "relative flex h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-[13px] font-semibold transition-all duration-200",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isPro
                ? "bg-gradient-to-r from-amber-300 via-amber-200 to-orange-200 text-[#1a1205] hover:brightness-105"
                : "bg-gradient-to-r from-teal-300 via-cyan-200 to-teal-100 text-[#06201c] hover:brightness-105"
            )}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 hover:opacity-100"
              style={{
                background:
                  "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 50%, transparent 60%)",
                backgroundSize: "200% 100%",
              }}
            />
            <Sparkles className="relative size-4" strokeWidth={2} />
            <span className="relative">{generating ? "增强处理中…" : "开始增强"}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="px-3 pb-2.5 pt-2"
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <h3 className="mb-3 text-[14px] font-medium text-white/90">高清放大</h3>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[13px] text-white/45">模型选择</span>
          <div
            className="pointer-events-none flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-white/10 bg-[#1a1a28] px-2 text-[13px] text-white/75"
            title="在管理后台「模型开关 → 高清」配置实际调用模型"
          >
            <Box className="size-4 shrink-0 text-white/70" strokeWidth={1.75} />
            <span className="truncate text-left text-white/85">{displayName}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[13px] text-white/45">预设</span>
          <Select
            value={values.hdModel || "general"}
            onValueChange={(value) => value && onChange({ hdModel: value })}
          >
            <SelectTrigger className={cn(CANVAS_SELECT_TRIGGER_CLASS, "min-w-0 flex-1")}>
              <SelectValue placeholder={presetLabel}>{presetLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className={CANVAS_SELECT_CONTENT_CLASS} side="top" sideOffset={6}>
              {HD_UPSCALE_MODELS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  className={CANVAS_SELECT_ITEM_CLASS}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[13px] text-white/45">放大倍数</span>
          <div className="inline-flex rounded-lg border border-white/10 bg-[#1a1a28] p-0.5">
            {HD_UPSCALE_SCALES.map((n) => (
              <button
                key={n}
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                  scale === n ? "bg-white/15 text-white" : "text-white/55 hover:text-white/80"
                )}
                onClick={() => onChange({ hdScale: n })}
              >
                {n}x
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={generating || !hasSourceImage || !hasModel}
          onClick={() => void handleGenerate()}
          className="mt-1 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white/90 text-[13px] font-medium text-black hover:bg-white disabled:opacity-40"
        >
          <ArrowUp className="size-4" strokeWidth={2} />
          {generating ? "生成中…" : "开始生成"}
          <span
            className="ml-1 inline-flex items-center gap-0.5 text-[12px] text-black/55"
            title={creditTitle}
          >
            <Zap className="size-3.5" />
            {creditNumber}
          </span>
        </button>
      </div>
    </div>
  );
}
