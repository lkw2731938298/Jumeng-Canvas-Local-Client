"use client";

import { useToolImageCreditQuote } from "@/lib/canvas/canvasToolImageModel";

/** 多角度面板：平台固定算力 + 全能图片 Pro 图生图 */
export function useMultiAngleModel() {
  return useToolImageCreditQuote(true, "multi_angle");
}
