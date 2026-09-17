/**
 * Agent 对话驱动爆款复刻：把会话附件写成 ViralRemakeSession，
 * 复用 viralRemakePipeline 拉片，并向 Session 写入 LibTV 风格进度旁白。
 */

import { fetchAssetById } from "@/lib/api/assets";
import {
  collectNodeMediaItems,
  narrateAgentSession,
} from "@/lib/canvas/agentSessionNarrate";
import {
  runViralRemakeAnalyze,
  type ViralRemakePipelineState,
} from "@/lib/canvas/viralRemakePipeline";
import {
  loadViralRemakeSession,
  saveViralRemakeSession,
  type ViralRemakeAspect,
  type ViralRemakeClarity,
  type ViralRemakeSession,
  VIRAL_REMAKE_SKILL,
} from "@/lib/canvas/viralRemakeSession";
import {
  setAgentCanvasBusy,
  clearAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";
import { useCanvasStore } from "@/stores/canvasStore";

export type ViralRemakeBriefFromApi = {
  videoAssetId: string;
  videoFileUrl?: string;
  videoTitle?: string;
  replaceImageAssetIds?: string[];
  replaceImageUrls?: string[];
  replaceNotes?: string;
  aspectRatio?: string;
  clarity?: string;
  entryKind?: string;
};

async function narrate(sessionId: string, content: string, done = false): Promise<void> {
  await narrateAgentSession(sessionId, content, { done });
}

/** 将 API brief / 附件解析为可跑流水线的会话 */
export async function buildViralRemakeSessionFromBrief(
  projectId: string,
  brief: ViralRemakeBriefFromApi
): Promise<ViralRemakeSession> {
  let videoFileUrl = (brief.videoFileUrl || "").trim();
  let videoTitle = (brief.videoTitle || "").trim() || "参考爆款";
  if (!videoFileUrl && brief.videoAssetId) {
    const asset = await fetchAssetById(projectId, brief.videoAssetId);
    if (asset) {
      videoFileUrl = asset.fileUrl;
      videoTitle = asset.title || videoTitle;
    }
  }
  if (!brief.videoAssetId || !videoFileUrl) {
    throw new Error("缺少参考视频素材");
  }

  const replaceImageAssetIds = [...(brief.replaceImageAssetIds || [])].filter(Boolean);
  let replaceImageUrls = [...(brief.replaceImageUrls || [])].filter(Boolean);
  if (replaceImageAssetIds.length && replaceImageUrls.length < replaceImageAssetIds.length) {
    replaceImageUrls = [];
    for (const id of replaceImageAssetIds) {
      const img = await fetchAssetById(projectId, id);
      if (img?.fileUrl) replaceImageUrls.push(img.fileUrl);
    }
  }

  const aspect = (brief.aspectRatio || "9:16") as ViralRemakeAspect;
  const clarity = (brief.clarity || "1080p") as ViralRemakeClarity;

  return {
    videoAssetId: brief.videoAssetId,
    videoFileUrl,
    videoTitle,
    // 缺省竖屏 9:16（对齐对话默认 / ViralRemakeDialog）
    aspectRatio: aspect === "16:9" || aspect === "1:1" ? aspect : "9:16",
    clarity: clarity === "720p" ? "720p" : "1080p",
    replaceNotes: (brief.replaceNotes || "").trim(),
    replaceImageAssetIds,
    replaceImageUrls,
    // 由 bridge 执行，避免与 Wizard autoStart 双跑
    autoStart: false,
  };
}

/**
 * 对话侧触发拉片：写 sessionStorage → 跑流水线 → 旁白进度。
 * 返回最终 pipeline 状态；失败会 skill_done 释放会话锁。
 */
export async function runViralRemakeFromAgentSession(opts: {
  projectId: string;
  sessionId: string;
  brief: ViralRemakeBriefFromApi;
  onProgress?: (partial: Partial<ViralRemakePipelineState>) => void;
}): Promise<ViralRemakePipelineState> {
  const { projectId, sessionId, brief } = opts;
  if ((brief.entryKind || VIRAL_REMAKE_SKILL) === "overseas_localize") {
    throw new Error("一键出海请使用出海向导；本桥接仅处理爆款复刻");
  }

  const session = await buildViralRemakeSessionFromBrief(projectId, brief);
  saveViralRemakeSession(projectId, session);

  // 同步 skill 到 URL，便于 Wizard 识别为爆款项目
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("skill") !== VIRAL_REMAKE_SKILL) {
      url.searchParams.set("skill", VIRAL_REMAKE_SKILL);
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    /* ignore */
  }

  setAgentCanvasBusy("tool", "正在切镜拉片…");
  let lastNarrated = "";
  try {
    const result = await runViralRemakeAnalyze({
      projectId,
      session,
      onProgress: (partial) => {
        opts.onProgress?.(partial);
        const msg = (partial.message || "").trim();
        if (msg) setAgentCanvasBusy("tool", msg);
        // 按 phase 去重旁白，避免切镜轮询刷屏
        const key = `${partial.phase || ""}:${msg}`;
        if (msg && key !== lastNarrated && partial.phase !== "extracting") {
          lastNarrated = key;
          void narrate(sessionId, msg);
        } else if (msg && partial.phase === "extracting" && !lastNarrated.startsWith("extracting:")) {
          lastNarrated = `extracting:${msg}`;
          void narrate(sessionId, msg);
        }
      },
    });

    const summary = [
      `拉片完成：共 ${result.shotCount || 0} 个镜头（切镜已按≥4秒合并碎镜）。`,
      result.styleSummary ? `风格：${result.styleSummary}` : "",
      "请回复「确认生成」：将批量生成同款视频并新建独立「成片表」（每镜≥4秒，下方附参考与提示词）。",
      "也可先点「一键生成主体图」，或在右下角复刻面板操作。",
    ]
      .filter(Boolean)
      .join("\n");
    await narrate(sessionId, summary, true);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "拉片失败";
    await narrate(sessionId, `拉片失败：${msg}。请重新上传视频或稍后重试。`, true);
    throw err;
  } finally {
    clearAgentCanvasBusy();
  }
}

