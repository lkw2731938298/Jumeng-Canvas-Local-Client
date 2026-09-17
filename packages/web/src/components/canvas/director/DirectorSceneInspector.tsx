"use client";

import type { RefObject } from "react";
import type { DirectorSceneSettings } from "@/types/director-scene";
import { Switch } from "@/components/ui/switch";

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
        className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-xs text-white/85 outline-none select-text focus:border-indigo-400/50"
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-white/55">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} size="sm" />
    </div>
  );
}

export function DirectorSceneInspector({
  settings,
  panoramaPreviewUrl,
  onPatch,
  onPanoramaUpload,
}: {
  settings: DirectorSceneSettings;
  panoramaPreviewUrl?: string | null;
  onPatch: (patch: Partial<DirectorSceneSettings>) => void;
  onPanoramaUpload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-white/80">3D 场景</p>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">场景缩放 {settings.zoom}%</span>
        <input
          type="range"
          min={50}
          max={300}
          step={5}
          value={settings.zoom}
          onChange={(e) => onPatch({ zoom: parseInt(e.target.value, 10) })}
          className="w-full accent-indigo-500"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">场景平移</span>
        <AxisInput label="X" value={settings.pan[0]} onChange={(v) => onPatch({ pan: [v, settings.pan[1], settings.pan[2]] })} />
        <AxisInput label="Y" value={settings.pan[1]} onChange={(v) => onPatch({ pan: [settings.pan[0], v, settings.pan[2]] })} />
        <AxisInput label="Z" value={settings.pan[2]} onChange={(v) => onPatch({ pan: [settings.pan[0], settings.pan[1], v] })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">场景旋转</span>
        <AxisInput label="X" value={settings.rotate[0]} step={1} onChange={(v) => onPatch({ rotate: [v, settings.rotate[1], settings.rotate[2]] })} />
        <AxisInput label="Y" value={settings.rotate[1]} step={1} onChange={(v) => onPatch({ rotate: [settings.rotate[0], v, settings.rotate[2]] })} />
        <AxisInput label="Z" value={settings.rotate[2]} step={1} onChange={(v) => onPatch({ rotate: [settings.rotate[0], settings.rotate[1], v] })} />
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <p className="mb-2 text-[10px] font-medium text-white/45">全景背景</p>
        {panoramaPreviewUrl ? (
          <div className="mb-2 overflow-hidden rounded-md border border-white/10 bg-black/40">
            <img
              src={panoramaPreviewUrl}
              alt="全景预览"
              className="aspect-video w-full max-w-full object-cover"
              draggable={false}
            />
          </div>
        ) : (
          <div className="mb-2 flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-white/15 bg-black/20 text-[10px] text-white/30">
            未设置全景图
          </div>
        )}
        <button
          type="button"
          onClick={onPanoramaUpload}
          className="w-full rounded-md bg-white/5 py-1.5 text-[10px] text-white/70 hover:bg-white/10 hover:text-white"
        >
          从资产选择全景图
        </button>
        {settings.panorama ? (
          <>
            <label className="mt-2 flex flex-col gap-1">
              <span className="text-[10px] text-white/45">水平旋转</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={settings.panorama.horizontalRotation}
                onChange={(e) =>
                  onPatch({
                    panorama: {
                      ...settings.panorama!,
                      horizontalRotation: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full accent-indigo-500"
              />
            </label>
            <label className="mt-1 flex flex-col gap-1">
              <span className="text-[10px] text-white/45">
                球形半径 {settings.panorama.sphereRadius}（放大/缩小全景球）
              </span>
              <input
                type="range"
                // 全景球缩放范围：更小可贴近场景，更大可拉远包住场地
                min={10}
                max={500}
                step={5}
                value={settings.panorama.sphereRadius}
                onChange={(e) =>
                  onPatch({
                    panorama: {
                      ...settings.panorama!,
                      sphereRadius: parseFloat(e.target.value),
                    },
                  })
                }
                className="w-full accent-indigo-500"
              />
            </label>
          </>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] text-white/45">天空颜色</span>
        <input
          type="color"
          value={settings.skyColor}
          onChange={(e) => onPatch({ skyColor: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-white/10 bg-transparent"
        />
      </label>

      <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
        <ToggleRow
          label="角色标签"
          checked={settings.showLabels}
          onCheckedChange={(showLabels) => onPatch({ showLabels })}
        />
        <ToggleRow
          label="网格吸附"
          checked={settings.gridSnap}
          onCheckedChange={(gridSnap) => onPatch({ gridSnap })}
        />
        <ToggleRow
          label="地面"
          checked={settings.ground.visible}
          onCheckedChange={(visible) =>
            onPatch({ ground: { ...settings.ground, visible } })
          }
        />
        {settings.ground.visible ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/45">透明度 {settings.ground.opacity.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.ground.opacity}
                onChange={(e) =>
                  onPatch({
                    ground: { ...settings.ground, opacity: parseFloat(e.target.value) },
                  })
                }
                className="w-full accent-indigo-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/45">高度</span>
              <AxisInput
                label="Y"
                value={settings.ground.height}
                onChange={(v) => onPatch({ ground: { ...settings.ground, height: v } })}
              />
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}
