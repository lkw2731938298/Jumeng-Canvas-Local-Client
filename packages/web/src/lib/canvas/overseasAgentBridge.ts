/**
 * Agent 对话驱动一键出海：把会话附件 + 目标市场写成 OverseasSession，
 * 复用 overseasPipeline 本地化拉片，并向 Session 写入进度旁白。
 */

import { fetchAssetById } from "@/lib/api/assets";
import { narrateAgentSession } from "@/lib/canvas/agentSessionNarrate";
import {
  getOverseasMarket,
  type OverseasMarketId,
} from "@/lib/canvas/overseasMarkets";
import {
  runOverseasAnalyze,
  type OverseasPipelineState,
} from "@/lib/canvas/overseasPipeline";
import {
  saveOverseasSession,
  OVERSEAS_LOCALIZE_SKILL,
  type OverseasSession,
} from "@/lib/canvas/overseasSession";
import { ensureOverseasLocalizeNode } from "@/lib/canvas/overseasLocalizeNode";
import type { ViralRemakeAspect, ViralRemakeClarity } from "@/lib/canvas/viralRemakeSession";
import {
  setAgentCanvasBusy,
  clearAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";

export type OverseasBriefFromApi = {
  videoAssetId: string;
  videoFileUrl?: string;
  videoTitle?: string;
  replaceNotes?: string;
  aspectRatio?: string;
  clarity?: string;
  /** 目标市场：US / JP / KR … */
  targetMarketId?: string;
  targetMarketLabel?: string;
  entryKind?: string;
};

async function narrate(sessionId: string, content: string, done = false): Promise<void> {
  await narrateAgentSession(sessionId, content, { done });
}

function normalizeMarketId(raw: string | undefined): OverseasMarketId {
  const id = String(raw || "").trim();
  const hit = getOverseasMarket(id);
  return hit.id;
}

/** 将 API brief / 附件解析为可跑出海流水线的会话 */
export async function buildOverseasSessionFromBrief(
  projectId: string,
  brief: OverseasBriefFromApi
): Promise<OverseasSession> {
  let videoFileUrl = (brief.videoFileUrl || "").trim();
  let videoTitle = (brief.videoTitle || "").trim() || "出海参考视频";
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

  const aspect = (brief.aspectRatio || "9:16") as ViralRemakeAspect;
  const clarity = (brief.clarity || "1080p") as ViralRemakeClarity;
  const targetMarketId = normalizeMarketId(brief.targetMarketId);

  return {
    videoAssetId: brief.videoAssetId,
    videoFileUrl,
    videoTitle,
    aspectRatio: aspect === "16:9" || aspect === "1:1" ? aspect : "9:16",
    clarity: clarity === "720p" ? "720p" : "1080p",
    targetMarketId,
    localeNotes: (brief.replaceNotes || "").trim(),
    // 由 bridge 执行，避免与 Wizard autoStart 双跑
    autoStart: false,
  };
}

/**
 * 对话侧触发出海本地化拉片：写 sessionStorage → 跑流水线 → 旁白进度。
 */
export async function runOverseasFromAgentSession(opts: {
  projectId: string;
  sessionId: string;
  brief: OverseasBriefFromApi;
  onProgress?: (partial: Partial<OverseasPipelineState>) => void;
}): Promise<OverseasPipelineState> {
  const { projectId, sessionId, brief } = opts;
  const session = await buildOverseasSessionFromBrief(projectId, brief);
  saveOverseasSession(projectId, session);

  const market = getOverseasMarket(session.targetMarketId);
  // 不再落画布 Skill 卡；清理遗留节点后走 Agent 旁白 + 分镜/成片节点
  ensureOverseasLocalizeNode({ targetMarketId: session.targetMarketId });

  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("skill") !== OVERSEAS_LOCALIZE_SKILL) {
      url.searchParams.set("skill", OVERSEAS_LOCALIZE_SKILL);
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    /* ignore */
  }

  setAgentCanvasBusy("tool", `正在出海本地化拉片（${market.label}）…`);
  let lastNarrated = "";
  try {
    const result = await runOverseasAnalyze({
      projectId,
      session,
      onProgress: (partial) => {
        opts.onProgress?.(partial);
        const msg = (partial.message || "").trim();
        if (msg) setAgentCanvasBusy("tool", msg);
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
      `出海拉片完成：共 ${result.shotCount || 0} 个镜头（${market.label} · ${market.language}）。`,
      result.styleSummary ? `风格：${result.styleSummary}` : "",
      result.localePlan ? `本地化方案：${String(result.localePlan).slice(0, 120)}…` : "",
      "请回复「一键生成主体图」，或「确认生成」批量出海成片（写入独立成片表）。",
    ]
      .filter(Boolean)
      .join("\n");
    await narrate(sessionId, summary, true);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "出海拉片失败";
    await narrate(sessionId, `出海拉片失败：${msg}。请重新上传视频或稍后重试。`, true);
    throw err;
  } finally {
    clearAgentCanvasBusy();
  }
}