/**
 * 对话确认成片：批量生成并写入分镜节点「成片」表（下方附参考与提示词）。
 */
export async function runViralRemakeBatchFromAgentSession(opts: {
  projectId: string;
  sessionId: string;
  gridNodeId?: string;
}): Promise<string[]> {
  const { projectId, sessionId } = opts;
  let gridNodeId = (opts.gridNodeId || "").trim();
  if (!gridNodeId) {
    const stored = loadViralRemakeSession(projectId);
    gridNodeId = stored?.progress?.gridNodeId || "";
  }
  if (!gridNodeId) {
    const grid = useCanvasStore.getState().nodes.find((n) => n.type === "storyboard_grid");
    gridNodeId = grid?.id || "";
  }
  if (!gridNodeId) {
    throw new Error("未找到分镜表，请先完成拉片");
  }

  setAgentCanvasBusy("generating", "正在按分镜表生成同款视频…");
  let lastNarrated = "";
  try {
    await narrate(sessionId, "开始批量生成同款视频（每镜≥4秒，结果写入独立成片表）…");
    const { runViralRemakeBatchVideos } = await import("@/lib/canvas/viralRemakePipeline");
    const ids = await runViralRemakeBatchVideos({
      projectId,
      gridNodeId,
      onProgress: (partial) => {
        const msg = (partial.message || "").trim();
        if (msg) setAgentCanvasBusy("generating", msg);
        if (msg && msg !== lastNarrated && partial.phase !== "generating") {
          lastNarrated = msg;
          void narrate(sessionId, msg);
        } else if (msg && partial.phase === "generating" && !lastNarrated) {
          lastNarrated = msg;
          void narrate(sessionId, msg);
        }
      },
    });
    // 成片节点素材回传到聊天框
    const mediaItems = collectNodeMediaItems(ids);
    await narrateAgentSession(
      sessionId,
      `成片完成：${ids.length} 镜已写入画布独立「成片表」（成片下方可查看参考片段与提示词）。`,
      { done: true, mediaItems }
    );
    return ids;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "成片失败";
    await narrate(sessionId, `成片失败：${msg}`, true);
    throw err;
  } finally {
    clearAgentCanvasBusy();
  }
}

/**
 * 对话「一键生成主体图」：按分镜表准备资产批量出图。
 */
export async function runViralRemakeSubjectsFromAgentSession(opts: {
  projectId: string;
  sessionId: string;
  gridNodeId?: string;
}): Promise<{ done: number; total: number }> {
  const { projectId, sessionId } = opts;
  let gridNodeId = (opts.gridNodeId || "").trim();
  if (!gridNodeId) {
    const stored = loadViralRemakeSession(projectId);
    gridNodeId = stored?.progress?.gridNodeId || "";
  }
  if (!gridNodeId) {
    const grid = useCanvasStore.getState().nodes.find((n) => n.type === "storyboard_grid");
    gridNodeId = grid?.id || "";
  }
  if (!gridNodeId) {
    throw new Error("未找到分镜表，请先完成拉片");
  }

  setAgentCanvasBusy("generating", "正在生成主体图…");
  try {
    await narrate(sessionId, "开始一键生成主体图…");
    const { runViralRemakeSubjectImages } = await import("@/lib/canvas/viralRemakePipeline");
    const result = await runViralRemakeSubjectImages({
      projectId,
      gridNodeId,
      onProgress: (partial) => {
        const msg = (partial.message || "").trim();
        if (msg) setAgentCanvasBusy("generating", msg);
      },
    });
    if (result.total === 0) {
      await narrate(sessionId, "主体图已就绪，无需再生成。可继续回复「确认生成」成片。", true);
    } else {
      // 主体图素材回传到聊天框
      const subjectNodes = useCanvasStore
        .getState()
        .nodes.filter((n) => {
          if (n.type !== "image_input") return false;
          const p = (n.data?.params ?? {}) as Record<string, unknown>;
          return Boolean(String(p.assetId ?? "").trim());
        })
        .slice(-Math.max(result.done, 1))
        .map((n) => n.id);
      const mediaItems = collectNodeMediaItems(subjectNodes);
      await narrateAgentSession(
        sessionId,
        `主体图完成：成功 ${result.done}/${result.total}。可回复「确认生成」批量成片。`,
        { done: true, mediaItems }
      );
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "主体图生成失败";
    await narrate(sessionId, `主体图失败：${msg}`, true);
    throw err;
  } finally {
    clearAgentCanvasBusy();
  }
}
