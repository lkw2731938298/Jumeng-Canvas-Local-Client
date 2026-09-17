import {
  buildMaterialSlots,
  resolveAllReferences,
  resolveMentionsInPrompt,
} from "@/lib/canvas/nodeMaterialSlots";
import {
  extractSubjectPromptForMultiAngle,
  normalizeCanvasBaseForComposer,
  renderComposerPrompt,
  type ComposerPromptToolConfig,
  type MultiAngleRuntime,
} from "@/lib/canvas/renderToolPrompt";
import type { Edge, Node } from "@xyflow/react";

export interface AppendSuffixSpec {
  content: string;
  joiner?: string;
}

const DEFAULT_H_PREFIX = "水平环绕";
const DEFAULT_E_PREFIX = "俯仰";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimJoiners(text: string, joiner = "，"): string {
  const pattern = new RegExp(`^(?:${escapeRegExp(joiner)}\\s*)+|(?:\\s*${escapeRegExp(joiner)})+$`, "g");
  return text.replace(pattern, "").trim();
}

/** Remove canvas top-menu append texts (whole phrase, may contain commas). */
export function stripAppendSuffixes(prompt: string, appendSuffixes: AppendSuffixSpec[]): string {
  let text = prompt.trim();
  for (const item of appendSuffixes) {
    const content = item.content.trim();
    if (!content || !text.includes(content)) continue;
    const joiner = item.joiner ?? "，";
    const wrapped = new RegExp(
      `(?:${escapeRegExp(joiner)}\\s*)?${escapeRegExp(content)}(?:\\s*${escapeRegExp(joiner)})?`,
      "g"
    );
    text = trimJoiners(text.replace(wrapped, joiner), joiner);
  }
  return text.trim();
}

function splitByJoiner(prompt: string, joiner = "，"): string[] {
  return prompt
    .split(joiner)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinSegments(segments: string[], joiner = "，"): string {
  return segments.filter(Boolean).join(joiner);
}

/** Remove previously composed multi-angle segments from a dirty prompt. */
export function stripMultiAngleComposerSegments(
  prompt: string,
  composer: ComposerPromptToolConfig
): string {
  const joiner = composer.static?.j ?? "，";
  let segments = splitByJoiner(prompt, joiner);

  const staticC = composer.static?.c?.trim();
  const staticBase = (composer.static?.base ?? composer.static?.b ?? "").trim();
  const shotTexts = new Set(
    Object.values(composer.lookups?.s ?? {})
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const hPrefix = (composer.formats?.h ?? DEFAULT_H_PREFIX).split("{azimuth}")[0]?.trim();
  const ePrefix = (composer.formats?.e ?? DEFAULT_E_PREFIX).split("{elevation}")[0]?.trim();

  segments = segments.filter((seg) => {
    if (staticC && seg === staticC) return false;
    if (staticBase && seg === staticBase) return false;
    if (shotTexts.has(seg)) return false;
    if (hPrefix && seg.startsWith(hPrefix)) return false;
    if (ePrefix && seg.startsWith(ePrefix)) return false;
    return true;
  });

  return joinSegments(segments, joiner);
}

/** Remove canvas top-menu append texts and previously composed multi-angle segments. */
export function stripToolPromptNoise(
  prompt: string,
  appendSuffixes: AppendSuffixSpec[],
  composer?: ComposerPromptToolConfig
): string {
  let text = stripAppendSuffixes(prompt, appendSuffixes);
  if (composer) {
    text = stripMultiAngleComposerSegments(text, composer);
  }
  return dedupeSegments(text, composer?.static?.j ?? "，");
}

/** Collapse repeated comma-separated segments (e.g. same line pasted 3×). */
export function dedupeSegments(prompt: string, joiner = "，"): string {
  const seen = new Set<string>();
  const segments = splitByJoiner(prompt, joiner).filter((seg) => {
    if (seen.has(seg)) return false;
    seen.add(seg);
    return true;
  });
  return joinSegments(segments, joiner);
}

/** Resolve @mentions and prefer upstream text node when image prompt is empty or mention-only. */
export async function resolveMultiAngleBasePrompt(
  projectId: string,
  nodeId: string,
  rawPrompt: string,
  edges: Edge[],
  nodes: Node[],
  appendSuffixes: AppendSuffixSpec[],
  composer?: ComposerPromptToolConfig
): Promise<string> {
  const baseMode = composer?.static?.baseMode ?? "admin";
  if (baseMode === "admin") return "";

  const slots = buildMaterialSlots(nodeId, edges, nodes);
  const references = await resolveAllReferences(projectId, slots, nodes, edges);
  const { resolvedPrompt } = resolveMentionsInPrompt(rawPrompt, references);

  let base = stripToolPromptNoise(resolvedPrompt, appendSuffixes, composer);
  base = dedupeSegments(base, composer?.static?.j ?? "，");

  const textRefs = references.filter((r) => r.type === "text" && r.content?.trim());
  const baseWithoutMentions = base.replace(/@[^\s@，,、]+/g, "").trim();

  if (!baseWithoutMentions && textRefs.length === 1) {
    base = textRefs[0].content!.trim();
  } else if (textRefs.length === 1) {
    const only = textRefs[0].content!.trim();
    if (base === only || baseWithoutMentions === only) {
      base = only;
    }
  }

  if (composer) {
    return normalizeCanvasBaseForComposer(base, composer);
  }
  return extractSubjectPromptForMultiAngle(base).trim();
}

export function buildMultiAnglePrompt(
  composer: ComposerPromptToolConfig,
  runtime: MultiAngleRuntime
): string {
  return renderComposerPrompt(composer, runtime);
}
