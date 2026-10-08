"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Mesh, MeshStandardMaterial, Texture, Vector3, type Object3D } from "three";
import { resolveStorageResourceUrl } from "@/lib/api/storageUrl";

const TARGET_HEIGHT = 1.75;

export interface CharacterGlbModelProps {
  url: string;
  directorObjectId: string;
  scaleMultiplier?: number;
  /** 归一化基准高度（米）：人物默认 1.75，GLB 道具传 1（最终高度 = 基准 × scaleMultiplier） */
  targetHeight?: number;
  /** 纯色 / 贴图色调 */
  color?: string;
  colorMap?: Texture | null;
}

function applyColorMap(root: Object3D, color: string, colorMap: Texture | null) {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as MeshStandardMaterial;
      if (!std || !("color" in std)) continue;
      // 有贴图：白底 + 哑光，避免金属度把贴纸打成灰白
      std.color.set(colorMap ? "#ffffff" : color);
      if ("map" in std) {
        std.map = colorMap;
      }
      if (colorMap) {
        std.metalness = 0;
        std.roughness = 0.55;
      }
      std.needsUpdate = true;
    }
  });
}

function normalizeHumanScene(
  scene: Object3D,
  directorObjectId: string,
  scaleMultiplier = 1,
  targetHeight = TARGET_HEIGHT
) {
  const cloned = scene.clone(true);
  cloned.traverse((child) => {
    child.userData.directorObjectId = directorObjectId;
  });

  const box = new Box3().setFromObject(cloned);
  const size = box.getSize(new Vector3());
  const height = size.y > 1e-4 ? size.y : 1;
  const scale = (targetHeight / height) * scaleMultiplier;
  cloned.scale.setScalar(scale);

  const grounded = new Box3().setFromObject(cloned);
  cloned.position.y = -grounded.min.y;

  return cloned;
}

function CharacterGlbModelInner({
  url,
  directorObjectId,
  scaleMultiplier = 1,
  targetHeight = TARGET_HEIGHT,
  color = "#ffffff",
  colorMap = null,
}: CharacterGlbModelProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.manager.setURLModifier((resourceUrl) => resolveStorageResourceUrl(url, resourceUrl));
  });
  const { invalidate } = useThree();
  const model = useMemo(
    () => normalizeHumanScene(gltf.scene, directorObjectId, scaleMultiplier, targetHeight),
    [gltf.scene, directorObjectId, scaleMultiplier, targetHeight]
  );

  useEffect(() => {
    applyColorMap(model, color, colorMap);
    invalidate();
  }, [model, color, colorMap, invalidate]);

  return <primitive object={model} />;
}

export function CharacterGlbModel(props: CharacterGlbModelProps) {
  return (
    <Suspense fallback={null}>
      <CharacterGlbModelInner {...props} />
    </Suspense>
  );
}
