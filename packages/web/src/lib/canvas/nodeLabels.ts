import type { Node } from "@xyflow/react";
import { NODE_REGISTRY } from "@/types/node-registry";
import type { WorkflowNodeData } from "@/types/workflow";

/** 侧栏/画布展示用节点名前缀（与类型一一对应） */
const NODE_LABEL_BASE: Record<string, string> = {
  text_input: "文本节点",
  image_input: "图片节点",
  video_input: "视频节点",
  audio_input: "音频节点",
  document_input: "文档/链接",
  storyboard_grid: "分镜表",
  overseas_localize: "一键出海",
  director_stage: "导演台",
  prompt: "提示词节点",
};

function labelBaseForType(type: string): string {
  return NODE_LABEL_BASE[type] ?? NODE_REGISTRY[type]?.label ?? type;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 根据当前画布上同类型节点，生成「文本节点1」「图片节点2」类标题 */
export function nextNodeLabel(type: string, nodes: Node<WorkflowNodeData>[]): string {
  const base = labelBaseForType(type);
  const pattern = new RegExp(`^${escapeRegExp(base)}(\\d+)$`);
  let maxSeq = 0;

  for (const node of nodes) {
    if (node.type !== type) continue;
    const label = String((node.data as WorkflowNodeData)?.label ?? "").trim();
    const m = label.match(pattern);
    if (m) {
      maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      continue;
    }
    if (label === base) {
      maxSeq = Math.max(maxSeq, 1);
    }
  }

  const sameTypeCount = nodes.filter((n) => n.type === type).length;
  const next = Math.max(maxSeq, sameTypeCount) + 1;
  return `${base}${next}`;
}
