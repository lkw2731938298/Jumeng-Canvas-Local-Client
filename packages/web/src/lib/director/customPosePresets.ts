/**
 * 用户自定义动作模板：存浏览器 localStorage，跨项目复用。
 * 与内置 POSE_PRESETS 并列，仅影响人模 bonePose。
 */

import type { DirectorBonePose } from "@jumeng-canvas/shared";

const STORAGE_KEY = "jumeng-director-custom-poses";
const MAX_CUSTOM = 32;

export interface CustomPosePreset {
  id: string;
  label: string;
  pose: DirectorBonePose;
  createdAt: number;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizePose(raw: unknown): DirectorBonePose {
  if (!raw || typeof raw !== "object") return {};
  const out: DirectorBonePose = {};
  for (const [bone, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length < 3) continue;
    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    if (![x, y, z].every((n) => Number.isFinite(n))) continue;
    out[bone] = [x, y, z];
  }
  return out;
}

export function loadCustomPosePresets(): CustomPosePreset[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list: CustomPosePreset[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const label = typeof rec.label === "string" ? rec.label.trim() : "";
      if (!id || !label) continue;
      list.push({
        id,
        label: label.slice(0, 16),
        pose: sanitizePose(rec.pose),
        createdAt: typeof rec.createdAt === "number" ? rec.createdAt : Date.now(),
      });
    }
    return list;
  } catch {
    return [];
  }
}

function persist(list: CustomPosePreset[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM)));
  } catch {
    /* quota / private mode */
  }
}

/** 把当前关节姿势存为自定义模板 */
export function saveCustomPosePreset(label: string, pose: DirectorBonePose): CustomPosePreset | null {
  const name = label.trim().slice(0, 16);
  if (!name) return null;
  const list = loadCustomPosePresets();
  if (list.length >= MAX_CUSTOM) return null;
  const preset: CustomPosePreset = {
    id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    label: name,
    pose: structuredClone(sanitizePose(pose)),
    createdAt: Date.now(),
  };
  list.unshift(preset);
  persist(list);
  return preset;
}

export function deleteCustomPosePreset(id: string): CustomPosePreset[] {
  const next = loadCustomPosePresets().filter((p) => p.id !== id);
  persist(next);
  return next;
}

export function renameCustomPosePreset(id: string, label: string): CustomPosePreset[] {
  const name = label.trim().slice(0, 16);
  if (!name) return loadCustomPosePresets();
  const next = loadCustomPosePresets().map((p) => (p.id === id ? { ...p, label: name } : p));
  persist(next);
  return next;
}
