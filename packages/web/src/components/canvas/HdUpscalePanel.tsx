"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Gauge, Maximize2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type HdUpscaleMediaKind } from "@/lib/canvas/createHdUpscaleNode";
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
import {
  DEFAULT_HD_ASPECT_RATIO,
  DEFAULT_HD_CLARITY_TIER,
  HD_CLARITY_TIERS,
  HD_NANO_BANANA_I2I_DISPLAY,
  HD_NANO_BANANA_I2I_UPSTREAM,
  buildHdImageGenerationOptions,
  computeHdOutputSizePx,
  isHdClarityTierId,
  probeImageNaturalSize,
  type HdClarityTierId,
} from "@/lib/local/topazHdUpscale";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";

export interface HdUpscalePanelValues {
  hdProvider: string;
  hdModel: string;
  hdScale: number;
  /** 图片高清：1k / 2k / 4k */
  hdClarityTier?: string;
  /** @deprecated 已固定原图比例，保留字段兼容旧节点 */
  hdAspectRatio?: string;
  /** @deprecated 旧 MP 档，等同 hdClarityTier */
  hdMpTier?: string;
  hdMpPlusSteps?: number;
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
 * 图片：固定 gemini-nano-banana-2.1 + 1K/2K/4K，比例始终跟原图。
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
  const hdParams = ((hdNode?.data as WorkflowNodeData | undefined)?.params ??
    {}) as Record<string, unknown>;
  const hdVideoUrl = String(hdParams.videoUrl ?? "");
  const hdImageUrl = String(hdParams.imageUrl ?? "");
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [srcPx, setSrcPx] = useState<{ w: number; h: number } | null>(null);
  const canvasTool = hdUpscaleCanvasTool(mediaKind);
  const isVideoHd = mediaKind === "video";
  const { durationSec: videoBillSec } = useNodeVideoDurationSec(
    isVideoHd ? nodeId : null,
    hdVideoUrl,
    isVideoHd && Boolean(nodeId)
  );

  const clarityTier: HdClarityTierId = isHdClarityTierId(
    values.hdClarityTier || values.hdMpTier
  )
    ? ((values.hdClarityTier || values.hdMpTier) as HdClarityTierId)
    : DEFAULT_HD_CLARITY_TIER;
  // 图片比例固定原图，不再提供 UI 选择
  const aspectRatio = DEFAULT_HD_ASPECT_RATIO;

  const previewSize = useMemo(() => {
    if (!srcPx) return null;
    return computeHdOutputSizePx({
      srcW: srcPx.w,
      srcH: srcPx.h,
      clarityTier,
      aspectRatio,
    });
  }, [srcPx, clarityTier, aspectRatio]);

  // 探测源图像素，供 MP 档预览与提交 size
  useEffect(() => {
    if (isVideoHd || !projectId || !hasSourceImage) {
      setSrcPx(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const url =
          (await resolveNodeMediaUrl(projectId, hdParams, "imageUrl")) || hdImageUrl;
        if (!url || cancelled) return;
        const size = await probeImageNaturalSize(url);
        if (!cancelled) setSrcPx({ w: size.width, h: size.height });
      } catch {
        if (!cancelled) setSrcPx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随节点/源图变化探测
  }, [isVideoHd, projectId, hasSourceImage, nodeId, hdImageUrl]);

  const extraGenerationOptions = useMemo(() => {
    if (isVideoHd) {
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
    }
    // 主组 id 在 run 时按目录模型再对齐；此处 size + 档位足够报价刷新
    return buildHdImageGenerationOptions({
      clarityTier,
      aspectRatio,
      outputSize: previewSize?.size || "1024x1024",
      model: null,
    });
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
    clarityTier,
    aspectRatio,
    previewSize?.size,
  ]);

  const {
    modelName,
    hasModel,
    defaultGenerationOptions,
    creditsEnabled,
    refetch: refetchQuote,
  } = useCanvasToolConfiguredModel(
    canvasTool,
    Boolean(nodeId) && (!isVideoHd || videoBillSec != null),
    mediaKind,
    extraGenerationOptions
  );

  const enhanceMode = values.enhanceMode === "professional" ? "professional" : "standard";
  const enhanceResolutions = volcEnhanceResolutions("standard_pro");
  const enhanceResolution = enhanceResolutions.includes(
    String(values.enhanceResolution || "")
  )
    ? String(values.enhanceResolution)
    : "1080p";

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
          : `请先确保目录含「${HD_NANO_BANANA_I2I_DISPLAY}」`
      );
      return;
    }
    if (generating) return;

