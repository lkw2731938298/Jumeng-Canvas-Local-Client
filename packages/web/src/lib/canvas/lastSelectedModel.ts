import type { ModelCategory } from "@/lib/canvas/nodeModelRouting";

const STORAGE_KEY = "jm_canvas_last_model_v1";

type LastModelMap = Partial<Record<ModelCategory, string>>;

function readMap(): LastModelMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LastModelMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: LastModelMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getLastSelectedModel(category: ModelCategory): string | null {
  const name = readMap()[category];
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function setLastSelectedModel(category: ModelCategory, modelName: string) {
  const trimmed = modelName.trim();
  if (!trimmed) return;
  const map = readMap();
  map[category] = trimmed;
  writeMap(map);
}

export function pickModelOption(
  modelName: string | null | undefined,
  options: ReadonlyArray<{ value: string }>,
  fallback = ""
): string {
  if (modelName && options.some((o) => o.value === modelName)) return modelName;
  return fallback;
}

export function resolvePreferredModel(
  category: ModelCategory | null,
  options: ReadonlyArray<{ value: string }>
): string {
  const listFallback = options[0]?.value ?? "";
  if (!category) return listFallback;
  const last = getLastSelectedModel(category);
  return pickModelOption(last, options, listFallback);
}
