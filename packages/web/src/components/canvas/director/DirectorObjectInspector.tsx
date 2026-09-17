"use client";

import type { ReactNode, RefObject } from "react";
import type { DirectorObject } from "@/types/director-scene";

function AxisInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-white/50">
      <span className="w-3 font-mono text-white/35">{label}</span>
      <input
        type="number"
        step={0.1}
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-xs text-white/85 outline-none focus:border-indigo-400/50"
      />
    </label>
  );
}

export function DirectorObjectInspector({
  object,
  onNameChange,
  onPositionChange,
  onLookAtChange,
  onFovChange,
  lensPreviewTrackRef,
  cameraViewModeToggle,
}: {
  object: DirectorObject;
  onNameChange: (name: string) => void;
  onPositionChange: (axis: 0 | 1 | 2, value: number) => void;
  onLookAtChange?: (axis: 0 | 1 | 2, value: number) => void;
  onFovChange?: (fov: number) => void;
  lensPreviewTrackRef?: RefObject<HTMLDivElement | null>;
  cameraViewModeToggle?: ReactNode;
}) {
  const pos = object.transform.position;
  const lookAt = object.lookAt ?? [0, 1, 0];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">造具设置</p>
      {cameraViewModeToggle}
      {object.kind === "camera" && lensPreviewTrackRef ? (
        <div className="overflow-hidden rounded-md border border-white/10">
          <p className="border-b border-white/10 bg-black/40 px-2 py-1 text-[9px] text-white/40">
            镜头预览
          </p>
          <div
            ref={lensPreviewTrackRef}
            className="pointer-events-none aspect-video w-full bg-transparent"
          />
        </div>
      ) : null}
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
      {object.kind === "camera" && onLookAtChange ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-white/45">朝向目标</span>
            <AxisInput label="X" value={lookAt[0]} onChange={(v) => onLookAtChange(0, v)} />
            <AxisInput label="Y" value={lookAt[1]} onChange={(v) => onLookAtChange(1, v)} />
            <AxisInput label="Z" value={lookAt[2]} onChange={(v) => onLookAtChange(2, v)} />
          </div>
          {onFovChange ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/45">视场角 FOV</span>
              <input
                type="number"
                min={10}
                max={120}
                step={1}
                value={object.fov ?? 45}
                onChange={(e) => onFovChange(parseFloat(e.target.value) || 45)}
                className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-indigo-400/50"
              />
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
