/**
 * 一键出海专属节点：可复用控制卡（对齐 OiiOii Skill 卡 + 分步提示）。
 * 节点存 params；流水线仍投影到 video_input / storyboard_grid / finished_clips_grid。
 */

import {
  OVERSEAS_MARKETS,
  getOverseasMarket,
  type OverseasMarketId,
} from "@/lib/canvas/overseasMarkets";
import {
  OVERSEAS_LOCALIZE_SKILL,
  loadOverseasSession,
  saveOverseasSession,
  type OverseasSession,
} from "@/lib/canvas/overseasSession";
import type { ViralRemakeAspect, ViralRemakeClarity } from "@/lib/canvas/viralRemakeSession";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";

export const OVERSEAS_LOCALIZE_NODE_TYPE = "overseas_localize" as const;

/** OiiOii 式分步提示（提示 n/5） */
export const OVERSEAS_TIPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "上传参考视频",
    body: "上传要出海的短视频蓝本。系统会按镜头切镜，保留原片运镜与叙事节奏。",
  },
  {
    title: "选择目标市场",
    body: "在卡片内选择出海国家/地区版本。对白语言、人设服饰与场景习惯将按该市场本地化。",
  },
  {
    title: "本地化拉片",
    body: "AI 完整复刻分镜：改写人物外貌/服饰、场景地标与对白语言，并标明说话人。",
  },
  {
    title: "生成主体图",
    body: "一键生成本地化主体图，锁定脸与整套服饰，成片时作身份参考（运镜仍参考原片片段）。",
  },
  {
    title: "生成视频",
    body: "确认后按镜批量生成出海同款视频，写入独立成片表；可预览后一键合并。",
  },
];

export type OverseasNodeParams = {
  targetMarketId: OverseasMarketId;
  aspectRatio: ViralRemakeAspect;
  clarity: ViralRemakeClarity;
  localeNotes: string;
  tipIndex: number;
  tipDismissed: boolean;
  phase: string;
  message: string;
  videoAssetId: string;
  videoFileUrl: string;
  videoTitle: string;
  gridNodeId: string;
  videoNodeId: string;
  shotCount: number;
  styleSummary: string;
  localePlan: string;
  analyzeCredit?: number;
  estimatedVideoTotal?: number;
  videoCreditEach?: number;
  videoModelName?: string;
  creditsEnabled?: boolean;
};

export const DEFAULT_OVERSEAS_NODE_PARAMS: OverseasNodeParams = {
  targetMarketId: "US",
  aspectRatio: "9:16",
  clarity: "1080p",
  localeNotes: "",
  tipIndex: 0,
  tipDismissed: false,
  phase: "idle",
  message: "",
  videoAssetId: "",
  videoFileUrl: "",
  videoTitle: "",
  gridNodeId: "",
  videoNodeId: "",
  shotCount: 0,
  styleSummary: "",
  localePlan: "",
};

export function readOverseasNodeParams(
  raw: Record<string, unknown> | undefined | null
): OverseasNodeParams {
  const p = raw ?? {};
  const market = getOverseasMarket(String(p.targetMarketId || ""));
  const tipIndex = Number(p.tipIndex);
  return {
    ...DEFAULT_OVERSEAS_NODE_PARAMS,
    targetMarketId: market.id,
    aspectRatio:
      p.aspectRatio === "16:9" || p.aspectRatio === "1:1" ? p.aspectRatio : "9:16",
    clarity: p.clarity === "720p" ? "720p" : "1080p",
    localeNotes: String(p.localeNotes || ""),
    tipIndex: Number.isFinite(tipIndex) ? Math.max(0, Math.min(OVERSEAS_TIPS.length - 1, tipIndex)) : 0,
    // 兼容历史空串；禁止 Boolean("false")===true
    tipDismissed:
      p.tipDismissed === true ||
      p.tipDismissed === 1 ||
      p.tipDismissed === "1" ||
      p.tipDismissed === "true",
    phase: String(p.phase || "idle"),
    message: String(p.message || ""),
    videoAssetId: String(p.videoAssetId || ""),
    videoFileUrl: String(p.videoFileUrl || ""),
    videoTitle: String(p.videoTitle || ""),
    gridNodeId: String(p.gridNodeId || ""),
    videoNodeId: String(p.videoNodeId || ""),
    shotCount: Number(p.shotCount) || 0,
    styleSummary: String(p.styleSummary || ""),
    localePlan: String(p.localePlan || ""),
    analyzeCredit: p.analyzeCredit != null ? Number(p.analyzeCredit) : undefined,
    estimatedVideoTotal:
      p.estimatedVideoTotal != null ? Number(p.estimatedVideoTotal) : undefined,
    videoCreditEach: p.videoCreditEach != null ? Number(p.videoCreditEach) : undefined,
    videoModelName: p.videoModelName ? String(p.videoModelName) : undefined,
    creditsEnabled: p.creditsEnabled === false ? false : p.creditsEnabled === true ? true : undefined,
  };
}

