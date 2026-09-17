/**
 * 通用故事板按镜批量出视频：不依赖爆款/出海 meta。
 * 有视频提示词（或先补全）+ 可选草图/主体图作参考，串行提交 + 并行轮询。
 */

import { toast } from "sonner";
import { fetchAssetsBatch, notifyAssetsUpdated } from "@/lib/api/assets";
import {
  completePendingGeneratableNode,
  runOneGeneratableNode,
} from "@/lib/canvas/runOneGeneratableNode";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import { runStoryboardOneClickGeneration } from "@/lib/canvas/storyboardGridActions";
import {
  buildViralRemakeGenerationOptions,
  parseViralShotDurationSec,
  withViralRemakeDuration,
} from "@/lib/canvas/viralRemakeOptions";
import type { ViralRemakeAspect, ViralRemakeClarity } from "@/lib/canvas/viralRemakeSession";
import { useCanvasStore } from "@/stores/canvasStore";
import type { GenerationOptions } from "@/types/generationPresets";
import { parseSubjectsParam } from "@/types/storyboard-subjects";
import { parseTableRowsParam, type StoryboardTableRow } from "@/types/storyboard-table";
import type { WorkflowNodeData } from "@/types/workflow";

const OUTPUT_COLS = 3;
const CELL_W = 360;
const CELL_H = 240;
const GAP = 48;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function gridPos(
  index: number,
  origin: { x: number; y: number },
  cols: number
): { x: number; y: number } {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: origin.x + col * (CELL_W + GAP),
    y: origin.y + row * (CELL_H + GAP),
  };
}

function moveNodeTo(id: string, position: { x: number; y: number }) {
  const { nodes, setNodes } = useCanvasStore.getState();
  const cur = nodes.find((n) => n.id === id);
  if (!cur) return;
  if (cur.position?.x === position.x && cur.position?.y === position.y) return;
  setNodes(nodes.map((n) => (n.id === id ? { ...n, position: { ...position } } : n)));
}

function connectRefsToVideo(videoId: string, sourceIds: string[]) {
  const store = useCanvasStore.getState();
  const wanted = new Set(sourceIds.filter(Boolean));
  const pruned = store.edges.filter((e) => {
    if (e.target !== videoId || e.targetHandle !== REFERENCE_INPUT_ID) return true;
    return wanted.has(e.source);
  });
  if (pruned.length !== store.edges.length) {
    store.setEdges(pruned);
  }
  for (const srcId of wanted) {
    if (!srcId || srcId === videoId) continue;
    const already = useCanvasStore
      .getState()
      .edges.some(
        (e) =>
          e.source === srcId &&
          e.target === videoId &&
          e.targetHandle === REFERENCE_INPUT_ID
      );
    if (already) continue;
    const src = useCanvasStore.getState().nodes.find((n) => n.id === srcId);
    const handle = src?.type === "video_input" ? "video" : "image";
    useCanvasStore.getState().connectNodes({
      source: srcId,
      target: videoId,
      sourceHandle: handle,
      targetHandle: REFERENCE_INPUT_ID,
    });
  }
}

function collectSubjectAssets(params: Record<string, unknown>): Array<{
  assetId: string;
  name: string;
}> {
  const subjects = parseSubjectsParam(params.subjects);
  const out: Array<{ assetId: string; name: string }> = [];
  for (const list of [subjects.roles, subjects.scenes, subjects.props]) {
    for (const item of list) {
      const id = String(item.imageAssetId ?? "").trim();
      if (!id) continue;
      out.push({ assetId: id, name: item.name?.trim() || "主体" });
    }
  }
  return out;
}

function buildShotPrompt(row: StoryboardTableRow): string {
  const video = String(row.videoPrompt ?? "").trim();
  if (video) return video;
  const parts = [
    row.description?.trim() ? `画面：${row.description.trim()}` : "",
    row.shotSize?.trim() ? `景别：${row.shotSize.trim()}` : "",
    row.cameraPrompt?.trim() ? `运镜：${row.cameraPrompt.trim()}` : "",
    row.dialogue?.trim() ? `对白：${row.dialogue.trim()}` : "",
    row.lighting?.trim() ? `光影：${row.lighting.trim()}` : "",
    row.sfx?.trim() ? `音效：${row.sfx.trim()}` : "",
  ].filter(Boolean);
  return parts.join("。");
}

function resolveAspect(params: Record<string, unknown>): ViralRemakeAspect {
  const raw = String(params.aspectRatio ?? params.ratio ?? "16:9").trim();
  if (raw === "9:16" || raw === "1:1") return raw;
  return "16:9";
}

function resolveClarity(params: Record<string, unknown>): ViralRemakeClarity {
  const raw = String(params.clarity ?? params.resolution ?? "1080p").trim().toLowerCase();
  if (raw === "720p" || raw.includes("720")) return "720p";
  return "1080p";
}

export type StoryboardBatchVideoProgress = {
  message: string;
  done?: number;
  total?: number;
};

/**
 * 按分镜表行批量生成视频节点。
 * @param onlyRowIds 仅生成指定行；空则全表
 */
