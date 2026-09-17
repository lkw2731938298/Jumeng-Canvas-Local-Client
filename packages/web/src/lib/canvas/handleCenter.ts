import type { InternalNode } from "@xyflow/react";

type HandleBounds = {
  id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Flow-space center of a node handle (matches the visual connection dot). */
export function absoluteHandleCenter(
  node: InternalNode | null | undefined,
  handleType: "source" | "target",
  handleId?: string | null,
): { x: number; y: number } | null {
  if (!node) return null;
  const bounds = node.internals.handleBounds?.[handleType] as HandleBounds[] | undefined;
  if (!bounds?.length) return null;

  const handle = (handleId ? bounds.find((h) => h.id === handleId) : bounds[0]) ?? bounds[0];
  if (!handle) return null;

  const { x: ax, y: ay } = node.internals.positionAbsolute;
  return {
    x: ax + handle.x + handle.width / 2,
    y: ay + handle.y + handle.height / 2,
  };
}
