import type { DirectorAnimationTimeline, DirectorSceneState } from "@jumeng-canvas/shared";
import {
  createAnimKeyframe,
  createAnimTrack,
  createDefaultAnimationTimeline,
  ensureHostCameraTrack,
} from "./createTimeline";
import { DIRECTOR_CAMERA_TRACK_TARGET } from "@jumeng-canvas/shared";

/** 将旧 cameraTrack 迁入 animation.camera 轨 */
export function migrateCameraTrackToAnimation(
  scene: DirectorSceneState
): DirectorAnimationTimeline | null {
  if (scene.animation && scene.animation.tracks.length > 0) {
    return ensureHostCameraTrack(scene.animation, scene.objects);
  }

  const legacy = scene.cameraTrack;
  if (!legacy || !Array.isArray(legacy.keyframes) || legacy.keyframes.length === 0) {
    return scene.animation;
  }

  const camObj = scene.objects.find((o) => o.kind === "camera");
  let timeline = scene.animation ?? createDefaultAnimationTimeline();
  timeline = {
    ...timeline,
    duration: Math.max(timeline.duration, legacy.duration || 5),
    fps: legacy.fps >= 60 ? 60 : 30,
  };

  const existingCam = timeline.tracks.find((t) => t.kind === "camera");
  const keyframes = legacy.keyframes.map((k) =>
    createAnimKeyframe(k.time, {
      position: [...k.position] as [number, number, number],
      lookAt: [...k.target] as [number, number, number],
      fov: k.fov,
    })
  );

  if (existingCam) {
    timeline = {
      ...timeline,
      tracks: timeline.tracks.map((t) =>
        t.id === existingCam.id
          ? {
              ...t,
              keyframes: keyframes.length ? keyframes : t.keyframes,
            }
          : t
      ),
    };
  } else {
    const track = createAnimTrack(
      "camera",
      camObj?.id ?? DIRECTOR_CAMERA_TRACK_TARGET,
      camObj?.name || "主机位"
    );
    track.keyframes = keyframes;
    timeline = { ...timeline, tracks: [track, ...timeline.tracks] };
  }

  return timeline;
}
