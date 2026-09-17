import type { DirectorObject, DirectorObjectKind, DirectorObjectShape } from "@/types/director-scene";

const SHAPE_LABELS: Partial<Record<DirectorObjectShape, string>> = {
  sphere: "球",
  box: "立方体",
  cylinder: "圆柱",
  cone: "圆锥",
  plane: "平面",
  model: "角色",
  camera: "摄像机",
  capsule: "胶囊",
};

/** 用于编号分组的类别键（同类共享递增序号） */
export function directorObjectNameCategory(
  obj: Pick<DirectorObject, "kind" | "shape">
): string {
  if (obj.kind === "camera") return "camera";
  if (obj.kind === "character") return "character";
  return obj.shape;
}

/** 标签前缀，如球、立方体、角色 */
export function directorObjectCategoryLabel(
  spec: Pick<DirectorObject, "kind" | "shape">
): string {
  if (spec.kind === "camera") return "摄像机";
  if (spec.kind === "character") return "角色";
  return SHAPE_LABELS[spec.shape] ?? "道具";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在现有对象基础上分配下一个分类编号名，如 球1、球2 */
export function allocateDirectorObjectName(
  objects: DirectorObject[],
  spec: Pick<DirectorObject, "kind" | "shape">
): string {
  const label = directorObjectCategoryLabel(spec);
  const category = directorObjectNameCategory(spec);
  const numbered = new RegExp(`^${escapeRegExp(label)}(\\d+)$`);
  const legacySpaced = new RegExp(`^${escapeRegExp(label)}\\s+(\\d+)$`);

  let max = 0;
  for (const obj of objects) {
    if (directorObjectNameCategory(obj) !== category) continue;
    const trimmed = obj.name.trim();
    const match = trimmed.match(numbered) ?? trimmed.match(legacySpaced);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }

  return `${label}${max + 1}`;
}
