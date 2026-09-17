"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "@/stores/canvasStore";
import { uploadAsset, type Asset } from "@/lib/api/assets";
import { formatCreditLabel } from "@/lib/api/credits";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { resolveLocalMediaUrl } from "@/lib/canvas/resolveNodeMedia";
import { useCanvasToolConfiguredModel } from "@/lib/canvas/useCanvasToolConfiguredModel";
import {
  isStoryboardGenActive,
  STORYBOARD_CELL_GENERATING_OVERLAY_CLASS,
  STORYBOARD_ROW_GENERATING_CLASS,
} from "@/lib/canvas/storyboardGeneratingUi";
import { MediaAssetPicker } from "./MediaAssetPicker";
import {
  SUBJECT_KIND_ASSET_SUBCATEGORY,
  computeSubjectImageSourceHash,
  createEmptySubject,
  newSubjectId,
  parseSubjectsParam,
  subjectKindToKey,
  type StoryboardGenStatus,
  type StoryboardSubjectItem,
  type StoryboardSubjectKind,
  type StoryboardSubjectsBundle,
} from "@/types/storyboard-subjects";

const KIND_LABELS: Record<StoryboardSubjectKind, string> = {
  role: "角色",
  scene: "场景",
  prop: "道具",
};

interface StoryboardSubjectsViewProps {
  nodeId: string;
}

/** 单元格内紧凑算力提示（闪电图标 + 数字，完整文案放 title） */
function CellCreditHint({
  cost,
  loading,
  creditsEnabled,
}: {
  cost: number;
  loading?: boolean;
  creditsEnabled: boolean;
}) {
  const label = loading ? "…" : formatCreditLabel(cost, creditsEnabled);
  const display = loading ? "…" : cost > 0 ? String(cost) : "—";
  return (
    <span
      className="inline-flex items-center gap-0.5 leading-none tabular-nums text-white/40"
      title={label}
    >
      {/* 主体表单元格算力闪电用主题紫，与分镜表一致 */}
      <Zap className="size-2 fill-current text-primary" aria-hidden />
      <span>{display}</span>
    </span>
  );
}

