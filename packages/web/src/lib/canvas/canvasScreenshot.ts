import type { Node } from "@xyflow/react";
import { NODE_IMAGE_SUBCATEGORY, uploadAsset } from "@/lib/api/assets";
import { canvasStreamUrlFromUrl } from "@/lib/api/storageUrl";
import { getNodeWorldPosition } from "@/lib/canvas/canvasOverlayTransform";
import { NODE_TITLE_HEIGHT, resolveNodeSize } from "@/lib/canvas/nodeSizing";
import type { WorkflowNodeData } from "@/types/workflow";

export interface FlowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("截图导出失败"))),
      "image/png"
    );
  });
}

function rectsIntersect(
  a: FlowRect,
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/**
 * 按画布坐标系框选区域合成截图：铺底色 + 绘制相交的图片节点内容，上传为项目素材。
 */
export async function bakeCanvasScreenshotToAsset(params: {
  projectId: string;
  flowRect: FlowRect;
  nodes: Node<WorkflowNodeData>[];
  title?: string;
}): Promise<{ id: string; fileUrl: string; title: string }> {
  const { flowRect, nodes, projectId } = params;
  const scale = 2;
  const outW = Math.max(1, Math.round(flowRect.w * scale));
  const outH = Math.max(1, Math.round(flowRect.h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持截图");

  // 与画布深色底一致
  ctx.fillStyle = "#0c0c12";
  ctx.fillRect(0, 0, outW, outH);
  ctx.scale(scale, scale);
  ctx.translate(-flowRect.x, -flowRect.y);

  const imageNodes = nodes.filter(
    (n) => n.type === "image_input" || n.type === "director_stage"
  );

  for (const node of imageNodes) {
    const world = getNodeWorldPosition(node, nodes);
    const { width, height } = resolveNodeSize(node.width, node.height);
    const nodeRect = { x: world.x, y: world.y, w: width, h: height };
    if (!rectsIntersect(flowRect, nodeRect)) continue;

    const paramsData = (node.data as WorkflowNodeData)?.params ?? {};
    const rawUrl = String(paramsData.imageUrl ?? "").trim();
    if (!rawUrl) {
      // 空节点：画占位卡片
      ctx.fillStyle = "rgba(34,34,42,0.95)";
      ctx.fillRect(world.x, world.y, width, height);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "13px system-ui, sans-serif";
      const label = String((node.data as WorkflowNodeData)?.label ?? "图片");
      ctx.fillText(label, world.x + 12, world.y + 22);
      continue;
    }

    try {
      const loadUrl = canvasStreamUrlFromUrl(rawUrl) || rawUrl;
      const img = await loadImage(loadUrl);
      const bodyY = world.y + NODE_TITLE_HEIGHT;
      const bodyH = Math.max(1, height - NODE_TITLE_HEIGHT);
      // 标题条
      ctx.fillStyle = "rgba(28,28,36,0.98)";
      ctx.fillRect(world.x, world.y, width, NODE_TITLE_HEIGHT);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "12px system-ui, sans-serif";
      const label = String((node.data as WorkflowNodeData)?.label ?? "图片");
      ctx.fillText(label.slice(0, 24), world.x + 10, world.y + 22);
      // 图片本体 object-cover
      ctx.save();
      ctx.beginPath();
      ctx.rect(world.x, bodyY, width, bodyH);
      ctx.clip();
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const cover = Math.max(width / iw, bodyH / ih);
      const dw = iw * cover;
      const dh = ih * cover;
      const dx = world.x + (width - dw) / 2;
      const dy = bodyY + (bodyH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    } catch {
      ctx.fillStyle = "rgba(34,34,42,0.95)";
      ctx.fillRect(world.x, world.y, width, height);
    }
  }

  const blob = await canvasToPngBlob(canvas);
  const title = params.title?.trim() || "画布截图";
  const file = new File([blob], `canvas-shot-${Date.now()}.png`, { type: "image/png" });
  const asset = await uploadAsset({
    file,
    projectId,
    category: "image",
    subcategory: NODE_IMAGE_SUBCATEGORY,
    title,
  });
  if (!asset.fileUrl) throw new Error("截图上传后未返回地址");
  return { id: asset.id, fileUrl: asset.fileUrl, title: asset.title || title };
}
