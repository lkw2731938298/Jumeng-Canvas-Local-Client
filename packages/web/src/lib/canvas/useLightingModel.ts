"use client";

import { useToolImageCreditQuote } from "@/lib/canvas/canvasToolImageModel";

/** 打光面板：平台固定算力 + 全能图片 Pro 图生图 */
export function useLightingModel() {
  return useToolImageCreditQuote(true, "lighting");
}
