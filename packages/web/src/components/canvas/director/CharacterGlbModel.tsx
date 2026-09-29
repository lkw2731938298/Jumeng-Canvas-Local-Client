"use client";

import { Suspense, useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";
import { resolveStorageResourceUrl } from "@/lib/api/storageUrl";

const TARGET_HEIGHT = 1.75;

export interface CharacterGlbModelProps {
  url: string;
  directorObjectId: string;
  scaleMultiplier?: number;
  /** 归一化基准高度（米）：人物默认 1.75，GLB 道具传 1（最终高度 = 基准 × scaleMultiplier） */
  targetHeight?: number;
}

function normalizeHumanScene(
  scene: import("three").Object3D,
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
}: CharacterGlbModelProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.manager.setURLModifier((resourceUrl) => resolveStorageResourceUrl(url, resourceUrl));
  });
  const model = useMemo(
    () => normalizeHumanScene(gltf.scene, directorObjectId, scaleMultiplier, targetHeight),
    [gltf.scene, directorObjectId, scaleMultiplier, targetHeight]
  );

  return <primitive object={model} />;
}

export function CharacterGlbModel(props: CharacterGlbModelProps) {
  return (
    <Suspense fallback={null}>
      <CharacterGlbModelInner {...props} />
    </Suspense>
  );
}