function SubjectImagePreview({
  item,
  previewUrl,
  onRetry,
}: {
  item: StoryboardSubjectItem;
  previewUrl: string;
  onRetry?: () => void;
}) {
  const status: StoryboardGenStatus = item.imageStatus ?? (item.imageAssetId ? "succeeded" : "idle");
  const [previewOpen, setPreviewOpen] = useState(false);
  const generating = isStoryboardGenActive(status);

  return (
    <>
      <div
        className={`relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white/[0.03] ${
          generating ? "border-purple-400/60 shadow-[0_0_12px_rgba(168,85,247,0.35)]" : "border-white/10"
        }`}
      >
        {generating ? (
          <div className={STORYBOARD_CELL_GENERATING_OVERLAY_CLASS}>
            <Loader2 className="h-4 w-4 animate-spin text-purple-200" aria-label="主体图生成中" />
            <span className="text-[7px] font-medium text-purple-100">生成中</span>
          </div>
        ) : previewUrl ? (
          <button
            type="button"
            className="h-full w-full"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewOpen(true);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="查看主体图"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          </button>
        ) : status === "failed" ? (
          <button
            type="button"
            className="flex flex-col items-center gap-0.5 px-1 text-[8px] text-red-300/80"
            title={item.imageError || "生成失败"}
            onClick={(e) => {
              e.stopPropagation();
              onRetry?.();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <RefreshCw className="h-3 w-3" />
            重试
          </button>
        ) : (
          <span className="px-1 text-center text-[8px] leading-snug text-white/30">待生成</span>
        )}
      </div>
      {previewOpen && previewUrl ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewOpen(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="主体图预览"
            className="max-h-[85vh] max-w-[90vw] rounded-lg border border-white/15 object-contain shadow-2xl"
          />
        </div>
      ) : null}
    </>
  );
}

export function StoryboardSubjectsView({ nodeId }: StoryboardSubjectsViewProps) {
  const projectId = useCanvasStore((s) => s.projectId);
  const subjectsParam = useCanvasStore(
    useShallow((s) => s.nodes.find((n) => n.id === nodeId)?.data?.params?.subjects)
  );
  const subjectKind = useCanvasStore(
    useShallow((s) => {
      const raw = s.nodes.find((n) => n.id === nodeId)?.data?.params?.subjectKind;
      return raw === "scene" || raw === "prop" ? raw : "role";
    })
  ) as StoryboardSubjectKind;
  const selectedSubjectId = useCanvasStore(
    useShallow((s) => String(s.nodes.find((n) => n.id === nodeId)?.data?.params?.selectedSubjectId ?? ""))
  );
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  // 主体生图模型：设置 → 高级设置 → 画布工具 →「准备资产 · 主体生图」
  const {
    total: subjectImageUnitCost,
    isLoading: subjectImageQuoteLoading,
    creditsEnabled: subjectImageCreditsEnabled,
  } = useCanvasToolConfiguredModel(
    "storyboard_subject_image",
    Boolean(projectId),
    "image",
    { size: "1x1" }
  );

  const subjects = useMemo(() => parseSubjectsParam(subjectsParam), [subjectsParam]);
  const list = subjects[subjectKindToKey(subjectKind)];
  const { lookupMap } = useProjectAssetManifest(projectId);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceMenuOpen, setReplaceMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const assetUrlById = useMemo(() => {
    const manifestLookup = (id: string) => lookupMap?.get(id);
    const map = new Map<string, string>();
    for (const item of [...subjects.roles, ...subjects.scenes, ...subjects.props]) {
      if (!item.imageAssetId) continue;
      const url = resolveLocalMediaUrl({ assetId: item.imageAssetId }, "imageUrl", manifestLookup);
      if (url) map.set(item.id, url);
    }
    return map;
  }, [subjects, lookupMap]);

  const persistSubjects = useCallback(
    (next: StoryboardSubjectsBundle) => {
      updateNodeParam(nodeId, "subjects", next);
    },
    [nodeId, updateNodeParam]
  );

  const patchSubject = useCallback(
    (id: string, patch: Partial<StoryboardSubjectItem>) => {
      const key = subjectKindToKey(subjectKind);
      const next: StoryboardSubjectsBundle = {
        ...subjects,
        [key]: subjects[key].map((item) => (item.id === id ? { ...item, ...patch } : item)),
      };
      persistSubjects(next);
    },
    [subjectKind, subjects, persistSubjects]
  );

  const handleRetryImage = useCallback(
    (subjectId: string) => {
      updateNodeParam(nodeId, "subjectImageRetryId", subjectId);
    },
    [nodeId, updateNodeParam]
  );

  const handleSelectKind = useCallback(
    (kind: StoryboardSubjectKind) => {
      updateNodeParam(nodeId, "subjectKind", kind);
      const key = subjectKindToKey(kind);
      const first = subjects[key][0];
      updateNodeParam(nodeId, "selectedSubjectId", first?.id ?? "");
    },
    [nodeId, subjects, updateNodeParam]
  );

  const handleSelectItem = useCallback(
    (id: string) => {
      updateNodeParam(nodeId, "selectedSubjectId", id);
    },
    [nodeId, updateNodeParam]
  );

  const handleAdd = useCallback(() => {
    const key = subjectKindToKey(subjectKind);
    const item = createEmptySubject(`${KIND_LABELS[subjectKind]}${subjects[key].length + 1}`);
    persistSubjects({
      ...subjects,
      [key]: [...subjects[key], item],
    });
    updateNodeParam(nodeId, "selectedSubjectId", item.id);
  }, [subjectKind, subjects, persistSubjects, nodeId, updateNodeParam]);

  const handleDelete = useCallback(() => {
    if (!selectedSubjectId) return;
    const key = subjectKindToKey(subjectKind);
    const nextList = subjects[key].filter((item) => item.id !== selectedSubjectId);
    persistSubjects({ ...subjects, [key]: nextList });
    updateNodeParam(nodeId, "selectedSubjectId", nextList[0]?.id ?? "");
  }, [selectedSubjectId, subjectKind, subjects, persistSubjects, nodeId, updateNodeParam]);

  const selected = list.find((item) => item.id === selectedSubjectId) ?? list[0];
  const selectedPreviewUrl = selected ? assetUrlById.get(selected.id) ?? "" : "";

  /** 用户替换主体参考图：写回分镜表 imageAssetId，拉片复刻/成片均读此最终图 */
  const applyReplacedSubjectImage = useCallback(
    (asset: Asset) => {
      if (!selected) return;
      patchSubject(selected.id, {
        imageAssetId: asset.id,
        imageStatus: "succeeded",
        imageError: undefined,
        // 与当前提示词对齐 hash，避免批量「生成主体图」立刻覆盖用户替换图
        imageSourceHash: computeSubjectImageSourceHash(selected, subjectKind),
      });
      setReplaceMenuOpen(false);
      setPickerOpen(false);
      toast.success(`已替换「${selected.name}」参考图`);
    },
    [selected, patchSubject, subjectKind]
  );

  const handleReplaceUpload = useCallback(
    async (file: File | undefined) => {
      if (!file || !selected) return;
      if (!projectId) {
        toast.error("请先打开项目后再替换图片");
        return;
      }
      setReplacing(true);
      try {
        const asset = await uploadAsset({
          file,
          projectId,
          category: "image",
          subcategory: SUBJECT_KIND_ASSET_SUBCATEGORY[subjectKind],
          title: selected.name || file.name.replace(/\.[^.]+$/, "") || "主体参考",
        });
        applyReplacedSubjectImage(asset);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "替换图片失败");
      } finally {
        setReplacing(false);
        if (replaceInputRef.current) replaceInputRef.current.value = "";
      }
    },
    [selected, projectId, subjectKind, applyReplacedSubjectImage]
  );

  return (
    <div className="flex min-h-[200px] flex-col">
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1">
        {(["role", "scene", "prop"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSelectKind(kind);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              subjectKind === kind
                ? "bg-purple-500/20 text-purple-200"
                : "text-white/40 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            {KIND_LABELS[kind]}{" "}
            <span className="tabular-nums text-white/35">{subjects[subjectKindToKey(kind)].length}</span>
          </button>
        ))}
        <span className="ml-auto text-[9px] text-white/28">可替换参考图；顶部菜单可生成</span>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-[11px] leading-relaxed text-white/28">
          连接剧本文本后点「提取分镜」
          <br />
          将自动提取{KIND_LABELS[subjectKind]}名称与提示词
        </div>
      ) : (
        <>
          {/* nowheel：滚轮滚动缩略图网格，不被 React Flow 拦去缩放画布 */}
          <div className="nowheel grid max-h-[180px] grid-cols-3 gap-1.5 overflow-y-auto p-2">
            {list.map((item) => {
              const active = (selected?.id ?? "") === item.id;
              const thumbUrl = assetUrlById.get(item.id) ?? "";
              const status = item.imageStatus ?? (item.imageAssetId ? "succeeded" : "idle");
              const generating = isStoryboardGenActive(status);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectItem(item.id);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    generating
                      ? STORYBOARD_ROW_GENERATING_CLASS
                      : active
                        ? "border-purple-400/40 bg-purple-500/[0.1]"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="mb-1.5 flex items-start gap-1.5">
                    <div
                      className={`relative h-10 w-10 shrink-0 overflow-hidden rounded border bg-black/20 ${
                        generating ? "border-purple-400/50" : "border-white/10"
                      }`}
                    >
                      {generating ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-purple-950/80">
                          <Loader2 className="h-3 w-3 animate-spin text-purple-200" />
                          <span className="text-[6px] text-purple-100">生成中</span>
                        </div>
                      ) : thumbUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[7px] text-white/25">
                          无图
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[10px] font-medium text-white/85">{item.name}</div>
                      <div className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-white/35">
                        {item.extractPrompt || "暂无提示词"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="border-t border-white/[0.06] p-2">
              <div className="mb-2 flex items-start gap-2">
                <SubjectImagePreview
                  item={selected}
                  previewUrl={selectedPreviewUrl}
                  onRetry={() => handleRetryImage(selected.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-medium text-white/70">{selected.name}</span>
                    <div className="relative flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetryImage(selected.id);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] text-purple-200/80 hover:bg-white/10"
                        title={`生成主体图 · ${formatCreditLabel(subjectImageUnitCost, subjectImageCreditsEnabled)}`}
                      >
                        生成图
                        <CellCreditHint
                          cost={subjectImageUnitCost}
                          loading={subjectImageQuoteLoading}
                          creditsEnabled={subjectImageCreditsEnabled}
                        />
                      </button>
                      <button
                        type="button"
                        disabled={replacing}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReplaceMenuOpen((open) => !open);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="rounded px-1.5 py-0.5 text-[9px] text-sky-200/85 hover:bg-white/10 disabled:opacity-50"
                        title="用本地图或素材库替换主体参考图；拉片复刻将使用此图"
                      >
                        {replacing ? "替换中…" : "替换图片"}
                      </button>
                      {replaceMenuOpen ? (
                        <div
                          className="absolute right-0 top-full z-20 mt-1 min-w-[112px] rounded-md border border-white/10 bg-[rgba(12,12,28,0.98)] py-1 shadow-xl"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="block w-full px-2.5 py-1.5 text-left text-[9px] text-white/75 hover:bg-white/[0.06]"
                            onClick={() => {
                              setReplaceMenuOpen(false);
                              replaceInputRef.current?.click();
                            }}
                          >
                            本地上传
                          </button>
                          <button
                            type="button"
                            className="block w-full px-2.5 py-1.5 text-left text-[9px] text-white/75 hover:bg-white/[0.06]"
                            onClick={() => {
                              setReplaceMenuOpen(false);
                              setPickerOpen(true);
                            }}
                          >
                            素材库
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAdd();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="rounded px-1.5 py-0.5 text-[9px] text-white/45 hover:bg-white/10 hover:text-white/80"
                      >
                        添加
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="rounded px-1.5 py-0.5 text-[9px] text-red-300/70 hover:bg-white/10"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={selected.extractPrompt}
                    onChange={(e) => patchSubject(selected.id, { extractPrompt: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    rows={3}
                    placeholder="主体生图提示词…"
                    className="block w-full resize-none rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[10px] leading-relaxed text-white/80 outline-none ring-0 placeholder:text-white/25 focus:border-purple-400/30"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleReplaceUpload(e.target.files?.[0]);
        }}
      />
      {pickerOpen ? (
        <MediaAssetPicker
          category="image"
          overlayZIndex={120}
          onSelect={(asset) => applyReplacedSubjectImage(asset)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function duplicateSubjectItem(source: StoryboardSubjectItem): StoryboardSubjectItem {
  return {
    ...source,
    id: newSubjectId(),
    name: `${source.name} 副本`,
    imageAssetId: undefined,
    imageStatus: "idle",
    imageError: undefined,
    imageSourceHash: undefined,
  };
}