export async function runStoryboardBatchVideos(opts: {
  projectId: string;
  gridNodeId: string;
  onlyRowIds?: string[];
  /** 缺视频词时先跑运镜→视频词 */
  fillPromptsIfNeeded?: boolean;
  onProgress?: (p: StoryboardBatchVideoProgress) => void;
}): Promise<string[]> {
  const projectId = String(opts.projectId || "").trim();
  if (!projectId) throw new Error("项目未加载");

  const store = useCanvasStore.getState();
  const grid = store.nodes.find((n) => n.id === opts.gridNodeId);
  if (!grid || grid.type !== "storyboard_grid") throw new Error("分镜表不存在");

  const params = (grid.data as WorkflowNodeData).params ?? {};
  let rows = parseTableRowsParam(params.shots);
  if (opts.onlyRowIds?.length) {
    const want = new Set(opts.onlyRowIds);
    rows = rows.filter((r) => want.has(r.id));
  }
  if (rows.length === 0) throw new Error("没有可生成的分镜行");

  const needPrompts = rows.some((r) => !buildShotPrompt(r));
  if (needPrompts && opts.fillPromptsIfNeeded !== false) {
    opts.onProgress?.({ message: "补全运镜/视频提示词…" });
    await runStoryboardOneClickGeneration({
      gridNodeId: opts.gridNodeId,
      onlyEmpty: true,
    });
    const latest = useCanvasStore.getState().nodes.find((n) => n.id === opts.gridNodeId);
    const latestParams = (latest?.data as WorkflowNodeData | undefined)?.params ?? {};
    rows = parseTableRowsParam(latestParams.shots);
    if (opts.onlyRowIds?.length) {
      const want = new Set(opts.onlyRowIds);
      rows = rows.filter((r) => want.has(r.id));
    }
  }

  const latestParams =
    (useCanvasStore.getState().nodes.find((n) => n.id === opts.gridNodeId)?.data as
      | WorkflowNodeData
      | undefined)?.params ?? params;
  const aspectRatio = resolveAspect(latestParams);
  const clarity = resolveClarity(latestParams);

  const { generationOptions, modelName, presets } = await buildViralRemakeGenerationOptions({
    aspectRatio,
    clarity,
    withRefVideo: false,
  });
  if (!modelName) {
    throw new Error("未配置可用视频模型");
  }

  const subjectAssets = collectSubjectAssets(latestParams);
  const subjectIds = subjectAssets.map((s) => s.assetId);
  const subjectFetched = subjectIds.length ? await fetchAssetsBatch(projectId, subjectIds) : [];
  const subjectUrlById = new Map(subjectFetched.map((a) => [a.id, a.fileUrl]));

  const sketchIds = rows.map((r) => String(r.sketchAssetId ?? "").trim()).filter(Boolean);
  const sketchFetched = sketchIds.length ? await fetchAssetsBatch(projectId, sketchIds) : [];
  const sketchUrlById = new Map(sketchFetched.map((a) => [a.id, a.fileUrl]));

  const gridW = grid.width && grid.width > 0 ? grid.width : 920;
  const origin = {
    x: (grid.position?.x ?? 0) + gridW + 80,
    y: grid.position?.y ?? 0,
  };

  // 主体图节点（共享，排在成片上方）
  const subjectOrigin = { x: origin.x, y: origin.y - CELL_H - GAP };
  const subjectNodeIds: string[] = [];
  subjectAssets.forEach((asset, i) => {
    const pos = gridPos(i, subjectOrigin, OUTPUT_COLS);
    const existing = useCanvasStore.getState().nodes.find((n) => {
      if (n.type !== "image_input") return false;
      const p = (n.data as WorkflowNodeData).params ?? {};
      return String(p.assetId ?? "") === asset.assetId;
    });
    if (existing) {
      moveNodeTo(existing.id, pos);
      useCanvasStore.getState().updateNodeSize(existing.id, CELL_W, CELL_H);
      subjectNodeIds.push(existing.id);
      return;
    }
    const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
    useCanvasStore.getState().addNodeFromAsset(
      {
        id: asset.assetId,
        category: "image",
        fileUrl: subjectUrlById.get(asset.assetId) || "",
        title: asset.name,
      },
      pos
    );
    const id =
      useCanvasStore
        .getState()
        .nodes.find((n) => n.type === "image_input" && !before.has(n.id))?.id ?? "";
    if (id) {
      useCanvasStore.getState().updateNodeData(id, { label: asset.name });
      useCanvasStore.getState().updateNodeSize(id, CELL_W, CELL_H);
      subjectNodeIds.push(id);
    }
  });

  const batchId = `storyboard-video-${Date.now()}`;
  const createdIds: string[] = [];
  type Pending = {
    nodeId: string;
    jobId: number | string;
    kind: "text" | "media";
    model: string;
    nodeType: string;
    shotIndex: number;
  };
  const pendings: Pending[] = [];
  let abortRemaining = false;

  opts.onProgress?.({
    message: `准备生成 ${rows.length} 段视频…`,
    done: 0,
    total: rows.length,
  });

  for (let i = 0; i < rows.length; i += 1) {
    if (abortRemaining) break;
    const row = rows[i]!;
    const prompt = buildShotPrompt(row).trim();
    if (!prompt) {
      toast.message(`镜头 ${row.shotNo || row.index} 缺少提示词，已跳过`);
      continue;
    }

    opts.onProgress?.({
      message: `提交镜头 ${i + 1}/${rows.length}…`,
      done: i,
      total: rows.length,
    });

    const outputPos = gridPos(i, origin, OUTPUT_COLS);
    let videoId =
      useCanvasStore.getState().nodes.find((n) => {
        if (n.type !== "video_input") return false;
        const p = (n.data as WorkflowNodeData).params ?? {};
        return (
          String(p.storyboardShotId ?? "") === row.id ||
          String(p.viralRemakeShotId ?? "") === row.id
        );
      })?.id ?? "";

    if (!videoId) {
      const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
      useCanvasStore.getState().addNode("video_input", outputPos);
      videoId =
        useCanvasStore.getState().nodes.find((n) => n.type === "video_input" && !before.has(n.id))
          ?.id ?? "";
    } else {
      moveNodeTo(videoId, outputPos);
    }
    if (!videoId) continue;

    useCanvasStore.getState().updateNodeSize(videoId, CELL_W, CELL_H);

    const durationSec = Math.max(
      4,
      parseViralShotDurationSec(row.duration) || 4
    );
    const shotOpts = withViralRemakeDuration(presets, generationOptions, durationSec);

    const curParams =
      (useCanvasStore.getState().nodes.find((n) => n.id === videoId)?.data as WorkflowNodeData)
        ?.params ?? {};

    useCanvasStore.getState().updateNodeData(videoId, {
      label: `故事板镜头${row.shotNo || row.index}`,
      params: {
        ...curParams,
        prompt,
        model: modelName,
        generationOptions: shotOpts as GenerationOptions,
        storyboardShotId: row.id,
        durationSec,
      },
    });

    const refSources: string[] = [...subjectNodeIds];
    const sketchAssetId = String(row.sketchAssetId ?? "").trim();
    if (sketchAssetId) {
      const existingImg = useCanvasStore.getState().nodes.find((n) => {
        if (n.type !== "image_input") return false;
        const p = (n.data as WorkflowNodeData).params ?? {};
        return String(p.assetId ?? "") === sketchAssetId;
      });
      let imgId = existingImg?.id ?? "";
      if (!imgId) {
        const before = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
        useCanvasStore.getState().addNodeFromAsset(
          {
            id: sketchAssetId,
            category: "image",
            fileUrl: sketchUrlById.get(sketchAssetId) || "",
            title: `镜头${row.shotNo || row.index}草图`,
          },
          { x: outputPos.x, y: outputPos.y - CELL_H - 24 }
        );
        imgId =
          useCanvasStore
            .getState()
            .nodes.find((n) => n.type === "image_input" && !before.has(n.id))?.id ?? "";
      }
      if (imgId) {
        useCanvasStore.getState().updateNodeSize(imgId, Math.min(CELL_W, 280), Math.min(CELL_H, 180));
        refSources.push(imgId);
      }
    }

    connectRefsToVideo(videoId, refSources);
    createdIds.push(videoId);

    let submitted = false;
    for (let attempt = 0; attempt < 4 && !submitted; attempt += 1) {
      const result = await runOneGeneratableNode({
        projectId,
        nodeId: videoId,
        batchId: `${batchId}-${i}`,
        deferPoll: true,
      });
      if (result.ok) {
        submitted = true;
        if (result.pending) {
          pendings.push({
            nodeId: videoId,
            jobId: result.pending.jobId,
            kind: result.pending.kind,
            model: result.pending.model,
            nodeType: result.pending.nodeType,
            shotIndex: row.index,
          });
        }
        break;
      }
      if (result.abortBatch) {
        abortRemaining = true;
        toast.error(result.error || "算力不足，已停止后续提交");
        break;
      }
      const busy =
        result.code === "RATE_LIMITED" ||
        (typeof result.error === "string" && result.error.includes("生成提交处理中"));
      if (busy && attempt < 3) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      toast.error(`镜头 ${row.shotNo || row.index}：${result.error || "提交失败"}`);
      break;
    }
  }

  requestAnimationFrame(() => {
    useCanvasStore.getState().fitView?.();
  });

  if (pendings.length > 0) {
    opts.onProgress?.({
      message: `已提交 ${pendings.length} 段，等待生成完成…`,
      done: pendings.length,
      total: rows.length,
    });
    await Promise.all(
      pendings.map(async (p) => {
        const done = await completePendingGeneratableNode({
          projectId,
          nodeId: p.nodeId,
          jobId: p.jobId,
          kind: p.kind,
          model: p.model,
          nodeType: p.nodeType,
        });
        if (!done.ok) {
          toast.error(`镜头 ${p.shotIndex}：${done.error || "生成失败"}`);
        }
      })
    );
  }

  notifyAssetsUpdated();
  opts.onProgress?.({
    message: `完成 ${createdIds.length} 段视频`,
    done: createdIds.length,
    total: rows.length,
  });
  return createdIds;
}
