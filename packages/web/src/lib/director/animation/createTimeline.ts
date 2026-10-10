import {
  DIRECTOR_CAMERA_TRACK_TARGET,
  type DirectorAnimKeyframe,
  type DirectorAnimTrack,
  type DirectorAnimTrackKind,
  type DirectorAnimationTimeline,
  type DirectorMotionPath,
  type DirectorObject,
  type DirectorSceneState,
} from "@jumeng-canvas/shared";

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultAnimationTimeline(): DirectorAnimationTimeline {
  return {
    id: uid("anim"),
    duration: 10,
    fps: 30,
    loop: false,
    tracks: [],
    motionPaths: [],
    ui: {
      zoomPxPerSec: 48,
      panelHeight: 140,
      snapSec: 0.1,
      timeUnit: "s",
      autoKeyframe: false,
    },
  };
}

export function createAnimTrack(
  kind: DirectorAnimTrackKind,
  targetId: string,
  name: string
): DirectorAnimTrack {
  return {
    id: uid("track"),
    kind,
    targetId,
    name,
    muted: false,
    locked: false,
    interpolation: "linear",
    pathControlsXZ: true,
    orientToPath: kind !== "prop",
    motionPathId: null,
    motionPathStart: 0,
    motionPathEnd: 1,
    keyframes: [],
  };
}

export function createMotionPath(
  points: [number, number, number][],
  name = "轨迹",
  opts?: { closed?: boolean }
): DirectorMotionPath {
  return {
    id: uid("path"),
    name,
    points,
    closed: !!opts?.closed,
    heightOffset: 0,
    offset: [0, 0, 0],
    curve: "catmull",
  };
}

export function createAnimKeyframe(
  time: number,
  partial: Omit<DirectorAnimKeyframe, "id" | "time">
): DirectorAnimKeyframe {
  return { id: uid("kf"), time, ...partial };
}

/** 确保存在主机位轨；返回更新后的 timeline */
export function ensureHostCameraTrack(
  timeline: DirectorAnimationTimeline,
  objects: DirectorObject[]
): DirectorAnimationTimeline {
  const hasCameraTrack = timeline.tracks.some((t) => t.kind === "camera");
  if (hasCameraTrack) return timeline;
  const camObj = objects.find((o) => o.kind === "camera");
  const track = createAnimTrack(
    "camera",
    camObj?.id ?? DIRECTOR_CAMERA_TRACK_TARGET,
    camObj?.name || "主机位"
  );
  return { ...timeline, tracks: [track, ...timeline.tracks] };
}

/** 打开时间轴时：无 animation 则创建并挂主机位 */
export function openOrCreateAnimation(scene: DirectorSceneState): DirectorAnimationTimeline {
  const base = scene.animation ?? createDefaultAnimationTimeline();
  return ensureHostCameraTrack(base, scene.objects);
}

export function upsertKeyframe(
  keyframes: DirectorAnimKeyframe[],
  next: DirectorAnimKeyframe,
  epsilon = 0.05
): DirectorAnimKeyframe[] {
  const idx = keyframes.findIndex((k) => Math.abs(k.time - next.time) <= epsilon);
  if (idx < 0) {
    return [...keyframes, next].sort((a, b) => a.time - b.time);
  }
  const merged = { ...keyframes[idx]!, ...next, id: keyframes[idx]!.id, time: next.time };
  const copy = [...keyframes];
  copy[idx] = merged;
  return copy.sort((a, b) => a.time - b.time);
}

export function findTrackForObject(
  timeline: DirectorAnimationTimeline,
  objectId: string
): DirectorAnimTrack | undefined {
  return timeline.tracks.find((t) => t.targetId === objectId);
}
