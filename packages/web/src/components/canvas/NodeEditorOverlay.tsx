"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EdgeLabelRenderer, useReactFlow } from "@xyflow/react";
import { ArrowLeftRight, ArrowUp, FileText, Globe, Image, Music, SlidersHorizontal, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSelectedCanvasNode } from "@/lib/canvas/useSelectedCanvasNode";
import { useAgentNodeTouchVersion } from "@/lib/canvas/agentNodeTouch";
import { fetchNodeText, saveNodeText } from "@/lib/api/nodeText";
import { generateFromTextNode } from "@/lib/api/textGeneration";
import { clipTextNodeGeneratedContent } from "@/lib/canvas/textNodeGenerationLimit";
import { ApiError } from "@/lib/api/client";
import { generateFromMediaNode } from "@/lib/api/mediaGeneration";
import { applyMediaJobResultToNode } from "@/lib/canvas/applyMediaJobResult";
import { resolveNodeMediaUrl } from "@/lib/canvas/resolveNodeMediaUrl";
import {
  hasMeaningfulGenerationPrompt,
  resolveMediaPromptForGeneration,
} from "@/lib/canvas/resolveMediaPrompt";
import { stripStoryboardAdminAppend } from "@/lib/canvas/runStoryboardSheetGenerate";
import { mergeInlineDrawingForGeneration } from "@/lib/canvas/inlineImageDrawing";
import { resolveNodeSize } from "@/lib/canvas/nodeSizing";
import { useNodeEditorModels } from "@/lib/canvas/useNodeEditorModels";
import { getNodeModelCategory, type ModelCategory } from "@/lib/canvas/nodeModelRouting";
import { getEditorConfig, isEditorNodeType } from "@/lib/canvas/nodeEditorConfig";
import {
  collectI2vFrameReferences,
  getVideoFrameInputSpec,
  previewFrameLabels,
  validateI2vFrameReferences,
} from "@/lib/canvas/videoFrameReferences";
import { resolveTextPromptKind, useTextPromptTools } from "@/lib/canvas/useTextPromptTools";
import { useGlobalWatermark } from "@/components/providers/GlobalWatermarkProvider";
import {
  normalizeGenerationOptions,
} from "@/lib/canvas/generationPresets";
import {
  hasVideoReferenceForBilling,
  withRefVideoBillingOption,
} from "@/lib/canvas/refVideoBilling";
import { withMaterialUsageBillingOptions } from "@/lib/canvas/materialUsageBilling";
import { DEFAULT_VISUAL_STYLE_ID } from "@/lib/canvas/renderToolPrompt";
import { HdUpscalePanel } from "@/components/canvas/HdUpscalePanel";
import { ModelTagPicker } from "@/components/canvas/ModelTagPicker";
import { ModelFlatFavoriteList } from "@/components/canvas/ModelFlatFavoriteList";
import { isHdUpscaleToolMode } from "@/lib/canvas/createHdUpscaleNode";
import { isLibraryUiLockedParams } from "@/lib/canvas/materialLibrary";
import {
  AUDIO_PROMPT_MAX_CHARS,
  DEFAULT_AUDIO_VOICE,
  DEFAULT_AUDIO_VOICE_STYLE,
  normalizeAudioVoiceStyle,
  resolveAudioVoiceFromParams,
  type AudioVoiceItem,
} from "@/lib/canvas/audioVoiceStyles";
import {
  audioGenParamsToGenerationOptions,
  DEFAULT_AUDIO_GENERATION_PARAMS,
  normalizeAudioGenerationParams,
  type AudioGenerationParams,
} from "@/lib/canvas/audioGenerationParams";
import { AudioGenerationParamsPanel } from "@/components/canvas/AudioGenerationParamsPanel";
import { VoiceSelectModal } from "@/components/canvas/VoiceSelectModal";
import {
  isMinimaxInstrumental,
  isMinimaxMusicModel,
  MINIMAX_MUSIC_LYRICS_MAX,
  MINIMAX_MUSIC_LYRICS_PLACEHOLDER,
  MINIMAX_MUSIC_PROMPT_MAX,
  minimaxMusicStylePlaceholder,
} from "@/lib/canvas/minimaxMusicParams";
import {
  isSunoCustomModel,
  SUNO_LYRICS_MAX,
  SUNO_LYRICS_PLACEHOLDER,
  SUNO_TAGS_MAX,
  SUNO_TAGS_PLACEHOLDER,
  SUNO_TITLE_MAX,
  SUNO_TITLE_PLACEHOLDER,
} from "@/lib/canvas/sunoMusicParams";
import { cn } from "@/lib/utils";
import {
  buildCanvasOverlayStyle,
  CANVAS_AUDIO_EDITOR_PANEL_WIDTH,
  CANVAS_EDITOR_NODE_GAP,
  CANVAS_EDITOR_PANEL_WIDTH,
  CANVAS_HD_UPSCALE_PANEL_WIDTH,
  CANVAS_IMAGE_EDITOR_PANEL_WIDTH,
  CANVAS_OVERLAY_DROPDOWN_CLASS,
  CANVAS_OVERLAY_Z_EDITOR,
  CANVAS_OVERLAY_Z_EDITOR_EXPANDED,
  CANVAS_TEXT_EDITOR_PANEL_WIDTH,
  CANVAS_VIDEO_EDITOR_PANEL_WIDTH,
  getNodeWorldPosition,
} from "@/lib/canvas/canvasOverlayTransform";
import { CANVAS_MIST_GLASS_STYLE } from "@/components/canvas/AddNodeMenu";
import { invalidateCanvasCreditQueries, useCanvasStoreCreditBalance, useGenerationCreditQuote } from "@/lib/canvas/useGenerationCreditQuote";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNodeAssetMedia } from "@/lib/canvas/useNodeAssetMedia";
import { assetHasImageThumbnail } from "@/components/canvas/panels/AssetThumbnail";
import { urlParamKeyForNodeType } from "@/lib/canvas/resolveNodeMedia";
import {
  isPricingChangedError,
  newIdempotencyKey,
  handleCollaboratorSpendCapError,
  maybeToastCreditCharged,
  toastAwaitingApproval,
  toastPricingChanged,
} from "@/lib/canvas/generationCreditHelpers";
import { getCreditQuote } from "@/lib/api/credits";
import { useQueryClient } from "@tanstack/react-query";
import { ImageOptionsBar, isNanoOfficialCreativeToolsModel } from "./ImageOptionsBar";
import { findCanvasAspectInOptions, imageAspectPresets, pickCanvasClarityFromOptions, videoDurationPresets } from "@/lib/local/presetTemplates";
import { ImageCreativeToolsButton } from "./ImageCreativeToolsButton";
import { ImageCameraGearButton } from "./ImageCameraGearButton";
import {
  buildCameraGearPromptSuffix,
  DEFAULT_CAMERA_GEAR,
  parseCameraGear,
  type CameraGearState,
} from "@/lib/canvas/cameraGearCatalog";
import { ModelBrandMark } from "./ModelBrandMark";
import {
  MODEL_SELECT_CONTENT_CLASS,
  MODEL_SELECT_ITEM_CLASS,
  MODEL_SELECT_MENU_CONTENT_CLASS,
  MODEL_SELECT_TRIGGER_CLASS,
} from "@/lib/canvas/canvasSelectStyles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildMaterialSlots,
  collectGenerationReferences,
  collectMentionedReferences,
  collectVideoR2vReferences,
  filterSlotsForMention,
  insertMention,
  isVideoR2vModel,
  parseMentionQuery,
  resolveAllReferences,
  resolveMentionsInPrompt,
  stripMentionTokens,
  validateGenerationReferences,
  type MaterialSlot,
} from "@/lib/canvas/nodeMaterialSlots";
import { PromptMentionTextarea } from "@/components/canvas/PromptMentionTextarea";
import type { GenerationOptions } from "@/types/generationPresets";
import type { WorkflowNodeData } from "@/types/workflow";

const SAVE_DELAY_MS = 800;

function SlotIcon({ type }: { type: MaterialSlot["type"] }) {
  const className = "h-3.5 w-3.5 shrink-0";
  switch (type) {
    case "image":
      return <Image className={className} />;
    case "video":
      return <Video className={className} />;
    case "audio":
      return <Music className={className} />;
    case "link":
      return <Globe className={className} />;
    case "file":
      return <FileText className={className} />;
    default:
      return <FileText className={className} />;
  }
}

