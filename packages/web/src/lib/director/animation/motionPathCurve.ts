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
    // 过滤非法/连续重合点，避免 CatmullRom 产出 NaN
    const pts: Vector3[] = [];
    for (const p of path.points) {
      if (!p || p.length < 3) continue;
      if (![p[0], p[1], p[2]].every(Number.isFinite)) continue;
      const v = new Vector3(p[0], p[1], p[2]);
      const last = pts[pts.length - 1];
      if (last && last.distanceToSquared(v) < 1e-10) continue;
      pts.push(v);
    }
    if (pts.length < 2) return null;
    // 闭合路径若首尾重合，去掉末点交给 closed 处理
    if (path.closed && pts.length >= 3) {
      const first = pts[0]!;
      const end = pts[pts.length - 1]!;
      if (first.distanceToSquared(end) < 1e-8) pts.pop();
    }
    if (pts.length < 2) return null;
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

/**
 * 供 drei Line 使用：剔除非有限坐标与连续重合点。
 * 零长度折线会导致 LineSegmentsGeometry.computeBoundingSphere 半径为 NaN。
 */
export function sanitizePathLinePoints(
  raw: Array<[number, number, number] | Vector3>
): Vector3[] | null {
  const pts: Vector3[] = [];
  for (const p of raw) {
    const x = Array.isArray(p) ? p[0] : p.x;
    const y = Array.isArray(p) ? p[1] : p.y;
    const z = Array.isArray(p) ? p[2] : p.z;
    if (![x, y, z].every(Number.isFinite)) continue;
    const v = new Vector3(x, y, z);
    const last = pts[pts.length - 1];
    if (last && last.distanceToSquared(v) < 1e-10) continue;
    pts.push(v);
  }
  if (pts.length < 2) return null;
  let extent = 0;
  for (let i = 1; i < pts.length; i++) {
    extent = Math.max(extent, pts[i]!.distanceToSquared(pts[0]!));
  }
  if (extent < 1e-8) return null;
  return pts;
}
