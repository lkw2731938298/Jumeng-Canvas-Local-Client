/**
 * 一键出海：成片节点结果表 + 一键合并（复用 video-compose）。
 */

import { notifyAssetsUpdated } from "@/lib/api/assets";
import { composeVideoAssets } from "@/lib/canvas/videoTrim";
import { parseViralShotDurationSec } from "@/lib/canvas/viralRemakeOptions";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

export type OverseasShotVideoRow = {
  shotIndex: number;
  shotId: string;
  nodeId: string;
  label: string;
  status: "success" | "error" | "running" | "idle";
  assetId: string;
  videoUrl: string;
  /** 合并用出点（秒），来自分镜「时长」或默认 4s */
  durationSec: number;
  error?: string;
};

function parseShotDurationSec(raw?: string): number {
  return parseViralShotDurationSec(raw);
}

/** 从成片节点收集表格行（按镜头号排序） */
export function collectOverseasShotVideoRows(
  videoNodeIds: string[],
  gridNodeId?: string
): OverseasShotVideoRow[] {
  const store = useCanvasStore.getState();
  const durationByShotId = new Map<string, number>();
  const durationByIndex = new Map<number, number>();
  if (gridNodeId) {
    const grid = store.nodes.find((n) => n.id === gridNodeId);
    const shots = Array.isArray((grid?.data as WorkflowNodeData | undefined)?.params?.shots)
      ? ((grid?.data as WorkflowNodeData).params!.shots as Array<{
          id?: string;
          index?: number;
          duration?: string;
        }>)
      : [];
    for (const s of shots) {
      const dur = parseShotDurationSec(s.duration);
      if (s.id) durationByShotId.set(String(s.id), dur);
      if (s.index != null) durationByIndex.set(Number(s.index), dur);
    }
  }

  const rows: OverseasShotVideoRow[] = [];
  for (const nodeId of videoNodeIds) {
    const node = store.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "video_input") continue;
    const data = node.data as WorkflowNodeData;
    const params = data.params ?? {};
    const label = String(data.label || `出海镜头`);
    const shotId = String(params.viralRemakeShotId ?? "");
    const shotIndexMatch = label.match(/(\d+)/);
    const shotIndex = shotIndexMatch ? Number(shotIndexMatch[1]) : rows.length + 1;
    const assetId = String(params.assetId ?? "").trim();
    const videoUrl = String(params.videoUrl ?? "").trim();
    const statusRaw = String(data.status || "idle");
    let status: OverseasShotVideoRow["status"] = "idle";
    if (statusRaw === "success" && assetId) status = "success";
    else if (statusRaw === "error" || statusRaw === "failed") status = "error";
    else if (statusRaw === "running" || statusRaw === "pending") status = "running";
    else if (assetId) status = "success";

    const durationSec =
      (shotId && durationByShotId.get(shotId)) ||
      durationByIndex.get(shotIndex) ||
      4;

    rows.push({
      shotIndex: Number.isFinite(shotIndex) ? shotIndex : rows.length + 1,
      shotId,
      nodeId,
      label,
      status,
      assetId,
      videoUrl,
      durationSec,
      error: String(data.error || params.errorMessage || "").trim() || undefined,
    });
  }
  rows.sort((a, b) => a.shotIndex - b.shotIndex || a.label.localeCompare(b.label));
  return rows;
}

/** 把成片 assetId / 状态回写到分镜表对应行（爆款 + 出海共用） */
export function syncOutputVideosToStoryboardRows(
  gridNodeId: string,
  videoNodeIds: string[],
  opts?: { markRunningShotIds?: string[] }
): void {
  const store = useCanvasStore.getState();
  const grid = store.nodes.find((n) => n.id === gridNodeId);
  if (!grid) return;
  const params = (grid.data as WorkflowNodeData).params ?? {};
  const shots = Array.isArray(params.shots) ? [...params.shots] : [];
  if (!shots.length) return;

  const collected = collectOverseasShotVideoRows(videoNodeIds, gridNodeId);
  const byShotId = new Map(collected.filter((r) => r.shotId).map((r) => [r.shotId, r]));
  const byIndex = new Map(collected.map((r) => [r.shotIndex, r]));
  const running = new Set((opts?.markRunningShotIds || []).map(String));

  const nextShots = shots.map((raw) => {
    const shot = raw as {
      id?: string;
      index?: number;
      outputVideoAssetId?: string;
      videoStatus?: string;
      videoError?: string;
      duration?: string;
    };
    const shotId = String(shot.id || "");
    const hit =
      (shotId && byShotId.get(shotId)) || byIndex.get(Number(shot.index));

    if (running.has(shotId) && !hit?.assetId) {
      return { ...shot, videoStatus: "running", videoError: undefined };
    }
    if (!hit) return raw;

    if (hit.status === "running" || hit.status === "idle") {
      return {
        ...shot,
        videoStatus: hit.status === "running" ? "running" : shot.videoStatus || "pending",
      };
    }
    if (hit.status === "error") {
      return {
        ...shot,
        videoStatus: "failed",
        videoError: hit.error || "生成失败",
      };
    }
    if (hit.assetId) {
      return {
        ...shot,
        outputVideoAssetId: hit.assetId,
        videoStatus: "succeeded",
        videoError: undefined,
        // 成片时长展示不低于 4s
        duration: shot.duration?.trim()
          ? shot.duration
          : `${Math.max(4, Math.round(hit.durationSec || 4))}s`,
      };
    }
    return raw;
  });

  const meta = {
    ...((params.viralRemakeMeta as Record<string, unknown> | undefined) ?? {}),
    outputVideoNodeIds: videoNodeIds,
  };
  store.updateNodeData(gridNodeId, {
    params: { ...params, shots: nextShots, viralRemakeMeta: meta },
  });
}

