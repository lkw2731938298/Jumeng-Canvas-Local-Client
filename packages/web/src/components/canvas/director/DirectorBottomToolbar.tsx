"use client";

import { useState } from "react";
import {
  Camera,
  Globe,
  Maximize2,
  Move3d,
  Plus,
  Rotate3d,
  Scaling,
  UserPlus,
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

const TRANSFORM_MODES: { mode: DirectorTransformMode; label: string; icon: React.ReactNode }[] = [
  { mode: "translate", label: "移动", icon: <Move3d className="h-4 w-4" /> },
  { mode: "rotate", label: "旋转", icon: <Rotate3d className="h-4 w-4" /> },
  { mode: "scale", label: "缩放", icon: <Scaling className="h-4 w-4" /> },
];

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
        active
          ? "bg-indigo-500/35 text-white"
          : "text-white/65 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export function DirectorBottomToolbar({
  transformMode,
  aspectRatio,
  fullscreen,
  uploadingModel,
  onTransformModeChange,
  onUploadModel,
  onAddBuiltinModel,
  onUploadPanorama,
  onAddCamera,
  onAspectRatioChange,
  onScreenshot,
  onToggleFullscreen,
}: {
  transformMode: DirectorTransformMode;
  aspectRatio: DirectorAspectRatio;
  fullscreen: boolean;
  uploadingModel?: boolean;
  onTransformModeChange: (mode: DirectorTransformMode) => void;
  onUploadModel: () => void;
  onAddBuiltinModel: (builtinId: string) => void;
  onUploadPanorama: () => void;
  onAddCamera: () => void;
  onAspectRatioChange: (ratio: DirectorAspectRatio) => void;
  onScreenshot: () => void;
  onToggleFullscreen: () => void;
}) {
  const [pointerOpen, setPointerOpen] = useState(false);
  const activeTransform = TRANSFORM_MODES.find((m) => m.mode === transformMode) ?? TRANSFORM_MODES[0];

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 px-2 py-1.5 shadow-2xl"
        style={{
          background: "rgba(18, 18, 28, 0.92)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* 指针 */}
        <DropdownMenu open={pointerOpen} onOpenChange={setPointerOpen}>
          <DropdownMenuTrigger
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors outline-none ${
              pointerOpen ? "bg-indigo-500/35 text-white" : "text-white/65 hover:bg-white/10 hover:text-white"
            }`}
            title="指针工具"
          >
            {activeTransform.icon}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="min-w-[140px] border-white/10 bg-[rgba(18,18,28,0.98)] text-white/90">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px]">变换模式</DropdownMenuLabel>
              {TRANSFORM_MODES.map((item) => (
                <DropdownMenuItem
                  key={item.mode}
                  onClick={() => {
                    onTransformModeChange(item.mode);
                    setPointerOpen(false);
                  }}
                  className="gap-2 text-xs focus:bg-white/10 focus:text-white"
                >
                  {item.icon}
                  {item.label}
                  {transformMode === item.mode ? <span className="ml-auto text-indigo-300">✓</span> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 添加模型 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 outline-none transition-colors hover:bg-white/10 hover:text-white"
            title="添加模型"
          >
            <UserPlus className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="min-w-[180px] border-white/10 bg-[rgba(18,18,28,0.98)] text-white/90">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px]">添加模型</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={onUploadModel}
                className="gap-2 text-xs focus:bg-white/10 focus:text-white"
                disabled={uploadingModel}
              >
                <Plus className="h-3.5 w-3.5" />
                {uploadingModel ? "上传中…" : "本地上传 GLB/GLTF"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {DIRECTOR_BUILTIN_MODELS.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => onAddBuiltinModel(model.id)}
                  className="text-xs focus:bg-white/10 focus:text-white"
                >
                  {model.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 全景图 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 outline-none transition-colors hover:bg-white/10 hover:text-white"
            title="全景图"
          >
            <Globe className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="min-w-[160px] border-white/10 bg-[rgba(18,18,28,0.98)] text-white/90">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onUploadPanorama} className="text-xs focus:bg-white/10 focus:text-white">
                从资产选择全景图
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 添加摄像机 */}
        <ToolButton title="添加摄像机" onClick={onAddCamera}>
          <Video className="h-4 w-4" />
        </ToolButton>

        {/* 画幅比例 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 outline-none transition-colors hover:bg-white/10 hover:text-white"
            title="画幅比例"
          >
            <AspectRatioIcon ratioId={aspectRatio} className="text-white/80" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="min-w-[120px] border-white/10 bg-[rgba(18,18,28,0.98)] text-white/90">
            <DropdownMenuGroup>
              {DIRECTOR_ASPECT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.id}
                  onClick={() => onAspectRatioChange(opt.id)}
                  className="gap-2 text-xs focus:bg-white/10 focus:text-white"
                >
                  <AspectRatioIcon ratioId={opt.id} />
                  {opt.label}
                  {aspectRatio === opt.id ? <span className="ml-auto text-indigo-300">✓</span> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 截图 */}
        <ToolButton title="截图（创建机位并拍照）" onClick={onScreenshot}>
          <Camera className="h-4 w-4" />
        </ToolButton>

        {/* 全屏 */}
        <ToolButton title={fullscreen ? "退出全屏" : "全屏"} onClick={onToggleFullscreen}>
          <Maximize2 className="h-4 w-4" />
        </ToolButton>
      </div>
    </div>
  );
}
