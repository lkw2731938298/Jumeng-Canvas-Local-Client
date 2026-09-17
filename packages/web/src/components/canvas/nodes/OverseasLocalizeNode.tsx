"use client";

/**
 * 一键出海专属节点卡片（对齐 OiiOii Skill 卡）：
 * - 分步提示「提示 n/5」+「知道了」
 * - 可复用：上传参考视频、选市场、拉片 / 主体图 / 成片
 */

import { memo, useCallback, useRef, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import {
  Film,
  Globe2,
  ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { uploadAsset } from "@/lib/api/assets";
import { inferAssetCategory } from "@/lib/canvas/fileDrop";
import {
  OVERSEAS_MARKETS,
  getOverseasMarket,
  type OverseasMarketId,
} from "@/lib/canvas/overseasMarkets";
import {
  OVERSEAS_TIPS,
  patchOverseasNodeParams,
  readOverseasNodeParams,
  sessionFromOverseasNode,
  syncOverseasSessionFromNode,
  type OverseasNodeParams,
} from "@/lib/canvas/overseasLocalizeNode";
import {
  getOverseasSubjectReadiness,
  runOverseasAnalyze,
  runOverseasBatchVideos,
  runOverseasSubjectImages,
} from "@/lib/canvas/overseasPipeline";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import { BaseNode } from "./BaseNode";

const ACCEPT_VIDEO =
  "video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.webm,.mov,.mkv";

function formatCredits(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100);
}

function TipDialog(props: {
  tipIndex: number;
  onAck: () => void;
  onSkipAll: () => void;
}) {
  const tip = OVERSEAS_TIPS[props.tipIndex] ?? OVERSEAS_TIPS[0];
  const n = props.tipIndex + 1;
  const total = OVERSEAS_TIPS.length;
  return (
    <div
      role="dialog"
      aria-label={`提示 ${n}/${total}`}
      className="flex h-full flex-col justify-between rounded-xl bg-gradient-to-b from-violet-500/15 via-transparent to-black/20 p-1"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium tracking-wide text-violet-200/90">
            提示 {n}/{total}
          </span>
          <button
            type="button"
            className="text-[10px] text-white/40 hover:text-white/70"
            onClick={props.onSkipAll}
          >
            跳过引导
          </button>
        </div>
        <h3 className="mb-2 text-[15px] font-semibold leading-snug text-white">
          {tip.title}
        </h3>
        <p className="text-[12px] leading-relaxed text-white/65">{tip.body}</p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-1">
          {OVERSEAS_TIPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= props.tipIndex ? "bg-violet-400" : "bg-white/15"
              )}
            />
          ))}
        </div>
        <button
          type="button"
          className="w-full rounded-xl bg-white px-3 py-2.5 text-[13px] font-medium text-zinc-900 hover:bg-white/90"
          onClick={props.onAck}
        >
          {n >= total ? "生成视频 · 知道了" : "知道了"}
        </button>
      </div>
    </div>
  );
}

