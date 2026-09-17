"use client";

import { useState } from "react";
import type { DirectorBonePose, DirectorCharacterGender } from "@jumeng-canvas/shared";
import {
  degToRad,
  getBoneRotation,
  POSE_GROUPS,
  POSE_PRESETS,
  radToDeg,
  resolvePresetPose,
  type PoseGroupDef,
} from "@/lib/director/poseRig";

function PoseSlider({
  label,
  valueDeg,
  min,
  max,
  onChange,
}: {
  label: string;
  valueDeg: number;
  min: number;
  max: number;
  onChange: (deg: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));

  return (
    <div className="flex items-center gap-2 text-[10px] text-white/50">
      <span className="w-8 shrink-0 text-white/40">{label}</span>
      <input
        type="range"
        className="min-w-0 flex-1 accent-indigo-500"
        min={min}
        max={max}
        step={1}
        value={valueDeg}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <span className="w-8 text-right font-mono text-white/60">{valueDeg}°</span>
    </div>
  );
}

function PoseGroupSection({
  group,
  pose,
  onUpdateBone,
}: {
  group: PoseGroupDef;
  pose: DirectorBonePose;
  onUpdateBone: (bone: string, rotation: [number, number, number]) => void;
}) {
  const [open, setOpen] = useState(true);

  const readAxis = (axis: 0 | 1 | 2) => radToDeg(getBoneRotation(pose, group.bones[0]!)[axis]);

  const writeAxis = (axis: 0 | 1 | 2, deg: number) => {
    const rad = degToRad(deg);
    for (const bone of group.bones) {
      const rot = [...getBoneRotation(pose, bone)] as [number, number, number];
      rot[axis] = rad;
      onUpdateBone(bone, rot);
    }
  };

  return (
    <div className="rounded-md border border-white/10">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[10px] text-white/70 hover:bg-white/5"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-white/35">{open ? "∨" : "›"}</span>
        {group.label}
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 border-t border-white/10 px-2 py-2">
          {group.axes.map((axisDef) => (
            <PoseSlider
              key={`${group.label}-${axisDef.label}`}
              label={axisDef.label}
              valueDeg={readAxis(axisDef.axis)}
              min={axisDef.min}
              max={axisDef.max}
              onChange={(deg) => writeAxis(axisDef.axis, deg)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DirectorPosePanel({
  bonePose,
  gender = "male",
  onPresetApply,
  onUpdateBone,
}: {
  bonePose: DirectorBonePose;
  gender?: DirectorCharacterGender;
  onPresetApply: (pose: DirectorBonePose) => void;
  onUpdateBone: (bone: string, rotation: [number, number, number]) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
      <p className="text-[10px] text-white/45">关节姿势</p>
      <div className="grid grid-cols-3 gap-1">
        {POSE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onPresetApply(resolvePresetPose(preset.id, gender))}
            className="rounded-md bg-white/5 px-1.5 py-1 text-[10px] text-white/55 hover:bg-indigo-500/20 hover:text-white"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {POSE_GROUPS.map((group) => (
        <PoseGroupSection key={group.label} group={group} pose={bonePose} onUpdateBone={onUpdateBone} />
      ))}
    </div>
  );
}
