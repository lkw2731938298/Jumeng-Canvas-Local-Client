"use client";

import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import type { DirectorBonePose, DirectorCharacterGender } from "@jumeng-canvas/shared";
import { withBasePath } from "@/lib/basePath";
import {
  applyBonePose,
  createSelectionOutlineMaterial,
  extractSkeletonData,
  findBone,
} from "@/lib/director/boneRig";
import { createDefaultBonePose } from "@/lib/director/poseRig";
import { DirectorBoneHandles } from "./DirectorBoneHandles";

export const MANNEQUIN_GLB_URL = withBasePath("/director/models/mannequin.glb");

useGLTF.preload(MANNEQUIN_GLB_URL);

interface RigState {
  mesh: THREE.Object3D;
  outline: THREE.Object3D;
  skeletonMain: ReturnType<typeof extractSkeletonData>;
  skeletonOutline: ReturnType<typeof extractSkeletonData>;
  center: THREE.Vector3;
  pivotY: number;
}

const MALE_WAIST_SCALE = 1.22;

function cloneAndTint(material: THREE.Material, color: string): THREE.Material {
  const tinted = material.clone();
  if ((tinted as THREE.MeshStandardMaterial).color) {
    (tinted as THREE.MeshStandardMaterial).color.set(color);
  }
  return tinted;
}

function tintSkinnedMeshes(root: THREE.Object3D, color: string) {
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    skinned.castShadow = true;
    skinned.frustumCulled = false;
    skinned.material = Array.isArray(skinned.material)
      ? skinned.material.map((m) => cloneAndTint(m, color))
      : cloneAndTint(skinned.material, color);
  });
}

function wireSkinnedMeshPicking(root: THREE.Object3D) {
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    skinned.frustumCulled = false;
    const baseRaycast = THREE.SkinnedMesh.prototype.raycast;
    skinned.raycast = function raycast(this: THREE.SkinnedMesh, raycaster, intersects) {
      if (this.skeleton) this.skeleton.update();
      this.computeBoundingSphere();
      baseRaycast.call(this, raycaster, intersects);
    };
  });
}

function prepareOutline(root: THREE.Object3D) {
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    skinned.raycast = () => undefined;
    skinned.castShadow = false;
    skinned.receiveShadow = false;
    skinned.frustumCulled = false;
    skinned.material = createSelectionOutlineMaterial();
  });
}

function updateSkinnedBounds(root: THREE.Object3D) {
  root.traverse((obj) => {
    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      skinned.skeleton.update();
      skinned.computeBoundingSphere();
      skinned.frustumCulled = false;
    }
  });
}

function applyMaleWaistShape(root: THREE.Object3D) {
  const boneMap = new Map<string, THREE.Bone>();
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) boneMap.set(obj.name, obj as THREE.Bone);
  });
  const spine = findBone(boneMap, "Spine");
  const spine2 = findBone(boneMap, "Spine2") ?? findBone(boneMap, "Spine1");
  if (!spine || !spine2 || spine === spine2) return;
  const s = MALE_WAIST_SCALE;
  spine.scale.set(s, 1, s);
  spine2.scale.set(1 / s, 1, 1 / s);
}

function createRig(
  gltfScene: THREE.Object3D,
  color: string,
  gender: DirectorCharacterGender,
  directorObjectId: string,
  scaleMultiplier = 1
): RigState {
  const mesh = skeletonClone(gltfScene);
  tintSkinnedMeshes(mesh, color);
  wireSkinnedMeshPicking(mesh);
  mesh.traverse((child) => {
    child.userData.directorObjectId = directorObjectId;
  });

  const outline = skeletonClone(gltfScene);
  prepareOutline(outline);

  if (gender === "male") {
    applyMaleWaistShape(mesh);
    applyMaleWaistShape(outline);
  }

  // skeletonClone 后对皮肤网格 setFromObject 会严重低估高度（约 0.02m），
  // 若再按 TARGET_HEIGHT 归一化会把模型放大近百倍；须用源 GLB 包围盒。
  const sourceBox = new THREE.Box3().setFromObject(gltfScene);
  const sourceSize = sourceBox.getSize(new THREE.Vector3());
  const scale = scaleMultiplier;
  mesh.scale.setScalar(scale);
  outline.scale.setScalar(scale);
  mesh.position.y = -sourceBox.min.y * scale;

  const center = sourceBox.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  center.y = (sourceSize.y * scale) / 2;
  const pivotY = sourceSize.y * scale;

  const skeletonMain = extractSkeletonData(mesh);
  const skeletonOutline = extractSkeletonData(outline);

  return { mesh, outline, skeletonMain, skeletonOutline, center, pivotY };
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose();
    }
  });
}

