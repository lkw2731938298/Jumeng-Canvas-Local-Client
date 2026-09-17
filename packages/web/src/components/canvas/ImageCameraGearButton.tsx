"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  CAMERA_APERTURES,
  CAMERA_BODIES,
  CAMERA_FOCAL_LENGTHS,
  CAMERA_LENSES,
  cycleOption,
  type CameraGearOption,
  type CameraGearState,
} from "@/lib/canvas/cameraGearCatalog";

interface ImageCameraGearButtonProps {
  value: CameraGearState;
  onChange: (next: CameraGearState) => void;
  className?: string;
}

/** 工具栏镜头图标：透明底 + 高光镜头 */
function CameraLensMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="11" fill="#0c0c12" stroke="#8a8a98" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="8.2" fill="url(#cameraLensGrad)" />
      <circle cx="12.8" cy="12.4" r="2.4" fill="white" opacity="0.55" />
      <circle cx="19.2" cy="19.6" r="1.2" fill="white" opacity="0.28" />
      <defs>
        <radialGradient id="cameraLensGrad" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#2a3550" />
          <stop offset="55%" stopColor="#0a0c14" />
          <stop offset="100%" stopColor="#050508" />
        </radialGradient>
      </defs>
    </svg>
  );
}

function GearColumn({
  options,
  valueId,
  onCycle,
  bottomLabel,
  ariaLabel,
  renderPreview,
}: {
  options: CameraGearOption[];
  valueId: string;
  onCycle: (dir: 1 | -1) => void;
  bottomLabel: string;
  ariaLabel: string;
  renderPreview: (opt: CameraGearOption) => ReactNode;
}) {
  const current = options.find((o) => o.id === valueId) ?? options[0]!;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 px-1">
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-purple-500/15 hover:text-white"
        aria-label={`上一${ariaLabel}`}
        onClick={() => onCycle(-1)}
      >
        <ChevronUp className="size-4" strokeWidth={2} />
      </button>
      <div className="flex h-[72px] w-full max-w-[88px] flex-col items-center justify-center rounded-xl border border-white/12 bg-[#1a1a28] px-1.5 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.12)]">
        {renderPreview(current)}
      </div>
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-purple-500/15 hover:text-white"
        aria-label={`下一${ariaLabel}`}
        onClick={() => onCycle(1)}
      >
        <ChevronDown className="size-4" strokeWidth={2} />
      </button>
      <p className="mt-0.5 max-w-full truncate px-0.5 text-center text-[11px] font-medium text-white/55">
        {bottomLabel}
      </p>
    </div>
  );
}

/**
 * 全能 G/Pro 官方稳定：工具栏摄像机按钮 → 机身/镜头/焦距/光圈面板
 */
