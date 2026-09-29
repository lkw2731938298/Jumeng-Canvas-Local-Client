/**
 * 构图医生：对照当前机位与主体，给出可执行的修正建议（非 LLM）。
 */

import {
  computeFramingPose,
  focusPointOnObject,
  framingToCameraFields,
  objectHeightMeters,
  type FramingPose,
} from "@/lib/director/cameraFraming";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import type { DirectorAspectRatio, DirectorObject } from "@/types/director-scene";

export type DoctorSeverity = "ok" | "info" | "warn";

export interface CompositionTip {
  id: string;
  severity: DoctorSeverity;
  title: string;
  detail: string;
  /** 一键修正后的机位字段；无可修正则为 null */
  fix: ReturnType<typeof framingToCameraFields> | null;
  fixLabel?: string;
}

function dist(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function pickSubject(objects: DirectorObject[], lookAtObjectId?: string | null): DirectorObject | null {
  if (lookAtObjectId) {
    const hit = objects.find((o) => o.id === lookAtObjectId && o.kind !== "camera");
    if (hit) return hit;
  }
  return objects.find((o) => o.kind === "character") ?? objects.find((o) => o.kind !== "camera") ?? null;
}

/**
 * @param camera 当前选中/分析的摄像机
 * @param objects 场景全部物体
 * @param aspectRatio 场景画幅（影响「过宽 FOV」判断）
 */
export function analyzeCameraComposition(
  camera: DirectorObject,
  objects: DirectorObject[],
  aspectRatio: DirectorAspectRatio = "16:9"
): CompositionTip[] {
  if (camera.kind !== "camera") return [];
  const tips: CompositionTip[] = [];
  const subject = pickSubject(objects, camera.lookAtObjectId);
  const camPos = camera.transform.position;
  const lookAt = camera.lookAt ?? [0, 1, 0];
  const fov = camera.fov ?? 45;
  const aspect = aspectRatioToNumber(aspectRatio);

  if (!subject) {
    tips.push({
      id: "no_subject",
      severity: "warn",
      title: "场景里还没有主体",
      detail: "先添加人物或道具，构图医生才能对照机位给建议。",
      fix: null,
    });
    return tips;
  }

  const height = objectHeightMeters(subject);
  const head = focusPointOnObject(subject, "close");
  const chest = focusPointOnObject(subject, "medium");
  const d = dist(camPos, subject.transform.position);
  const lookDistToHead = dist(lookAt as [number, number, number], head);
  const camHeight = camPos[1];
  const eyeHeight = subject.transform.position[1] + height * 0.9;

  // 1) 注视点是否偏离头部/胸口
  if (lookDistToHead > height * 0.55) {
    const pose = computeFramingPose({
      target: subject,
      shot: d < 1.6 ? "close" : d > 4 ? "full" : "medium",
      angle: "eye",
      azimuthDeg: estimateAzimuth(camPos, subject),
      distance: d,
      fov,
    });
    tips.push({
      id: "lookat_miss",
      severity: "warn",
      title: "注视点偏离主体",
      detail: `当前看向距头部约 ${lookDistToHead.toFixed(1)}m，容易拍到空景或脚底。`,
      fix: framingToCameraFields({ ...pose, lookAt: chest, targetId: subject.id }),
      fixLabel: "对准胸口",
    });
  }

  // 2) 机位过近 / 过远
  if (d < 0.7) {
    const pose = computeFramingPose({
      target: subject,
      shot: "close",
      angle: "eye",
      azimuthDeg: estimateAzimuth(camPos, subject),
      fov: Math.min(fov, 40),
    });
    tips.push({
      id: "too_close",
      severity: "warn",
      title: "机位贴得太近",
      detail: `距主体仅 ${d.toFixed(1)}m，透视会夸张、也容易穿模。`,
      fix: framingToCameraFields(pose),
      fixLabel: "退到近景位",
    });
  } else if (d > 9) {
    const pose = computeFramingPose({
      target: subject,
      shot: "wide",
      angle: "eye",
      azimuthDeg: estimateAzimuth(camPos, subject),
      fov: Math.max(fov, 50),
    });
    tips.push({
      id: "too_far",
      severity: "info",
      title: "机位偏远",
      detail: `距主体 ${d.toFixed(1)}m，人物在画幅里会很小。`,
      fix: framingToCameraFields(pose),
      fixLabel: "收到广角建立位",
    });
  }

  // 3) 高度：过低贴地 / 过高鸟瞰误用
  if (camHeight < 0.25) {
    const pose = computeFramingPose({
      target: subject,
      shot: "medium",
      angle: "low",
      azimuthDeg: estimateAzimuth(camPos, subject),
      distance: Math.max(1.5, Math.min(d, 3)),
      fov,
    });
    tips.push({
      id: "too_low",
      severity: "warn",
      title: "机位几乎贴地",
      detail: "容易只拍到腿和地面，除非刻意仰拍英雄感。",
      fix: framingToCameraFields(pose),
      fixLabel: "抬到仰拍位",
    });
  } else if (camHeight > eyeHeight + 3.5) {
    const pose = computeFramingPose({
      target: subject,
      shot: "full",
      angle: "high",
      azimuthDeg: estimateAzimuth(camPos, subject),
      distance: Math.max(2.5, Math.min(d, 5)),
      fov,
    });
    tips.push({
      id: "too_high",
      severity: "info",
      title: "机位过高",
      detail: "接近鸟瞰，人物面部信息会变少。",
      fix: framingToCameraFields(pose),
      fixLabel: "降到俯拍观察位",
    });
  }

  // 4) FOV 与画幅
  if (fov > 70) {
    tips.push({
      id: "fov_wide",
      severity: "info",
      title: "FOV 偏广",
      detail: `当前 ${Math.round(fov)}°，边缘畸变明显；叙事人像常用 35–50°。`,
      fix: {
        ...framingToCameraFields(
          computeFramingPose({
            target: subject,
            shot: "medium",
            angle: "eye",
            azimuthDeg: estimateAzimuth(camPos, subject),
            distance: d,
            fov: 42,
          })
        ),
        fov: 42,
      },
      fixLabel: "收到 42°",
    });
  } else if (fov < 22) {
    tips.push({
      id: "fov_tele",
      severity: "info",
      title: "FOV 过窄（长焦）",
      detail: `当前 ${Math.round(fov)}°，景深压缩强，空间感弱。`,
      fix: {
        ...framingToCameraFields(
          computeFramingPose({
            target: subject,
            shot: "medium",
            angle: "eye",
            azimuthDeg: estimateAzimuth(camPos, subject),
            distance: d,
            fov: 35,
          })
        ),
        fov: 35,
      },
      fixLabel: "放到 35°",
    });
  }

  if (aspect >= 2.2 && fov < 40) {
    tips.push({
      id: "ultrawide_tight_fov",
      severity: "info",
      title: "超宽画幅配窄 FOV",
      detail: `${aspectRatioLabel(aspectRatio)} 画幅下 FOV ${Math.round(fov)}° 会显得左右空、主体挤在中间。`,
      fix: {
        ...framingToCameraFields(
          computeFramingPose({
            target: subject,
            shot: "medium",
            angle: "eye",
            azimuthDeg: estimateAzimuth(camPos, subject),
            distance: Math.max(1.8, d * 0.9),
            fov: 50,
          })
        ),
        fov: 50,
      },
      fixLabel: "略广角补两侧",
    });
  }

  // 5) 未关联主体（智能分镜用 manual 锁胸口，但仍应记下 lookAtObjectId）
  if (!camera.lookAtObjectId) {
    tips.push({
      id: "no_lookat_bind",
      severity: "info",
      title: "未关联注视主体",
      detail: "记下主体后构图医生可对照人物给建议；注视点仍建议锁在胸口而非脚底。",
      fix: {
        ...framingToCameraFields(
          computeFramingPose({
            target: subject,
            shot: d < 1.6 ? "close" : d > 4 ? "full" : "medium",
            angle: "eye",
            azimuthDeg: estimateAzimuth(camPos, subject),
            distance: d,
            fov,
          })
        ),
      },
      fixLabel: "对准主体胸口",
    });
  }

  if (!tips.length) {
    tips.push({
      id: "all_good",
      severity: "ok",
      title: "构图看起来稳妥",
      detail: "距离、高度、注视点都在常用区间。可再试智能分镜换情绪。",
      fix: null,
    });
  }

  return tips;
}

function estimateAzimuth(camPos: [number, number, number], subject: DirectorObject): number {
  const fwdYaw = subject.transform.rotation[1];
  const dx = camPos[0] - subject.transform.position[0];
  const dz = camPos[2] - subject.transform.position[2];
  const camYaw = Math.atan2(dx, dz);
  let deg = ((camYaw - fwdYaw) * 180) / Math.PI;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function aspectRatioLabel(r: DirectorAspectRatio) {
  return r;
}

/** 应用「经典中景」作为总重置 */
export function classicMediumFix(subject: DirectorObject): FramingPose {
  return computeFramingPose({
    target: subject,
    shot: "medium",
    angle: "eye",
    azimuthDeg: 20,
  });
}
