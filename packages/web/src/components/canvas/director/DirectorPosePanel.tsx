"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { DirectorBonePose, DirectorCharacterGender } from "@jumeng-canvas/shared";
import {
  deleteCustomPosePreset,
  loadCustomPosePresets,
  saveCustomPosePreset,
  type CustomPosePreset,
} from "@/lib/director/customPosePresets";
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
  const [customs, setCustoms] = useState<CustomPosePreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCustoms(loadCustomPosePresets());
  }, []);

  const openSave = () => {
    setSaving(true);
    setSaveName("");
    setSaveError(null);
  };

  const cancelSave = () => {
    setSaving(false);
    setSaveName("");
    setSaveError(null);
  };

  const confirmSave = () => {
    const name = saveName.trim();
    if (!name) {
      setSaveError("请输入名称");
      return;
    }
    const created = saveCustomPosePreset(name, bonePose);
    if (!created) {
      setSaveError("保存失败（可能已达上限 32 个）");
      return;
    }
    setCustoms(loadCustomPosePresets());
    cancelSave();
  };

  const removeCustom = (id: string) => {
    setCustoms(deleteCustomPosePreset(id));
  };

  return (
    <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
      <p className="text-[10px] text-white/45">内置动作</p>
      <div className="grid grid-cols-4 gap-1">
        {POSE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.label}
            onClick={() => onPresetApply(resolvePresetPose(preset.id, gender))}
            className="rounded-md bg-white/5 px-1 py-1.5 text-[10px] leading-tight text-white/55 hover:bg-indigo-500/20 hover:text-white"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[10px] text-white/45">我的动作</p>
        {!saving ? (
          <button
            type="button"
            onClick={openSave}
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] text-indigo-300/80 hover:bg-indigo-500/15 hover:text-indigo-200"
            title="把当前关节姿势存为模板"
          >
            <Plus className="h-3 w-3" />
            存为模板
          </button>
        ) : null}
      </div>

      {saving ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-indigo-400/25 bg-indigo-500/10 p-2">
          <p className="text-[10px] text-indigo-100/70">保存当前摆好的姿势</p>
          <input
            autoFocus
            value={saveName}
            maxLength={16}
            placeholder="例如：侧身看向窗外"
            onChange={(e) => {
              setSaveName(e.target.value);
              setSaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmSave();
              if (e.key === "Escape") cancelSave();
            }}
            className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white/85 outline-none placeholder:text-white/25 focus:border-indigo-400/40"
          />
          {saveError ? <p className="text-[10px] text-rose-300/80">{saveError}</p> : null}
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={cancelSave}
              className="rounded-md px-2 py-1 text-[10px] text-white/45 hover:bg-white/5 hover:text-white/70"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmSave}
              className="rounded-md bg-indigo-500/30 px-2 py-1 text-[10px] text-indigo-100 hover:bg-indigo-500/45"
            >
              保存
            </button>
          </div>
        </div>
      ) : null}

      {customs.length === 0 && !saving ? (
        <p className="rounded-md border border-dashed border-white/10 px-2 py-2 text-center text-[10px] leading-relaxed text-white/30">
          摆好姿势后点「存为模板」，下次一键套用
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1">
          {customs.map((preset) => (
            <div
              key={preset.id}
              className="group relative flex min-h-[30px] items-stretch overflow-hidden rounded-md bg-white/5"
            >
              <button
                type="button"
                title={preset.label}
                onClick={() => onPresetApply(structuredClone(preset.pose))}
                className="min-w-0 flex-1 px-1.5 py-1.5 text-left text-[10px] leading-tight text-white/60 hover:bg-indigo-500/20 hover:text-white"
              >
                <span className="line-clamp-2 break-all">{preset.label}</span>
              </button>
              <button
                type="button"
                title="删除此模板"
                onClick={() => removeCustom(preset.id)}
                className="shrink-0 px-1.5 text-white/25 opacity-70 hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-white/45">关节微调</p>
      {POSE_GROUPS.map((group) => (
        <PoseGroupSection key={group.label} group={group} pose={bonePose} onUpdateBone={onUpdateBone} />
      ))}
    </div>
  );
}
