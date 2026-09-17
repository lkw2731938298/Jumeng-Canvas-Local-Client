"use client";

/**
 * 故事板 / 调度故事板浮动输入条（对齐 LibTV）：
 * 锚定在对应图片节点下方；剧情描述 + 参考图 + 模型/参数 + 算力提交 → 一张多镜合成图。
 * 上游连线图片自动进入参考区，提示词可用 @ 引用。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EdgeLabelRenderer, Panel, useReactFlow } from "@xyflow/react";
import { ArrowUp, BookOpen, Clapperboard, Plus, SlidersHorizontal, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import { NODE_IMAGE_SUBCATEGORY, notifyAssetsUpdated, uploadAsset } from "@/lib/api/assets";
import type { GenerationReference } from "@/lib/api/textGeneration.types";
import { validateCanvasImageFile } from "@/lib/canvas/imageSizePolicy";
import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import {
  buildCanvasOverlayStyle,
  CANVAS_EDITOR_NODE_GAP,
  CANVAS_EDITOR_PANEL_WIDTH,
  CANVAS_OVERLAY_Z_SPECIAL_PANEL,
  getNodeWorldPosition,
} from "@/lib/canvas/canvasOverlayTransform";
import { useCanvasToolConfiguredModel } from "@/lib/canvas/useCanvasToolConfiguredModel";
import {
  STORYBOARD_SHEET_TOOLS,
  type StoryboardSheetKind,
  runStoryboardSheetGenerate,
  stripStoryboardAdminAppend,
} from "@/lib/canvas/runStoryboardSheetGenerate";
import {
  getModelGenerationPresets,
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import type { GenerationOptions } from "@/types/generationPresets";
import {
  collectMentionedReferences,
  filterSlotsForMention,
  getUpstreamMaterialSlots,
  insertMention,
  parseMentionQuery,
  resolveAllReferences,
  type MaterialSlot,
} from "@/lib/canvas/nodeMaterialSlots";
import { PromptMentionTextarea } from "@/components/canvas/PromptMentionTextarea";
import { ImageOptionsBar } from "./ImageOptionsBar";
import { ModelBrandMark } from "./ModelBrandMark";

const PLACEHOLDERS: Record<StoryboardSheetKind, string> = {
  storyboard:
    "描述一个 10-15 秒内能演完的小剧情片段，系统会整理为 4-8 个连续分镜，内容过长时会自动提炼关键剧情。提供角色三视图、美术设定图及准确的需求描述，生成效果会更好。可用 @ 引用参考图。",
  blocking_storyboard:
    "描述一个 10-15 秒剧情片段。系统将生成调度故事板：多镜头画面 + 每镜景别/运镜/动作/音效说明 + 角色道具索引 + 俯视调度与机位图。提供角色三视图与场景设定图效果更佳。可用 @ 引用参考图。",
};

type ExtraRef = {
  id: string;
  url: string;
  assetId?: string;
  title: string;
};

/** 图片节点卡片上已有的图（有图时以此为准，不再当「无图」空条） */
type HostMedia = {
  url: string;
  assetId?: string;
  title: string;
};

/** 上游连线解析出的参考图（自动加入，断线后移除） */
type ConnectedRef = {
  nodeId: string;
  url: string;
  label: string;
};

