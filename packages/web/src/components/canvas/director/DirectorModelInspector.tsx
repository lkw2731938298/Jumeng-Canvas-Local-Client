"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
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
  onColorMapFile,
  onColorMapClear,
  colorMapPreviewUrl = null,
  colorMapUploading = false,
  onPositionChange,
  onRotationChange,
  onScaleChange,
  onUniformScaleChange,
}: {
  object: DirectorObject;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  /** 选择本地图片作为模型贴图 */
  onColorMapFile?: (file: File) => void;
  onColorMapClear?: () => void;
  colorMapPreviewUrl?: string | null;
  colorMapUploading?: boolean;
  onPositionChange: (axis: 0 | 1 | 2, value: number) => void;
  onRotationChange: (axis: 0 | 1 | 2, value: number) => void;
  onScaleChange: (axis: 0 | 1 | 2, value: number) => void;
  onUniformScaleChange: (value: number) => void;
}) {
  const pos = object.transform.position;
  const rot = object.transform.rotation;
  const scale = object.transform.scale;
  const uniform = (scale[0] + scale[1] + scale[2]) / 3;
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);

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

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">模型颜色</span>
        <input
          type="color"
          value={object.color}
          onChange={(e) => onColorChange(e.target.value)}
          className="h-8 w-full cursor-pointer rounded border border-white/10 bg-transparent"
          title="纯色（无贴图时生效；有贴图时作色调）"
        />
        {onColorMapFile ? (
          <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <p className="mb-1.5 text-[10px] text-white/40">造具贴图（仅几何体）</p>
            {colorMapPreviewUrl ? (
              <div className="relative mb-2 overflow-hidden rounded-md border border-white/10 bg-black/40">
                <img
                  src={colorMapPreviewUrl}
                  alt="模型贴图预览"
                  className="aspect-video w-full object-cover"
                  draggable={false}
                />
                {onColorMapClear ? (
                  <button
                    type="button"
                    onClick={onColorMapClear}
                    className="absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1 text-white/80 hover:bg-black/75 hover:text-white"
                    title="清除贴图"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="mb-2 flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-white/15 bg-black/20 text-[10px] text-white/30">
                未设置贴图，使用上方纯色
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                setPicking(false);
                if (file) onColorMapFile(file);
              }}
            />
            <button
              type="button"
              disabled={colorMapUploading || picking}
              onClick={() => {
                setPicking(true);
                fileRef.current?.click();
                // 取消选择文件时重置 picking
                window.setTimeout(() => setPicking(false), 800);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white/5 py-1.5 text-[10px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <ImagePlus className="h-3 w-3" />
              {colorMapUploading ? "上传中…" : colorMapPreviewUrl ? "更换贴图" : "上传图片"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
