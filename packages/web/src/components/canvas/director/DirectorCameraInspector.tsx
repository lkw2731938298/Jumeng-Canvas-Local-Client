"use client";

import type { RefObject } from "react";
import { Camera, Loader2 } from "lucide-react";
import type { DirectorAspectRatio, DirectorObject } from "@/types/director-scene";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import { lookupAsset, type Asset } from "@/lib/api/assets";
import { CameraViewModeToggle } from "./CameraViewModeToggle";
import type { CameraPropViewMode } from "@/types/director-scene";

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

export function DirectorCameraInspector({
  object,
  cameraObjects,
  targetObjects,
  assets,
  cameraViewMode,
  onCameraViewModeChange,
  onSelectCamera,
  onNameChange,
  onPositionChange,
  onLookAtModeChange,
  onLookAtObjectChange,
  onLookAtChange,
  onFovChange,
  lensPreviewTrackRef,
  onCaptureScreenshot,
  capturing = false,
  aspectRatio = "16:9",
}: {
  object: DirectorObject;
  cameraObjects: DirectorObject[];
  targetObjects: DirectorObject[];
  assets: Asset[];
  cameraViewMode: CameraPropViewMode;
  onCameraViewModeChange: (mode: CameraPropViewMode) => void;
  onSelectCamera: (id: string) => void;
  onNameChange: (name: string) => void;
  onPositionChange: (axis: 0 | 1 | 2, value: number) => void;
  onLookAtModeChange: (mode: "manual" | "target") => void;
  onLookAtObjectChange: (objectId: string | null) => void;
  onLookAtChange: (axis: 0 | 1 | 2, value: number) => void;
  onFovChange: (fov: number) => void;
  lensPreviewTrackRef: RefObject<HTMLDivElement | null>;
  onCaptureScreenshot: () => void;
  capturing?: boolean;
  aspectRatio?: DirectorAspectRatio;
}) {
  const pos = object.transform.position;
  const lookAt = object.lookAt ?? [0, 1, 0];
  const lookAtMode = object.lookAtMode ?? "manual";
  const screenshots = object.screenshots ?? [];
  const previewAspect = aspectRatioToNumber(aspectRatio);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 border-b border-white/10 pb-2 text-[10px]">
        <span className="text-white/80">属性</span>
        <span className="text-white/35">·</span>
        <span className="text-indigo-300">摄像机视图</span>
      </div>

      <div className="overflow-hidden rounded-md border border-white/10">
        <p className="border-b border-white/10 bg-black/40 px-2 py-1 text-[9px] text-white/40">
          FOV {object.fov ?? 45}°
        </p>
        <div
          ref={lensPreviewTrackRef}
          className="pointer-events-none w-full bg-transparent"
          style={{ aspectRatio: previewAspect }}
        />
      </div>

      <CameraViewModeToggle mode={cameraViewMode} onChange={onCameraViewModeChange} />

      <button
        type="button"
        disabled={capturing}
        onClick={onCaptureScreenshot}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-indigo-400/40 bg-indigo-500/20 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {capturing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
        {capturing ? "拍摄中…" : "拍摄当前机位"}
      </button>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">名称</span>
        <input
          type="text"
          value={object.name}
          onChange={(e) => onNameChange(e.target.value)}
          className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-indigo-400/50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">切换机位</span>
        <select
          value={object.id}
          onChange={(e) => onSelectCamera(e.target.value)}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-indigo-400/50"
        >
          {cameraObjects.map((cam) => (
            <option key={cam.id} value={cam.id} className="bg-zinc-900">
              {cam.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">位置</span>
        <AxisInput label="X" value={pos[0]} onChange={(v) => onPositionChange(0, v)} />
        <AxisInput label="Y" value={pos[1]} onChange={(v) => onPositionChange(1, v)} />
        <AxisInput label="Z" value={pos[2]} onChange={(v) => onPositionChange(2, v)} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">注视目标</span>
        <select
          value={lookAtMode === "target" ? object.lookAtObjectId ?? "" : "manual"}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "manual") {
              onLookAtModeChange("manual");
              onLookAtObjectChange(null);
            } else {
              onLookAtModeChange("target");
              onLookAtObjectChange(val);
            }
          }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-indigo-400/50"
        >
          <option value="manual" className="bg-zinc-900">
            手动坐标
          </option>
          {targetObjects.map((t) => (
            <option key={t.id} value={t.id} className="bg-zinc-900">
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {lookAtMode === "manual" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-white/45">注视坐标</span>
          <AxisInput label="X" value={lookAt[0]} onChange={(v) => onLookAtChange(0, v)} />
          <AxisInput label="Y" value={lookAt[1]} onChange={(v) => onLookAtChange(1, v)} />
          <AxisInput label="Z" value={lookAt[2]} onChange={(v) => onLookAtChange(2, v)} />
        </div>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">视野角度 {object.fov ?? 45}°</span>
        <input
          type="range"
          min={10}
          max={120}
          step={0.5}
          value={object.fov ?? 45}
          onChange={(e) => onFovChange(parseFloat(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </label>

      <div>
        <p className="mb-1.5 text-[10px] text-white/45">相机截图</p>
        {screenshots.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5">
            {screenshots.map((shot) => {
              const asset = lookupAsset(assets, shot.assetId);
              const url = asset?.fileUrl;
              return (
                <div key={shot.id} className="overflow-hidden rounded-md border border-white/10">
                  {url ? (
                    <img src={url} alt={shot.name} className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-black/30 text-[9px] text-white/30">
                      {shot.name}
                    </div>
                  )}
                  <p className="truncate px-1 py-0.5 text-[9px] text-white/50">{shot.name}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-white/30">暂无截图，点击上方按钮拍摄</p>
        )}
      </div>
    </div>
  );
}