    setGenerating(true);
    try {
      await runHdUpscaleGenerate({
        projectId,
        nodeId,
        hdModel: HD_NANO_BANANA_I2I_UPSTREAM,
        hdScale: Number(values.hdScale) || 2,
        hdProvider: values.hdProvider || "jumengai",
        hdClarityTier: clarityTier,
        hdAspectRatio: DEFAULT_HD_ASPECT_RATIO,
        hdMpTier: clarityTier,
        modelName,
        generationOptions: {
          ...defaultGenerationOptions,
          ...extraGenerationOptions,
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
              <p
                className="mt-0.5 truncate text-[11px] text-white/40"
                title={VOLC_ENHANCE_STANDARD_PRO_MODEL}
              >
                {VOLC_ENHANCE_STANDARD_PRO_MODEL}
              </p>
            </div>
          </header>

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
            <Sparkles className="relative size-4" strokeWidth={2} />
            <span className="relative">{generating ? "增强处理中…" : "开始增强"}</span>
          </button>
        </div>
      </div>
    );
  }

  // —— 图片高清：gemini-nano-banana-2.1 + 1K/2K/4K，比例跟原图 ——
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, rgba(56,189,248,0.14), transparent 55%)," +
            "radial-gradient(90% 70% at 100% 100%, rgba(167,139,250,0.10), transparent 50%)," +
            "linear-gradient(165deg, #12141c 0%, #0c0e14 55%, #141018 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(56,189,248,0.55), rgba(167,139,250,0.4), transparent)",
        }}
      />

      <div className="relative px-3.5 pb-3.5 pt-3">
        <header className="mb-3 flex items-start gap-2.5">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-sky-400/35 bg-sky-400/10 text-sky-200">
            <Maximize2 className="size-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-wide text-white/95">HD 高清</h3>
              <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-sky-200/90 uppercase">
                I2I
              </span>
            </div>
          </div>
        </header>

        <div className="mb-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-white/40">
            <Gauge className="size-3.5 opacity-70" strokeWidth={1.75} />
            清晰档次
          </div>
          <div className="flex flex-wrap gap-1">
            {HD_CLARITY_TIERS.map((tier) => {
              const on = clarityTier === tier.id;
              return (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() =>
                    onChange({ hdClarityTier: tier.id, hdMpTier: tier.id })
                  }
                  className={cn(
                    "min-w-[72px] flex-1 rounded-lg px-2 py-2 text-center text-[13px] font-medium tabular-nums transition-all duration-150",
                    on
                      ? "bg-white text-[#0c0e14] shadow-sm"
                      : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white/85"
                  )}
                >
                  {tier.label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] tabular-nums text-white/35">
            {previewSize
              ? `按原图比例提交 ${previewSize.size}${
                  srcPx ? `（源 ${srcPx.w}×${srcPx.h}）` : ""
                }`
              : hasSourceImage
                ? "正在读取原图尺寸…"
                : "连接参考图后按原图比例提交"}
          </p>
        </div>

        <button
          type="button"
          disabled={generating || !hasSourceImage || !hasModel || !previewSize}
          onClick={() => void handleGenerate()}
          className={cn(
            "relative flex h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-[13px] font-semibold transition-all duration-200",
            "bg-gradient-to-r from-sky-300 via-cyan-200 to-sky-100 text-[#06201c] hover:brightness-105",
            "disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          <Maximize2 className="relative size-4" strokeWidth={2} />
          <span className="relative">{generating ? "放大处理中…" : "开始放大"}</span>
        </button>
      </div>
    </div>
  );
}
