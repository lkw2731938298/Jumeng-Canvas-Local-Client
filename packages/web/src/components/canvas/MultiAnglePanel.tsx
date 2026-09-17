"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EdgeLabelRenderer } from "@xyflow/react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { formatCreditLabel } from "@/lib/api/credits";
import { useCanvasStoreCreditBalance } from "@/lib/canvas/useGenerationCreditQuote";
import {
  DEFAULT_MULTI_ANGLE,
  ELEVATION_MAX,
  ELEVATION_MIN,
  ELEVATION_PRESET_VALUES,
  HORIZONTAL_AZIMUTH_MAX,
  HORIZONTAL_AZIMUTH_MIN,
  HORIZONTAL_AZIMUTH_VALUES,
  SHOT_SCALES,
  formatAngleNumber,
  isPresetAzimuth,
  isPresetElevation,
  normalizeAzimuth,
  normalizeElevation,
  type ShotScale,
} from "@/lib/canvas/multiAnglePresets";
import { runMultiAngleGenerate } from "@/lib/canvas/runMultiAngleGenerate";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import {
  buildCanvasOverlayStyle,
  CANVAS_EDITOR_NODE_GAP,
  CANVAS_MULTI_ANGLE_PANEL_WIDTH,
  CANVAS_OVERLAY_Z_SPECIAL_PANEL,
  getNodeWorldPosition,
} from "@/lib/canvas/canvasOverlayTransform";
import { useMultiAngleModel } from "@/lib/canvas/useMultiAngleModel";
import { usePromptSuffixTools } from "@/lib/canvas/usePromptSuffixTools";
import {
  buildMultiAnglePrompt,
  resolveMultiAngleBasePrompt,
} from "@/lib/canvas/resolveMultiAnglePrompt";
import { mergeComposerBase } from "@/lib/canvas/renderToolPrompt";
import { useMultiAngleComposedPrompt } from "@/lib/canvas/useMultiAngleComposedPrompt";
import { usePromptToolConfig } from "@/lib/canvas/usePromptToolConfig";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";
import { CameraAngleBall } from "./CameraAngleBall";
import type { WorkflowNodeData } from "@/types/workflow";

const PANEL_STYLE = {
  background: "rgba(18, 18, 28, 0.96)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(139, 92, 246, 0.35)",
} as const;

