import { CatmullRomCurve3, Vector3 } from "three";
import type { DirectorMotionPath } from "@jumeng-canvas/shared";

const curveCache = new Map<string, CatmullRomCurve3>();

function pathCacheKey(path: DirectorMotionPath): string {
  return `${path.id}:${path.closed ? 1 : 0}:${path.points.map((p) => p.join(",")).join("|")}`;
}

export function getMotionPathCurve(path: DirectorMotionPath): CatmullRomCurve3 | null {
  if (path.points.length < 2) return null;
  const key = pathCacheKey(path);
  let curve = curveCache.get(key);
  if (!curve) {
    // 清同 id 旧缓存
    for (const k of curveCache.keys()) {
      if (k.startsWith(`${path.id}:`)) curveCache.delete(k);
    }
    const pts = path.points.map((p) => new Vector3(p[0], p[1], p[2]));
    curve = new CatmullRomCurve3(pts, !!path.closed, "catmullrom", 0.5);
    curveCache.set(key, curve);
  }
  return curve;
}

export function sampleMotionPath(
  path: DirectorMotionPath,
  u: number
): { position: [number, number, number]; tangent: [number, number, number]; yawDeg: number } | null {
  const curve = getMotionPathCurve(path);
  if (!curve) return null;
  const t = Math.min(1, Math.max(0, u));
  const pos = curve.getPointAt(t);
  const tan = curve.getTangentAt(t).normalize();
  const offset = path.offset ?? [0, 0, 0];
  const height = path.heightOffset ?? 0;
  const yawDeg = (Math.atan2(tan.x, tan.z) * 180) / Math.PI;
  return {
    position: [pos.x + offset[0], pos.y + offset[1] + height, pos.z + offset[2]],
    tangent: [tan.x, tan.y, tan.z],
    yawDeg,
  };
}

export function invalidateMotionPathCache(pathId?: string) {
  if (!pathId) {
    curveCache.clear();
    return;
  }
  for (const k of curveCache.keys()) {
    if (k.startsWith(`${pathId}:`)) curveCache.delete(k);
  }
}
