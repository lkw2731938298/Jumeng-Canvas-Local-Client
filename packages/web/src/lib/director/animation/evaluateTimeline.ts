import {
  DIRECTOR_CAMERA_TRACK_TARGET,
  type DirectorAnimKeyframe,
  type DirectorAnimTrack,
  type DirectorAnimationTimeline,
  type DirectorCameraState,
  type DirectorMotionPath,
  type DirectorSceneState,
} from "@jumeng-canvas/shared";
import { sampleMotionPath } from "./motionPathCurve";

export type Vec3 = [number, number, number];

export interface DirectorTimelineObjectSample {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  lookAt?: Vec3;
  fov?: number;
  motion?: "idle" | "walk" | "run";
  moving: boolean;
}

export interface DirectorTimelineSample {
  time: number;
  objects: Record<string, DirectorTimelineObjectSample>;
  directorCamera?: DirectorCameraState;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function applySpeedCurve(u: number, curve?: { u: number; v: number }[]): number {
  if (!curve || curve.length < 2) return Math.min(1, Math.max(0, u));
  const pts = [...curve].sort((a, b) => a.u - b.u);
  const x = Math.min(1, Math.max(0, u));
  if (x <= pts[0]!.u) return pts[0]!.v;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (x >= a.u && x <= b.u) {
      const t = b.u === a.u ? 0 : (x - a.u) / (b.u - a.u);
      return lerp(a.v, b.v, t);
    }
  }
  return pts[pts.length - 1]!.v;
}

function pickChannel<T>(
  keyframes: DirectorAnimKeyframe[],
  time: number,
  get: (k: DirectorAnimKeyframe) => T | undefined,
  lerpFn: (a: T, b: T, t: number) => T,
  fallback: T
): T {
  const keyed = keyframes
    .map((k) => ({ time: k.time, value: get(k) }))
    .filter((k): k is { time: number; value: T } => k.value !== undefined)
    .sort((a, b) => a.time - b.time);
  if (keyed.length === 0) return fallback;
  if (time <= keyed[0]!.time) return keyed[0]!.value;
  const last = keyed[keyed.length - 1]!;
  if (time >= last.time) return last.value;
  for (let i = 0; i < keyed.length - 1; i++) {
    const a = keyed[i]!;
    const b = keyed[i + 1]!;
    if (time >= a.time && time <= b.time) {
      const t = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
      return lerpFn(a.value, b.value, t);
    }
  }
  return last.value;
}

function trackProgress(track: DirectorAnimTrack, time: number, duration: number): number {
  const span = Math.max(1e-6, duration);
  const raw = Math.min(1, Math.max(0, time / span));
  return applySpeedCurve(raw, track.speedCurve);
}

function evaluateTrack(
  track: DirectorAnimTrack,
  time: number,
  duration: number,
  paths: Map<string, DirectorMotionPath>,
  base: DirectorTimelineObjectSample
): DirectorTimelineObjectSample {
  const kfs = [...track.keyframes].sort((a, b) => a.time - b.time);
  let position = pickChannel(kfs, time, (k) => k.position, lerpVec3, base.position);
  let rotation = pickChannel(kfs, time, (k) => k.rotation, lerpVec3, base.rotation);
  const scale = pickChannel(kfs, time, (k) => k.scale, lerpVec3, base.scale);
  let lookAt = pickChannel(kfs, time, (k) => k.lookAt, lerpVec3, base.lookAt ?? ([0, 1, 0] as Vec3));
  const fov = pickChannel(kfs, time, (k) => k.fov, lerp, base.fov ?? 45);

  let moving = false;
  const pathId = track.motionPathId;
  if (pathId) {
    const path = paths.get(pathId);
    if (path && path.points.length >= 2) {
      const u = trackProgress(track, time, duration);
      const start = track.motionPathStart ?? 0;
      const end = track.motionPathEnd ?? 1;
      const along = lerp(start, end, u);
      const sample = sampleMotionPath(path, along);
      if (sample) {
        moving = u > 0.001 && u < 0.999;
        const pathControlsXZ = track.pathControlsXZ !== false;
        if (pathControlsXZ) {
          // 路径管 XZ，Y 优先用关键帧（若有 position 关键帧则保留插值 Y）
          const hasYKey = kfs.some((k) => k.position != null);
          position = [
            sample.position[0],
            hasYKey ? position[1] : sample.position[1],
            sample.position[2],
          ];
        } else {
          position = sample.position;
        }
        if (track.orientToPath) {
          if (track.kind === "camera") {
            lookAt = [
              position[0] + sample.tangent[0],
              position[1] + sample.tangent[1] * 0.2,
              position[2] + sample.tangent[2],
            ];
          } else {
            rotation = [rotation[0], sample.yawDeg, rotation[2]];
          }
        }
      }
    }
  }

  const motionKf = [...kfs].filter((k) => k.motion).sort((a, b) => b.time - a.time).find((k) => k.time <= time);
  return {
    position,
    rotation,
    scale,
    lookAt: track.kind === "camera" ? lookAt : undefined,
    fov: track.kind === "camera" ? fov : undefined,
    motion: motionKf?.motion ?? (moving ? "walk" : "idle"),
    moving,
  };
}

