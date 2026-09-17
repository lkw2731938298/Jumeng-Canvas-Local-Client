"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import {
  CREATIVE_TOOL_COLUMNS,
  isConceptSheetTool,
  isCreativeGridChildTool,
  type CreativeToolItem,
} from "@/lib/canvas/imageCreativeToolsCatalog";
import {
  isNanoProOfficialModel,
  NANO_PRO_OFFICIAL_DISABLED_IDS,
} from "@/lib/canvas/creativeToolsShared";
import { VisualStylePickerDialog } from "./VisualStylePickerDialog";
import { useVisualStyles } from "@/lib/canvas/useVisualStyles";
import {
  DEFAULT_VISUAL_STYLE_ID,
  findCreativeToolPrompt,
  type CreativeToolsPromptToolConfig,
} from "@/lib/canvas/renderToolPrompt";
import { getPromptConfig } from "@/lib/api/promptConfig";
import { formatCreditLabel } from "@/lib/api/credits";
import {
  CREATIVE_TOOLS_CANVAS_TOOL,
  buildCreativeToolSubmitPrompt,
  runCreativeToolDirectGenerate,
} from "@/lib/canvas/runCreativeToolDirectGenerate";
import { resolveCreativeGridToolModel } from "@/lib/canvas/resolveCreativeGridToolModel";
import type { StoryboardSheetKind } from "@/lib/canvas/runStoryboardSheetGenerate";