export const OverseasLocalizeNode = memo(function OverseasLocalizeNode(
  props: NodeProps
) {
  const { id, data } = props;
  const nodeData = data as WorkflowNodeData;
  const params = readOverseasNodeParams(nodeData.params as Record<string, unknown>);
  const projectId = useCanvasStore((s) => String(s.projectId || ""));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const patch = useCallback(
    (partial: Partial<OverseasNodeParams>) => {
      patchOverseasNodeParams(id, partial);
      const next = { ...params, ...partial };
      if (projectId) syncOverseasSessionFromNode(projectId, next);
    },
    [id, params, projectId]
  );

  const market = getOverseasMarket(params.targetMarketId);
  const phaseLabel: Record<string, string> = {
    idle: "等待开始",
    bootstrap: "搭建画布",
    extracting: "切镜抽帧",
    analyzing: "本地化拉片",
    ready: "可生成",
    confirm: "确认生成",
    prompting: "生成提示词",
    generating: "生成视频",
    done: "完成",
    error: "出错",
  };
  const running = ["bootstrap", "extracting", "analyzing", "prompting", "generating"].includes(
    params.phase
  );
  const showActions =
    params.phase === "confirm" ||
    params.phase === "ready" ||
    params.phase === "done" ||
    (params.shotCount > 0 && Boolean(params.gridNodeId));
  // 渲染期勿因分镜表状态异常整卡崩溃
  let subjectReady: ReturnType<typeof getOverseasSubjectReadiness> | null = null;
  if (params.gridNodeId && showActions) {
    try {
      subjectReady = getOverseasSubjectReadiness(params.gridNodeId);
    } catch {
      subjectReady = null;
    }
  }

  const handleAckTip = () => {
    if (params.tipIndex >= OVERSEAS_TIPS.length - 1) {
      patch({ tipDismissed: true, tipIndex: OVERSEAS_TIPS.length - 1 });
      return;
    }
    patch({ tipIndex: params.tipIndex + 1 });
  };

  const handlePickVideo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !projectId) return;
    const inferred = inferAssetCategory(file);
    if (inferred !== "video") {
      toast.error("请上传视频文件（mp4 / mov / webm 等）");
      return;
    }
    setUploading(true);
    try {
      const asset = await uploadAsset({
        file,
        projectId,
        category: "video",
        title: file.name.replace(/\.[^.]+$/, "") || "出海参考视频",
      });
      patch({
        videoAssetId: asset.id,
        videoFileUrl: asset.fileUrl,
        videoTitle: asset.title || file.name,
        phase: "idle",
        message: `已上传「${asset.title || file.name}」，选择市场后点击本地化拉片`,
      });
      toast.success("参考视频已上传");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runAnalyze = async () => {
    if (!projectId) {
      toast.error("项目未就绪");
      return;
    }
    const session = sessionFromOverseasNode({ ...params });
    if (!session) {
      toast.error("请先上传参考视频");
      return;
    }
    setBusy(true);
    try {
      syncOverseasSessionFromNode(projectId, params);
      const result = await runOverseasAnalyze({
        projectId,
        session,
        onProgress: (partial) => {
          patch({
            phase: partial.phase || params.phase,
            message: partial.message || params.message,
            gridNodeId: partial.gridNodeId || params.gridNodeId,
            videoNodeId: partial.videoNodeId || params.videoNodeId,
            shotCount: partial.shotCount ?? params.shotCount,
            styleSummary: partial.styleSummary || params.styleSummary,
            localePlan:
              partial.localePlan || partial.replacePlan || params.localePlan,
            targetMarketId: params.targetMarketId,
            analyzeCredit: partial.analyzeCredit ?? params.analyzeCredit,
            estimatedVideoTotal:
              partial.estimatedVideoTotal ?? params.estimatedVideoTotal,
            videoCreditEach: partial.videoCreditEach ?? params.videoCreditEach,
            videoModelName: partial.videoModelName || params.videoModelName,
            creditsEnabled: partial.creditsEnabled ?? params.creditsEnabled,
          });
        },
      });
      patch({
        phase: result.phase,
        message: result.message,
        gridNodeId: result.gridNodeId || "",
        videoNodeId: result.videoNodeId || "",
        shotCount: result.shotCount || 0,
        styleSummary: result.styleSummary || "",
        localePlan: result.localePlan || result.replacePlan || "",
        analyzeCredit: result.analyzeCredit,
        estimatedVideoTotal: result.estimatedVideoTotal,
        videoCreditEach: result.videoCreditEach,
        videoModelName: result.videoModelName,
        creditsEnabled: result.creditsEnabled,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "出海拉片失败";
      patch({ phase: "error", message: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const runSubjects = async () => {
    if (!projectId || !params.gridNodeId) {
      toast.error("请先完成拉片");
      return;
    }
    setBusy(true);
    try {
      patch({ phase: "prompting", message: "正在生成主体图…" });
      await runOverseasSubjectImages({
        projectId,
        gridNodeId: params.gridNodeId,
        onProgress: (partial) => {
          if (partial.message) patch({ message: partial.message });
        },
      });
      patch({
        phase: "confirm",
        message: "主体图已生成，可确认生成出海视频",
      });
      toast.success("主体图已生成");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "主体图失败";
      patch({ phase: "error", message: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const runBatch = async () => {
    if (!projectId || !params.gridNodeId) {
      toast.error("请先完成拉片");
      return;
    }
    if (subjectReady && subjectReady.pendingCount > 0) {
      const ok = window.confirm(
        `还有 ${subjectReady.pendingCount} 个主体未出图。仍要继续生成出海视频吗？`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      patch({ phase: "generating", message: "正在批量生成出海视频…" });
      const ids = await runOverseasBatchVideos({
        projectId,
        gridNodeId: params.gridNodeId,
        onProgress: (partial) => {
          if (partial.message) patch({ message: partial.message, phase: partial.phase || "generating" });
        },
      });
      patch({
        phase: "done",
        message: `已完成 ${ids.length} 段出海视频，可在成片表预览`,
      });
      toast.success(`出海成片完成：${ids.length} 镜`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "成片失败";
      patch({ phase: "error", message: msg });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const showTips = !params.tipDismissed;

  return (
    <BaseNode
      {...props}
      data={nodeData}
      icon="Globe"
      color="#8b5cf6"
      status={(nodeData.status as "idle" | "running" | "success" | "error") || "idle"}
      unboundedResize
    >
      <div
        className="nodrag nopan flex h-full min-h-[420px] flex-col text-[12px] text-zinc-100"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {showTips ? (
          <TipDialog
            tipIndex={params.tipIndex}
            onAck={handleAckTip}
            onSkipAll={() => patch({ tipDismissed: true })}
          />
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Globe2 className="h-4 w-4 shrink-0 text-violet-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  一键出海 · {market.label}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-white/45">
                  {(busy || running || uploading) && (
                    <Loader2 className="h-3 w-3 animate-spin text-violet-300" />
                  )}
                  <span>
                    {phaseLabel[params.phase] ?? params.phase}
                    {params.shotCount ? ` · ${params.shotCount} 镜` : ""}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 text-[10px] text-white/40 hover:bg-white/10 hover:text-white/70"
                title="重新查看引导"
                onClick={() => patch({ tipDismissed: false, tipIndex: 0 })}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 目标市场 */}
            <div className="mb-2">
              <div className="mb-1 text-[10px] text-white/40">出海国家版本</div>
              <div className="flex flex-wrap gap-1">
                {OVERSEAS_MARKETS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={busy || running}
                    onClick={() => {
                      patch({ targetMarketId: m.id as OverseasMarketId });
                      toast.message(`出海版本：${m.label}`);
                    }}
                    className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50",
                      params.targetMarketId === m.id
                        ? "border-violet-400/80 bg-violet-500/25 text-white"
                        : "border-white/10 text-white/55 hover:border-white/25 hover:bg-white/[0.04]"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 参考视频 */}
            <div className="mb-2 rounded-lg border border-white/10 bg-black/25 p-2">
              {params.videoAssetId ? (
                <div className="flex items-start gap-2">
                  <Film className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-white/85">
                      {params.videoTitle || "参考视频"}
                    </div>
                    <button
                      type="button"
                      className="mt-1 text-[10px] text-violet-300 hover:underline"
                      disabled={busy || uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      更换视频
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={uploading || !projectId}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-white/20 px-2 py-4 text-white/50 hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-white/80 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                  <span className="text-[11px]">
                    {uploading ? "上传中…" : "上传参考视频"}
                  </span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_VIDEO}
                className="hidden"
                onChange={(e) => void handlePickVideo(e.target.files)}
              />
            </div>

            <p className="mb-2 line-clamp-3 text-[11px] leading-relaxed text-white/55">
              {params.message ||
                "选择市场并上传参考视频后，点击本地化拉片；保留运镜节奏，本地化主体/场景/对白。"}
            </p>

            {params.styleSummary ? (
              <p className="mb-1.5 line-clamp-2 rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/45">
                风格：{params.styleSummary}
              </p>
            ) : null}
            {params.localePlan ? (
              <p className="mb-2 line-clamp-2 rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/45">
                本地化：{params.localePlan}
              </p>
            ) : null}

            {showActions &&
            (params.estimatedVideoTotal != null ||
              params.analyzeCredit != null ||
              subjectReady) ? (
              <div className="mb-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-[10px] text-violet-100/90">
                {params.analyzeCredit != null ? (
                  <div>拉片：{formatCredits(params.analyzeCredit)} 算力</div>
                ) : null}
                {params.estimatedVideoTotal != null ? (
                  <div>预估成片：约 {formatCredits(params.estimatedVideoTotal)} 算力</div>
                ) : null}
                {subjectReady && subjectReady.subjectCount > 0 ? (
                  <div>
                    主体图：{subjectReady.readyCount}/{subjectReady.subjectCount}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-auto flex flex-col gap-1.5">
              <button
                type="button"
                disabled={busy || running || uploading || !params.videoAssetId}
                onClick={() => void runAnalyze()}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-500 px-3 py-2 text-[12px] font-medium text-white hover:bg-violet-400 disabled:opacity-40"
              >
                {busy && (params.phase === "analyzing" || params.phase === "extracting" || params.phase === "bootstrap") ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {params.shotCount ? "重新出海拉片" : "本地化拉片"}
              </button>

              {showActions ? (
                <>
                  <button
                    type="button"
                    disabled={busy || !params.gridNodeId}
                    onClick={() => void runSubjects()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[12px] text-white/85 hover:bg-white/10 disabled:opacity-40"
                  >
                    {busy && params.message.includes("主体图") ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="h-3.5 w-3.5" />
                    )}
                    一键生成主体图
                  </button>
                  <button
                    type="button"
                    disabled={busy || !params.gridNodeId}
                    onClick={() => void runBatch()}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-zinc-900 hover:bg-white/90 disabled:opacity-40"
                  >
                    {busy && params.phase === "generating" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Film className="h-3.5 w-3.5" />
                    )}
                    确认生成出海视频
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </BaseNode>
  );
});

export default OverseasLocalizeNode;
