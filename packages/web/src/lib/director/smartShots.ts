/**
 * 智能分镜：根据场景主体生成一组可落库的机位建议（不依赖 LLM）。
 */

import {
  computeFramingPose,
  computeOverShoulderPose,
  framingToCameraFields,
  type FramingAngle,
  type FramingPose,
  type FramingShot,
} from "@/lib/director/cameraFraming";
import type { DirectorObject } from "@/types/director-scene";

export interface SmartShotRecipe {
  id: string;
  label: string;
  blurb: string;
  /** 情绪色点，仅 UI */
  tone: string;
  build: (subjects: DirectorObject[]) => FramingPose | null;
}

const RECIPES: SmartShotRecipe[] = [
  {
    id: "front_medium",
    label: "正面中景",
    blurb: "正前方、眼高平视胸口，对话/介绍",
    tone: "bg-sky-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({ target: t, shot: "medium", angle: "eye", azimuthDeg: 0 });
    },
  },
  {
    id: "three_quarter",
    label: "四分之三",
    blurb: "斜侧 35°，颧骨立体、仍见五官",
    tone: "bg-indigo-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({ target: t, shot: "medium", angle: "eye", azimuthDeg: 35 });
    },
  },
  {
    id: "low_hero",
    label: "仰拍英雄",
    blurb: "膝下仰拍看向头部，压迫/力量感",
    tone: "bg-amber-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({
        target: t,
        shot: "medium",
        angle: "low",
        azimuthDeg: 12,
        lookAtShot: "close",
      });
    },
  },
  {
    id: "high_observe",
    label: "俯拍观察",
    blurb: "高机位俯视全身，交代站位关系",
    tone: "bg-emerald-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({
        target: t,
        shot: "full",
        angle: "high",
        azimuthDeg: -18,
        lookAtShot: "medium",
      });
    },
  },
  {
    id: "profile_full",
    label: "侧面全身",
    blurb: "正侧 90°，行走/轮廓剪影",
    tone: "bg-fuchsia-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({ target: t, shot: "full", angle: "eye", azimuthDeg: 90 });
    },
  },
  {
    id: "wide_establish",
    label: "广角建立",
    blurb: "拉开距离略俯，交代空间环境",
    tone: "bg-rose-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({
        target: t,
        shot: "wide",
        angle: "high",
        azimuthDeg: 20,
        lookAtShot: "full",
      });
    },
  },
  {
    id: "over_shoulder",
    label: "过肩对话",
    blurb: "需两名人物：从 A 肩后看 B 面部",
    tone: "bg-orange-400",
    build: (subjects) => {
      if (subjects.length < 2) return null;
      return computeOverShoulderPose(subjects[0]!, subjects[1]!, "right");
    },
  },
  {
    id: "close_portrait",
    label: "近景肖像",
    blurb: "正前方贴脸，眼鼻入画",
    tone: "bg-violet-400",
    build: (subjects) => {
      const t = subjects[0];
      if (!t) return null;
      return computeFramingPose({ target: t, shot: "close", angle: "eye", azimuthDeg: 0 });
    },
  },
];

export interface SmartShotSuggestion {
  recipeId: string;
  label: string;
  blurb: string;
  tone: string;
  pose: FramingPose;
  cameraFields: ReturnType<typeof framingToCameraFields>;
}

/** 以人物优先、其次道具为取景主体 */
export function pickFramingSubjects(objects: DirectorObject[]): DirectorObject[] {
  const characters = objects.filter((o) => o.kind === "character");
  if (characters.length) return characters;
  return objects.filter((o) => o.kind !== "camera");
}

export function buildSmartShotSuggestions(objects: DirectorObject[]): SmartShotSuggestion[] {
  const subjects = pickFramingSubjects(objects);
  if (!subjects.length) return [];
  const out: SmartShotSuggestion[] = [];
  for (const recipe of RECIPES) {
    const pose = recipe.build(subjects);
    if (!pose) continue;
    out.push({
      recipeId: recipe.id,
      label: recipe.label,
      blurb: recipe.blurb,
      tone: recipe.tone,
      pose,
      cameraFields: framingToCameraFields(pose),
    });
  }
  return out;
}

export type { FramingShot, FramingAngle };
