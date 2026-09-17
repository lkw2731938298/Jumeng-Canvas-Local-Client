import type { ComposerPromptToolConfig } from "@/lib/canvas/renderToolPrompt";
import { buildLightingPrompt, type LightingRuntime } from "@/lib/canvas/renderToolPrompt";
import {
  dedupeSegments,
  stripAppendSuffixes,
  type AppendSuffixSpec,
} from "@/lib/canvas/resolveMultiAnglePrompt";

function splitByJoiner(prompt: string, joiner = "，"): string[] {
  return prompt
    .split(joiner)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinSegments(segments: string[], joiner = "，"): string {
  return segments.filter(Boolean).join(joiner);
}

/** Remove previously composed lighting segments from a dirty prompt. */
export function stripLightingComposerSegments(
  prompt: string,
  composer: ComposerPromptToolConfig
): string {
  const joiner = composer.static?.j ?? "，";
  let segments = splitByJoiner(prompt, joiner);

  const staticC = composer.static?.c?.trim();
  const staticBase = (composer.static?.base ?? composer.static?.b ?? "").trim();
  const dirTexts = new Set(
    Object.values(composer.lookups?.dir ?? {})
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const rimOn = (composer.lookups?.rim?.on ?? "").trim();
  const smartOn = (composer.lookups?.smart?.on ?? "").trim();
  const brightPrefix = (composer.formats?.bright ?? "光照强度").split("{brightness}")[0]?.trim();

  segments = segments.filter((seg) => {
    if (staticC && seg === staticC) return false;
    if (staticBase && seg === staticBase) return false;
    if (dirTexts.has(seg)) return false;
    if (rimOn && seg === rimOn) return false;
    if (smartOn && seg === smartOn) return false;
    if (brightPrefix && seg.startsWith(brightPrefix)) return false;
    if (seg.includes("光源") && (seg.includes("暖") || seg.includes("冷") || seg.includes("色"))) return false;
    return true;
  });

  return joinSegments(segments, joiner);
}

export function stripLightingPromptNoise(
  prompt: string,
  appendSuffixes: AppendSuffixSpec[],
  composer?: ComposerPromptToolConfig
): string {
  let text = stripAppendSuffixes(prompt, appendSuffixes);
  if (composer) {
    text = stripLightingComposerSegments(text, composer);
  }
  return dedupeSegments(text, composer?.static?.j ?? "，");
}

export function buildLightingPromptFromConfig(
  composer: ComposerPromptToolConfig,
  runtime: LightingRuntime
): string {
  return buildLightingPrompt(composer, runtime);
}