/** 从节点 params 组装出海会话（供流水线） */
export function sessionFromOverseasNode(
  params: OverseasNodeParams
): OverseasSession | null {
  if (!params.videoAssetId || !params.videoFileUrl) return null;
  return {
    videoAssetId: params.videoAssetId,
    videoFileUrl: params.videoFileUrl,
    videoTitle: params.videoTitle || "出海参考视频",
    aspectRatio: params.aspectRatio,
    clarity: params.clarity,
    targetMarketId: params.targetMarketId,
    localeNotes: params.localeNotes,
    autoStart: false,
    progress: {
      phase: params.phase,
      gridNodeId: params.gridNodeId || undefined,
      videoNodeId: params.videoNodeId || undefined,
      shotCount: params.shotCount || undefined,
      styleSummary: params.styleSummary || undefined,
      localePlan: params.localePlan || undefined,
      message: params.message || undefined,
    },
  };
}

/** 把流水线进度回写到出海节点 params */
export function patchOverseasNodeParams(
  nodeId: string,
  patch: Partial<OverseasNodeParams>
): void {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== OVERSEAS_LOCALIZE_NODE_TYPE) return;
  const cur = (node.data as WorkflowNodeData | undefined)?.params ?? {};
  const cleaned: Partial<OverseasNodeParams> = {};
  for (const [k, v] of Object.entries(patch) as Array<
    [keyof OverseasNodeParams, OverseasNodeParams[keyof OverseasNodeParams]]
  >) {
    if (v !== undefined) cleaned[k] = v as never;
  }
  const next = { ...readOverseasNodeParams(cur), ...cleaned };
  const market = getOverseasMarket(next.targetMarketId);
  useCanvasStore.getState().updateNodeData(nodeId, {
    label: `一键出海·${market.label}`,
    params: { ...cur, ...next },
    status:
      next.phase === "error"
        ? "error"
        : ["bootstrap", "extracting", "analyzing", "prompting", "generating"].includes(
              next.phase
            )
          ? "running"
          : next.phase === "done" || next.phase === "confirm" || next.phase === "ready"
            ? "success"
            : "idle",
  });
}

/**
 * 移除画布上遗留的「一键出海」Skill 卡（含引导提示）。
 * 出海操作改走 Agent 对话，不再落此节点。
 */
export function removeOverseasLocalizeNodes(): number {
  const store = useCanvasStore.getState();
  const removedIds = store.nodes
    .filter((n) => n.type === OVERSEAS_LOCALIZE_NODE_TYPE)
    .map((n) => n.id);
  if (!removedIds.length) return 0;
  const idSet = new Set(removedIds);
  const nextNodes = store.nodes.filter((n) => !idSet.has(n.id));
  const nextEdges = store.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
  store.setNodes(nextNodes);
  store.setEdges(nextEdges);
  if (store.selectedNodeId && idSet.has(store.selectedNodeId)) {
    store.selectNode(null);
  }
  store.scheduleAutoSave();
  return removedIds.length;
}

/**
 * @deprecated 一键出海不再创建画布 Skill 卡；调用时清理遗留节点并返回空 id。
 * 保留函数签名以免 Agent / Wizard 调用方报错。
 */
export function ensureOverseasLocalizeNode(opts?: {
  targetMarketId?: string;
  position?: { x: number; y: number };
  focus?: boolean;
  resetTips?: boolean;
  forceNew?: boolean;
  markSkillQuery?: boolean;
}): string {
  void opts?.targetMarketId;
  void opts?.position;
  void opts?.focus;
  void opts?.resetTips;
  void opts?.forceNew;
  removeOverseasLocalizeNodes();
  // Skill 入口仍可写 URL，供会话态识别（不落节点）
  if (opts?.markSkillQuery) {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("skill") !== OVERSEAS_LOCALIZE_SKILL) {
        url.searchParams.set("skill", OVERSEAS_LOCALIZE_SKILL);
        window.history.replaceState({}, "", url.toString());
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

/** 节点变更后同步到 sessionStorage，供 Wizard / Agent 桥复用 */
export function syncOverseasSessionFromNode(
  projectId: string,
  params: OverseasNodeParams
): void {
  if (!projectId || !params.videoAssetId || !params.videoFileUrl) return;
  const prev = loadOverseasSession(projectId);
  saveOverseasSession(projectId, {
    videoAssetId: params.videoAssetId,
    videoFileUrl: params.videoFileUrl,
    videoTitle: params.videoTitle || "出海参考视频",
    aspectRatio: params.aspectRatio,
    clarity: params.clarity,
    targetMarketId: params.targetMarketId,
    localeNotes: params.localeNotes,
    autoStart: false,
    progress: {
      ...(prev?.progress || {}),
      phase: params.phase,
      gridNodeId: params.gridNodeId || undefined,
      videoNodeId: params.videoNodeId || undefined,
      shotCount: params.shotCount || undefined,
      styleSummary: params.styleSummary || undefined,
      localePlan: params.localePlan || undefined,
      message: params.message || undefined,
    },
  });
}

export { OVERSEAS_MARKETS };
