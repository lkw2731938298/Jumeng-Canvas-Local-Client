"use client";

import {
  getLightingPreset,
  resolveLightingLights,
  type DirectorLightingState,
  type LightingPresetId,
} from "@/lib/director/lightingPresets";

export function DirectorLighting({
  presetId,
  yawDeg = 0,
  pitchDeg = 0,
}: {
  presetId: LightingPresetId | string;
  yawDeg?: number;
  pitchDeg?: number;
} & Partial<Pick<DirectorLightingState, "yawDeg" | "pitchDeg">>) {
  const preset = getLightingPreset(presetId);
  const lights = resolveLightingLights(preset, yawDeg, pitchDeg);

  return (
    <>
      <ambientLight intensity={preset.ambient} />
      {lights.map((light, index) => (
        <directionalLight
          key={`${presetId}-${index}-${yawDeg}-${pitchDeg}`}
          position={light.position}
          intensity={light.intensity}
          color={light.color}
        />
      ))}
    </>
  );
}
