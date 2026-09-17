import type { DirectorTransform } from "@/types/director-scene";

const GRID_STEP = 0.5;
const ROT_STEP = (15 * Math.PI) / 180;

function snapValue(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** 网格吸附：平移 0.5m、旋转 15° */
export function snapTransform(transform: DirectorTransform, mode: "translate" | "rotate" | "scale"): DirectorTransform {
  if (mode === "translate") {
    return {
      ...transform,
      position: transform.position.map((v) => snapValue(v, GRID_STEP)) as DirectorTransform["position"],
    };
  }
  if (mode === "rotate") {
    return {
      ...transform,
      rotation: transform.rotation.map((v) => snapValue(v, ROT_STEP)) as DirectorTransform["rotation"],
    };
  }
  return transform;
}
