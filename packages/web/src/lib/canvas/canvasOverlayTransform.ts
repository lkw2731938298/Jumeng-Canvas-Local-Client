import type { CSSProperties } from "react";
import type { Node } from "@xyflow/react";
import { useCanvasStore } from "@/stores/canvasStore";
import { getAbsolutePosition } from "@/lib/canvas/nodeGroup";
import type { WorkflowNodeData } from "@/types/workflow";

/** Fixed screen-pixel widths for node-attached popups (counter-scaled against canvas zoom). */
export const CANVAS_EDITOR_PANEL_WIDTH = 720;
/** 图片节点底栏（模型/参数/创作工具），比通用编辑浮层更窄 */
export const CANVAS_IMAGE_EDITOR_PANEL_WIDTH = 600;
/** 文本节点底栏控件较少，比通用编辑浮层更窄 */
export const CANVAS_TEXT_EDITOR_PANEL_WIDTH = 480;
/** 音频节点底栏（音色/参数/字数），比通用编辑浮层更窄 */
export const CANVAS_AUDIO_EDITOR_PANEL_WIDTH = 520;
/** 视频底栏含模式/参数摘要，略宽于图片编辑浮层 */
export const CANVAS_VIDEO_EDITOR_PANEL_WIDTH = 680;
/** 高清放大参数面板更窄，贴近截图紧凑布局 */
export const CANVAS_HD_UPSCALE_PANEL_WIDTH = 360;
export const CANVAS_MULTI_ANGLE_PANEL_WIDTH = 480;
export const CANVAS_LIGHTING_PANEL_WIDTH = 520;
export const CANVAS_TOP_MENU_MAX_WIDTH = 420;
/** 分镜表顶栏按钮较多，背景框需足够宽以单行容纳 */
export const CANVAS_STORYBOARD_TOP_MENU_MAX_WIDTH = 1200;
/** 图片节点顶栏工具较多，需单行展开 */
export const CANVAS_IMAGE_TOP_MENU_MAX_WIDTH = 920;
/** 视频节点顶栏：剪辑等工具 + 截图/上传/下载，需更宽单行展示 */
export const CANVAS_VIDEO_TOP_MENU_MAX_WIDTH = 1080;
/** 节点底边到编辑浮层顶部的空隙（画布坐标，与节点世界高度同单位） */
export const CANVAS_EDITOR_NODE_GAP = 12;
/** 节点顶边到顶栏工具条底边的空隙（画布坐标，贴近标题栏） */
export const CANVAS_TOP_MENU_NODE_GAP = 2;

/**
 * EdgeLabelRenderer 内各浮层 z-index（transform 会创建独立层叠上下文，须设在浮层根上）。
 * 默认：顶栏及下拉 > 编辑面板；底部参数面板展开时抬高编辑浮层并互斥关闭顶栏下拉。
 */
export const CANVAS_OVERLAY_Z_EDITOR = 1;
export const CANVAS_OVERLAY_Z_TOP_MENU = 5;
export const CANVAS_OVERLAY_Z_TOP_MENU_OPEN = 20;
/** 底部生成参数展开时盖过顶栏下拉，避免「编辑」菜单压住分辨率/比例面板 */
export const CANVAS_OVERLAY_Z_EDITOR_EXPANDED = 25;
export const CANVAS_OVERLAY_Z_SPECIAL_PANEL = 30;
/** 浮层内部下拉面板 class（相对浮层根再抬一层） */
export const CANVAS_OVERLAY_DROPDOWN_CLASS = "z-[100]";

export type CanvasOverlayPlacement = "below" | "above";

/**
 * EdgeLabelRenderer 在缩放后的 viewport 内；须用 transform translate 锚定（与节点定位一致）。
 * scale(1/zoom) 抵消画布缩放，保持浮层屏幕尺寸稳定。
 */
export function buildCanvasOverlayStyle(
  anchorX: number,
  anchorY: number,
  zoom: number,
  placement: CanvasOverlayPlacement,
  extra?: CSSProperties
): CSSProperties {
  const safeZoom = zoom > 0 ? zoom : 1;
  const inv = 1 / safeZoom;
  const anchor =
    placement === "above"
      ? `translate(-50%, -100%) translate(${anchorX}px, ${anchorY}px)`
      : `translate(-50%, 0) translate(${anchorX}px, ${anchorY}px)`;

  return {
    position: "absolute",
    transform: `${anchor} scale(${inv})`,
    transformOrigin: placement === "above" ? "bottom center" : "top center",
    ...extra,
  };
}

export function useCanvasOverlayStyle(
  anchorX: number,
  anchorY: number,
  placement: CanvasOverlayPlacement,
  extra?: CSSProperties
): CSSProperties {
  const zoom = useCanvasStore((s) => s.viewport.zoom);
  return buildCanvasOverlayStyle(anchorX, anchorY, zoom, placement, extra);
}

/**
 * 组内节点 position 是相对父组的；弹层必须用世界坐标，否则相对组框错位。
 */
export function getNodeWorldPosition(
  node: Node<WorkflowNodeData> | undefined | null,
  nodes: Node<WorkflowNodeData>[]
): { x: number; y: number } {
  if (!node) return { x: 0, y: 0 };
  return getAbsolutePosition(node, nodes);
}