function CreativeToolRow({
  item,
  disabled,
  disabledReason,
  busy,
  creditCost,
  creditLoading,
  creditsEnabled,
  showCredit,
  onSelect,
}: {
  item: CreativeToolItem;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  creditCost?: number;
  creditLoading?: boolean;
  creditsEnabled?: boolean;
  /** 会触发扣费的生成项才展示算力（画风选择除外） */
  showCredit?: boolean;
  onSelect: (item: CreativeToolItem) => void;
}) {
  const Icon = item.icon;
  const creditTitle =
    showCredit && !creditLoading && creditCost != null
      ? formatCreditLabel(creditCost, creditsEnabled !== false)
      : undefined;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      title={
        disabled
          ? disabledReason || "当前模型不支持"
          : creditTitle
            ? `${item.label} · ${creditTitle}`
            : item.label
      }
      onClick={() => onSelect(item)}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-[10px] border border-transparent px-2 py-2 text-left transition-colors",
        disabled || busy
          ? "cursor-not-allowed opacity-35"
          : "hover:border-purple-500/35 hover:bg-purple-500/15 active:bg-purple-500/25"
      )}
    >
      <span
        className={cn(
          "relative mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-[8px] border border-white/10 bg-[#1a1a28] text-white/80 transition-colors",
          !(disabled || busy) &&
            "group-hover:border-purple-500/45 group-hover:bg-purple-500/20 group-hover:text-white"
        )}
      >
        <Icon className="size-[15px]" strokeWidth={1.75} />
        {item.iconBadge ? (
          <span className="absolute bottom-0.5 right-0.5 text-[8px] font-semibold leading-none text-white/90">
            {item.iconBadge}
          </span>
        ) : null}
        {item.badge ? (
          <span
            className="absolute -right-0.5 -top-0.5 size-[6px] rounded-full bg-purple-400 shadow-[0_0_0_1.5px_#14141f]"
            aria-hidden
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "block min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug text-white/85",
              !(disabled || busy) && "group-hover:text-white"
            )}
          >
            {busy ? `${item.label}…` : item.label}
          </span>
          {showCredit ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-white/45"
              title={creditTitle}
              aria-label={creditTitle}
            >
              <Zap className="size-3 fill-current text-primary" aria-hidden />
              <span className="font-mono text-white/70">
                {creditLoading ? "…" : creditCost != null && creditCost > 0 ? creditCost.toLocaleString() : "—"}
              </span>
            </span>
          ) : null}
        </span>
        {item.description ? (
          <span
            className={cn(
              "mt-0.5 block text-[11px] leading-snug text-white/40",
              !(disabled || busy) && "group-hover:text-white/55"
            )}
          >
            {item.description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

interface CreativeToolsPopoverPanelProps {
  nodeId: string | null;
  hasImage: boolean;
  visualStyleId: string;
  onVisualStyleChange: (styleId: string) => void;
  modelName?: string;
  /** 各画布工具固定算力（按 toolId；子功能缺省回退 grid_9） */
  costByTool?: Record<string, number | undefined>;
  creditLoading?: boolean;
  creditsEnabled?: boolean;
  /** @deprecated 全景/九宫格改为直接生图，保留兼容调用方 */
  onPanorama?: () => void;
  /** @deprecated 全景/九宫格改为直接生图，保留兼容调用方 */
  onGrid9?: () => void;
  onItemSelected?: () => void;
  /** 生成中回调：父级可用来禁用顶栏其它按钮（如传入 grid_9） */
  onGeneratingChange?: (toolId: string | null) => void;
  className?: string;
}

/** 创作工具两列宫格（分镜叙事 / 质感 / 空间机位 / 设定图） */
export function CreativeToolsPopoverPanel({
  nodeId,
  hasImage,
  visualStyleId,
  onVisualStyleChange,
  modelName,
  costByTool,
  creditLoading,
  creditsEnabled = true,
  onItemSelected,
  onGeneratingChange,
  className,
}: CreativeToolsPopoverPanelProps) {
  const [styleOpen, setStyleOpen] = useState(false);
  const [generatingToolId, setGeneratingToolId] = useState<string | null>(null);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const openStoryboardSheet = useCanvasStore((s) => s.openStoryboardSheet);
  const queryClient = useQueryClient();
  const { styles, config } = useVisualStyles();
  const isProOfficial = isNanoProOfficialModel(modelName);

  // 后台 Prompt 模板 → 九宫格：各功能独立提示词
  const { data: promptConfig } = useQuery({
    queryKey: ["prompt-config"],
    queryFn: getPromptConfig,
    staleTime: 30_000,
  });
  const creativeToolsConfig = useMemo(() => {
    const raw = promptConfig?.tools?.grid_9;
    return raw?.kind === "creative_tools" ? (raw as CreativeToolsPromptToolConfig) : null;
  }, [promptConfig?.tools?.grid_9]);

  const creditForItem = useCallback(
    (itemId: string) => {
      const direct = costByTool?.[itemId];
      if (direct != null) return direct;
      return costByTool?.[CREATIVE_TOOLS_CANVAS_TOOL];
    },
    [costByTool]
  );

  const isNarrativeEntry = useCallback(
    (item: CreativeToolItem) => item.id === "storyboard" || item.id === "blocking_storyboard",
    []
  );

  const isItemDisabled = useCallback(
    (item: CreativeToolItem) => {
      // 故事板/调度故事板、设定图：打开或生成可不依赖当前是否已有图
      if (isNarrativeEntry(item) || isConceptSheetTool(item.id)) {
        return Boolean(generatingToolId) || !nodeId;
      }
      if (!nodeId) return true;
      if (generatingToolId) return true;
      if (isProOfficial && NANO_PRO_OFFICIAL_DISABLED_IDS.has(item.id)) return true;
      // 其余图生图工具仍需参考图
      if (!hasImage) return true;
      return false;
    },
    [generatingToolId, hasImage, isNarrativeEntry, isProOfficial, nodeId]
  );

  /** 点击工具：故事板/调度故事板打开合成图输入条；其余对齐顶栏全景直接图生图 */
  const handleSelect = useCallback(
    async (item: CreativeToolItem) => {
      if (generatingToolId) return;

      if (isProOfficial && NANO_PRO_OFFICIAL_DISABLED_IDS.has(item.id)) {
        toast.message(`${item.label}在全能 Pro 官方稳定版暂不可用`);
        return;
      }

      if (item.mapsTo === "visual_style" || item.id === "visual_style") {
        onItemSelected?.();
        setStyleOpen(true);
        return;
      }

      // 故事板 / 调度故事板：弹出浮动输入条（参考图 + 文字 → 一张多镜合成图）
      if (item.id === "storyboard" || item.id === "blocking_storyboard") {
        openStoryboardSheet(item.id as StoryboardSheetKind, nodeId);
        onItemSelected?.();
        return;
      }

      if (!nodeId) return;

      // 设定图：允许无参考图，仅按后台提示词文生图；有图则走图生图
      const allowTextOnly = isConceptSheetTool(item.id);
      if (!hasImage && !allowTextOnly) {
        toast.error("请先上传参考图片");
        return;
      }

      if (!projectId) {
        toast.error("项目未加载");
        return;
      }

      const adminItem = findCreativeToolPrompt(creativeToolsConfig, item.id);
      const label = adminItem?.label?.trim() || item.label;
      const adminPrompt = adminItem?.prompt?.trim() || "";
      if (!adminPrompt) {
        toast.error(`请在后台配置「${label}」的提示词`);
        return;
      }

      // 与故事板一致：节点 textarea 提示词 + 后台预设一并提交
      const sourceNode = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      const userPrompt = String(
        ((sourceNode?.data?.params ?? {}) as Record<string, unknown>).prompt ?? ""
      ).trim();
      const prompt = buildCreativeToolSubmitPrompt(userPrompt, adminPrompt);

      // 各功能独立 canvasTool：后台可分别配置主/副模型与固定算力
      const canvasTool = isCreativeGridChildTool(item.id)
        ? item.id
        : CREATIVE_TOOLS_CANVAS_TOOL;

      let modelNameResolved = "";
      let generationOptions;
      try {
        const resolved = await resolveCreativeGridToolModel(canvasTool);
        modelNameResolved = resolved.modelName;
        generationOptions = resolved.generationOptions;
      } catch {
        toast.error("无法读取该功能的模型配置");
        return;
      }
      if (!modelNameResolved) {
        toast.error(`请在后台「模型开关」为「${label}」配置主模型`);
        return;
      }

      if (allowTextOnly && !hasImage) {
        toast.message(`未添加参考图：将仅按文字生成「${label}」`);
      }

      // 生成完成后再关弹层，避免卸载中断 busy 态；对齐顶栏全景「点选即生图」
      setGeneratingToolId(item.id);
      onGeneratingChange?.(canvasTool);
      try {
        await runCreativeToolDirectGenerate({
          projectId,
          sourceNodeId: nodeId,
          label,
          prompt,
          /** 结果节点卡片优先展示用户提示词，不暴露过长后台预设 */
          nodePrompt: userPrompt || prompt,
          modelName: modelNameResolved,
          generationOptions,
          workflowId,
          creditsEnabled: creditsEnabled !== false,
          queryClient,
          canvasTool,
          allowMissingSourceImage: allowTextOnly,
          onRefetchPricing: () => {
            void queryClient.invalidateQueries({ queryKey: ["credits", "canvas-tool-pricing"] });
            void queryClient.invalidateQueries({ queryKey: ["canvas-tool-models"] });
          },
        });
      } finally {
        setGeneratingToolId(null);
        onGeneratingChange?.(null);
        onItemSelected?.();
      }
    },
    [
      creativeToolsConfig,
      creditsEnabled,
      generatingToolId,
      hasImage,
      isProOfficial,
      nodeId,
      onGeneratingChange,
      onItemSelected,
      openStoryboardSheet,
      projectId,
      queryClient,
      workflowId,
    ]
  );

  return (
    <>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-purple-500/30 bg-[#14141f]/[0.98] px-2.5 py-3 text-white shadow-2xl backdrop-blur-md ring-1 ring-white/10",
          className
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-x-2">
          {CREATIVE_TOOL_COLUMNS.map((column, colIdx) => (
            <div key={colIdx} className="min-w-0 space-y-3.5">
              {column.map((section) => (
                <section key={section.id}>
                  <p className="mb-1.5 px-2 text-[12px] font-medium tracking-wide text-white/40">
                    {section.label}
                  </p>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const isStylePicker =
                        item.mapsTo === "visual_style" || item.id === "visual_style";
                      const isNarrative = isNarrativeEntry(item);
                      const needsImage =
                        !isStylePicker && !isNarrative && !isConceptSheetTool(item.id);
                      return (
                        <CreativeToolRow
                          key={item.id}
                          item={item}
                          disabled={isItemDisabled(item)}
                          busy={generatingToolId === item.id}
                          disabledReason={
                            isProOfficial && NANO_PRO_OFFICIAL_DISABLED_IDS.has(item.id)
                              ? "全能 Pro 官方稳定版暂不支持"
                              : needsImage && !hasImage
                                ? "请先上传参考图片"
                                : undefined
                          }
                          showCredit={!isStylePicker && !isNarrative}
                          creditCost={creditForItem(item.id)}
                          creditLoading={creditLoading}
                          creditsEnabled={creditsEnabled}
                          onSelect={(selected) => void handleSelect(selected)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ))}
        </div>
      </div>

      <VisualStylePickerDialog
        open={styleOpen}
        onOpenChange={setStyleOpen}
        styles={styles}
        value={visualStyleId?.trim() || DEFAULT_VISUAL_STYLE_ID}
        onSelect={(id) => {
          onVisualStyleChange(id);
          setStyleOpen(false);
        }}
      />
    </>
  );
}