export function StoryboardSheetComposerPanel() {
  const kind = useCanvasStore((s) => s.storyboardSheetKind);
  const hostNodeId = useCanvasStore((s) => s.storyboardSheetNodeId);
  const closeStoryboardSheet = useCanvasStore((s) => s.closeStoryboardSheet);
  const setStoryboardSheetNodeId = useCanvasStore((s) => s.setStoryboardSheetNodeId);
  const projectId = useCanvasStore((s) => s.projectId);
  const workflowId = useCanvasStore((s) => s.workflowId);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const addNode = useCanvasStore((s) => s.addNode);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const viewport = useCanvasStore((s) => s.viewport);
  const flowPaneSize = useCanvasStore((s) => s.flowPaneSize);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const { screenToFlowPosition } = useReactFlow();

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** 节点底边实测锚点（flow 坐标），避免 store 高度与 DOM 不一致 */
  const [nodeBottomAnchor, setNodeBottomAnchor] = useState<{ x: number; y: number } | null>(null);

  /** 锚定宿主：优先故事板绑定的图片节点，其次当前选中图片节点 */
  const resolvedHostId = useMemo(() => {
    if (hostNodeId && nodes.some((n) => n.id === hostNodeId)) return hostNodeId;
    if (
      selectedNodeId &&
      nodes.find((n) => n.id === selectedNodeId)?.type === "image_input"
    ) {
      return selectedNodeId;
    }
    return null;
  }, [hostNodeId, selectedNodeId, nodes]);

  const hostNode = useMemo(
    () => (resolvedHostId ? nodes.find((n) => n.id === resolvedHostId) ?? null : null),
    [resolvedHostId, nodes]
  );
  const [userPrompt, setUserPrompt] = useState("");
  const [extraRefs, setExtraRefs] = useState<ExtraRef[]>([]);
  const [connectedRefs, setConnectedRefs] = useState<ConnectedRef[]>([]);
  const [hostMedia, setHostMedia] = useState<HostMedia | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>({});
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);

  const canvasTool = kind ? STORYBOARD_SHEET_TOOLS[kind].canvasTool : "";
  const label = kind ? STORYBOARD_SHEET_TOOLS[kind].label : "";

  const {
    modelName,
    displayName,
    hasModel,
    selectedModel,
    defaultGenerationOptions,
    total: creditTotal,
    creditsEnabled,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useCanvasToolConfiguredModel(canvasTool || "storyboard", Boolean(kind));

  const generationPresets = useMemo(
    () => getModelGenerationPresets(selectedModel ?? undefined),
    [selectedModel]
  );

  /** 可 @ 的素材槽：上游连线图 + 本地面板上传 */
  const materialSlots = useMemo((): MaterialSlot[] => {
    const upstream =
      resolvedHostId != null
        ? getUpstreamMaterialSlots(resolvedHostId, edges, nodes).filter((s) => s.type === "image")
        : [];
    const uploaded: MaterialSlot[] = extraRefs.map((r) => ({
      nodeId: r.id,
      nodeType: "image_input",
      label: r.title,
      type: "image",
      source: "local",
    }));
    return [...upstream, ...uploaded];
  }, [resolvedHostId, edges, nodes, extraRefs]);

  const mentionKnownLabels = useMemo(
    () => materialSlots.map((s) => s.label).filter(Boolean),
    [materialSlots]
  );

  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [];
    const pos = textareaRef.current?.selectionStart ?? userPrompt.length;
    const mention = parseMentionQuery(userPrompt, pos);
    if (!mention) return [];
    return filterSlotsForMention(materialSlots, mention.query);
  }, [mentionOpen, userPrompt, materialSlots]);

  const handlePromptChange = useCallback((value: string, cursorPos: number) => {
    setUserPrompt(value);
    const mention = parseMentionQuery(value, cursorPos);
    if (mention) {
      setMentionOpen(true);
      setMentionStart(mention.start);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  }, []);

  const applyMention = useCallback(
    (slot: MaterialSlot) => {
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? userPrompt.length;
      const { nextDraft, nextCursor } = insertMention(
        userPrompt,
        mentionStart,
        cursorPos,
        slot.label
      );
      handlePromptChange(nextDraft, nextCursor);
      setMentionOpen(false);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [userPrompt, mentionStart, handlePromptChange]
  );

  // 有图：提示词/参考图以图片节点卡片为准；无图：清空，走「+参考」现有流程
  useEffect(() => {
    if (!kind || !projectId) return;
    let cancelled = false;
    const nodeId =
      (hostNodeId && nodes.some((n) => n.id === hostNodeId) ? hostNodeId : null) ||
      (selectedNodeId &&
      nodes.find((n) => n.id === selectedNodeId)?.type === "image_input"
        ? selectedNodeId
        : null);

    setExtraRefs([]);
    setGenerationOptions(defaultGenerationOptions);

    if (!nodeId) {
      setUserPrompt("");
      setHostMedia(null);
      return;
    }

    const host = nodes.find((n) => n.id === nodeId);
    const params = (host?.data?.params ?? {}) as Record<string, unknown>;
    // 历史误写入的后台版式词不展示给用户
    const nodePrompt = stripStoryboardAdminAppend(String(params.prompt ?? ""));

    void (async () => {
      const url = await resolveNodeMediaUrl(projectId, params, "imageUrl");
      if (cancelled) return;
      if (url) {
        setUserPrompt(nodePrompt);
        if (nodePrompt !== String(params.prompt ?? "").trim()) {
          updateNodeParam(nodeId, "prompt", nodePrompt);
        }
        setHostMedia({
          url,
          assetId: String(params.assetId || "").trim() || undefined,
          title: String(host?.data?.label || "节点图"),
        });
        const nodeOpts = params.generationOptions;
        if (nodeOpts && typeof nodeOpts === "object" && !Array.isArray(nodeOpts)) {
          const presets = getModelGenerationPresets(selectedModel ?? undefined);
          setGenerationOptions(
            normalizeGenerationOptions(presets, {
              ...defaultGenerationOptions,
              ...(nodeOpts as GenerationOptions),
            })
          );
        }
        return;
      }
      setUserPrompt("");
      setHostMedia(null);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅切换模式/宿主节点时同步卡片
  }, [kind, hostNodeId, projectId, selectedNodeId]);

  // 上游连线图片 → 自动进入参考区（断线或换宿主后刷新）
  useEffect(() => {
    if (!kind || !projectId || !resolvedHostId) {
      setConnectedRefs([]);
      return;
    }
    let cancelled = false;
    const slots = getUpstreamMaterialSlots(resolvedHostId, edges, nodes).filter(
      (s) => s.type === "image"
    );
    if (slots.length === 0) {
      setConnectedRefs([]);
      return;
    }
    void (async () => {
      const resolved = await resolveAllReferences(projectId, slots, nodes, edges);
      if (cancelled) return;
      setConnectedRefs(
        resolved
          .filter((r) => r.type === "image" && Boolean(r.url?.trim()))
          .map((r) => ({
            nodeId: r.nodeId,
            url: String(r.url),
            label: r.label || r.nodeId.slice(0, 8),
          }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, projectId, resolvedHostId, edges, nodes]);

  useEffect(() => {
    if (!kind) return;
    if (hostMedia) return;
    setGenerationOptions(defaultGenerationOptions);
  }, [kind, modelName, defaultGenerationOptions, hostMedia]);

  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !generating) {
        if (mentionOpen) {
          setMentionOpen(false);
          return;
        }
        closeStoryboardSheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, generating, closeStoryboardSheet, mentionOpen]);

  useLayoutEffect(() => {
    if (!kind || !resolvedHostId) {
      setNodeBottomAnchor(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(
        `.react-flow__node[data-id="${CSS.escape(resolvedHostId)}"]`
      ) as HTMLElement | null;
      if (!el) return;
      const bodyEl =
        (el.querySelector(":scope > .group > .relative.min-h-0") as HTMLElement | null) ||
        (el.querySelector(".relative.min-h-0.flex-1") as HTMLElement | null) ||
        el;
      const rect = bodyEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const bottomCenter = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom,
      });
      setNodeBottomAnchor({
        x: bottomCenter.x,
        y: bottomCenter.y + CANVAS_EDITOR_NODE_GAP,
      });
    };
    measure();
    const el = document.querySelector(
      `.react-flow__node[data-id="${CSS.escape(resolvedHostId)}"]`
    );
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [
    kind,
    resolvedHostId,
    hostNode?.width,
    hostNode?.height,
    hostNode?.position?.x,
    hostNode?.position?.y,
    viewport.zoom,
    viewport.x,
    viewport.y,
    screenToFlowPosition,
  ]);

  const ensureHostNodeId = useCallback((): string | null => {
    if (hostNodeId && nodes.some((n) => n.id === hostNodeId)) return hostNodeId;
    if (selectedNodeId) {
      const selected = nodes.find((n) => n.id === selectedNodeId);
      if (selected?.type === "image_input") {
        setStoryboardSheetNodeId(selected.id);
        return selected.id;
      }
    }
    const before = new Set(nodes.map((n) => n.id));
    const position = resolveAddNodePosition("image_input", nodes, {
      viewport,
      paneSize: flowPaneSize,
      selectedNodeId,
    });
    addNode("image_input", position);
    const created = useCanvasStore
      .getState()
      .nodes.find((n) => n.type === "image_input" && !before.has(n.id));
    if (!created) {
      toast.error("无法创建图片节点");
      return null;
    }
    setStoryboardSheetNodeId(created.id);
    selectNode(created.id);
    return created.id;
  }, [
    hostNodeId,
    nodes,
    selectedNodeId,
    setStoryboardSheetNodeId,
    viewport,
    flowPaneSize,
    addNode,
    selectNode,
  ]);

  const handlePickRefs = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || !projectId) return;
      const list = Array.from(files).slice(0, 8);
      for (const file of list) {
        const sizeError = validateCanvasImageFile(file);
        if (sizeError) {
          toast.error(sizeError);
          continue;
        }
        try {
          const asset = await uploadAsset({
            file,
            projectId,
            category: "image",
            subcategory: NODE_IMAGE_SUBCATEGORY,
            title: file.name.replace(/\.[^.]+$/, "") || "故事板参考",
          });
          notifyAssetsUpdated();
          setExtraRefs((prev) => [
            ...prev,
            {
              id: `${asset.id}-${Date.now()}`,
              url: asset.fileUrl,
              assetId: asset.id,
              title: asset.title || "参考图",
            },
          ]);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "参考图上传失败");
        }
      }
    },
    [projectId]
  );

  const handleGenerate = useCallback(async () => {
    if (!kind || !projectId || generating) return;
    if (!hasModel || !modelName) {
      toast.error(`请在后台「模型开关」配置「${label}」图片模型`);
      return;
    }
    const nodeId = ensureHostNodeId();
    if (!nodeId) return;

    setGenerating(true);
    try {
      const host = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      const params = (host?.data?.params ?? {}) as Record<string, unknown>;
      const hostUrl =
        hostMedia?.url || (await resolveNodeMediaUrl(projectId, params, "imageUrl"));

      if (hostUrl && userPrompt.trim() !== String(params.prompt ?? "").trim()) {
        updateNodeParam(nodeId, "prompt", userPrompt.trim());
      }
      if (hostUrl) {
        updateNodeParam(
          nodeId,
          "generationOptions",
          normalizeGenerationOptions(generationPresets, generationOptions)
        );
      }

      // 连线参考 + 本地上传
      const allRefs: GenerationReference[] = [
        ...connectedRefs.map((r) => ({
          nodeId: r.nodeId,
          type: "image" as const,
          label: r.label,
          url: r.url,
          source: "upstream" as const,
        })),
        ...extraRefs
          .filter((r) => r.url?.trim())
          .map((r) => ({
            nodeId: r.id,
            type: "image" as const,
            label: r.title,
            url: r.url,
            source: "local" as const,
          })),
      ];
      // 有 @ 则只带被引用的图；否则自动带全部连线 + 上传参考
      const mentionPool = allRefs.map((r) => ({
        nodeId: r.nodeId,
        type: "image" as const,
        label: r.label || "",
        url: r.url,
        source: (r as { source?: "upstream" | "local" }).source,
      }));
      const mentioned = collectMentionedReferences(userPrompt, mentionPool);
      const references: GenerationReference[] =
        mentioned.length > 0
          ? mentioned.map((r) => ({
              nodeId: r.nodeId,
              type: "image",
              label: r.label,
              url: r.url,
            }))
          : allRefs.map((r) => ({
              nodeId: r.nodeId,
              type: "image",
              label: r.label,
              url: r.url,
            }));

      if (!hostUrl && references.length === 0) {
        toast.message("未添加参考图：将仅按文字生成；建议连线图片节点或上传角色三视图");
      }

      const opts = normalizeGenerationOptions(generationPresets, generationOptions);
      const resultNodeId = await runStoryboardSheetGenerate({
        kind,
        projectId,
        sourceNodeId: nodeId,
        modelName,
        generationOptions: opts,
        workflowId,
        creditsEnabled,
        queryClient,
        userPrompt,
        references,
        onRefetchPricing: () => void refetchQuote(),
      });
      if (resultNodeId) {
        closeStoryboardSheet();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label}生成失败`);
    } finally {
      setGenerating(false);
    }
  }, [
    kind,
    projectId,
    generating,
    hasModel,
    modelName,
    label,
    ensureHostNodeId,
    hostMedia,
    connectedRefs,
    extraRefs,
    generationPresets,
    generationOptions,
    workflowId,
    creditsEnabled,
    queryClient,
    userPrompt,
    updateNodeParam,
    refetchQuote,
    closeStoryboardSheet,
  ]);

  if (!kind) return null;

  const creditNumber = quoteLoading ? "…" : creditTotal > 0 ? String(creditTotal) : "—";
  const ModeIcon = kind === "blocking_storyboard" ? Clapperboard : BookOpen;

  const { width: nodeW, height: nodeH } = hostNode
    ? resolveNodeSize(hostNode.width, hostNode.height)
    : { width: 0, height: 0 };
  const world = hostNode ? getNodeWorldPosition(hostNode, nodes) : { x: 0, y: 0 };
  const hasHostAnchor = Boolean(hostNode);
  const anchorX = hasHostAnchor
    ? (nodeBottomAnchor?.x ?? world.x + nodeW / 2)
    : 0;
  const anchorY = hasHostAnchor
    ? (nodeBottomAnchor?.y ?? world.y + nodeH + CANVAS_EDITOR_NODE_GAP)
    : 0;
  const overlayStyle = hasHostAnchor
    ? buildCanvasOverlayStyle(anchorX, anchorY, viewport.zoom, "below", {
        width: CANVAS_EDITOR_PANEL_WIDTH,
        zIndex: CANVAS_OVERLAY_Z_SPECIAL_PANEL,
      })
    : undefined;

  const hasAnyRef = Boolean(hostMedia) || connectedRefs.length > 0 || extraRefs.length > 0;

  const panelInner = (
    <div
      className={cn(
        "pointer-events-auto w-full rounded-2xl border border-white/10",
        "bg-[#1a1a22]/96 shadow-2xl backdrop-blur-xl",
        !hasHostAnchor && "max-w-[720px]"
      )}
      style={hasHostAnchor ? undefined : { width: "min(720px, 100%)" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2 px-3 pt-3">
        <button
          type="button"
          onClick={handlePickRefs}
          disabled={generating}
          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg border border-white/12 bg-white/5 px-2 py-1.5 text-[12px] text-white/75 transition-colors hover:bg-white/10 disabled:opacity-50"
          title="上传角色三视图、美术设定等参考图；连线的图片节点会自动加入"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          参考
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div className="relative min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-600/90 px-1.5 py-0.5 text-[12px] font-medium text-white">
              <ModeIcon className="size-3.5" aria-hidden />
              {label}
            </span>
            <span
              className="inline-flex size-6 items-center justify-center rounded-md text-white/40"
              title="版式提示词与模型请在管理后台「Prompt 模板 / 模型开关」配置"
            >
              <SlidersHorizontal className="size-3.5" />
            </span>
            <button
              type="button"
              disabled={generating}
              onClick={closeStoryboardSheet}
              className="ml-auto rounded-md p-1 text-white/35 hover:bg-white/10 hover:text-white/80 disabled:opacity-40"
              aria-label="关闭"
            >
              <X className="size-4" />
            </button>
          </div>

          {hasAnyRef ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {hostMedia ? (
                <div
                  className="relative size-12 overflow-hidden rounded-md border border-violet-400/50 bg-black/40"
                  title={`节点图：${hostMedia.title}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={hostMedia.url} alt="" className="size-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/65 py-px text-center text-[9px] text-white/90">
                    节点
                  </span>
                </div>
              ) : null}
              {connectedRefs.map((ref) => (
                <div
                  key={`conn-${ref.nodeId}`}
                  className="relative size-12 overflow-hidden rounded-md border border-sky-400/40 bg-black/40"
                  title={`连线参考：@${ref.label}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.url} alt="" className="size-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/65 px-0.5 py-px text-center text-[9px] text-sky-100">
                    @{ref.label}
                  </span>
                </div>
              ))}
              {extraRefs.map((ref) => (
                <div
                  key={ref.id}
                  className="relative size-12 overflow-hidden rounded-md border border-white/15 bg-black/40"
                  title={`上传参考：@${ref.title}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ref.url} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    disabled={generating}
                    onClick={() => setExtraRefs((prev) => prev.filter((r) => r.id !== ref.id))}
                    className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white/80"
                    aria-label="移除参考"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <PromptMentionTextarea
            textareaRef={textareaRef}
            value={userPrompt}
            knownLabels={mentionKnownLabels}
            onValueChange={handlePromptChange}
            onKeyDown={(e) => {
              if (!mentionOpen || mentionCandidates.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionCandidates.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex(
                  (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length
                );
              } else if (e.key === "Enter" && mentionOpen) {
                e.preventDefault();
                applyMention(mentionCandidates[mentionIndex]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setMentionOpen(false);
              }
            }}
            placeholder={
              hostMedia
                ? "使用图片节点卡片上的提示词；可在此修改，并用 @ 引用参考图"
                : PLACEHOLDERS[kind]
            }
            disabled={generating}
            rows={3}
            className="!min-h-[63px] min-h-0 border-0 px-0 py-0 text-[13px] leading-relaxed"
          />

          {mentionOpen && mentionCandidates.length > 0 ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-auto rounded-lg border border-white/12 bg-[#1e1e28] py-1 shadow-xl">
              {mentionCandidates.map((slot, idx) => (
                <button
                  key={`${slot.nodeId}-${slot.label}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-white/80",
                    idx === mentionIndex ? "bg-violet-500/25 text-white" : "hover:bg-white/8"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(slot);
                  }}
                >
                  <span className="truncate font-medium">@{slot.label}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-white/35">
                    {slot.source === "upstream" ? "连线" : "上传"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-white/8 px-3 py-2.5">
        <div
          className="flex min-w-0 max-w-[140px] items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-white/80"
          title="实际调用模型由后台「模型开关」配置"
        >
          <ModelBrandMark className="size-4 shrink-0 text-white" />
          <span className="truncate font-medium">{displayName}</span>
        </div>

        <span className="h-4 w-px shrink-0 bg-white/15" aria-hidden />

        {generationPresets ? (
          <ImageOptionsBar
            presets={generationPresets}
            value={generationOptions}
            onChange={setGenerationOptions}
            pricing={selectedModel?.parameters?.pricing as Record<string, unknown> | undefined}
            variant="image"
            layout="inline"
            modelName={modelName}
          />
        ) : (
          <span className="text-[12px] text-white/40">16:9 · 高画质</span>
        )}

        <div className="ml-auto flex items-center gap-2.5">
          <span
            className="flex items-center gap-0.5 text-[13px] tabular-nums text-white/45"
            title={creditTotal > 0 ? `本次消耗 ${creditTotal} 算力` : "算力报价加载中"}
          >
            <Zap className="size-3.5 fill-current" aria-hidden />
            <span>{creditNumber}</span>
          </span>
          <button
            type="button"
            disabled={generating || !userPrompt.trim()}
            onClick={() => void handleGenerate()}
            title={generating ? "生成中…" : `生成${label}`}
            aria-label="生成"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#c9c9c9] text-black transition-colors hover:bg-[#d6d6d6] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {generating ? (
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (hasHostAnchor && overlayStyle) {
    return (
      <EdgeLabelRenderer>
        <div
          className="canvas-node-overlay nodrag nopan nowheel pointer-events-auto"
          style={overlayStyle}
          data-storyboard-sheet-composer
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {panelInner}
        </div>
      </EdgeLabelRenderer>
    );
  }

  return (
    <Panel
      position="bottom-center"
      className="pointer-events-none m-0 mb-4 px-3"
      data-storyboard-sheet-composer
    >
      <div className="pointer-events-auto flex justify-center">{panelInner}</div>
    </Panel>
  );
}
