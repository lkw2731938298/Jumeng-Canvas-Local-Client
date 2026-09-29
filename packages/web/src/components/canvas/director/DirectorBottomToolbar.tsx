"use client";

/**
 * 导演台 · 底部控制坞（控制台版）。
 * 分四组：变换模式分段（带快捷键提示）｜添加（模型 / 全景 / 机位）｜取景（画幅 / 构图线）｜拍摄 + 专注模式。
 */

import type { ReactNode } from "react";
import {
  Focus,
  Globe,
  Grid3x3,
  Minimize2,
  Move3d,
  Plus,
  Rotate3d,
  Scaling,
  Upload,
  Video,
} from "lucide-react";
import type { DirectorAspectRatio, DirectorTransformMode } from "@/types/director-scene";
import { DIRECTOR_ASPECT_OPTIONS } from "@/lib/director/aspectRatio";
import { DIRECTOR_BUILTIN_MODELS } from "@/lib/director/builtinModels";
import { AspectRatioIcon } from "@/components/canvas/AspectRatioIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GLASS_PANEL } from "./directorUi";

const TRANSFORM_MODES: { mode: DirectorTransformMode; label: string; key: string; icon: ReactNode }[] = [
  { mode: "translate", label: "移动", key: "V", icon: <Move3d className="h-3.5 w-3.5" /> },
  { mode: "rotate", label: "旋转", key: "R", icon: <Rotate3d className="h-3.5 w-3.5" /> },
  { mode: "scale", label: "缩放", key: "S", icon: <Scaling className="h-3.5 w-3.5" /> },
];

const MENU_CLASS = "border-white/10 bg-[rgba(16,16,26,0.98)] text-white/90";
const MENU_ITEM = "gap-2 text-xs focus:bg-white/10 focus:text-white";
const ICON_BTN =
  "flex h-9 w-9 items-center justify-center rounded-xl text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-white";

function Divider() {
  return <span className="mx-1 h-6 w-px bg-white/10" />;
}

export function DirectorBottomToolbar({
  transformMode,
  aspectRatio,
  focusMode,
  showGuides,
  uploadingModel,
  onTransformModeChange,
  onUploadModel,
  onAddBuiltinModel,
  onUploadPanorama,
  onAddCamera,
  onAspectRatioChange,
  onToggleGuides,
  onScreenshot,
  onToggleFocus,
}: {
  transformMode: DirectorTransformMode;
  aspectRatio: DirectorAspectRatio;
  focusMode: boolean;
  showGuides: boolean;
  uploadingModel?: boolean;
  onTransformModeChange: (mode: DirectorTransformMode) => void;
  onUploadModel: () => void;
  onAddBuiltinModel: (builtinId: string) => void;
  onUploadPanorama: () => void;
  onAddCamera: () => void;
  onAspectRatioChange: (ratio: DirectorAspectRatio) => void;
  onToggleGuides: () => void;
  onScreenshot: () => void;
  onToggleFocus: () => void;
}) {
  const aspectLabel = DIRECTOR_ASPECT_OPTIONS.find((o) => o.id === aspectRatio)?.label ?? aspectRatio;

  return (
    <div className={`pointer-events-auto flex items-center gap-1 px-2 py-1.5 ${GLASS_PANEL}`}>
      {/* 变换模式 */}
      <div className="flex rounded-xl bg-black/30 p-0.5">
        {TRANSFORM_MODES.map((item) => {
          const active = transformMode === item.mode;
          return (
            <button
              key={item.mode}
              type="button"
              title={`${item.label}（${item.key}）`}
              onClick={() => onTransformModeChange(item.mode)}
              className={`flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11px] transition-all ${
                active
                  ? "bg-gradient-to-b from-indigo-400/40 to-indigo-500/25 text-white shadow-inner"
                  : "text-white/50 hover:text-white/85"
              }`}
            >
              {item.icon}
              {item.label}
              <kbd className={`rounded px-1 font-mono text-[9px] ${active ? "bg-white/15 text-white/80" : "bg-white/[0.06] text-white/30"}`}>
                {item.key}
              </kbd>
            </button>
          );
        })}
      </div>

      <Divider />

      {/* 添加模型 */}
      <DropdownMenu>
        <DropdownMenuTrigger className={ICON_BTN} title="添加模型">
          <Plus className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" className={`min-w-[180px] ${MENU_CLASS}`}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] text-white/40">添加模型</DropdownMenuLabel>
            {DIRECTOR_BUILTIN_MODELS.map((model) => (
              <DropdownMenuItem key={model.id} onClick={() => onAddBuiltinModel(model.id)} className={MENU_ITEM}>
                {model.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onUploadModel} disabled={uploadingModel} className={MENU_ITEM}>
            <Upload className="h-3.5 w-3.5" />
            {uploadingModel ? "上传中…" : "本地上传 GLB/GLTF"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" className={ICON_BTN} title="从素材选择全景背景" onClick={onUploadPanorama}>
        <Globe className="h-4 w-4" />
      </button>
      <button type="button" className={ICON_BTN} title="在当前视角新建机位" onClick={onAddCamera}>
        <Video className="h-4 w-4" />
      </button>

      <Divider />

      {/* 画幅 + 构图线 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[11px] text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white"
          title="画幅比例"
        >
          <AspectRatioIcon ratioId={aspectRatio} className="text-white/80" />
          <span className="font-mono">{aspectLabel}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" className={`min-w-[120px] ${MENU_CLASS}`}>
          <DropdownMenuGroup>
            {DIRECTOR_ASPECT_OPTIONS.map((opt) => (
              <DropdownMenuItem key={opt.id} onClick={() => onAspectRatioChange(opt.id)} className={MENU_ITEM}>
                <AspectRatioIcon ratioId={opt.id} />
                {opt.label}
                {aspectRatio === opt.id ? <span className="ml-auto text-indigo-300">✓</span> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        title="构图辅助线（G）"
        onClick={onToggleGuides}
        className={`${ICON_BTN} ${showGuides ? "!bg-indigo-500/30 !text-white" : ""}`}
      >
        <Grid3x3 className="h-4 w-4" />
      </button>

      <Divider />

      {/* 拍摄：快门按钮 */}
      <button
        type="button"
        title="拍摄当前视角（自动创建机位并截图）"
        onClick={onScreenshot}
        className="group relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/70 transition-transform hover:scale-105 active:scale-95"
      >
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-red-400 to-rose-600 shadow-[0_0_16px_rgba(244,63,94,0.55)] transition-all group-hover:h-6 group-hover:w-6" />
      </button>

      <button
        type="button"
        title={focusMode ? "退出专注模式（Tab）" : "专注模式：隐藏面板（Tab）"}
        onClick={onToggleFocus}
        className={`${ICON_BTN} ml-1 ${focusMode ? "!bg-white/15 !text-white" : ""}`}
      >
        {focusMode ? <Minimize2 className="h-4 w-4" /> : <Focus className="h-4 w-4" />}
      </button>
    </div>
  );
}