function baseFromScene(
  scene: DirectorSceneState,
  track: DirectorAnimTrack
): DirectorTimelineObjectSample {
  if (track.targetId === DIRECTOR_CAMERA_TRACK_TARGET) {
    return {
      position: [...scene.camera.position],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      lookAt: [...scene.camera.target],
      fov: scene.camera.fov,
      moving: false,
    };
  }
  const obj = scene.objects.find((o) => o.id === track.targetId);
  if (!obj) {
    return {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      moving: false,
    };
  }
  return {
    position: [...obj.transform.position],
    rotation: [...obj.transform.rotation],
    scale: [...obj.transform.scale],
    lookAt: obj.lookAt ? [...obj.lookAt] : undefined,
    fov: obj.fov,
    moving: false,
  };
}

export function evaluateTimeline(
  scene: DirectorSceneState,
  timeSec: number,
  timeline?: DirectorAnimationTimeline | null
): DirectorTimelineSample {
  const anim = timeline ?? scene.animation;
  const sample: DirectorTimelineSample = { time: timeSec, objects: {} };
  if (!anim) return sample;

  const duration = Math.max(0.1, anim.duration);
  const t = Math.min(duration, Math.max(0, timeSec));
  const paths = new Map(anim.motionPaths.map((p) => [p.id, p]));

  for (const track of anim.tracks) {
    if (track.muted) continue;
    const base = baseFromScene(scene, track);
    const evaluated = evaluateTrack(track, t, duration, paths, base);

    if (track.targetId === DIRECTOR_CAMERA_TRACK_TARGET) {
      sample.directorCamera = {
        position: evaluated.position,
        target: evaluated.lookAt ?? [0, 1, 0],
        fov: evaluated.fov ?? 45,
      };
      continue;
    }

    sample.objects[track.targetId] = evaluated;

    if (track.kind === "camera") {
      // 若未设自由相机轨，第一个相机轨也可驱动预览相机
      if (!sample.directorCamera) {
        sample.directorCamera = {
          position: evaluated.position,
          target: evaluated.lookAt ?? [0, 1, 0],
          fov: evaluated.fov ?? 45,
        };
      }
    }
  }

  return sample;
}

/** 将 sample 合并进 scene 的浅拷贝（仅预览，不持久化） */
export function applySampleToScene(
  scene: DirectorSceneState,
  sample: DirectorTimelineSample
): DirectorSceneState {
  if (!Object.keys(sample.objects).length && !sample.directorCamera) return scene;
  return {
    ...scene,
    camera: sample.directorCamera
      ? { ...sample.directorCamera }
      : scene.camera,
    objects: scene.objects.map((obj) => {
      const ov = sample.objects[obj.id];
      if (!ov) return obj;
      return {
        ...obj,
        transform: {
          position: ov.position,
          rotation: ov.rotation,
          scale: ov.scale,
        },
        lookAt: ov.lookAt ?? obj.lookAt,
        fov: ov.fov ?? obj.fov,
      };
    }),
  };
}
