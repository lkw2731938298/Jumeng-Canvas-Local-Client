"use client";

import type { DirectorObject } from "@/types/director-scene";

function AxisInput({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-white/50">
      <span className="w-3 font-mono text-white/35">{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-xs text-white/85 outline-none focus:border-indigo-400/50"
      />
    </label>
  );
}

export function DirectorModelInspector({
  object,
  onNameChange,
  onColorChange,
  onPositionChange,
  onRotationChange,
  onScaleChange,
  onUniformScaleChange,
}: {
  object: DirectorObject;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  onPositionChange: (axis: 0 | 1 | 2, value: number) => void;
  onRotationChange: (axis: 0 | 1 | 2, value: number) => void;
  onScaleChange: (axis: 0 | 1 | 2, value: number) => void;
  onUniformScaleChange: (value: number) => void;
}) {
  const pos = object.transform.position;
  const rot = object.transform.rotation;
  const scale = object.transform.scale;
  const uniform = (scale[0] + scale[1] + scale[2]) / 3;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-white/80">模型属性</p>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">名称</span>
        <input
          type="text"
          value={object.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-indigo-400/50"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">位置</span>
        <AxisInput label="X" value={pos[0]} onChange={(v) => onPositionChange(0, v)} />
        <AxisInput label="Y" value={pos[1]} onChange={(v) => onPositionChange(1, v)} />
        <AxisInput label="Z" value={pos[2]} onChange={(v) => onPositionChange(2, v)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">旋转</span>
        <AxisInput label="X" value={rot[0]} step={0.05} onChange={(v) => onRotationChange(0, v)} />
        <AxisInput label="Y" value={rot[1]} step={0.05} onChange={(v) => onRotationChange(1, v)} />
        <AxisInput label="Z" value={rot[2]} step={0.05} onChange={(v) => onRotationChange(2, v)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">缩放</span>
        <AxisInput label="X" value={scale[0]} step={0.05} onChange={(v) => onScaleChange(0, v)} />
        <AxisInput label="Y" value={scale[1]} step={0.05} onChange={(v) => onScaleChange(1, v)} />
        <AxisInput label="Z" value={scale[2]} step={0.05} onChange={(v) => onScaleChange(2, v)} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">统一缩放</span>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={uniform}
          onChange={(e) => onUniformScaleChange(parseFloat(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">模型颜色</span>
        <input
          type="color"
          value={object.color}
          onChange={(e) => onColorChange(e.target.value)}
          className="h-8 w-full cursor-pointer rounded border border-white/10 bg-transparent"
        />
      </label>
    </div>
  );
}
