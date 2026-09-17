"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EdgeLabelRenderer } from "@xyflow/react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { formatCreditLabel } from "@/lib/api/credits";
import { useCanvasStoreCreditBalance } from "@/lib/canvas/useGenerationCreditQuote";
import {
  DEFAULT_LIGHTING,
  normalizeLightingOptions,
  type LightingOptions,
} from "@/lib/canvas/lightingPresets";
import { runLightingGenerate } from "@/lib/canvas/runLightingGenerate";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import {
  buildCanvasOverlayStyle,
  CANVAS_EDITOR_NODE_GAP,
  CANVAS_LIGHTING_PANEL_WIDTH,
  CANVAS_OVERLAY_Z_SPECIAL_PANEL,
  getNodeWorldPosition,
} from "@/lib/canvas/canvasOverlayTransform";
import { useLightingModel } from "@/lib/canvas/useLightingModel";
import { usePromptSuffixTools } from "@/lib/canvas/usePromptSuffixTools";
import { resolveMultiAngleBasePrompt } from "@/lib/canvas/resolveMultiAnglePrompt";
import { buildLightingPromptFromConfig } from "@/lib/canvas/resolveLightingPrompt";
import { mergeComposerBase } from "@/lib/canvas/renderToolPrompt";
import { useLightingComposedPrompt } from "@/lib/canvas/useLightingComposedPrompt";
import { usePromptToolConfig } from "@/lib/canvas/usePromptToolConfig";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";
import { LightSourceBall } from "./LightSourceBall";
import type { LightDirection } from "@/lib/canvas/renderToolPrompt";
import type { WorkflowNodeData } from "@/types/workflow";