/**
 * 显式把「未生成/提交失败/算力不足未生成」的镜头写为失败态，确保批量结束后
 * 分镜表每一镜都有确定状态（成功/失败），不会停在「待生成」查无音讯。
 * 已有成片（outputVideoAssetId）的行不会被覆盖。
 */
export function markStoryboardShotsFailed(
  gridNodeId: string,
  messagesByShotId: Map<string, string> | Record<string, string>
): void {
  const entries =
    messagesByShotId instanceof Map
      ? Array.from(messagesByShotId.entries())
      : Object.entries(messagesByShotId);
  if (!entries.length) return;
  const store = useCanvasStore.getState();
  const grid = store.nodes.find((n) => n.id === gridNodeId);
  if (!grid) return;
  const params = (grid.data as WorkflowNodeData).params ?? {};
  const shots = Array.isArray(params.shots) ? [...params.shots] : [];
  if (!shots.length) return;
  const msgById = new Map(entries.map(([id, msg]) => [String(id), msg]));

  const nextShots = shots.map((raw) => {
    const shot = raw as {
      id?: string;
      outputVideoAssetId?: string;
      videoStatus?: string;
      videoError?: string;
    };
    const shotId = String(shot.id || "");
    if (!shotId || !msgById.has(shotId)) return raw;
    // 已有成片：不覆盖已成功的结果
    if (shot.outputVideoAssetId) return raw;
    return { ...shot, videoStatus: "failed", videoError: msgById.get(shotId) };
  });

  store.updateNodeData(gridNodeId, { params: { ...params, shots: nextShots } });
}

/** @deprecated 使用 syncOutputVideosToStoryboardRows */
export function syncOverseasOutputAssetsToGrid(
  gridNodeId: string,
  videoNodeIds: string[]
): void {
  syncOutputVideosToStoryboardRows(gridNodeId, videoNodeIds);
}

/**
 * 按镜头顺序一键合并成片（legacy 首尾相接，outSec=分镜时长）。
 */
export async function mergeOverseasShotVideos(opts: {
  projectId: string;
  rows: OverseasShotVideoRow[];
  title?: string;
}): Promise<{ assetId: string; fileUrl: string; durationSec: number; nodeId: string }> {
  const okRows = opts.rows.filter((r) => r.status === "success" && r.assetId);
  if (okRows.length < 1) {
    throw new Error("没有可合并的成片，请先成功生成至少 1 段视频");
  }

  const result = await composeVideoAssets({
    projectId: opts.projectId,
    title: opts.title || `出海合并·${okRows.length}镜`,
    clips: okRows.map((r) => ({
      videoAssetId: r.assetId,
      inSec: 0,
      outSec: Math.max(0.5, r.durationSec || 3),
      trackIndex: 0,
    })),
  });

  notifyAssetsUpdated();

  const store = useCanvasStore.getState();
  const before = new Set(store.nodes.map((n) => n.id));
  const last = okRows[okRows.length - 1];
  const lastNode = store.nodes.find((n) => n.id === last.nodeId);
  const pos = {
    x: (lastNode?.position?.x ?? 80) + 360,
    y: lastNode?.position?.y ?? 80,
  };
  store.addNodeFromAsset(
    {
      id: result.asset.id,
      category: "video",
      fileUrl: result.asset.fileUrl,
      title: result.asset.title || opts.title || "出海合并成片",
    },
    pos
  );
  const nodeId =
    store.nodes.find((n) => n.type === "video_input" && !before.has(n.id))?.id ?? "";
  if (nodeId) {
    store.updateNodeData(nodeId, { label: "出海合并成片" });
  }

  return {
    assetId: result.asset.id,
    fileUrl: result.asset.fileUrl,
    durationSec: result.durationSec,
    nodeId,
  };
}
