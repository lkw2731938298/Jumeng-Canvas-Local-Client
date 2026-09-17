/**
 * 单镜重新生成后自动同步分镜表 / 成片表 —— 「Editor 自动 reflow 整条时间线」。
 *
 * 背景：此前 generate_node（AI 操控画布 / 节点手动重新生成 / 批量流水线）只会把结果写回
 * 该节点自身参数，分镜表 / 成片表里对应的镜头行需要等整批流程跑完才会被重新汇总，
 * 期间表格显示的仍是旧素材——这正是团队设计文档标注的「改单镜后 Editor 自动 reflow
 * 整条时间线」缺口（对齐 OiiOii/LibTV）。
 *
 * 修补方式：在唯一的媒体结果回写出口 applyMediaJobResultToNode 处挂钩（见
 * applyMediaJobResult.ts），只要节点带有 storyboardShotId / viralRemakeShotId，
 * 生成成功后立即把最新 assetId / 状态回写所属分镜表行；分镜表 / 成片表的镜头顺序、
 * 累计时长均为对 shots 的纯函数计算（computeShotsTimeline），无需额外缓存或手动
 * 「重新汇总」——单镜一变，整条时间线自动重排。
 */

import { computeShotsTimeline, parseTableRowsParam, type StoryboardTableRow } from "@/types/storyboard-table";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import {
  findAgentShotByNodeId,
  patchAgentShotLocal,
  computeAgentTimelineSummary,
  findAgentCharacterByNodeId,
  patchAgentCharacterSheetLocal,
  findAgentProductByNodeId,
  patchAgentProductSheetLocal,
} from "@/lib/canvas/agentProjectGraphCache";
import { syncShotProgress, syncCharacterSheetAsset, syncProductSheetAsset } from "@/lib/api/agentSessions";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";

export interface ShotReflowResult {
  /** 是否实际发生了回写（false 时可能是无绑定镜头、或已是最新，无需提示） */
  updated: boolean;
  gridNodeId?: string;
  shotNo?: string;
  totalSec?: number;
  readyCount?: number;
  totalCount?: number;
}

function resolveBoundShotId(params: Record<string, unknown>): string {
  return (
    String(params.storyboardShotId ?? "").trim() ||
    String(params.viralRemakeShotId ?? "").trim()
  );
}

/** 在项目全部分镜表节点中查找该 shotId 归属的表（shotId 全局唯一，故最多命中一张表） */
function findGridByShotId(
  shotId: string
): { gridNodeId: string; rows: StoryboardTableRow[] } | null {
  const { nodes } = useCanvasStore.getState();
  for (const n of nodes) {
    if (n.type !== "storyboard_grid") continue;
    const params = (n.data as WorkflowNodeData).params ?? {};
    const rows = parseTableRowsParam(params.shots);
    if (rows.some((r) => r.id === shotId)) {
      return { gridNodeId: n.id, rows };
    }
  }
  return null;
}

/**
 * 视频节点生成成功后调用：若该节点绑定了某分镜表的镜头行，把最新 assetId / 状态 /
 * 时长写回该行；分镜表与成片表（成片表为分镜表 shots 的只读投影）会立即随之刷新，
 * 且总时长 / 各镜起止时刻（由 computeShotsTimeline 计算）自动跟着重排。
 */
