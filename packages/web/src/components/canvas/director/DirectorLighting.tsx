"use client";

import type { LightingPresetId } from "@/lib/director/lightingPresets";
import { getLightingPreset } from "@/lib/director/lightingPresets";

export function DirectorLighting({ presetId }: { presetId: LightingPresetId }) {
  const preset = getLightingPreset(presetId);

  return (
    <>
      <ambientLight intensity={preset.ambient} />
      {preset.lights.map((light, index) => (
        <directionalLight
          key={`${presetId}-${index}`}
          position={light.position}
          intensity={light.intensity}
          color={light.color}
        />
      ))}
    </>
  );
}