export function ImageCameraGearButton({
  value,
  onChange,
  className,
}: ImageCameraGearButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      // 点到底栏其它菜单（参数 / 创作工具等）时不关：允许多面板同时打开
      if (
        t instanceof Element &&
        t.closest(".canvas-node-overlay") &&
        rootRef.current &&
        !rootRef.current.contains(t)
      ) {
        return;
      }
      if (rootRef.current && !rootRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const patch = useCallback(
    (partial: Partial<CameraGearState>) => onChange({ ...value, ...partial }),
    [onChange, value]
  );

  return (
    <div ref={rootRef} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        className={cn(
          "relative flex size-8 items-center justify-center rounded-md bg-transparent text-white/70 transition-colors",
          "hover:bg-purple-500/15 hover:text-white",
          open && "bg-purple-500/20 text-white"
        )}
        aria-label="摄像机"
        aria-expanded={open}
        title="摄像机设定"
        onClick={() => setOpen((v) => !v)}
      >
        <CameraLensMark className="size-[18px]" />
      </button>

      {open ? (
        <div
          className="absolute bottom-full left-1/2 z-40 mb-2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-purple-500/30 bg-[#14141f]/[0.98] text-white shadow-2xl backdrop-blur-md ring-1 ring-white/10"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <h3 className="text-[15px] font-semibold tracking-wide text-white">摄像机</h3>
            <button
              type="button"
              className="flex size-7 items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex items-stretch gap-0 px-2 py-3">
            <GearColumn
              ariaLabel="相机"
              options={CAMERA_BODIES}
              valueId={value.cameraId}
              bottomLabel={
                CAMERA_BODIES.find((x) => x.id === value.cameraId)?.label ?? value.cameraId
              }
              onCycle={(dir) =>
                patch({ cameraId: cycleOption(CAMERA_BODIES, value.cameraId, dir) })
              }
              renderPreview={() => (
                <svg viewBox="0 0 48 36" className="h-9 w-11 text-white/80" aria-hidden>
                  <rect x="4" y="10" width="28" height="18" rx="2" fill="currentColor" opacity="0.85" />
                  <rect x="30" y="14" width="12" height="10" rx="1.5" fill="currentColor" opacity="0.7" />
                  <circle cx="16" cy="19" r="5" fill="#14141f" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="8" y="7" width="8" height="4" rx="1" fill="currentColor" opacity="0.55" />
                </svg>
              )}
            />
            <div className="w-px self-stretch bg-white/10" aria-hidden />
            <GearColumn
              ariaLabel="镜头"
              options={CAMERA_LENSES}
              valueId={value.lensId}
              bottomLabel={
                CAMERA_LENSES.find((x) => x.id === value.lensId)?.label ?? value.lensId
              }
              onCycle={(dir) =>
                patch({ lensId: cycleOption(CAMERA_LENSES, value.lensId, dir) })
              }
              renderPreview={() => (
                <svg viewBox="0 0 40 40" className="size-10 text-white/80" aria-hidden>
                  <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
                  <circle cx="20" cy="20" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                  <circle cx="20" cy="20" r="4" fill="currentColor" opacity="0.5" />
                </svg>
              )}
            />
            <div className="w-px self-stretch bg-white/10" aria-hidden />
            <GearColumn
              ariaLabel="焦距"
              options={CAMERA_FOCAL_LENGTHS}
              valueId={value.focalId}
              bottomLabel="mm"
              onCycle={(dir) =>
                patch({ focalId: cycleOption(CAMERA_FOCAL_LENGTHS, value.focalId, dir) })
              }
              renderPreview={(opt) => (
                <span className="text-[26px] font-semibold tabular-nums leading-none text-white">
                  {opt.label}
                </span>
              )}
            />
            <div className="w-px self-stretch bg-white/10" aria-hidden />
            <GearColumn
              ariaLabel="光圈"
              options={CAMERA_APERTURES}
              valueId={value.apertureId}
              bottomLabel={
                CAMERA_APERTURES.find((x) => x.id === value.apertureId)?.label ?? value.apertureId
              }
              onCycle={(dir) =>
                patch({ apertureId: cycleOption(CAMERA_APERTURES, value.apertureId, dir) })
              }
              renderPreview={() => (
                <svg viewBox="0 0 40 40" className="size-9 text-white/75" aria-hidden>
                  <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  {[0, 60, 120, 180, 240, 300].map((deg) => (
                    <line
                      key={deg}
                      x1="20"
                      y1="20"
                      x2={20 + Math.cos((deg * Math.PI) / 180) * 11}
                      y2={20 + Math.sin((deg * Math.PI) / 180) * 11}
                      stroke="currentColor"
                      strokeWidth="1.2"
                      opacity="0.75"
                    />
                  ))}
                  <circle cx="20" cy="20" r="3" fill="currentColor" opacity="0.45" />
                </svg>
              )}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-white/10 px-3.5 py-2.5">
            <span className="text-[13px] text-white/70">{value.enabled ? "开启" : "关闭"}</span>
            <Switch
              checked={value.enabled}
              onCheckedChange={(checked) => patch({ enabled: checked })}
              className="data-checked:bg-black data-unchecked:bg-white/25 [&_[data-slot=switch-thumb]]:bg-white"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