export function reflowShotToStoryboardGrid(nodeId: string): ShotReflowResult {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "video_input") return { updated: false };

  const params = (node.data as WorkflowNodeData).params ?? {};
  const shotId = resolveBoundShotId(params);
  if (!shotId) return { updated: false };

  const assetId = String(params.assetId ?? "").trim();
  if (!assetId) return { updated: false };

  const hit = findGridByShotId(shotId);
  if (!hit) return { updated: false };

  const rowIndex = hit.rows.findIndex((r) => r.id === shotId);
  if (rowIndex < 0) return { updated: false };
  const prevRow = hit.rows[rowIndex]!;

  // 已同步为最新素材，避免批量流水线自身同步与本钩子重复触发时的多余写入/抖动
  if (prevRow.outputVideoAssetId === assetId && prevRow.videoStatus === "succeeded") {
    const summary = computeShotsTimeline(hit.rows);
    return {
      updated: false,
      gridNodeId: hit.gridNodeId,
      shotNo: prevRow.shotNo,
      totalSec: summary.totalSec,
      readyCount: summary.readyCount,
      totalCount: summary.totalCount,
    };
  }

  const durationSec = Number(params.durationSec);
  const nextRow: StoryboardTableRow = {
    ...prevRow,
    outputVideoAssetId: assetId,
    videoStatus: "succeeded",
    videoError: undefined,
    duration:
      Number.isFinite(durationSec) && durationSec > 0
        ? `${Math.round(durationSec)}s`
        : prevRow.duration,
  };
  const nextRows = hit.rows.map((r, i) => (i === rowIndex ? nextRow : r));

  const gridNode = store.nodes.find((n) => n.id === hit.gridNodeId);
  const gridParams = (gridNode?.data as WorkflowNodeData | undefined)?.params ?? {};
  store.updateNodeData(hit.gridNodeId, {
    params: { ...gridParams, shots: nextRows },
  });

  const summary = computeShotsTimeline(nextRows);
  return {
    updated: true,
    gridNodeId: hit.gridNodeId,
    shotNo: nextRow.shotNo,
    totalSec: summary.totalSec,
    readyCount: summary.readyCount,
    totalCount: summary.totalCount,
  };
}

export interface ProjectGraphReflowResult {
  /** 是否实际发生了回写（false 时可能是自由创作路径未启用、节点未绑定镜头、或已是最新） */
  updated: boolean;
  readyCount?: number;
  totalCount?: number;
}

/**
 * 自由创作 Agent Team 路径（画布操控 / 智能编排，无分镜表承载）专用：
 * image_input / video_input 节点生成成功后，若该节点绑定了 Project Graph
 * 的某个 shotId（projectAgentCanvasOps.ts 投影时写入 bindings），就把最新
 * assetId / 状态先乐观更新进本地快照（agentProjectGraphCache），再
 * fire-and-forget 持久化回后端——与分镜表路径同构，只是载体换成
 * Project Graph shots[] + timeline.shotIds（排序已在建图时算好）。
 */
export function reflowShotToProjectGraph(nodeId: string): ProjectGraphReflowResult {
  const store = useCanvasStore.getState();
  const { projectId } = store;
  if (!projectId) return { updated: false };

  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || (node.type !== "image_input" && node.type !== "video_input")) {
    return { updated: false };
  }

  const shot = findAgentShotByNodeId(projectId, nodeId);
  if (!shot) return { updated: false };

  const params = (node.data as WorkflowNodeData).params ?? {};
  const assetId = String(params.assetId ?? "").trim();
  if (!assetId) return { updated: false };

  if (shot.outputAssetId === assetId && shot.status === "ready") {
    const summary = computeAgentTimelineSummary(projectId);
    return { updated: false, readyCount: summary?.readyCount, totalCount: summary?.totalCount };
  }

  patchAgentShotLocal(projectId, shot.id, { outputAssetId: assetId, status: "ready" });

  // 持久化失败不影响本地展示；下次会话续聊拿到权威 graph 时会自然校正。
  void syncShotProgress(projectId, [{ shotId: shot.id, outputAssetId: assetId, status: "ready" }]).catch(
    (err) => {
      console.warn("[shotReflow] syncShotProgress failed", err);
    }
  );

  const summary = computeAgentTimelineSummary(projectId);
  return { updated: true, readyCount: summary?.readyCount, totalCount: summary?.totalCount };
}

export interface CharacterSheetReflowResult {
  /** 是否实际发生了回写（false 时可能是非定妆图节点、未绑定角色、或素材已记录过） */
  updated: boolean;
  characterId?: string;
}

/**
 * identityLock 三视图身份锁闭环：角色「定妆图」节点（params.characterAssetRole
 * === "sheet"，由 agent_team_orchestrator 建图时打上）生成成功后，把产物
 * assetId 追加进 Project Graph 的 characters[].identityLock.sheetAssetIds——
 * 该节点已在建图时通过 connect_nodes 连到相关镜头节点上游，一旦定妆图生成
 * 完成，用户后续手动生成镜头时会经既有「上游连线媒体自动作为参考」通道自动
 * 带上该形象参考，无需改生成提交逻辑，也不自动扣算力。
 */
