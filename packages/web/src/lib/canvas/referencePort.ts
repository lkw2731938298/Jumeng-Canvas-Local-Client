import type { PortDefinition } from "@/types/node-registry";

/** Unified left-side port for upstream text / image / video / audio references. */
export const REFERENCE_INPUT_ID = "ref_in";

export const REFERENCE_INPUT_PORT: PortDefinition = {
  id: REFERENCE_INPUT_ID,
  type: "reference",
  label: "参考",
};

export function isReferenceTargetHandle(handle: string | null | undefined): boolean {
  if (!handle) return true;
  return handle === REFERENCE_INPUT_ID;
}
