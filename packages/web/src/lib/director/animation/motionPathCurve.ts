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
 * 播放头进度 u∈[0,1]（已含 motionPathStart/End）上，离曲线采样点最近的控制点下标。
 * 用于「移动模型 = 改该时刻对应的路径点」。
 */
export function nearestMotionPathPointIndex(
  path: DirectorMotionPath,
  along01: number
): number {
  const pts = path.points;
  if (pts.length <= 1) return 0;
  const u = Math.min(1, Math.max(0, along01));
  const curve = getMotionPathCurve(path);
  let tx: number;
  let ty: number;
  let tz: number;
  if (curve) {
    const p = curve.getPointAt(u);
    tx = p.x;
    ty = p.y;
    tz = p.z;
  } else {
    const i = Math.round(u * (pts.length - 1));
    return Math.min(pts.length - 1, Math.max(0, i));
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const d =
      (p[0] - tx) * (p[0] - tx) +
      (p[1] - ty) * (p[1] - ty) +
      (p[2] - tz) * (p[2] - tz);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * 把路径在 along01 处的采样点挪到 target（世界坐标）。
 * 不能直接把最近控制点设成 target（Catmull 上播放头未必落在该点），
 * 而是反复把「目标 − 当前采样」加到最近点上，使松手后模型停在拖到的位置。
 */
export function nudgeMotionPathTowardPosition(
  path: DirectorMotionPath,
  along01: number,
  target: [number, number, number],
  iterations = 4
): DirectorMotionPath {
  if (path.points.length === 0) return path;
  let points = path.points.map(
    (p) => [...p] as [number, number, number]
  );
  const u = Math.min(1, Math.max(0, along01));
  for (let iter = 0; iter < iterations; iter++) {
    const working: DirectorMotionPath = { ...path, points };
    invalidateMotionPathCache(path.id);
    const sample = sampleMotionPath(working, u);
    if (!sample) break;
    const dx = target[0] - sample.position[0];
    const dy = target[1] - sample.position[1];
    const dz = target[2] - sample.position[2];
    if (dx * dx + dy * dy + dz * dz < 1e-10) break;
    const idx = nearestMotionPathPointIndex(working, u);
    const pt = points[idx]!;
    points = points.map((p, i) =>
      i === idx
        ? ([pt[0] + dx, pt[1] + dy, pt[2] + dz] as [number, number, number])
        : p
    );
  }
  invalidateMotionPathCache(path.id);
  return { ...path, points };
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