function MannequinPickVolume({
  boneMap,
  rootRef,
  onPointerDown,
}: {
  boneMap: Map<string, THREE.Object3D>;
  rootRef: RefObject<THREE.Group | null>;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const point = useRef(new THREE.Vector3());
  const bounds = useRef(new THREE.Box3());
  const size = useRef(new THREE.Vector3());
  const center = useRef(new THREE.Vector3());

  useFrame(() => {
    const root = rootRef.current;
    const mesh = meshRef.current;
    if (!root || !mesh || boneMap.size === 0) return;

    bounds.current.makeEmpty();
    for (const bone of boneMap.values()) {
      bone.getWorldPosition(point.current);
      root.worldToLocal(point.current);
      bounds.current.expandByPoint(point.current);
    }
    if (bounds.current.isEmpty()) return;

    bounds.current.expandByScalar(0.14);
    bounds.current.getSize(size.current);
    bounds.current.getCenter(center.current);
    mesh.position.copy(center.current);
    mesh.scale.set(
      Math.max(size.current.x, 0.28),
      Math.max(size.current.y, 0.28),
      Math.max(size.current.z, 0.28)
    );
  });

  return (
    <mesh ref={meshRef} visible={false} onPointerDown={onPointerDown}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function DirectorMannequinModelInner({
  directorObjectId,
  color,
  gender = "male",
  bonePose,
  scaleMultiplier = 1,
  selected,
  interactive,
  poseEditMode = false,
  onBonePoseChange,
}: {
  directorObjectId: string;
  color: string;
  gender?: DirectorCharacterGender;
  bonePose: DirectorBonePose;
  scaleMultiplier?: number;
  selected: boolean;
  interactive: boolean;
  poseEditMode?: boolean;
  onBonePoseChange: (bone: string, rotation: [number, number, number]) => void;
}) {
  const { scene: gltfScene } = useGLTF(MANNEQUIN_GLB_URL);
  const rootRef = useRef<THREE.Group>(null);
  const outlineWrapRef = useRef<THREE.Group>(null);
  const rigRef = useRef<RigState | null>(null);
  const [mounted, setMounted] = useState(false);
  const { invalidate } = useThree();

  /** 拖拽关节时同步主网格与选中描边，避免橙色描边滞留在旧姿势 */
  const applyLiveBonePose = useCallback(
    (pose: DirectorBonePose) => {
      const rig = rigRef.current;
      if (!rig) return;
      applyBonePose(rig.skeletonMain.boneMap, rig.skeletonMain.bindPose, pose);
      if (selected) {
        applyBonePose(rig.skeletonOutline.boneMap, rig.skeletonOutline.bindPose, pose);
        updateSkinnedBounds(rig.outline);
      }
      updateSkinnedBounds(rig.mesh);
      invalidate();
    },
    [invalidate, selected]
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const rig = createRig(gltfScene, color, gender, directorObjectId, scaleMultiplier);
    rigRef.current = rig;
    root.add(rig.mesh);
    applyBonePose(rig.skeletonMain.boneMap, rig.skeletonMain.bindPose, bonePose);
    updateSkinnedBounds(rig.mesh);
    setMounted(true);
    invalidate();

    return () => {
      root.remove(rig.mesh);
      disposeObject3D(rig.mesh);
      disposeObject3D(rig.outline);
      rigRef.current = null;
      setMounted(false);
    };
  }, [gltfScene, directorObjectId, gender, scaleMultiplier, invalidate]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    tintSkinnedMeshes(rig.mesh, color);
    invalidate();
  }, [color, invalidate]);

  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    applyBonePose(rig.skeletonMain.boneMap, rig.skeletonMain.bindPose, bonePose);
    applyBonePose(rig.skeletonOutline.boneMap, rig.skeletonOutline.bindPose, bonePose);
    updateSkinnedBounds(rig.mesh);
    updateSkinnedBounds(rig.outline);
    invalidate();
  }, [bonePose, invalidate]);

  useEffect(() => {
    const rig = rigRef.current;
    const wrap = outlineWrapRef.current;
    if (!rig || !wrap) return;

    wrap.clear();
    if (selected) {
      wrap.add(rig.outline);
      wrap.position.copy(rig.center);
      rig.outline.position.set(-rig.center.x, -rig.center.y, -rig.center.z);
      wrap.scale.setScalar(1.018);
      applyBonePose(rig.skeletonOutline.boneMap, rig.skeletonOutline.bindPose, bonePose);
      updateSkinnedBounds(rig.outline);
    }
    invalidate();
  }, [selected, bonePose, invalidate]);

  const handleClick = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
  };

  const rig = rigRef.current;

  return (
    <group ref={rootRef}>
      <group ref={outlineWrapRef} />
      {mounted && rig && !selected ? (
        <MannequinPickVolume
          boneMap={rig.skeletonMain.boneMap}
          rootRef={rootRef}
          onPointerDown={handleClick}
        />
      ) : !mounted ? (
        <mesh visible={false} position={[0, 0.95, 0]} onPointerDown={handleClick}>
          <capsuleGeometry args={[0.55, 1.2, 6, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      {selected && interactive && poseEditMode && mounted && rig && rig.skeletonMain.boneMap.size > 0 ? (
        <DirectorBoneHandles
          boneMap={rig.skeletonMain.boneMap}
          bonePose={bonePose}
          onApplyPose={applyLiveBonePose}
          onBonePoseChange={onBonePoseChange}
        />
      ) : null}
    </group>
  );
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

class MannequinErrorBoundary extends Component<BoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export function DirectorMannequinModel({
  directorObjectId,
  color,
  gender = "male",
  bonePose,
  scaleMultiplier = 1,
  selected,
  interactive,
  poseEditMode = false,
  onBonePoseChange,
  fallback,
}: {
  directorObjectId: string;
  color: string;
  gender?: DirectorCharacterGender;
  bonePose?: DirectorBonePose;
  scaleMultiplier?: number;
  selected: boolean;
  interactive: boolean;
  poseEditMode?: boolean;
  onBonePoseChange: (bone: string, rotation: [number, number, number]) => void;
  fallback?: ReactNode;
}) {
  const resolvedPose = bonePose ?? createDefaultBonePose(gender);
  return (
    <MannequinErrorBoundary fallback={fallback ?? null}>
      <DirectorMannequinModelInner
        directorObjectId={directorObjectId}
        color={color}
        gender={gender}
        bonePose={resolvedPose}
        scaleMultiplier={scaleMultiplier}
        selected={selected}
        interactive={interactive}
        poseEditMode={poseEditMode}
        onBonePoseChange={onBonePoseChange}
      />
    </MannequinErrorBoundary>
  );
}

export function isMannequinBuiltinModel(builtinModelId?: string): boolean {
  return builtinModelId === "mannequin_male" || builtinModelId === "mannequin_female";
}
