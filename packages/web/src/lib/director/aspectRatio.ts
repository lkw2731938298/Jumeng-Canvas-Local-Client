import type { DirectorAspectRatio } from "@/types/director-scene";

export const DIRECTOR_ASPECT_OPTIONS: { id: DirectorAspectRatio; label: string }[] = [
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "1:1", label: "1:1" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "21:9", label: "21:9" },
  { id: "2.35:1", label: "2.35:1" },
];

export function aspectRatioToNumber(ratio: DirectorAspectRatio): number {
  if (ratio === "2.35:1") return 2.35;
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}

/** 在容器内计算画幅安全区（居中，letterbox / pillarbox） */
export function computeAspectFrame(
  containerWidth: number,
  containerHeight: number,
  aspect: number
): { x: number; y: number; width: number; height: number } {
  const containerAspect = containerWidth / containerHeight;
  if (containerAspect > aspect) {
    const height = containerHeight;
    const width = height * aspect;
    return { x: (containerWidth - width) / 2, y: 0, width, height };
  }
  const width = containerWidth;
  const height = width / aspect;
  return { x: 0, y: (containerHeight - height) / 2, width, height };
}