const PANEL_STYLE = {
  background: "rgba(18, 18, 28, 0.96)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(139, 92, 246, 0.35)",
} as const;

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? "bg-purple-500/70" : "bg-white/15"
      } disabled:opacity-40`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** LibTV-style lighting panel — replaces bottom prompt editor while active. */
export function LightingPanel() {
  const lightingNodeId = useCanvasStore((s) => s.lightingNodeId);
  const closeLighting = useCanvasStore((s) => s.closeLighting);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const viewportZoom = useCanvasStore((s) => s.viewport.zoom);

  const node = useMemo(
    () => (lightingNodeId ? nodes.find((n) => n.id === lightingNodeId) ?? null : null),
    [lightingNodeId, nodes]
  );

  const params = (node?.data as WorkflowNodeData | undefined)?.params ?? {};
  const { url: sourceImageUrl } = useNodeAssetMedia(lightingNodeId ?? "", { urlParamKey: "imageUrl" });

  const queryClient = useQueryClient();
  const { lighting, isLoading: configLoading, isReady: configReady } = usePromptToolConfig("lighting");

  useEffect(() => {
    if (!lightingNodeId) return;
    void queryClient.refetchQueries({ queryKey: ["prompt-config", "lighting"] });
    void queryClient.refetchQueries({ queryKey: ["prompt-config"] });
    void queryClient.invalidateQueries({ queryKey: ["models", "image"] });
  }, [lightingNodeId, queryClient]);

  const config = lighting?.ui ?? {
    directionLabels: {} as Record<string, string>,
    joiner: "，",
    consistency: "",
    defaultBase: "",
    baseMode: "admin" as const,
  };
  const composerConfig = lighting?.config;
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
  } = useLightingModel();

  const [options, setOptions] = useState<LightingOptions>({ ...DEFAULT_LIGHTING });
  const [extraPrompt, setExtraPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [basePrompt, setBasePrompt] = useState("");

  const setOption = <K extends keyof LightingOptions>(key: K, value: LightingOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!lightingNodeId || !projectId || !composerConfig) return;
    let cancelled = false;

    void resolveMultiAngleBasePrompt(
      projectId,
      lightingNodeId,
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
  }, [lightingNodeId, projectId, composerConfig, params.prompt, edges, nodes, appendSuffixItems]);

  const composeRuntime = useMemo(
    () => ({
      base: basePrompt,
      extra: extraPrompt,
      direction: options.direction,
      brightness: options.brightness,
      color: options.color,
      rimLight: options.rimLight,
      smartMode: options.smartMode,
    }),
    [basePrompt, extraPrompt, options]
  );

  const {
    data: previewData,
    isFetching: previewFetching,
    isError: previewError,
  } = useLightingComposedPrompt(composeRuntime, configReady);

  const composedPrompt = useMemo(() => {
    if (previewData?.prompt) return previewData.prompt;
    if (!composerConfig || !configReady) return "";
    return buildLightingPromptFromConfig(composerConfig, composeRuntime);
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
    if (!lightingNodeId) return;
    const nodeParams = useCanvasStore.getState().nodes.find((n) => n.id === lightingNodeId)
      ?.data?.params;
    setOptions(normalizeLightingOptions(nodeParams?.lightingOptions));
    setExtraPrompt("");
  }, [lightingNodeId]);

  useEffect(() => {
    if (!lightingNodeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !generating) closeLighting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightingNodeId, generating, closeLighting]);

  const handleReset = () => {
    setOptions({ ...DEFAULT_LIGHTING });
    setExtraPrompt("");
  };

  const handleGenerate = useCallback(async () => {
    if (!projectId || !node || !lightingNodeId || !modelName || !hasModel || generating || !composerConfig) return;

    const prompt = composedPrompt;
    if (!prompt.trim() || !effectiveBase.trim()) {
      toast.error("请在后台配置基础描述，或连接文本节点填写画布 prompt");
      return;
    }

    setGenerating(true);
    try {
      const ok = await runLightingGenerate({
        projectId,
        sourceNodeId: lightingNodeId,
        workflowId,
        creditsEnabled,
        queryClient,
        prompt,
        lightingOptions: options,
        modelName,
        generationOptions: defaultGenerationOptions,
        quoteToken: quoteToken ?? undefined,
        directionLabel: config.directionLabels[options.direction] ?? options.direction,
        persistOptions: true,
        onRefetchPricing: () => void refetchQuote(),
      });
      if (ok) closeLighting();
    } finally {
      setGenerating(false);
    }
  }, [
    projectId,
    node,
    lightingNodeId,
    modelName,
    hasModel,
    generating,
    composedPrompt,
    effectiveBase,
    options,
    config.directionLabels,
    composerConfig,
    workflowId,
    defaultGenerationOptions,
    quoteToken,
    creditsEnabled,
    refetchQuote,
    queryClient,
    closeLighting,
  ]);

  if (!lightingNodeId || !node || node.type !== "image_input") return null;

  const { width, height } = resolveNodeSize(node.width, node.height);
  const world = getNodeWorldPosition(node, nodes);
  const anchorX = world.x + width / 2;
  const anchorY = world.y + height + CANVAS_EDITOR_NODE_GAP;
  const overlayStyle = buildCanvasOverlayStyle(anchorX, anchorY, viewportZoom, "below", {
    width: CANVAS_LIGHTING_PANEL_WIDTH,
    ...PANEL_STYLE,
    zIndex: CANVAS_OVERLAY_Z_SPECIAL_PANEL,
  });

  const directionGrid: LightDirection[][] = [
    ["left", "top", "right"],
    ["front", "bottom", "back"],
  ];

  return (
    <EdgeLabelRenderer>
      <div
        /* nowheel：滚轮在浮层内滚动（prompt 预览等），不被 React Flow 拦去缩放画布 */
        className="canvas-node-overlay nodrag nopan nowheel pointer-events-auto rounded-xl shadow-2xl"
        style={overlayStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
          <h3 className="text-sm font-medium text-white/90">打光效果</h3>
          <button
            type="button"
            disabled={generating}
            onClick={closeLighting}
            className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-2">
            <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
              {(["perspective", "front"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={generating}
                  onClick={() => setOption("viewMode", mode)}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                    options.viewMode === mode
                      ? "bg-white/15 text-white"
                      : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {mode === "perspective" ? "透视" : "正面"}
                </button>
              ))}
            </div>

            <LightSourceBall
              direction={options.direction}
              viewMode={options.viewMode}
              disabled={generating}
              onDirectionChange={(direction) => setOption("direction", direction)}
            />
          </div>

          <div className="space-y-3">
            {!sourceImageUrl ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200/90">
                请先在上方菜单上传参考图片
              </p>
            ) : null}

            {!hasModel ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200/90">
                请在后台启用图片模型
              </p>
            ) : (
              <p className="text-[11px] text-white/40">
                {selectedModel?.displayName ? (
                  <>模型 {selectedModel.displayName} · </>
                ) : null}
                本次 {generateCreditLabel}
              </p>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/55">智能模式</span>
              <Toggle
                checked={options.smartMode}
                disabled={generating}
                onChange={(v) => setOption("smartMode", v)}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-white/55">
                <span>亮度</span>
                <span>{Math.round(options.brightness)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={options.brightness}
                disabled={generating}
                onChange={(e) => setOption("brightness", Number(e.target.value))}
                className="w-full accent-purple-400"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-white/55">颜色</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => setOption("color", null)}
                  className={`h-7 w-7 rounded-md border text-[10px] ${
                    options.color === null
                      ? "border-purple-400/50 bg-white/10"
                      : "border-white/15 bg-white/5 text-white/40"
                  }`}
                  title="无着色"
                >
                  ∅
                </button>
                <input
                  type="color"
                  value={options.color ?? "#ffffff"}
                  disabled={generating}
                  onChange={(e) => setOption("color", e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-white/15 bg-transparent p-0.5"
                />
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-white/45">主光源</p>
              <div className="grid grid-cols-3 gap-1.5">
                {directionGrid.flat().map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    disabled={generating}
                    onClick={() => setOption("direction", dir)}
                    className={`rounded-md px-2 py-1.5 text-[10px] transition-colors ${
                      options.direction === dir
                        ? "bg-purple-500/30 text-purple-100 ring-1 ring-purple-400/40"
                        : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {config.directionLabels[dir] ?? dir}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/55">轮廓光</span>
              <Toggle
                checked={options.rimLight}
                disabled={generating}
                onChange={(v) => setOption("rimLight", v)}
              />
            </div>

            <div>
              <p className="mb-1.5 text-[11px] text-white/45">补充描述（可选）</p>
              <input
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                disabled={generating}
                placeholder="例如：增强面部立体感…"
                className="h-8 w-full rounded-md border border-white/10 bg-white/5 px-2.5 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-purple-400/40"
              />
            </div>
          </div>
        </div>

        {(configLoading || previewFetching) && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-[11px] text-white/50">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在按后台模板合成 prompt…
          </div>
        )}
        {previewError ? (
          <div className="mx-3 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200/90">
            无法从后台拉取模板预览，已使用本地回退渲染
          </div>
        ) : null}
        {!configLoading && composedPrompt ? (
          <div className="mx-3 mb-2 rounded-md border border-white/10 bg-black/25 px-2.5 py-2">
            <p className="mb-1 text-[10px] text-white/40">将发送的完整 prompt</p>
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">
              {composedPrompt}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-white/10 px-3 py-2.5">
          <button
            type="button"
            disabled={generating}
            onClick={handleReset}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重置参数
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={generating}
              onClick={closeLighting}
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
      </div>
    </EdgeLabelRenderer>
  );
}
