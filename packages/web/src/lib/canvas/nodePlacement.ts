import type { Node } from "@xyflow/react";
import { NODE_REGISTRY } from "@/types/node-registry";
import { defaultNodeSize } from "@/lib/canvas/nodeSizing";

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PaneSize {
  width: number;
  height: number;
}

export interface FlowPoint {
  x: number;
  y: number;
}

export interface NodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PLACEMENT_GAP = 24;
const SPIRAL_STEP = 48;
const MAX_SPIRAL_TRIES = 40;

export function screenToFlowPosition(
  clientX: number,
  clientY: number,
  bounds: DOMRect,
  viewport: FlowViewport
): FlowPoint {
  return {
    x: (clientX - bounds.left - viewport.x) / viewport.zoom,
    y: (clientY - bounds.top - viewport.y) / viewport.zoom,
  };
}

export function viewportCenterFlowPosition(
  viewport: FlowViewport,
  paneSize: PaneSize
): FlowPoint {
  const w = paneSize.width > 0 ? paneSize.width : 800;
  const h = paneSize.height > 0 ? paneSize.height : 600;
  return {
    x: (w / 2 - viewport.x) / viewport.zoom,
    y: (h / 2 - viewport.y) / viewport.zoom,
  };
}

export function nodeSizeForType(type: string): { width: number; height: number } {
  const def = NODE_REGISTRY[type];
  if (def?.defaultWidth && def?.defaultHeight) {
    return { width: def.defaultWidth, height: def.defaultHeight };
  }
  return defaultNodeSize();
}

export function topLeftFromCenter(center: FlowPoint, size: { width: number; height: number }): FlowPoint {
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
  };
}

function boundsOverlap(a: NodeBounds, b: NodeBounds): boolean {
  const gap = PLACEMENT_GAP;
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function nodeToBounds(node: Node, size: { width: number; height: number }): NodeBounds {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? size.width,
    height: node.height ?? size.height,
  };
}

export function resolveNonOverlappingPosition(
  preferredTopLeft: FlowPoint,
  size: { width: number; height: number },
  existingNodes: Node[]
): FlowPoint {
  const candidate: NodeBounds = {
    x: preferredTopLeft.x,
    y: preferredTopLeft.y,
    width: size.width,
    height: size.height,
  };

  const occupied = existingNodes.map((node) => {
    const nodeType = node.type || "";
    const nodeSize = nodeSizeForType(nodeType);
    return nodeToBounds(node, nodeSize);
  });

  const collides = (box: NodeBounds) => occupied.some((other) => boundsOverlap(box, other));

  if (!collides(candidate)) {
    return { x: candidate.x, y: candidate.y };
  }

  const baseX = preferredTopLeft.x;
  const baseY = preferredTopLeft.y;

  for (let i = 1; i <= MAX_SPIRAL_TRIES; i++) {
    const ring = Math.ceil(i / 8);
    const angleIndex = i % 8;
    const dx = Math.cos((angleIndex * Math.PI) / 4) * ring * SPIRAL_STEP;
    const dy = Math.sin((angleIndex * Math.PI) / 4) * ring * SPIRAL_STEP;
    const next: NodeBounds = {
      x: baseX + dx,
      y: baseY + dy,
      width: size.width,
      height: size.height,
    };
    if (!collides(next)) {
      return { x: next.x, y: next.y };
    }
  }

  return {
    x: baseX + SPIRAL_STEP,
    y: baseY + SPIRAL_STEP,
  };
}

export function resolveAddNodePosition(
  type: string,
  existingNodes: Node[],
  options: {
    viewport: FlowViewport;
    paneSize: PaneSize;
    selectedNodeId?: string | null;
    preferredCenter?: FlowPoint;
  }
): FlowPoint {
  const size = nodeSizeForType(type);
  let center = options.preferredCenter;

  if (!center && options.selectedNodeId) {
    const selected = existingNodes.find((n) => n.id === options.selectedNodeId);
    if (selected) {
      const selectedSize = nodeSizeForType(selected.type || type);
      center = {
        x: selected.position.x + selectedSize.width + 48 + size.width / 2,
        y: selected.position.y + selectedSize.height / 2,
      };
    }
  }

  if (!center) {
    center = viewportCenterFlowPosition(options.viewport, options.paneSize);
  }

  const topLeft = topLeftFromCenter(center, size);
  return resolveNonOverlappingPosition(topLeft, size, existingNodes);
}

export function offsetFlowPosition(position: FlowPoint, index: number, step = 40): FlowPoint {
  if (index <= 0) return position;
  return {
    x: position.x + index * step,
    y: position.y + index * step,
  };
}
