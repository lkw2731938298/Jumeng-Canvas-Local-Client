import type { DirectorCameraState, DirectorCameraTrack, DirectorCameraKeyframe } from "@/types/director-scene";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function interpolateCameraTrack(
  track: DirectorCameraTrack,
  timeSec: number
): DirectorCameraState {
  const keyframes = [...track.keyframes].sort((a, b) => a.time - b.time);
  if (keyframes.length === 0) {
    return { position: [6, 4, 8], target: [0, 1, 0], fov: 45 };
  }
  if (keyframes.length === 1 || timeSec <= keyframes[0]!.time) {
    const k = keyframes[0]!;
    return { position: [...k.position], target: [...k.target], fov: k.fov };
  }
  const last = keyframes[keyframes.length - 1]!;
  if (timeSec >= last.time) {
    return { position: [...last.position], target: [...last.target], fov: last.fov };
  }

  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (timeSec >= a.time && timeSec <= b.time) {
      const t = (timeSec - a.time) / (b.time - a.time);
      return {
        position: lerpVec3(a.position, b.position, t),
        target: lerpVec3(a.target, b.target, t),
        fov: lerp(a.fov, b.fov, t),
      };
    }
  }

  return { position: [...last.position], target: [...last.target], fov: last.fov };
}

export function newCameraKeyframe(time: number, from: DirectorCameraState): DirectorCameraKeyframe {
  return {
    id: `kf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    time,
    position: [...from.position],
    target: [...from.target],
    fov: from.fov,
  };
}

export function createDefaultCameraTrack(): DirectorCameraTrack {
  return {
    id: `track_${Date.now()}`,
    duration: 5,
    fps: 12,
    keyframes: [],
  };
}

export function trackFrameTimes(track: DirectorCameraTrack): number[] {
  const frameCount = Math.max(1, Math.floor(track.duration * track.fps));
  const times: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    times.push((i / Math.max(1, frameCount - 1)) * track.duration);
  }
  return times;
}