/** LibTV-style multi-angle panel — replaces bottom prompt editor while active. */
export function MultiAnglePanel() {
  const multiAngleNodeId = useCanvasStore((s) => s.multiAngleNodeId);
  const closeMultiAngle = useCanvasStore((s) => s.closeMultiAngle);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const viewportZoom = useCanvasStore((s) => s.viewport.zoom);

  const node = useMemo(
    () => (multiAngleNodeId ? nodes.find((n) => n.id === multiAngleNodeId) ?? null : null),
    [multiAngleNodeId, nodes]
  );

  const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  const { url: sourceImageUrl } = useNodeAssetMedia(multiAngleNodeId ?? "", { urlParamKey: "imageUrl" });

  const queryClient = useQueryClient();
  const { multiAngle, isReady: configReady } = usePromptToolConfig("multi_angle");

  useEffect(() => {
    if (!multiAngleNodeId) return;
    void queryClient.refetchQueries({ queryKey: ["prompt-config", "multi_angle"] });
    void queryClient.refetchQueries({ queryKey: ["prompt-config"] });
    void queryClient.invalidateQueries({ queryKey: ["models", "image"] });
  }, [multiAngleNodeId, queryClient]);
  const config = multiAngle?.ui ?? {
    horizontalLabels: {} as Record<string, string>,
    elevationLabels: {} as Record<string, string>,
    shotLabels: {} as Record<string, string>,
    joiner: "，",
    consistency: "",
  };
  const composerConfig = multiAngle?.config;
  const { items: appendSuffixItems } = usePromptSuffixTools();
  const {
    modelName,
    defaultGenerationOptions,
    hasModel,
    selectedModel,
    quoteToken,
    total: creditTotal,
    creditsEnabled,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useMultiAngleModel();

  const [azimuth, setAzimuth] = useState(DEFAULT_MULTI_ANGLE.azimuth);
  const [elevation, setElevation] = useState(DEFAULT_MULTI_ANGLE.elevation);
  const [shot, setShot] = useState<ShotScale>(DEFAULT_MULTI_ANGLE.shot);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [basePrompt, setBasePrompt] = useState("");

  useEffect(() => {
    if (!multiAngleNodeId || !projectId || !composerConfig) return;
    let cancelled = false;

    void resolveMultiAngleBasePrompt(
      projectId,
      multiAngleNodeId,
      String(params.prompt ?? ""),
      edges,
      nodes,
      appendSuffixItems,
      composerConfig
    ).then((resolved) => {
      if (!cancelled) setBasePrompt(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [
    multiAngleNodeId,
    projectId,
    composerConfig,
    params.prompt,
    edges,
    nodes,
    appendSuffixItems,
  ]);

  const composeRuntime = useMemo(
    () => ({
      base: basePrompt,
      extra: extraPrompt,
      azimuth,
      elevation,
      shot,
    }),
    [basePrompt, extraPrompt, azimuth, elevation, shot]
  );

  const { data: previewData } = useMultiAngleComposedPrompt(composeRuntime, configReady);

  const composedPrompt = useMemo(() => {
    if (previewData?.prompt) return previewData.prompt;
    if (!composerConfig || !configReady) return "";
    return buildMultiAnglePrompt(composerConfig, composeRuntime);
  }, [previewData?.prompt, composerConfig, configReady, composeRuntime]);

  const effectiveBase = useMemo(() => {
    if (!composerConfig) return basePrompt;
    return mergeComposerBase(composerConfig, basePrompt);
  }, [composerConfig, basePrompt]);

  const { data: creditBalanceData } = useCanvasStoreCreditBalance();
  const insufficientCredits =
    creditsEnabled &&
    creditTotal > 0 &&
    creditBalanceData?.balance != null &&
    creditBalanceData.balance < creditTotal;
  const generateCreditLabel = quoteLoading ? "…" : formatCreditLabel(creditTotal, creditsEnabled);

  useEffect(() => {
    if (!multiAngleNodeId) return;
    setAzimuth(DEFAULT_MULTI_ANGLE.azimuth);
    setElevation(DEFAULT_MULTI_ANGLE.elevation);
    setShot(DEFAULT_MULTI_ANGLE.shot);
    setExtraPrompt("");
  }, [multiAngleNodeId]);

  useEffect(() => {
    if (!multiAngleNodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !generating) closeMultiAngle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiAngleNodeId, generating, closeMultiAngle]);

  const handleGenerate = useCallback(async () => {
    if (!projectId || !node || !multiAngleNodeId || !modelName || !hasModel || generating || !composerConfig) return;

    const prompt = composedPrompt;
    if (!prompt.trim() || !effectiveBase.trim()) {
      toast.error("请在后台配置基础描述，或连接文本节点填写画布 prompt");
      return;
    }

    setGenerating(true);
    try {
      const ok = await runMultiAngleGenerate({
        projectId,
        sourceNodeId: multiAngleNodeId,
        workflowId,
        creditsEnabled,
        queryClient,
        prompt,
        azimuth,
        elevation,
        shot,
        modelName,
        generationOptions: defaultGenerationOptions,
        quoteToken: quoteToken ?? undefined,
        onRefetchPricing: () => void refetchQuote(),
      });
      if (ok) closeMultiAngle();
    } finally {
      setGenerating(false);
    }
  }, [
    projectId,
    node,
    multiAngleNodeId,
    modelName,
    hasModel,
    generating,
    composedPrompt,
    effectiveBase,
    azimuth,
    elevation,
    shot,
    composerConfig,
    workflowId,
    defaultGenerationOptions,
    quoteToken,
    creditsEnabled,
    refetchQuote,
    queryClient,
    closeMultiAngle,
  ]);

  if (!multiAngleNodeId || !node || node.type !== "image_input") return null;

  const { width, height } = resolveNodeSize(node.width, node.height);
  const world = getNodeWorldPosition(node, nodes);
  const anchorX = world.x + width / 2;
  const anchorY = world.y + height + CANVAS_EDITOR_NODE_GAP;
  const overlayStyle = buildCanvasOverlayStyle(anchorX, anchorY, viewportZoom, "below", {
    width: CANVAS_MULTI_ANGLE_PANEL_WIDTH,
    ...PANEL_STYLE,
    zIndex: CANVAS_OVERLAY_Z_SPECIAL_PANEL,
  });

  return (
    <EdgeLabelRenderer>
      <div
        /* nowheel：滚轮在浮层内滚动，不被 React Flow 拦去缩放画布 */
        className="canvas-node-overlay nodrag nopan nowheel pointer-events-auto rounded-xl shadow-2xl"
        style={overlayStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
          <div>
            <h3 className="text-sm font-medium text-white/90">多角度 · 机位控制</h3>
            <p className="mt-0.5 text-[10px] text-white/35">拖拽角度球或点选预设，生成并连线到原图</p>
          </div>
          <button
            type="button"
            disabled={generating}
            onClick={closeMultiAngle}
            className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-3 py-3">
          <div className="flex items-start gap-3">
            {sourceImageUrl ? (
              <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                <img src={sourceImageUrl} alt="" className="max-h-40 w-full object-contain" />
              </div>
            ) : (
              <p className="flex-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-200/90">
                请先在上方菜单上传参考图片
              </p>
            )}

            <div className="shrink-0">
              <CameraAngleBall
                azimuth={azimuth}
                elevation={elevation}
                disabled={generating}
                onChange={({ azimuth: nextAzimuth, elevation: nextElevation }) => {
                  setAzimuth(nextAzimuth);
                  setElevation(nextElevation);
                }}
              />
            </div>
          </div>

          {!hasModel ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200/90">
              请在后台启用图片模型（如即梦），或配置「其他模型」中的多角度工具模型
            </p>
          ) : (
            <p className="text-[11px] text-white/40">
              {selectedModel?.displayName ? (
                <>模型 {selectedModel.displayName} · </>
              ) : null}
              本次 {generateCreditLabel}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 text-[11px] text-white/45">
            <label className="flex flex-col gap-1">
              <span>水平 {formatAngleNumber(normalizeAzimuth(azimuth))}°</span>
              <input
                type="range"
                min={HORIZONTAL_AZIMUTH_MIN}
                max={HORIZONTAL_AZIMUTH_MAX}
                step={0.1}
                value={normalizeAzimuth(azimuth)}
                disabled={generating}
                onChange={(e) => setAzimuth(Number(e.target.value))}
                className="w-full accent-purple-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span>俯仰 {formatAngleNumber(normalizeElevation(elevation))}°</span>
              <input
                type="range"
                min={ELEVATION_MIN}
                max={ELEVATION_MAX}
                step={0.1}
                value={normalizeElevation(elevation)}
                disabled={generating}
                onChange={(e) => setElevation(Number(e.target.value))}
                className="w-full accent-purple-400"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div>
              <p className="mb-1.5 text-[11px] text-white/45">水平环绕（0° 正 · 90° 右 · 180° 背 · 270° 左）</p>
              <div className="flex flex-wrap gap-1.5">
                {HORIZONTAL_AZIMUTH_VALUES.map((value) => {
                  const key = String(value);
                  const active = isPresetAzimuth(azimuth, value);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={generating}
                      onClick={() => setAzimuth(value)}
                      className={`rounded-md px-2 py-1 text-[10px] transition-colors ${
                        active
                          ? "bg-purple-500/30 text-purple-100 ring-1 ring-purple-400/40"
                          : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {config.horizontalLabels[key] ?? `${value}°`}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-white/45">俯仰（+90° 顶视 · 0° 平视 · -90° 仰拍）</p>
              <div className="flex flex-wrap gap-1.5">
                {ELEVATION_PRESET_VALUES.map((value) => {
                  const key = String(value);
                  const active = isPresetElevation(elevation, value);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={generating}
                      onClick={() => setElevation(value)}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                        active
                          ? "bg-purple-500/30 text-purple-100 ring-1 ring-purple-400/40"
                          : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {config.elevationLabels[key] ?? key}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-white/45">景别</p>
              <div className="flex flex-wrap gap-1.5">
                {SHOT_SCALES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={generating}
                    onClick={() => setShot(value)}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      shot === value
                        ? "bg-purple-500/30 text-purple-100 ring-1 ring-purple-400/40"
                        : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {config.shotLabels[value] ?? value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] text-white/45">补充描述（可选）</p>
            <input
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              disabled={generating}
              placeholder="例如：镜头略偏上、强调面部表情…"
              className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-purple-400/40"
            />
          </div>

          {/* 画布侧不展示合成 prompt，仅后台/生成链路使用 */}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-3 py-2.5">
          <button
            type="button"
            disabled={generating}
            onClick={closeMultiAngle}
            className="rounded-md px-3 py-1.5 text-xs text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={
              generating ||
              insufficientCredits ||
              !configReady ||
              !modelName ||
              !hasModel ||
              !sourceImageUrl
            }
            title={insufficientCredits ? `算力不足，需要 ${creditTotal}` : undefined}
            onClick={handleGenerate}
            className="flex items-center gap-1.5 rounded-md bg-purple-500/25 px-4 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/35 disabled:opacity-40"
          >
            {generating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                生成中
              </>
            ) : (
              <>生成并连线 · {generateCreditLabel}</>
            )}
          </button>
        </div>
      </div>
    </EdgeLabelRenderer>
  );
}