/** 图片/视频参考素材：悬浮显示缩略图 */
function MediaSlotChip({ slot }: { slot: MaterialSlot }) {
  const urlKey = urlParamKeyForNodeType(slot.nodeType) || (slot.type === "video" ? "videoUrl" : "imageUrl");
  const { url, thumbnailUrl, asset } = useNodeAssetMedia(slot.nodeId, { urlParamKey: urlKey });
  const isVideo = slot.type === "video";
  // 仅当有独立图片封面时用 <img>；视频 URL 不能当缩略图塞进 img（会裂图）
  const hasImageThumb = Boolean(asset && assetHasImageThumbnail(asset) && thumbnailUrl);
  const previewSrc = hasImageThumb ? thumbnailUrl : url;
  const useVideoEl = isVideo && !hasImageThumb;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-default items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[13px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white" />
        }
      >
        <SlotIcon type={slot.type} />
        <span className="max-w-[96px] truncate">{slot.label}</span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="z-[80] max-w-none border border-white/15 bg-[#14141f] p-1.5 text-white shadow-2xl"
      >
        <div className="flex flex-col gap-1">
          <div className="px-0.5 text-[11px] text-white/55">
            @{slot.label}
            {slot.source === "local" ? " · 本地" : ""}
          </div>
          {previewSrc ? (
            useVideoEl ? (
              <video
                src={previewSrc}
                muted
                playsInline
                preload="metadata"
                className="h-[120px] w-[180px] rounded-md object-cover bg-black/40"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- 动态 OSS / 签名 URL
              <img
                src={previewSrc}
                alt={slot.label}
                className="h-[120px] w-[180px] rounded-md object-cover bg-black/40"
                draggable={false}
              />
            )
          ) : (
            <div className="flex h-[80px] w-[140px] items-center justify-center rounded-md bg-white/5 text-[11px] text-white/40">
              暂无预览
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function MaterialSlotChip({ slot }: { slot: MaterialSlot }) {
  if (slot.type === "image" || slot.type === "video") {
    return <MediaSlotChip slot={slot} />;
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[13px] text-white/70"
      title={`@${slot.label}`}
    >
      <SlotIcon type={slot.type} />
      <span className="max-w-[96px] truncate">{slot.label}</span>
    </span>
  );
}

function MaterialSlotBar({ slots }: { slots: MaterialSlot[] }) {
  // 素材槽只展示上游引用；本节点「本地上传」不在此显示（上传菜单入口另有）
  const visibleSlots = slots.filter((slot) => slot.source !== "local");
  if (visibleSlots.length === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-white/40">
          素材
        </span>
        <span className="text-[12px] text-white/28">连接上游后显示 · 提示词里输入 @ 可引用</span>
      </div>
    );
  }

  return (
    <TooltipProvider delay={200}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
        <span className="mr-0.5 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-white/40">
          素材
        </span>
        {visibleSlots.map((slot) => (
          <MaterialSlotChip key={`${slot.source}-${slot.nodeId}`} slot={slot} />
        ))}
      </div>
    </TooltipProvider>
  );
}

/** Select 不接受空 value，表示未选文本类型（通用文本生成） */
const TEXT_PROMPT_KIND_DEFAULT = "__default__";
/** 手写剧本文本（非 AI「生成剧本」工具，不走 text_script prompt） */
const TEXT_PROMPT_KIND_INPUT_SCRIPT = "input_script";

export function NodeEditorOverlay() {
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  // Agent 通过 update_node_params 改动当前打开节点参数时的外部改动版本号；
  // 变化时下方「从 store 灌入本地状态」的 effect 需强制重新加载，见 loadedVersionRef
  const agentTouchVersion = useAgentNodeTouchVersion(selectedNodeId);
  const multiAngleNodeId = useCanvasStore((s) => s.multiAngleNodeId);
  const lightingNodeId = useCanvasStore((s) => s.lightingNodeId);
  const inlineImageEraseMode = useCanvasStore((s) => s.inlineImageEraseMode);
  const inlineImageOutpaint = useCanvasStore((s) => s.inlineImageOutpaint);
  const inlineImageCrop = useCanvasStore((s) => s.inlineImageCrop);
  const inlineVideoCrop = useCanvasStore((s) => s.inlineVideoCrop);
  const inlineVideoTrim = useCanvasStore((s) => s.inlineVideoTrim);
  const generationOptionsExpanded = useCanvasStore((s) => s.generationOptionsExpanded);
  const projectId = useCanvasStore((s) => s.projectId);
  const viewportZoom = useCanvasStore((s) => s.viewport.zoom);
  const viewportX = useCanvasStore((s) => s.viewport.x);
  const viewportY = useCanvasStore((s) => s.viewport.y);
  const { screenToFlowPosition } = useReactFlow();
  const workflowId = useCanvasStore((s) => s.workflowId);
  const edges = useCanvasStore((s) => s.edges);
  const allNodes = useCanvasStore((s) => s.nodes);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const setNodeStatus = useCanvasStore((s) => s.setNodeStatus);
  const beginNodeGeneration = useCanvasStore((s) => s.beginNodeGeneration);
  const endNodeGeneration = useCanvasStore((s) => s.endNodeGeneration);
  const activeGenerationNodeIds = useCanvasStore((s) => s.activeGenerationNodeIds);

  const node = useSelectedCanvasNode();
  const config = getEditorConfig(node?.type);
  const isEditorNode = isEditorNodeType(node?.type);

  const materialSlots = useMemo(() => {
    if (!selectedNodeId) return [];
    return buildMaterialSlots(selectedNodeId, edges, useCanvasStore.getState().nodes);
  }, [selectedNodeId, edges, node]);

  const needsVisionModel = useMemo(
    () =>
      node?.type === "text_input" &&
      materialSlots.some(
        (s) => (s.type === "image" || s.type === "video") && s.source === "upstream"
      ),
    [node?.type, materialSlots]
  );

  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>({});
  const [visualStyleId, setVisualStyleId] = useState(DEFAULT_VISUAL_STYLE_ID);
  const [cameraGear, setCameraGear] = useState<CameraGearState>(DEFAULT_CAMERA_GEAR);
  /** 音频 TTS 音色展示名（底栏胶囊） */
  const [voiceStyleLabel, setVoiceStyleLabel] = useState(DEFAULT_AUDIO_VOICE_STYLE);
  const [voiceId, setVoiceId] = useState(DEFAULT_AUDIO_VOICE.voiceId);
  const [voiceKind, setVoiceKind] = useState<"library" | "cloned">("library");
  const [ttsModel, setTtsModel] = useState(DEFAULT_AUDIO_VOICE.ttsModel);
  const [voiceSelectOpen, setVoiceSelectOpen] = useState(false);
  const [voiceSelectAnchor, setVoiceSelectAnchor] = useState<{
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null>(null);
  const voiceSelectTriggerRef = useRef<HTMLButtonElement>(null);
  /** 音频生成参数面板 */
  const [audioGenParams, setAudioGenParams] = useState<AudioGenerationParams>(
    DEFAULT_AUDIO_GENERATION_PARAMS
  );
  const [audioParamsOpen, setAudioParamsOpen] = useState(false);
  const audioParamsRef = useRef<HTMLDivElement>(null);
  /** MiniMax Music：歌曲歌词（与风格描述主输入框分离） */
  const [musicLyrics, setMusicLyrics] = useState("");
  /** Suno Custom：标题与风格标签（主输入框为歌词） */
  const [musicTitle, setMusicTitle] = useState("");
  const [musicTags, setMusicTags] = useState("");

  const { modelOptions, defaultModel, generationPresets, apiModels, rememberModelChoice, selectedModel } =
    useNodeEditorModels(node?.type, model || undefined);
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  /** 模型 UI 标签过滤（点击标签）；再点取消 */
  const [activeModelTagId, setActiveModelTagId] = useState<string | null>(null);
  /** 系列级联选模时需可控关闭下拉 */
  const [modelSelectOpen, setModelSelectOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(0);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedNodeRef = useRef<string | null>(null);
  // 已灌入本地状态时对应的 Agent 外部改动版本号；配合 loadedNodeRef 判断是否需要
  // 重新从 store 灌入（AI 通过 update_node_params 改了当前打开节点的参数时）
  const loadedVersionRef = useRef<number>(-1);
  /** Agent 灌入 store 后，跳过把旧 generationOptions 写回 store 的回写 effect */
  const hydratingOptionsFromStoreRef = useRef(false);
  /** 上次灌入时是否已有 generationPresets，避免预设晚到后被 early-return 跳过归一 */
  const hydratedPresetsReadyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitLockRef = useRef(false);

  const isTextNode = node?.type === "text_input";
  const isImageNode = node?.type === "image_input";
  const isVideoNode = node?.type === "video_input";
  const isAudioNode = node?.type === "audio_input";
  /** 声音复刻：用参考音创建音色，不展示系统音色选择胶囊 */
  const isVoiceCloneModel = isAudioNode && model === "cosyvoice_clone";
  /** 语音合成：可选官方音色 + 用户复刻音色 */
  const isVoiceTtsModel = isAudioNode && model === "cosyvoice_tts";
  /** RunningHub 分离音频：需要源视频（videoUrl） */
  const isAudioSeparateModel =
    isAudioNode && model.startsWith("rh_audio_extract");
  /** MiniMax Music 2.6：风格描述 + 歌词 + 采样/码率等可选项 */
  const isMinimaxMusic = isAudioNode && isMinimaxMusicModel(model);
  const isMinimaxInstrumentalMode =
    isMinimaxMusic && isMinimaxInstrumental(generationOptions);
  /** Suno Custom v5.5：标题 + 歌词 + 风格标签（均必填） */
  const isSunoMusic = isAudioNode && isSunoCustomModel(model);
  const isMediaNode = isImageNode || isVideoNode || isAudioNode;
  const nodeParamsForMode = ((node?.data as WorkflowNodeData | undefined)?.params ??
    {}) as Record<string, unknown>;
  // 高清放大节点（图片/视频）：底部用专用参数面板，不用普通 prompt 编辑区
  const isHdUpscaleNode =
    (isImageNode || isVideoNode) && isHdUpscaleToolMode(nodeParamsForMode.toolMode);
  const hdMediaKind = isVideoNode ? "video" : "image";
  const { items: textPromptKindItems } = useTextPromptTools();
  const textPromptKind = resolveTextPromptKind(nodeParamsForMode.textPromptKind);
  const textPromptKindRaw = String(nodeParamsForMode.textPromptKind ?? "");
  const textPromptKindSelectValue = textPromptKind
    ? textPromptKind
    : textPromptKindRaw === TEXT_PROMPT_KIND_INPUT_SCRIPT
      ? TEXT_PROMPT_KIND_INPUT_SCRIPT
      : TEXT_PROMPT_KIND_DEFAULT;
  const textPromptKindLabel =
    textPromptKindItems.find((item) => item.tool === textPromptKind)?.label ??
    (textPromptKindSelectValue === TEXT_PROMPT_KIND_INPUT_SCRIPT ? "输入剧本" : "选择类型");
  const { url: nodeImageUrl } = useNodeAssetMedia(selectedNodeId ?? "", {
    urlParamKey: "imageUrl",
  });
  const { url: nodeVideoUrl } = useNodeAssetMedia(selectedNodeId ?? "", {
    urlParamKey: "videoUrl",
  });
  const { url: nodeAudioUrl } = useNodeAssetMedia(selectedNodeId ?? "", {
    urlParamKey: "audioUrl",
  });
  const hdSourceUrl = isHdUpscaleNode
    ? hdMediaKind === "video"
      ? nodeVideoUrl
      : nodeImageUrl
    : nodeImageUrl;
  const mediaCategory = getNodeModelCategory(node?.type ?? "") as ModelCategory | null;

  const filteredModelOptions = useMemo(() => {
    if (!activeModelTagId) return modelOptions;
    return modelOptions.filter((opt) => (opt.uiTagIds ?? []).includes(activeModelTagId));
  }, [activeModelTagId, modelOptions]);

  useEffect(() => {
    setActiveModelTagId(null);
    setModelSelectOpen(false);
  }, [selectedNodeId]);
  const promptKey = config?.promptParamKey ?? "prompt";
  const nodeStatus = (node?.data as WorkflowNodeData | undefined)?.status ?? "idle";
  const isGenerating =
    generating ||
    nodeStatus === "running" ||
    !!(selectedNodeId && activeGenerationNodeIds[selectedNodeId]);

  const { enabled: globalWatermarkEnabled } = useGlobalWatermark();

  const normalizedGenerationOptions = useMemo(
    () => normalizeGenerationOptions(generationPresets, generationOptions),
    [generationPresets, generationOptions, globalWatermarkEnabled]
  );
  const modelPricing = selectedModel?.parameters?.pricing as Record<string, unknown> | undefined;
  // 多模态：参考视频单价切换 + MiniMax-H3 素材用量（输入视频秒/参考图张数）
  const billingGenerationOptions = useMemo(
    () =>
      withMaterialUsageBillingOptions(
        modelPricing,
        withRefVideoBillingOption(
          generationPresets,
          normalizedGenerationOptions,
          hasVideoReferenceForBilling(draft, materialSlots)
        ),
        draft,
        materialSlots,
        allNodes,
        undefined,
        model
      ),
    [modelPricing, generationPresets, normalizedGenerationOptions, draft, materialSlots, allNodes, model]
  );
  const quoteCategory = mediaCategory ?? (isTextNode ? "text" : undefined);
  const {
    quoteToken,
    total: creditTotal,
    creditsEnabled,
    refetch: refetchQuote,
  } = useGenerationCreditQuote({
    model: model || undefined,
    category: quoteCategory ?? undefined,
    generationOptions: isMediaNode ? billingGenerationOptions : undefined,
    pricing: modelPricing,
    enabled: Boolean(model && modelOptions.length > 0),
  });
  const { data: creditBalanceData } = useCanvasStoreCreditBalance();
  const insufficientCredits =
    creditsEnabled &&
    creditTotal > 0 &&
    creditBalanceData?.balance != null &&
    creditBalanceData.balance < creditTotal;

  useEffect(() => {
    if (!isEditorNode || !selectedNodeId || !projectId || !config) return;
    // 除了「切换选中节点」外，Agent 通过 update_node_params 改动了当前打开节点的
    // 参数（尺寸/时长等 generationOptions）时 agentTouchVersion 也会变化，需强制
    // 重新从 store 灌入本地状态，否则面板显示与「生成」提交仍会用旧值
    if (
      loadedNodeRef.current === selectedNodeId &&
      loadedVersionRef.current === agentTouchVersion &&
      hydratedPresetsReadyRef.current === Boolean(generationPresets)
    ) {
      return;
    }

    let cancelled = false;
    loadedNodeRef.current = selectedNodeId;
    loadedVersionRef.current = agentTouchVersion;
    hydratedPresetsReadyRef.current = Boolean(generationPresets);

    const currentNode = useCanvasStore.getState().nodes.find((n) => n.id === selectedNodeId);
    const params = (currentNode?.data as WorkflowNodeData)?.params ?? {};
    const rawLocalPrompt = (params[promptKey] as string) || "";
    // 故事板历史误写入的后台版式追加词不在用户编辑框展示
    const localPrompt =
      currentNode?.type === "image_input"
        ? stripStoryboardAdminAppend(rawLocalPrompt)
        : rawLocalPrompt;
    const localModel = (params.model as string) || defaultModel;
    const resolvedModel = modelOptions.some((o) => o.value === localModel) ? localModel : defaultModel;
    const savedOptions = (params.generationOptions as GenerationOptions) || {};
    const savedVisualStyle =
      typeof params.visualStyleId === "string" && params.visualStyleId.trim()
        ? params.visualStyleId.trim()
        : DEFAULT_VISUAL_STYLE_ID;

    setDraft(localPrompt);
    if (
      currentNode?.type === "image_input" &&
      localPrompt !== rawLocalPrompt.trim() &&
      promptKey === "prompt"
    ) {
      useCanvasStore.getState().updateNodeParam(selectedNodeId, "prompt", localPrompt);
    }
    setModel(resolvedModel);
    setVisualStyleId(savedVisualStyle);
    setCameraGear(parseCameraGear(params.cameraGear));
    const resolvedVoice = resolveAudioVoiceFromParams(params as Record<string, unknown>);
    setVoiceStyleLabel(resolvedVoice.label);
    setVoiceId(resolvedVoice.voiceId);
    setVoiceKind(resolvedVoice.kind);
    setTtsModel(resolvedVoice.ttsModel);
    setAudioGenParams(normalizeAudioGenerationParams(params.audioGenParams));
    setMusicLyrics(typeof params.musicLyrics === "string" ? params.musicLyrics : "");
    setMusicTitle(typeof params.musicTitle === "string" ? params.musicTitle : "");
    setMusicTags(typeof params.musicTags === "string" ? params.musicTags : "");
    setAudioParamsOpen(false);
    setVoiceSelectOpen(false);
    setVoiceSelectAnchor(null);
    if (!params.model && resolvedModel) {
      updateNodeParam(selectedNodeId, "model", resolvedModel);
    }
    const normalizedSaved = generationPresets
      ? normalizeGenerationOptions(generationPresets, savedOptions)
      : savedOptions;
    hydratingOptionsFromStoreRef.current = true;
    setGenerationOptions(normalizedSaved);
    // 越界时长（如 H3 的 4s）归一后写回 store，避免卡片摘要仍读旧值
    if (
      isMediaNode &&
      generationPresets &&
      JSON.stringify(normalizedSaved) !== JSON.stringify(savedOptions)
    ) {
      updateNodeParam(selectedNodeId, "generationOptions", normalizedSaved);
    }

    if (isTextNode) {
      // 素材库锁定文本节点：不要用空的 OSS 正文覆盖刚写入的提示词
      if (isLibraryUiLockedParams(params)) {
        return () => {
          cancelled = true;
        };
      }
      fetchNodeText(projectId, selectedNodeId)
        .then((record) => {
          if (cancelled || !record) return;
          const remote = String(record.content ?? "").trim();
          // OSS 尚无正文时保留节点上已有 content（提示词库落点即此路径）
          if (!remote) return;
          setDraft(remote);
          const nextModel = record.model || resolvedModel;
          const safeModel = modelOptions.some((o) => o.value === nextModel) ? nextModel : defaultModel;
          setModel(safeModel);
          rememberModelChoice(safeModel);
          updateNodeParam(selectedNodeId, promptKey, remote);
          updateNodeParam(selectedNodeId, "model", safeModel);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [
    isEditorNode,
    selectedNodeId,
    projectId,
    config,
    promptKey,
    updateNodeParam,
    defaultModel,
    isTextNode,
    isMediaNode,
    generationPresets,
    modelOptions,
    rememberModelChoice,
    agentTouchVersion,
  ]);

  useEffect(() => {
    if (!isEditorNode) loadedNodeRef.current = null;
  }, [isEditorNode]);

  useEffect(() => {
    if (!modelOptions.some((o) => o.value === model) && defaultModel) {
      setModel(defaultModel);
      if (selectedNodeId) updateNodeParam(selectedNodeId, "model", defaultModel);
    }
  }, [model, modelOptions, defaultModel, selectedNodeId, updateNodeParam]);

  useEffect(() => {
    if (!needsVisionModel || !selectedNodeId) return;
    if (model === "doubao_pro") return;
    if (!modelOptions.some((o) => o.value === "doubao_pro")) return;
    setModel("doubao_pro");
    updateNodeParam(selectedNodeId, "model", "doubao_pro");
  }, [needsVisionModel, selectedNodeId, model, modelOptions, updateNodeParam]);

  const scheduleSave = useCallback(
    (content: string, nextModel: string) => {
      if (!selectedNodeId || !projectId || !isTextNode) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNodeText(projectId, selectedNodeId, content, nextModel).catch(() => {});
      }, SAVE_DELAY_MS);
    },
    [projectId, selectedNodeId, isTextNode]
  );

  const handlePromptChange = useCallback(
    (value: string, cursorPos?: number) => {
      if (!selectedNodeId) return;
      // MiniMax 风格描述 2000；Suno 歌词 5000；其它音频通用上限
      const maxChars = isMinimaxMusic
        ? MINIMAX_MUSIC_PROMPT_MAX
        : isSunoMusic
          ? SUNO_LYRICS_MAX
          : AUDIO_PROMPT_MAX_CHARS;
      const nextValue =
        isAudioNode && value.length > maxChars ? value.slice(0, maxChars) : value;
      setDraft(nextValue);
      updateNodeParam(selectedNodeId, promptKey, nextValue);

      const pos = cursorPos ?? nextValue.length;
      const mention = parseMentionQuery(nextValue, pos);
      if (mention) {
        setMentionOpen(true);
        setMentionStart(mention.start);
        setMentionIndex(0);
      } else {
        setMentionOpen(false);
      }

      if (isTextNode) scheduleSave(nextValue, model);
    },
    [
      selectedNodeId,
      promptKey,
      updateNodeParam,
      isTextNode,
      isAudioNode,
      isMinimaxMusic,
      isSunoMusic,
      scheduleSave,
      model,
    ]
  );

  useEffect(() => {
    if (!generationPresets || !selectedNodeId) return;
    if (hydratingOptionsFromStoreRef.current) return;
    setGenerationOptions((prev) => {
      const next = normalizeGenerationOptions(generationPresets, prev);
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
  }, [model, generationPresets, selectedNodeId]);

  const generationOptionsRef = useRef(generationOptions);
  generationOptionsRef.current = generationOptions;

  useEffect(() => {
    if (!selectedNodeId || !isMediaNode) return;
    if (hydratingOptionsFromStoreRef.current) {
      hydratingOptionsFromStoreRef.current = false;
      return;
    }
    const opts = generationOptionsRef.current;
    const stored =
      (useCanvasStore.getState().nodes.find((n) => n.id === selectedNodeId)?.data.params
        ?.generationOptions as GenerationOptions | undefined) ?? {};
    if (JSON.stringify(stored) === JSON.stringify(opts)) return;
    updateNodeParam(selectedNodeId, "generationOptions", opts);
  }, [generationOptions, selectedNodeId, isMediaNode, updateNodeParam]);

  const handleGenerationOptionsChange = useCallback(
    (next: GenerationOptions) => {
      if (!selectedNodeId) return;
      const aspect = findCanvasAspectInOptions(next);
      const clarity = pickCanvasClarityFromOptions(next, "2K");
      const synced: GenerationOptions = {
        ...next,
        ...(aspect
          ? { ratio: aspect, aspect_ratio: aspect, aspectRatio: aspect }
          : {}),
        resolution: clarity,
        clarity,
      };
      setGenerationOptions(synced);
      updateNodeParam(selectedNodeId, "generationOptions", synced);
    },
    [selectedNodeId, updateNodeParam]
  );

  const handleVisualStyleChange = useCallback(
    (nextStyleId: string) => {
      if (!selectedNodeId) return;
      setVisualStyleId(nextStyleId);
      updateNodeParam(selectedNodeId, "visualStyleId", nextStyleId);
    },
    [selectedNodeId, updateNodeParam]
  );

  const handleCameraGearChange = useCallback(
    (next: CameraGearState) => {
      if (!selectedNodeId) return;
      setCameraGear(next);
      updateNodeParam(selectedNodeId, "cameraGear", next);
    },
    [selectedNodeId, updateNodeParam]
  );

  /** 打开音色选择：贴着音色胶囊定位（仅语音合成） */
  const handleOpenVoiceSelect = useCallback(() => {
    if (!isAudioNode || isVoiceCloneModel || isGenerating) return;
    setAudioParamsOpen(false);
    const el = voiceSelectTriggerRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setVoiceSelectAnchor({
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      });
    } else {
      setVoiceSelectAnchor(null);
    }
    setVoiceSelectOpen(true);
  }, [isAudioNode, isVoiceCloneModel, isGenerating]);

  // 切换到声音复刻时关闭音色选择弹窗（复刻不选系统音色）
  useEffect(() => {
    if (!isVoiceCloneModel) return;
    setVoiceSelectOpen(false);
    setVoiceSelectAnchor(null);
  }, [isVoiceCloneModel]);

  const handleSelectVoice = useCallback(
    (voice: AudioVoiceItem) => {
      if (!selectedNodeId || !isAudioNode) return;
      setVoiceStyleLabel(voice.name);
      setVoiceId(voice.voiceId);
      setVoiceKind(voice.kind);
      setTtsModel(voice.ttsModel);
      updateNodeParam(selectedNodeId, "voiceStyleLabel", voice.name);
      updateNodeParam(selectedNodeId, "voiceId", voice.voiceId);
      updateNodeParam(selectedNodeId, "voiceKind", voice.kind);
      updateNodeParam(selectedNodeId, "ttsModel", voice.ttsModel);
    },
    [selectedNodeId, isAudioNode, updateNodeParam]
  );

  const handleAudioGenParamsChange = useCallback(
    (next: AudioGenerationParams) => {
      if (!selectedNodeId || !isAudioNode) return;
      setAudioGenParams(next);
      updateNodeParam(selectedNodeId, "audioGenParams", next);
    },
    [selectedNodeId, isAudioNode, updateNodeParam]
  );

  // 点击外部 / Esc 关闭音频生成参数面板
  useEffect(() => {
    if (!audioParamsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!audioParamsRef.current?.contains(e.target as Node)) setAudioParamsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAudioParamsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [audioParamsOpen]);

  const handleHdUpscaleChange = useCallback(
    (patch: { hdProvider?: string; hdModel?: string; hdScale?: number }) => {
      if (!selectedNodeId) return;
      if (patch.hdProvider != null) updateNodeParam(selectedNodeId, "hdProvider", patch.hdProvider);
      if (patch.hdModel != null) updateNodeParam(selectedNodeId, "hdModel", patch.hdModel);
      if (patch.hdScale != null) updateNodeParam(selectedNodeId, "hdScale", patch.hdScale);
    },
    [selectedNodeId, updateNodeParam]
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!selectedNodeId) return;
      setModel(value);
      rememberModelChoice(value);
      updateNodeParam(selectedNodeId, "model", value);
      if (isTextNode) scheduleSave(draft, value);
      setAudioParamsOpen(false);
    },
    [selectedNodeId, updateNodeParam, isTextNode, scheduleSave, draft, rememberModelChoice]
  );

  const handleMusicLyricsChange = useCallback(
    (value: string) => {
      const next =
        value.length > MINIMAX_MUSIC_LYRICS_MAX
          ? value.slice(0, MINIMAX_MUSIC_LYRICS_MAX)
          : value;
      setMusicLyrics(next);
      if (selectedNodeId) updateNodeParam(selectedNodeId, "musicLyrics", next);
    },
    [selectedNodeId, updateNodeParam]
  );

  const handleMusicTitleChange = useCallback(
    (value: string) => {
      const next = value.length > SUNO_TITLE_MAX ? value.slice(0, SUNO_TITLE_MAX) : value;
      setMusicTitle(next);
      if (selectedNodeId) updateNodeParam(selectedNodeId, "musicTitle", next);
    },
    [selectedNodeId, updateNodeParam]
  );

  const handleMusicTagsChange = useCallback(
    (value: string) => {
      const next = value.length > SUNO_TAGS_MAX ? value.slice(0, SUNO_TAGS_MAX) : value;
      setMusicTags(next);
      if (selectedNodeId) updateNodeParam(selectedNodeId, "musicTags", next);
    },
    [selectedNodeId, updateNodeParam]
  );

  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [];
    const pos = textareaRef.current?.selectionStart ?? draft.length;
    const mention = parseMentionQuery(draft, pos);
    if (!mention) return [];
    return filterSlotsForMention(materialSlots, mention.query);
  }, [mentionOpen, draft, materialSlots]);

  const mentionKnownLabels = useMemo(
    () => materialSlots.map((s) => s.label).filter(Boolean),
    [materialSlots]
  );

  const applyMention = useCallback(
    (slot: MaterialSlot) => {
      const textarea = textareaRef.current;
      const cursorPos = textarea?.selectionStart ?? draft.length;
      const { nextDraft, nextCursor } = insertMention(draft, mentionStart, cursorPos, slot.label);
      handlePromptChange(nextDraft, nextCursor);
      setMentionOpen(false);
      requestAnimationFrame(() => {
        textarea?.focus();
        textarea?.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [draft, mentionStart, handlePromptChange]
  );

  const frameInputSpec = useMemo(() => {
    if (!isVideoNode || !model) return null;
    return getVideoFrameInputSpec(model, apiModels);
  }, [isVideoNode, model, apiModels]);

  const framePreview = useMemo(() => {
    if (!frameInputSpec?.isFrameModel) return null;
    return previewFrameLabels(
      draft,
      materialSlots.map((s) => ({ label: s.label, type: s.type })),
      frameInputSpec.supportsLastFrame
    );
  }, [draft, materialSlots, frameInputSpec]);

  const hasCloneAudioRef =
    Boolean(nodeAudioUrl) || materialSlots.some((s) => s.type === "audio");
  const hasSeparateVideoRef = materialSlots.some((s) => s.type === "video");

  const generateDisabled =
    isGenerating ||
    insufficientCredits ||
    modelOptions.length === 0 ||
    (frameInputSpec?.isFrameModel
      ? Boolean(framePreview?.missingFirst)
      : isVoiceCloneModel
        ? !draft.trim() || !hasCloneAudioRef
        : isAudioSeparateModel
          ? !hasSeparateVideoRef
          : isMinimaxMusic
            ? isMinimaxInstrumentalMode
              ? !draft.trim()
              : !musicLyrics.trim()
            : isSunoMusic
              ? !musicTitle.trim() || !musicTags.trim() || !draft.trim()
            : !draft.trim() &&
              !materialSlots.some((s) => s.type === "image" || s.type === "video"));

  const handleGenerate = useCallback(async () => {
    if (!selectedNodeId || !projectId || !config || submitLockRef.current || isGenerating) return;
    const hasUpstreamMedia = materialSlots.some((s) => s.type === "image" || s.type === "video");
    if (isVoiceCloneModel) {
      if (!draft.trim()) {
        toast.error("请输入要合成的文本");
        return;
      }
      if (!hasCloneAudioRef) {
        toast.error("声音复刻需要参考音频：请先上传到本节点或 @ 引用音频");
        return;
      }
    } else if (isAudioSeparateModel) {
      if (!hasSeparateVideoRef) {
        toast.error("分离音频需要源视频：请连接视频节点");
        return;
      }
    } else if (isMinimaxMusic) {
      if (isMinimaxInstrumentalMode) {
        if (!draft.trim()) {
          toast.error("纯音乐请填写风格描述");
          return;
        }
      } else if (!musicLyrics.trim()) {
        toast.error("歌曲模式请填写歌词");
        return;
      }
    } else if (isSunoMusic) {
      if (!musicTitle.trim()) {
        toast.error("请填写歌曲标题");
        return;
      }
      if (!draft.trim()) {
        toast.error("请填写完整歌词");
        return;
      }
      if (!musicTags.trim()) {
        toast.error("请填写风格标签");
        return;
      }
    } else if (!draft.trim() && !hasUpstreamMedia) {
      return;
    }

    submitLockRef.current = true;
    setGenerating(true);
    beginNodeGeneration(selectedNodeId);

    let asyncPending = false;
    const idempotencyKey = newIdempotencyKey(selectedNodeId);
    try {
      const allRefs = await resolveAllReferences(
        projectId,
        materialSlots,
        useCanvasStore.getState().nodes,
        edges
      );

      let references = collectGenerationReferences(draft, allRefs);
      const i2vSpec =
        isVideoNode && model ? getVideoFrameInputSpec(model, apiModels) : null;

      if (i2vSpec?.isFrameModel) {
        const frameCollection = collectI2vFrameReferences(
          draft,
          allRefs,
          i2vSpec.supportsLastFrame
        );
        const validationError = validateI2vFrameReferences(
          frameCollection,
          i2vSpec.supportsLastFrame
        );
        if (validationError) {
          toast.error(validationError);
          return;
        }
        if (!i2vSpec.supportsLastFrame && frameCollection.orderedImages.length > 1) {
          toast.message("当前模型仅支持首帧，已忽略第二张及之后的 @ 图片");
        } else if (frameCollection.orderedImages.length > 2) {
          toast.message("首尾帧模型最多使用 2 张 @ 图片，已忽略多余的参考图");
        }
        references = frameCollection.references;
      } else if (isVideoNode && isVideoR2vModel(apiModels.find((m) => m.name === model))) {
        references = collectVideoR2vReferences(draft, allRefs);
      }

      const referenceValidationError = validateGenerationReferences(draft, allRefs, references);
      if (referenceValidationError) {
        toast.error(referenceValidationError);
        return;
      }

      setNodeStatus(selectedNodeId, "running");
      updateNodeParam(selectedNodeId, "generationJobId", "");

      let promptForApi: string;
      if (isTextNode) {
        const { resolvedPrompt } = resolveMentionsInPrompt(draft, allRefs);
        promptForApi = stripMentionTokens(resolvedPrompt, allRefs) || resolvedPrompt.trim();
      } else {
        // 图片/视频：展开 @文本 + 合并已连接上游文本节点正文
        if (isVideoNode || isImageNode) {
          const resolved = await resolveMediaPromptForGeneration({
            draft,
            references: allRefs,
          });
          promptForApi = resolved.prompt;
          if (resolved.mergedTextCount > 0) {
            toast.message(
              resolved.mergedTextCount === 1
                ? "已并入上游文本节点内容"
                : `已并入 ${resolved.mergedTextCount} 个上游文本节点`
            );
          }
        } else {
          promptForApi = draft.trim();
        }
        if (isImageNode && isNanoOfficialCreativeToolsModel(model)) {
          const gearSuffix = buildCameraGearPromptSuffix(cameraGear);
          if (gearSuffix) {
            promptForApi = promptForApi ? `${promptForApi}，${gearSuffix}` : gearSuffix;
          }
        }
        // 分离音频无文本要求；API 仍校验 prompt 非空
        if (isAudioSeparateModel && !promptForApi) {
          promptForApi =
            model === "rh_audio_extract_other"
              ? "从参考视频提取伴奏与环境音（消除人声）"
              : "从参考视频提取纯人声（Vocals）";
        }
        // 视频必须有实质提示词，禁止空 prompt 变成 "generate video"
        if (isVideoNode && !hasMeaningfulGenerationPrompt(promptForApi)) {
          toast.error("请填写视频提示词，或连接文本节点提供描述（仅参考图不够）");
          setNodeStatus(selectedNodeId, "idle");
          endNodeGeneration(selectedNodeId);
          return;
        }
      }

      // 提交前用与 payload 一致的选项重签 quoteToken，避免底栏缓存与素材用量不一致导致「价格已更新」死循环
      let submitQuoteToken = quoteToken ?? undefined;
      if (isTextNode) {
        try {
          const fresh = await getCreditQuote({
            model,
            category: quoteCategory ?? "text",
          });
          submitQuoteToken = fresh.quoteToken;
        } catch {
          /* 沿用底栏凭证 */
        }
        const submitOptions = { idempotencyKey, quoteToken: submitQuoteToken };
        const nodeParams = ((node?.data as WorkflowNodeData)?.params ?? {}) as Record<string, unknown>;
        const textPromptKind = resolveTextPromptKind(nodeParams.textPromptKind);
        const result = await generateFromTextNode({
          projectId,
          nodeId: selectedNodeId,
          workflowId: workflowId ?? undefined,
          content: promptForApi,
          model,
          ...(textPromptKind ? { textPromptKind } : {}),
          references,
        }, submitOptions);

        maybeToastCreditCharged(result, creditsEnabled);

        if (result.status === "awaiting_approval") {
          updateNodeParam(selectedNodeId, "generationJobId", result.jobId);
          setNodeStatus(selectedNodeId, "idle");
          toastAwaitingApproval(result.message);
          return;
        }

        if (result.status === "pending") {
          asyncPending = true;
          updateNodeParam(selectedNodeId, "generationJobId", result.jobId);
          toast.message(result.message || "任务已入队，正在后台生成…");
          return;
        }

        if (result.status === "succeeded" && result.content) {
          const content = clipTextNodeGeneratedContent(result.content);
          setDraft(content);
          updateNodeParam(selectedNodeId, promptKey, content);
          if (result.jobId) updateNodeParam(selectedNodeId, "generationJobId", result.jobId);
          await saveNodeText(projectId, selectedNodeId, content, model);
        }
        setNodeStatus(selectedNodeId, "success");
        return;
      }
      const urlParamKey = config.urlParamKey!;
      const nodeParams = ((node?.data as WorkflowNodeData)?.params ?? {}) as Record<string, unknown>;
      const selfMentioned = collectMentionedReferences(draft, allRefs).some(
        (r) => r.nodeId === selectedNodeId
      );
      // Image i2i / 声音复刻：提交本节点媒体；分离音频：取参考视频 URL 作为 videoUrl
      const shouldPassSourceUrl =
        isImageNode || selfMentioned || isVoiceCloneModel;
      let resolvedSourceUrl = shouldPassSourceUrl
        ? await resolveNodeMediaUrl(projectId, nodeParams, urlParamKey)
        : undefined;
      if (isAudioSeparateModel && !resolvedSourceUrl) {
        const videoRef = references.find((r) => r.type === "video" && r.url?.trim());
        resolvedSourceUrl = videoRef?.url?.trim() || undefined;
      }
      // 图片节点有卡片内笔迹时，提交前将原图与透明笔迹层合并为项目资产。
      const sourceUrl =
        isImageNode && resolvedSourceUrl
          ? await mergeInlineDrawingForGeneration({
              projectId,
              nodeId: selectedNodeId,
              nodeParams,
              sourceUrl: resolvedSourceUrl,
            })
          : resolvedSourceUrl;

      // 与本次提交完全一致的 generationOptions（含参考视频/素材用量）
      const submitGenerationOptions = {
        ...withMaterialUsageBillingOptions(
          modelPricing,
          withRefVideoBillingOption(
            generationPresets,
            normalizeGenerationOptions(generationPresets, generationOptions),
            hasVideoReferenceForBilling(draft, materialSlots, references)
          ),
          draft,
          materialSlots,
          allNodes,
          references,
          model
        ),
        // 语音合成：透传官方/复刻音色；声音复刻不传音色（由参考音创建）
        ...(isVoiceTtsModel && voiceId
          ? {
              voice: voiceId,
              voiceId,
              voiceKind,
              ttsModel,
            }
          : {}),
        ...(isVoiceCloneModel
          ? {
              cloneDisplayName:
                promptForApi.replace(/\s+/g, " ").trim().slice(0, 24) || "复刻音色",
            }
          : {}),
        // CosyVoice 语速/声调/音量/音高（强度·音色·音效上游无字段，不传）
        ...(isVoiceTtsModel || isVoiceCloneModel
          ? audioGenParamsToGenerationOptions(audioGenParams)
          : {}),
        // MiniMax Music：歌词与风格描述分字段透传
        ...(isMinimaxMusic
          ? {
              ...(musicLyrics.trim() ? { lyrics: musicLyrics.trim() } : {}),
              ...(draft.trim() ? { musicPrompt: draft.trim() } : {}),
            }
          : {}),
        // Suno Custom：title / tags；主 prompt 即歌词（亦可再传 lyrics）
        ...(isSunoMusic
          ? {
              title: musicTitle.trim(),
              tags: musicTags.trim(),
              lyrics: draft.trim(),
            }
          : {}),
      };
      try {
        const fresh = await getCreditQuote({
          model,
          category: config.assetCategory!,
          generationOptions: submitGenerationOptions,
        });
        submitQuoteToken = fresh.quoteToken;
        void refetchQuote();
      } catch {
        /* 沿用底栏凭证 */
      }
      const submitOptions = { idempotencyKey, quoteToken: submitQuoteToken };

      const result = await generateFromMediaNode({
        projectId,
        nodeId: selectedNodeId,
        workflowId: workflowId ?? undefined,
        category: config.assetCategory!,
        prompt: promptForApi,
        model,
        references,
        sourceUrl: sourceUrl || undefined,
        generationOptions: submitGenerationOptions,
        visualStyleId: visualStyleId || DEFAULT_VISUAL_STYLE_ID,
      }, submitOptions);

      maybeToastCreditCharged(result, creditsEnabled);

      if (result.status === "awaiting_approval") {
        updateNodeParam(selectedNodeId, "generationJobId", result.jobId);
        setNodeStatus(selectedNodeId, "idle");
        toastAwaitingApproval(result.message);
        return;
      }

      if (result.status === "pending") {
        asyncPending = true;
        updateNodeParam(selectedNodeId, "generationJobId", result.jobId);
        toast.message(result.message || "任务已入队，正在后台生成…");
        return;
      }

      if (result.status === "succeeded") {
        // 同步成功时带上 outputAssets，多张时首张落当前节点、其余新建卡片
        const applied = await applyMediaJobResultToNode(
          projectId,
          selectedNodeId,
          node?.type,
          {
            assetId: result.assetId,
            resultUrl: result.resultUrl,
            outputAssets: result.outputAssets,
          },
          result.jobId
        );
        if (!applied) {
          setNodeStatus(selectedNodeId, "success");
        }
      } else {
        setNodeStatus(selectedNodeId, "error");
        toast.error(result.message || "媒体生成失败");
      }
    } catch (err) {
      setNodeStatus(selectedNodeId, "error");
      if (isPricingChangedError(err)) {
        toastPricingChanged(() => void refetchQuote());
        return;
      }
      if (handleCollaboratorSpendCapError(err)) {
        return;
      }
      const detail =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : undefined;
      const aborted = err instanceof DOMException && err.name === "AbortError";
      toast.error(
        aborted
          ? "生成超时，请稍后重试或换用更快模型"
          : detail ||
              (isTextNode ? "文本生成失败，请检查模型是否已启用" : "媒体生成失败，请检查模型是否已启用")
      );
    } finally {
      submitLockRef.current = false;
      setGenerating(false);
      if (!asyncPending) {
        endNodeGeneration(selectedNodeId);
      }
      void invalidateCanvasCreditQueries(queryClient, projectId);
    }
  }, [
    selectedNodeId,
    projectId,
    config,
    draft,
    isGenerating,
    materialSlots,
    isTextNode,
    isImageNode,
    model,
    node,
    setNodeStatus,
    beginNodeGeneration,
    endNodeGeneration,
    updateNodeParam,
    promptKey,
    workflowId,
    generationOptions,
    generationPresets,
    visualStyleId,
    cameraGear,
    isVideoNode,
    apiModels,
    edges,
    quoteToken,
    creditsEnabled,
    refetchQuote,
    queryClient,
    isAudioNode,
    isVoiceCloneModel,
    isVoiceTtsModel,
    isAudioSeparateModel,
    isMinimaxMusic,
    isMinimaxInstrumentalMode,
    musicLyrics,
    isSunoMusic,
    musicTitle,
    musicTags,
    hasCloneAudioRef,
    hasSeparateVideoRef,
    voiceId,
    voiceKind,
    ttsModel,
    audioGenParams,
  ]);

  // 弹窗整体改尺寸：右下角手柄拖宽/拖高倍率；改的是外层 width + 输入区 minHeight，不用 CSS scale
  const [popupScale, setPopupScale] = useState(1);
  const popupResizeRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);
  /** 节点底边实测锚点（flow 坐标），避免 store 高度与 DOM 不一致导致浮层盖住节点 */
  const [nodeBottomAnchor, setNodeBottomAnchor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setPopupScale(1);
  }, [selectedNodeId]);

  const handlePopupResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      popupResizeRef.current = { startX: e.clientX, startY: e.clientY, startScale: popupScale };
    },
    [popupScale]
  );

  const handlePopupResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = popupResizeRef.current;
    if (!drag) return;
    e.stopPropagation();
    // 取水平与垂直位移均值；向右下拉大、向左上缩小（倍率作用于真实宽高）
    const delta = (e.clientX - drag.startX + (e.clientY - drag.startY)) / 2;
    const next = Math.min(1.8, Math.max(0.7, drag.startScale + delta / 320));
    setPopupScale(next);
  }, []);

  const handlePopupResizeEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    popupResizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // 指针已释放，忽略
    }
  }, []);

  // 用屏幕底边反算 flow 锚点，避免 store/measured 高度与真实 DOM 不一致导致盖住节点
  useLayoutEffect(() => {
    if (!selectedNodeId || !isEditorNode) {
      setNodeBottomAnchor(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(
        `.react-flow__node[data-id="${CSS.escape(selectedNodeId)}"]`
      ) as HTMLElement | null;
      if (!el) return;
      // 优先量 body 卡片底边（与上传区同盒），标题不计入；找不到则退回整节点
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
      // 间距与 LightingPanel（height + 12）同单位：画布坐标
      setNodeBottomAnchor({
        x: bottomCenter.x,
        y: bottomCenter.y + CANVAS_EDITOR_NODE_GAP,
      });
    };
    measure();
    const el = document.querySelector(
      `.react-flow__node[data-id="${CSS.escape(selectedNodeId)}"]`
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
    selectedNodeId,
    isEditorNode,
    node?.width,
    node?.height,
    node?.position?.x,
    node?.position?.y,
    viewportZoom,
    viewportX,
    viewportY,
    screenToFlowPosition,
  ]);

  if (!isEditorNode || !node || !config) return null;
  if (multiAngleNodeId && multiAngleNodeId === selectedNodeId) return null;
  if (lightingNodeId && lightingNodeId === selectedNodeId) return null;
  // 擦除 / 扩图 / 裁剪模式用图片上下专用工具条，隐藏底部 prompt 编辑框
  if (inlineImageEraseMode || inlineImageOutpaint || inlineImageCrop) return null;
  if (inlineVideoCrop || inlineVideoTrim) return null;
  // 素材库锁定媒体节点：无底栏生成弹窗（提示词库文本可编辑）
  if (isLibraryUiLockedParams(nodeParamsForMode)) return null;

  // 优先屏幕实测底边；回退与 LightingPanel 相同的 resolveNodeSize + 间距
  const { width, height } = resolveNodeSize(node.width, node.height);
  const world = getNodeWorldPosition(node, allNodes);
  const anchorX = nodeBottomAnchor?.x ?? world.x + width / 2;
  const anchorY = nodeBottomAnchor?.y ?? world.y + height + CANVAS_EDITOR_NODE_GAP;
  // 与 LightingPanel 同一套 transform；用户拖动手柄时改真实 width，背景/边框随盒模型变大
  const basePanelWidth = isHdUpscaleNode
    ? CANVAS_HD_UPSCALE_PANEL_WIDTH
    : isVideoNode
      ? CANVAS_VIDEO_EDITOR_PANEL_WIDTH
      : isImageNode
        ? CANVAS_IMAGE_EDITOR_PANEL_WIDTH
        : isTextNode
          ? CANVAS_TEXT_EDITOR_PANEL_WIDTH
          : isAudioNode
            ? CANVAS_AUDIO_EDITOR_PANEL_WIDTH
            : CANVAS_EDITOR_PANEL_WIDTH;
  const panelWidth = Math.round(basePanelWidth * popupScale);
  const promptMinHeight = Math.round(110 * popupScale);

  const overlayStyle = buildCanvasOverlayStyle(anchorX, anchorY, viewportZoom, "below", {
    width: panelWidth,
    ...CANVAS_MIST_GLASS_STYLE,
    boxShadow: "0 18px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
    // 参数面板向上展开时抬高层级，避免被顶栏「编辑」下拉遮挡
    zIndex: generationOptionsExpanded ? CANVAS_OVERLAY_Z_EDITOR_EXPANDED : CANVAS_OVERLAY_Z_EDITOR,
  });

  return (
    <>
    <EdgeLabelRenderer>
      {/* nowheel：滚轮在弹窗内滚动（提示词输入框、@参考下拉），不被 React Flow 拦去缩放画布 */}
      <div
        className="canvas-node-overlay nodrag nopan nowheel pointer-events-auto overflow-visible rounded-xl shadow-2xl"
        style={overlayStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {isHdUpscaleNode ? (
          <HdUpscalePanel
            nodeId={selectedNodeId}
            hasSourceImage={Boolean(hdSourceUrl)}
            mediaKind={hdMediaKind}
            values={{
              hdProvider: String(nodeParamsForMode.hdProvider ?? "topazlabs"),
              hdModel: String(nodeParamsForMode.hdModel ?? "general"),
              hdScale: Number(nodeParamsForMode.hdScale) || 2,
            }}
            onChange={handleHdUpscaleChange}
          />
        ) : (
          <>
        <MaterialSlotBar slots={materialSlots} />

        <div className="relative">
          {/* Suno：标题 + 风格标签（歌词用下方主输入框） */}
          {isSunoMusic ? (
            <div className="space-y-2 border-b border-white/[0.08] px-3 py-2.5">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-white/55">歌曲标题</span>
                  <span className="tabular-nums text-[11px] text-white/35">
                    {musicTitle.length}/{SUNO_TITLE_MAX}
                  </span>
                </div>
                <input
                  type="text"
                  value={musicTitle}
                  disabled={isGenerating}
                  onChange={(e) => handleMusicTitleChange(e.target.value)}
                  placeholder={SUNO_TITLE_PLACEHOLDER}
                  className="nodrag nopan nowheel w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[13px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/20 disabled:opacity-50"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-white/55">风格标签</span>
                  <span className="tabular-nums text-[11px] text-white/35">
                    {musicTags.length}/{SUNO_TAGS_MAX}
                  </span>
                </div>
                <input
                  type="text"
                  value={musicTags}
                  disabled={isGenerating}
                  onChange={(e) => handleMusicTagsChange(e.target.value)}
                  placeholder={SUNO_TAGS_PLACEHOLDER}
                  className="nodrag nopan nowheel w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[13px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/20 disabled:opacity-50"
                />
              </div>
            </div>
          ) : null}

          <PromptMentionTextarea
            textareaRef={textareaRef}
            value={draft}
            knownLabels={mentionKnownLabels}
            onValueChange={handlePromptChange}
            onKeyDown={(e) => {
              if (!mentionOpen || mentionCandidates.length === 0) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionCandidates.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
              } else if (e.key === "Enter" && mentionOpen) {
                e.preventDefault();
                applyMention(mentionCandidates[mentionIndex]);
              } else if (e.key === "Escape") {
                setMentionOpen(false);
              }
            }}
            placeholder={
              isMinimaxMusic
                ? minimaxMusicStylePlaceholder(isMinimaxInstrumentalMode)
                : isSunoMusic
                  ? SUNO_LYRICS_PLACEHOLDER
                  : config.placeholder
            }
            style={{ minHeight: promptMinHeight }}
          />

          {isMinimaxMusic && !isMinimaxInstrumentalMode ? (
            <div className="border-t border-white/[0.08] px-3 pb-2 pt-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-white/55">歌曲歌词</span>
                <span className="tabular-nums text-[11px] text-white/35">
                  {musicLyrics.length}/{MINIMAX_MUSIC_LYRICS_MAX}
                </span>
              </div>
              <textarea
                value={musicLyrics}
                disabled={isGenerating}
                onChange={(e) => handleMusicLyricsChange(e.target.value)}
                placeholder={MINIMAX_MUSIC_LYRICS_PLACEHOLDER}
                rows={5}
                className="nodrag nopan nowheel w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[13px] leading-relaxed text-white/90 placeholder:text-white/30 outline-none focus:border-white/20 disabled:opacity-50"
              />
            </div>
          ) : null}

          {mentionOpen && mentionCandidates.length > 0 && (
            <div className={`absolute left-3 right-3 top-full ${CANVAS_OVERLAY_DROPDOWN_CLASS} mt-1 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a28] py-1 shadow-xl`}>
              {mentionCandidates.map((slot, idx) => (
                <button
                  key={slot.nodeId}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] ${
                    idx === mentionIndex ? "bg-white/12 text-white" : "text-white/70 hover:bg-white/5"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(slot);
                  }}
                >
                  <SlotIcon type={slot.type} />
                  <span className="truncate">{slot.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {framePreview ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 px-3 py-2 text-[13px]">
            <span className="text-white/40">帧分配</span>
            <span className={framePreview.missingFirst ? "text-amber-400" : "text-white/80"}>
              首帧{framePreview.first ? ` · @${framePreview.first}` : " · 未设置"}
            </span>
            {framePreview.supportsLastFrame ? (
              <span className="text-white/55">
                尾帧{framePreview.last ? ` · @${framePreview.last}` : " · 可选"}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-visible">
            {modelOptions.length === 0 ? (
              <span
                className="inline-flex max-w-full items-center gap-1.5 truncate rounded-lg border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[12px] text-amber-100/85"
                title={
                  isTextNode
                    ? "请在 config/llm-keys.env 填写 DOUBAO_ENDPOINT_ID 或 DEEPSEEK_API_KEY 后重启"
                    : "请在设置页启用模型，或于 config/llm-keys.env 配置密钥后重启"
                }
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/90" />
                {isTextNode ? "未配置文本模型" : "未配置可用模型"}
              </span>
            ) : (
              <Select
                value={model}
                open={modelSelectOpen}
                onOpenChange={setModelSelectOpen}
                onValueChange={(value) => value && handleModelChange(value)}
              >
                <SelectTrigger
                  className={MODEL_SELECT_TRIGGER_CLASS}
                  title="模型选择（与后台模型开关分类一致）"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ModelBrandMark className="size-[18px] shrink-0 text-white" />
                    {/* 触发器只显示名称，不带描述小字 */}
                    <SelectValue className="truncate font-semibold tracking-wide text-white">
                      {modelOptions.find((o) => o.value === model)?.label ?? "已选模型"}
                    </SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent
                  className={MODEL_SELECT_MENU_CONTENT_CLASS}
                  side="bottom"
                  sideOffset={6}
                  align="start"
                  alignItemWithTrigger={false}
                >
                  {/* 能力标签：固定顶部，不随列表滚动 */}
                  <ModelTagPicker
                    category={mediaCategory}
                    modelOptions={modelOptions}
                    activeTagId={activeModelTagId}
                    onActiveTagChange={setActiveModelTagId}
                  />
                  {filteredModelOptions.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-white/45">
                      {activeModelTagId ? "该标签下暂无模型" : "暂无模型"}
                    </div>
                  ) : (
                    <ModelFlatFavoriteList
                      key={selectedNodeId ?? "model-flat"}
                      open={modelSelectOpen}
                      options={filteredModelOptions}
                      selectedModel={model}
                      onSelectModel={(name) => {
                        handleModelChange(name);
                        setModelSelectOpen(false);
                      }}
                    />
                  )}
                </SelectContent>
              </Select>
            )}

            {isTextNode ? (
              <>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden />
                <Select
                  value={textPromptKindSelectValue}
                  onValueChange={(value) => {
                    if (!selectedNodeId || value == null) return;
                    const next = value === TEXT_PROMPT_KIND_DEFAULT ? "" : value;
                    updateNodeParam(selectedNodeId, "textPromptKind", next);
                  }}
                >
                  <SelectTrigger
                    className={MODEL_SELECT_TRIGGER_CLASS}
                    title="选择类型"
                  >
                    {/* Base UI 默认显示 value 原值，这里显式映射中文标签 */}
                    <SelectValue className="truncate font-medium tracking-wide text-white/85">
                      {textPromptKindLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    className={MODEL_SELECT_CONTENT_CLASS}
                    side="bottom"
                    sideOffset={6}
                    align="start"
                    alignItemWithTrigger={false}
                  >
                    <SelectItem value={TEXT_PROMPT_KIND_DEFAULT} className={MODEL_SELECT_ITEM_CLASS}>
                      选择类型
                    </SelectItem>
                    <SelectItem
                      value={TEXT_PROMPT_KIND_INPUT_SCRIPT}
                      className={MODEL_SELECT_ITEM_CLASS}
                    >
                      输入剧本
                    </SelectItem>
                    {textPromptKindItems.map((item) => (
                      <SelectItem
                        key={item.tool}
                        value={item.tool}
                        className={MODEL_SELECT_ITEM_CLASS}
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : null}

            {isMediaNode && (isImageNode || isVideoNode) ? (
              <>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden />
                <ImageOptionsBar
                  key={`${selectedNodeId ?? "none"}-opts`}
                  presets={
                    generationPresets ??
                    (isVideoNode ? videoDurationPresets() : imageAspectPresets())
                  }
                  value={generationOptions}
                  onChange={handleGenerationOptionsChange}
                  pricing={modelPricing}
                  variant={isVideoNode ? "video" : "image"}
                  layout="inline"
                  modelName={model}
                />
              </>
            ) : null}

            {/* 音频（MiniMax 等）：有预设组时展示折叠摘要；Suno 无枚举组则跳过 */}
            {isAudioNode &&
            generationPresets &&
            generationPresets.groups.length > 0 &&
            !isVoiceTtsModel &&
            !isVoiceCloneModel &&
            !isAudioSeparateModel ? (
              <>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden />
                <ImageOptionsBar
                  key={`${selectedNodeId ?? "none"}-audio-opts`}
                  presets={
                    isMinimaxInstrumentalMode
                      ? {
                          ...generationPresets,
                          groups: generationPresets.groups.filter((g) => g.id !== "lyricsOptimizer"),
                        }
                      : generationPresets
                  }
                  value={generationOptions}
                  onChange={handleGenerationOptionsChange}
                  pricing={modelPricing}
                  variant="audio"
                  layout="inline"
                  modelName={model}
                />
              </>
            ) : null}

            {isImageNode && isNanoOfficialCreativeToolsModel(model) ? (
              <>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-white/15" aria-hidden />
                <ImageCreativeToolsButton
                  nodeId={selectedNodeId}
                  hasImage={Boolean(nodeImageUrl)}
                  visualStyleId={visualStyleId}
                  onVisualStyleChange={handleVisualStyleChange}
                  modelName={model}
                  disabled={cameraGear.enabled}
                />
                <ImageCameraGearButton
                  value={cameraGear}
                  onChange={handleCameraGearChange}
                />
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            {isAudioNode ? (
              <>
                {/* 仅语音合成显示音色胶囊；声音复刻隐藏（用参考音创建专属音色） */}
                {isVoiceTtsModel ? (
                  <button
                    ref={voiceSelectTriggerRef}
                    type="button"
                    title="音色选择"
                    aria-label={`当前音色 ${voiceStyleLabel}，打开音色选择`}
                    disabled={isGenerating}
                    onClick={handleOpenVoiceSelect}
                    className="inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 text-[13px] text-white/90 transition-colors hover:bg-white/[0.12] disabled:opacity-35"
                  >
                    <Sparkles className="size-3.5 shrink-0 text-white/70" strokeWidth={1.75} />
                    <span className="truncate font-medium">{voiceStyleLabel}</span>
                    <ArrowLeftRight className="size-3.5 shrink-0 text-white/45" strokeWidth={1.75} />
                  </button>
                ) : null}
                {/* CosyVoice 语速等参数；音乐模型不展示 */}
                {isVoiceTtsModel || isVoiceCloneModel ? (
                  <div ref={audioParamsRef} className="relative">
                    <button
                      type="button"
                      title="生成参数"
                      aria-label="生成参数"
                      aria-expanded={audioParamsOpen}
                      aria-haspopup="dialog"
                      disabled={isGenerating}
                      onClick={() => setAudioParamsOpen((open) => !open)}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md text-white transition-colors hover:bg-white/[0.08] disabled:opacity-35",
                        audioParamsOpen && "bg-white/[0.12]"
                      )}
                    >
                      <SlidersHorizontal className="size-[18px]" strokeWidth={1.75} />
                    </button>
                    {audioParamsOpen ? (
                      <div
                        className={`absolute bottom-full right-0 ${CANVAS_OVERLAY_DROPDOWN_CLASS} mb-2`}
                      >
                        <AudioGenerationParamsPanel
                          value={audioGenParams}
                          onChange={handleAudioGenParamsChange}
                          disabled={isGenerating}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <span
                  className="tabular-nums text-[13px] text-white/40"
                  title={
                    isMinimaxMusic
                      ? "风格描述字数"
                      : isSunoMusic
                        ? "歌词字数"
                        : "提示词字数"
                  }
                >
                  {draft.length}/
                  {isMinimaxMusic
                    ? MINIMAX_MUSIC_PROMPT_MAX
                    : isSunoMusic
                      ? SUNO_LYRICS_MAX
                      : AUDIO_PROMPT_MAX_CHARS}
                </span>
              </>
            ) : null}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generateDisabled}
              title={
                insufficientCredits
                  ? `算力不足，需要 ${creditTotal}`
                  : isGenerating
                    ? "生成中"
                    : "生成"
              }
              aria-label={isGenerating ? "生成中" : "生成"}
              className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#c9c9c9] text-black transition-colors hover:bg-[#d6d6d6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isGenerating ? (
                <span className="inline-block size-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
              ) : (
                <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden />
              )}
            </button>
          </div>
        </div>

          </>
        )}

        {/* 右下角拖拽手柄：调整弹窗外层真实宽高 */}
        <div
          className="nodrag nopan absolute bottom-0 right-0 z-30 flex h-5 w-5 cursor-nwse-resize items-end justify-end rounded-br-xl p-1 text-white/35 hover:text-white/70"
          title="拖动调整弹窗大小"
          onPointerDown={handlePopupResizeStart}
          onPointerMove={handlePopupResizeMove}
          onPointerUp={handlePopupResizeEnd}
          onPointerCancel={handlePopupResizeEnd}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M11 4 L4 11 M11 8 L8 11"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </EdgeLabelRenderer>
    <VoiceSelectModal
      open={voiceSelectOpen && isVoiceTtsModel}
      selectedName={voiceStyleLabel}
      selectedVoiceId={voiceId}
      projectId={projectId}
      anchorRect={voiceSelectAnchor}
      onClose={() => {
        setVoiceSelectOpen(false);
        setVoiceSelectAnchor(null);
      }}
      onSelect={handleSelectVoice}
    />
    </>
  );
}

