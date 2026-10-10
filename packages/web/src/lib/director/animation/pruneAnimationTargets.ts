import type { DirectorAnimationTimeline } from "@jumeng-canvas/shared";
import { invalidateMotionPathCache } from "./motionPathCurve";

function usedMotionPathIds(
  tracks: DirectorAnimationTimeline["tracks"]
): Set<string> {
  return new Set(
    tracks
      .map((t) => t.motionPathId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
}

/**
 * 按当前仍存在的对象对齐时间轴：去掉幽灵轨与无引用路径。
 * 删除角色/道具后或加载旧场景时调用，防止轨迹线残留。
 */
export function reconcileAnimationWithObjects(
  anim: DirectorAnimationTimeline | null | undefined,
  liveObjectIds: Iterable<string>
): DirectorAnimationTimeline | null | undefined {
  if (!anim) return anim;
  const live = liveObjectIds instanceof Set ? liveObjectIds : new Set(liveObjectIds);
  const tracks = anim.tracks.filter((t) => live.has(t.targetId));
  const pathIds = usedMotionPathIds(tracks);
  let pathsChanged = tracks.length !== anim.tracks.length;
  const motionPaths = anim.motionPaths.filter((p) => {
    const keep = pathIds.has(p.id);
    if (!keep) {
      pathsChanged = true;
      invalidateMotionPathCache(p.id);
    }
    return keep;
  });
  if (!pathsChanged && motionPaths.length === anim.motionPaths.length) {
    return anim;
  }
  return { ...anim, tracks, motionPaths };
}

/**
 * 删除场景对象后修剪时间轴：去掉指向已删对象的轨，
 * 并删除不再被任何轨引用的 motionPath（避免轨迹线残留）。
 */
export function pruneAnimationAfterObjectRemoval(
  anim: DirectorAnimationTimeline | null | undefined,
  removedObjectIds: Iterable<string>
): DirectorAnimationTimeline | null | undefined {
  if (!anim) return anim;
  const removed = new Set(removedObjectIds);
  if (removed.size === 0) return anim;
  const tracks = anim.tracks.filter((t) => !removed.has(t.targetId));
  const pathIds = usedMotionPathIds(tracks);
  for (const p of anim.motionPaths) {
    if (!pathIds.has(p.id)) invalidateMotionPathCache(p.id);
  }
  return {
    ...anim,
    tracks,
    motionPaths: anim.motionPaths.filter((p) => pathIds.has(p.id)),
  };
}

/** 只保留「仍有轨、且目标对象仍在场景中」的路径（防御已残留的 orphan） */
export function motionPathsBoundToLiveObjects(
  anim: DirectorAnimationTimeline | null | undefined,
  liveObjectIds: ReadonlySet<string> | Iterable<string>
): NonNullable<DirectorAnimationTimeline["motionPaths"]> {
  if (!anim) return [];
  const live =
    liveObjectIds instanceof Set ? liveObjectIds : new Set(liveObjectIds);
  const usedByLiveTrack = new Set<string>();
  for (const t of anim.tracks) {
    if (!t.motionPathId) continue;
    if (!live.has(t.targetId)) continue;
    usedByLiveTrack.add(t.motionPathId);
  }
  return anim.motionPaths.filter((p) => usedByLiveTrack.has(p.id));
}
