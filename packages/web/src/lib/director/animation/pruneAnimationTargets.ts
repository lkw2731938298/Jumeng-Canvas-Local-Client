import {
  DIRECTOR_CAMERA_TRACK_TARGET,
  type DirectorAnimTrack,
  type DirectorAnimationTimeline,
} from "@jumeng-canvas/shared";
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

/** 主机位哨兵 target / 仍在场的物体轨都保留 */
function trackTargetStillLive(
  targetId: string,
  live: ReadonlySet<string>
): boolean {
  return targetId === DIRECTOR_CAMERA_TRACK_TARGET || live.has(targetId);
}

/**
 * 解析当前应显示/编辑的运动路径轨：优先带路径的选中轨，再回退到选中物体轨。
 * 避免「时间轴选中主机位（无路径）」时盖住角色轨，导致轨迹线整段不显示。
 */
export function resolveMotionPathEditTrack(
  anim: DirectorAnimationTimeline | null | undefined,
  selectedTrackId: string | null | undefined,
  selectedObjectId: string | null | undefined
): DirectorAnimTrack | null {
  if (!anim) return null;
  const byTrackId = selectedTrackId
    ? anim.tracks.find((t) => t.id === selectedTrackId)
    : undefined;
  const byObjectId = selectedObjectId
    ? anim.tracks.find((t) => t.targetId === selectedObjectId)
    : undefined;
  if (byTrackId?.motionPathId && !byTrackId.locked) return byTrackId;
  if (byObjectId?.motionPathId && !byObjectId.locked) return byObjectId;
  if (byTrackId?.motionPathId) return byTrackId;
  if (byObjectId?.motionPathId) return byObjectId;
  return null;
}

/**
 * 按当前仍存在的对象对齐时间轴：去掉幽灵轨与无引用路径。
 * 删除角色/道具后或加载旧场景时调用，防止轨迹线残留。
 * 主机位轨 target=`__director_camera__` 始终保留。
 */
export function reconcileAnimationWithObjects(
  anim: DirectorAnimationTimeline | null | undefined,
  liveObjectIds: Iterable<string>
): DirectorAnimationTimeline | null | undefined {
  if (!anim) return anim;
  const live = liveObjectIds instanceof Set ? liveObjectIds : new Set(liveObjectIds);
  const tracks = anim.tracks.filter((t) => trackTargetStillLive(t.targetId, live));
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
    if (!trackTargetStillLive(t.targetId, live)) continue;
    usedByLiveTrack.add(t.motionPathId);
  }
  return anim.motionPaths.filter((p) => usedByLiveTrack.has(p.id));
}
