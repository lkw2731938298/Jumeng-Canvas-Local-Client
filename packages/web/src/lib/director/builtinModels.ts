import type { DirectorObjectKind, DirectorObjectShape } from "@/types/director-scene";

export interface DirectorBuiltinModel {
  id: string;
  label: string;
  kind: DirectorObjectKind;
  shape: DirectorObjectShape;
  description?: string;
  /** 可选静态 GLB（public 路径） */
  glbPath?: string;
}

/** 系统自带模型（几何体 + 关节可动人模） */
export const DIRECTOR_BUILTIN_MODELS: DirectorBuiltinModel[] = [
  {
    id: "mannequin_male",
    label: "人体模型（男性 · 关节可动）",
    kind: "character",
    shape: "model",
    description: "Mixamo 骨骼人模，支持关节拖拽与姿势预设",
    glbPath: "/director/models/mannequin.glb",
  },
  {
    id: "mannequin_female",
    label: "人体模型（女性 · 关节可动）",
    kind: "character",
    shape: "model",
    description: "Mixamo 骨骼人模，支持关节拖拽与姿势预设",
    glbPath: "/director/models/mannequin.glb",
  },
  { id: "geo_box", label: "立方体", kind: "prop", shape: "box" },
  { id: "geo_sphere", label: "球体", kind: "prop", shape: "sphere" },
  { id: "geo_cylinder", label: "圆柱", kind: "prop", shape: "cylinder" },
  { id: "geo_cone", label: "圆锥", kind: "prop", shape: "cone" },
  { id: "geo_plane", label: "平面", kind: "prop", shape: "plane" },
];

export function findBuiltinModel(id: string): DirectorBuiltinModel | undefined {
  return DIRECTOR_BUILTIN_MODELS.find((m) => m.id === id);
}