export function reflowCharacterSheetToProjectGraph(nodeId: string): CharacterSheetReflowResult {
  const store = useCanvasStore.getState();
  const { projectId } = store;
  if (!projectId) return { updated: false };

  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "image_input") return { updated: false };

  const params = (node.data as WorkflowNodeData).params ?? {};
  if (String(params.characterAssetRole ?? "").trim() !== "sheet") return { updated: false };

  const character = findAgentCharacterByNodeId(projectId, nodeId);
  if (!character) return { updated: false };

  const assetId = String(params.assetId ?? "").trim();
  if (!assetId) return { updated: false };

  const isNew = patchAgentCharacterSheetLocal(projectId, character.id, assetId);
  if (!isNew) return { updated: false };

  // 持久化失败不影响本地展示；下次会话续聊拿到权威 graph 时会自然校正。
  void syncCharacterSheetAsset(projectId, [{ characterId: character.id, sheetAssetId: assetId }]).catch(
    (err) => {
      console.warn("[shotReflow] syncCharacterSheetAsset failed", err);
    }
  );

  return { updated: true, characterId: character.id };
}

export interface ProductSheetReflowResult {
  /** 是否实际发生了回写（false 时可能是非定妆图节点、未绑定产品、或素材已记录过） */
  updated: boolean;
  productId?: string;
  /** 本次确定性自动连线新增的边数（供 reply 提示，非必需） */
  autoConnectedCount?: number;
}

/**
 * 单一产品电影级宣传片 Skill 专用：产品「多视角定妆图」节点（params.productAssetRole
 * === "sheet"，由画布操控 followup 的 LLM plan 打上）生成成功后：
 * ① 把产物 assetId 追加进 Project Graph 的 products[].identityLock.sheetAssetIds；
 * ② 确定性自动连线——该 Skill 走 LLM JSON plan（非 Team 确定性编排），无法保证每次
 *    都记得把定妆图连到全部镜头，故这里兜底遍历同一 params.cinematicBatchId 下的
 *    全部 video_input 节点，为尚未连线的节点补 connect_nodes(ref_in)，不依赖 LLM 记忆。
 */
export function reflowProductSheetToProjectGraph(nodeId: string): ProductSheetReflowResult {
  const store = useCanvasStore.getState();
  const { projectId } = store;
  if (!projectId) return { updated: false };

  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "image_input") return { updated: false };

  const params = (node.data as WorkflowNodeData).params ?? {};
  if (String(params.productAssetRole ?? "").trim() !== "sheet") return { updated: false };

  const product = findAgentProductByNodeId(projectId, nodeId);
  if (!product) return { updated: false };

  const assetId = String(params.assetId ?? "").trim();
  if (!assetId) return { updated: false };

  const isNew = patchAgentProductSheetLocal(projectId, product.id, assetId);

  // 确定性自动连线：即使素材未变化（重复回调）也要补线，避免曾因异常漏连
  const batchId = String(params.cinematicBatchId ?? "").trim();
  let autoConnectedCount = 0;
  if (batchId) {
    const siblingVideoNodes = store.nodes.filter(
      (n) =>
        n.type === "video_input" &&
        String((n.data as WorkflowNodeData).params?.cinematicBatchId ?? "").trim() === batchId
    );
    for (const target of siblingVideoNodes) {
      const already = store.edges.some(
        (e) => e.source === nodeId && e.target === target.id && e.targetHandle === REFERENCE_INPUT_ID
      );
      if (already) continue;
      useCanvasStore.getState().connectNodes({
        source: nodeId,
        target: target.id,
        sourceHandle: "image",
        targetHandle: REFERENCE_INPUT_ID,
      });
      autoConnectedCount += 1;
    }
  }

  if (!isNew && autoConnectedCount === 0) return { updated: false };

  if (isNew) {
    // 持久化失败不影响本地展示；下次会话续聊拿到权威 graph 时会自然校正。
    void syncProductSheetAsset(projectId, [{ productId: product.id, sheetAssetId: assetId }]).catch((err) => {
      console.warn("[shotReflow] syncProductSheetAsset failed", err);
    });
  }

  return { updated: true, productId: product.id, autoConnectedCount };
}
