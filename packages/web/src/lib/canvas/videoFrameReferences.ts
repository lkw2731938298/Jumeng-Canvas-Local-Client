import type { CanvasModel } from "@/lib/api/models";
import type { GenerationReference } from "@/lib/canvas/nodeMaterialSlots";
import {
  extractMentionLabelsInOrder,
  findReferenceByMentionLabel,
} from "@/lib/canvas/nodeMaterialSlots";

/** Models that only accept a first frame (no last frame). */
const FIRST_FRAME_ONLY_MODELS = new Set(["happyhorse_i2v", "ltx_23_i2v"]);

export interface VideoFrameInputSpec {
  isFrameModel: boolean;
  supportsLastFrame: boolean;
}

export interface I2vFrameCollection {
  references: GenerationReference[];
  first: GenerationReference | null;
  last: GenerationReference | null;
  /** Image refs resolved after applying mention / upstream order (before trimming to 2). */
  orderedImages: GenerationReference[];
}

function modelCapabilities(model: CanvasModel): string[] {
  const caps = model.parameters?.capabilities;
  return Array.isArray(caps) ? caps.map(String) : [];
}

function modelVideoMode(model: CanvasModel): string | null {
  const mode = model.parameters?.videoMode;
  return typeof mode === "string" ? mode : null;
}

function specFromModelRecord(model: CanvasModel): VideoFrameInputSpec | null {
  if (model.category !== "video") return null;

  const caps = modelCapabilities(model);
  const mode = modelVideoMode(model);
  const isFrameModel =
    mode === "i2v" ||
    caps.includes("first_frame_to_video") ||
    caps.includes("start_end_to_video");

  if (!isFrameModel) {
    return { isFrameModel: false, supportsLastFrame: false };
  }

  const supportsLastFrame =
    caps.includes("start_end_to_video") && !FIRST_FRAME_ONLY_MODELS.has(model.name);

  return { isFrameModel: true, supportsLastFrame };
}

function specFromModelName(modelName: string): VideoFrameInputSpec | null {
  if (!modelName.endsWith("_i2v")) return null;
  return {
    isFrameModel: true,
    supportsLastFrame: !FIRST_FRAME_ONLY_MODELS.has(modelName),
  };
}

/** Whether the selected video model uses first / last frame inputs (I2V). */
export function getVideoFrameInputSpec(
  modelName: string,
  apiModels?: CanvasModel[]
): VideoFrameInputSpec | null {
  const model = apiModels?.find((m) => m.name === modelName);
  if (model) return specFromModelRecord(model);
  return specFromModelName(modelName);
}

/** Image references in the order @labels appear in the prompt (first occurrence per node). */
export function collectImageReferencesByMentionOrder(
  prompt: string,
  references: GenerationReference[]
): GenerationReference[] {
  const result: GenerationReference[] = [];
  const usedNodeIds = new Set<string>();
  const knownLabels = references.map((r) => r.label).filter(Boolean);

  for (const label of extractMentionLabelsInOrder(prompt, knownLabels)) {
    const ref = findReferenceByMentionLabel(label, references);
    if (!ref || ref.type !== "image" || !ref.url) continue;
    if (usedNodeIds.has(ref.nodeId)) continue;
    usedNodeIds.add(ref.nodeId);
    result.push(ref);
  }

  return result;
}

function fallbackUpstreamImageReferences(references: GenerationReference[]): GenerationReference[] {
  const result: GenerationReference[] = [];
  const usedNodeIds = new Set<string>();

  for (const ref of references) {
    if (ref.type !== "image" || !ref.url) continue;
    if (usedNodeIds.has(ref.nodeId)) continue;
    usedNodeIds.add(ref.nodeId);
    result.push(ref);
  }

  return result;
}

/**
 * For I2V models: map prompt @ order → first / last frame references.
 * Without @mentions, falls back to upstream image order.
 */
export function collectI2vFrameReferences(
  prompt: string,
  allReferences: GenerationReference[],
  supportsLastFrame: boolean
): I2vFrameCollection {
  const mentioned = collectImageReferencesByMentionOrder(prompt, allReferences);
  const orderedImages =
    mentioned.length > 0 ? mentioned : fallbackUpstreamImageReferences(allReferences);

  const first = orderedImages[0] ?? null;
  const last = supportsLastFrame ? (orderedImages[1] ?? null) : null;

  const references: GenerationReference[] = [];
  if (first) references.push(first);
  if (last && last.nodeId !== first?.nodeId) references.push(last);

  return { references, first, last, orderedImages };
}

export function validateI2vFrameReferences(
  collection: I2vFrameCollection,
  supportsLastFrame: boolean
): string | null {
  if (!collection.first?.url) {
    return "请在提示词中用 @ 引用首帧图片，或连接上游图片节点";
  }
  if (!supportsLastFrame && collection.orderedImages.length > 1) {
    return null;
  }
  return null;
}

export interface FramePreviewLabels {
  first: string | null;
  last: string | null;
  supportsLastFrame: boolean;
  missingFirst: boolean;
}

/** Sync preview of which slot labels map to first / last frame (no URL resolve). */
export function previewFrameLabels(
  prompt: string,
  slotLabels: Array<{ label: string; type: string }>,
  supportsLastFrame: boolean
): FramePreviewLabels {
  const imageSlots = slotLabels.filter((s) => s.type === "image");
  const knownLabels = imageSlots.map((s) => s.label);
  const labelsInPrompt = extractMentionLabelsInOrder(prompt, knownLabels);
  const slotByLabel = new Map(imageSlots.map((s) => [s.label, s]));

  let ordered: string[] = [];
  if (labelsInPrompt.length > 0) {
    for (const label of labelsInPrompt) {
      const exact = slotByLabel.get(label);
      if (exact) {
        ordered.push(exact.label);
        continue;
      }
      const ci = imageSlots.find((s) => s.label.toLowerCase() === label.toLowerCase());
      if (ci) ordered.push(ci.label);
    }
  } else {
    ordered = imageSlots.map((s) => s.label);
  }

  return {
    first: ordered[0] ?? null,
    last: supportsLastFrame ? (ordered[1] ?? null) : null,
    supportsLastFrame,
    missingFirst: !ordered[0],
  };
}
