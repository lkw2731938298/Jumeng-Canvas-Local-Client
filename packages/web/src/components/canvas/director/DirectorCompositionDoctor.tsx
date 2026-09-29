"use client";

/**
 * 构图医生：分析当前机位，列出问题与一键修正。
 */

import { CheckCircle2, Info, Stethoscope, Wrench } from "lucide-react";
import { analyzeCameraComposition, classicMediumFix } from "@/lib/director/compositionDoctor";
import { framingToCameraFields } from "@/lib/director/cameraFraming";
import { pickFramingSubjects } from "@/lib/director/smartShots";
import type { DirectorAspectRatio, DirectorObject } from "@/types/director-scene";
import { PanelSection } from "./directorUi";

type CameraFields = ReturnType<typeof framingToCameraFields>;

export function DirectorCompositionDoctor({
  camera,
  objects,
  aspectRatio,
  onApplyFix,
}: {
  camera: DirectorObject | null;
  objects: DirectorObject[];
  aspectRatio: DirectorAspectRatio;
  onApplyFix: (fields: CameraFields, tipTitle: string) => void;
}) {
  if (!camera || camera.kind !== "camera") {
    return (
      <PanelSection title="构图医生">
        <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/40">
          <Stethoscope className="mx-auto mb-1.5 h-4 w-4 text-white/25" />
          选中一台摄像机后，这里会诊断取景问题。
        </div>
      </PanelSection>
    );
  }

  const tips = analyzeCameraComposition(camera, objects, aspectRatio);
  const subject = pickFramingSubjects(objects)[0] ?? null;

  return (
    <PanelSection
      title="构图医生"
      extra={<span className="truncate text-[9px] normal-case tracking-normal text-white/30">{camera.name}</span>}
    >
      <ul className="flex flex-col gap-1.5">
        {tips.map((tip) => (
          <li
            key={tip.id}
            className={`rounded-xl border px-2.5 py-2 ${
              tip.severity === "ok"
                ? "border-emerald-400/20 bg-emerald-500/10"
                : tip.severity === "warn"
                  ? "border-amber-400/25 bg-amber-500/10"
                  : "border-white/[0.06] bg-black/20"
            }`}
          >
            <div className="flex items-start gap-2">
              {tip.severity === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
              ) : tip.severity === "warn" ? (
                <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              ) : (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300/80" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-white/90">{tip.title}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-white/45">{tip.detail}</p>
                {tip.fix ? (
                  <button
                    type="button"
                    onClick={() => onApplyFix(tip.fix!, tip.title)}
                    className="mt-1.5 rounded-lg bg-white/[0.08] px-2 py-1 text-[10px] text-white/75 hover:bg-indigo-500/30 hover:text-indigo-100"
                  >
                    {tip.fixLabel ?? "一键修正"}
                  </button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {subject ? (
        <button
          type="button"
          onClick={() => onApplyFix(framingToCameraFields(classicMediumFix(subject)), "经典中景")}
          className="mt-1 w-full rounded-xl border border-white/[0.06] bg-white/[0.03] py-2 text-[10px] text-white/50 hover:border-indigo-400/30 hover:text-indigo-100"
        >
          重置为经典中景（相对 {subject.name}）
        </button>
      ) : null}
    </PanelSection>
  );
}
