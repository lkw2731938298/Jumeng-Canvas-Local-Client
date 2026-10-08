"use client";

import { useLayoutEffect, useRef } from "react";
import type { Group, Texture } from "three";
import { createDefaultBonePose } from "@/lib/director/poseRig";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import { useColorMapTexture } from "@/lib/director/useColorMapTexture";
import type { DirectorObject, DirectorTransformMode } from "@/types/director-scene";
import { DoubleSide } from "three";
import { DirectorCameraProp } from "./DirectorCameraProp";
import { CharacterGlbModel } from "./CharacterGlbModel";
import { DirectorMannequinModel, isMannequinBuiltinModel } from "./DirectorMannequinModel";
import { DirectorObjectHeadLabel } from "./DirectorObjectHeadLabel";
import { useDirectorTransformRegistry } from "./directorTransformRegistry";

/** 造具有贴图时用不受光材质，否则 MeshStandard 在暗光下会把彩色图打成灰白 */
function PropMaterial({
  color,
  colorMap,
  roughness = 0.55,
  metalness = 0.05,
  side,
}: {
  color: string;
  colorMap: Texture | null;
  roughness?: number;
  metalness?: number;
  side?: typeof DoubleSide;
}) {
  if (colorMap) {
    return (
      <meshBasicMaterial
        key={colorMap.uuid}
        map={colorMap}
        color="#ffffff"
        toneMapped={false}
        side={side}
      />
    );
  }
  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      metalness={metalness}
      side={side}
    />
  );
}

function CapsulePlaceholder({ color, map }: { color: string; map?: Texture | null }) {
  return (
    <>
      <capsuleGeometry args={[0.35, 1.2, 8, 16]} />
      <PropMaterial color={color} colorMap={map ?? null} />
    </>
  );
}

function ShapeGeometry({
  object,
  colorMap,
}: {
  object: DirectorObject;
  colorMap: Texture | null;
}) {
  const { shape, color } = object;
  if (shape === "capsule" || (object.kind === "character" && shape === "model")) {
    return <CapsulePlaceholder color={color} map={colorMap} />;
  }
  if (shape === "sphere") {
    return (
      <>
        <sphereGeometry args={[0.5, 24, 24]} />
        <PropMaterial color={color} colorMap={colorMap} />
      </>
    );
  }
  if (shape === "cylinder") {
    return (
      <>
        <cylinderGeometry args={[0.4, 0.4, 1, 24]} />
        <PropMaterial color={color} colorMap={colorMap} />
      </>
    );
  }
  if (shape === "cone") {
    return (
      <>
        <coneGeometry args={[0.5, 1, 24]} />
        <PropMaterial color={color} colorMap={colorMap} />
      </>
    );
  }
  if (shape === "plane") {
    return (
      <>
        <planeGeometry args={[2, 2]} />
        <PropMaterial color={color} colorMap={colorMap} side={DoubleSide} />
      </>
    );
  }
  return (
    <>
      <boxGeometry args={[1, 1, 1]} />
      <PropMaterial color={color} colorMap={colorMap} roughness={0.6} />
    </>
  );
}

export function DirectorSceneObject({
  object,
  selected,
  transformMode,
  transformEnabled = true,
  poseEditMode = false,
  interactive: viewportInteractive = true,
  gridSnap = false,
  showLabel = false,
  modelUrl = null,
  colorMapUrl = null,
  aspectRatio = "16:9",
  onSelect,
  onBonePoseChange,
}: {
  object: DirectorObject;
  selected: boolean;
  transformMode: DirectorTransformMode;
  transformEnabled?: boolean;
  /** 人模关节编辑开关；物体坐标轴启用时关闭，避免与 TransformControls 抢拖拽 */
  poseEditMode?: boolean;
  interactive?: boolean;
  gridSnap?: boolean;
  showLabel?: boolean;
  modelUrl?: string | null;
  /** 模型颜色贴图 URL（对应 colorMapAssetId） */
  colorMapUrl?: string | null;
  aspectRatio?: string;
  onSelect: (id: string) => void;
  onBonePoseChange?: (id: string, bone: string, rotation: [number, number, number]) => void;
}) {
  const groupRef = useRef<Group | null>(null);
  const contentRef = useRef<Group | null>(null);
  const { registerTransformGroup } = useDirectorTransformRegistry();
  const { transform } = object;
  const isCamera = object.kind === "camera";
  const useMannequin = object.kind === "character" && isMannequinBuiltinModel(object.builtinModelId);
  // 人物与 GLB 模型道具都可渲染 GLB（道具归一化高度 1 米 × modelScale）
  const useGlb = !isCamera && Boolean(modelUrl) && !useMannequin;
  const cameraAspect = aspectRatioToNumber(aspectRatio as Parameters<typeof aspectRatioToNumber>[0]);
  // 仅基础造具加载贴图；人模 / 角色 GLB 忽略 colorMapUrl
  const allowColorMap =
    object.kind === "prop" &&
    ["box", "sphere", "cylinder", "cone", "plane"].includes(object.shape);
  const colorMap = useColorMapTexture(allowColorMap ? colorMapUrl : null);

  const syncGroupTransform = (group: Group) => {
    group.position.set(...transform.position);
    group.rotation.set(...transform.rotation);
    group.scale.set(...transform.scale);
    group.updateMatrixWorld(true);
  };

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    registerTransformGroup(object.id, group);
    return () => registerTransformGroup(object.id, null);
  }, [object.id, registerTransformGroup]);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    syncGroupTransform(group);
  }, [transform]);

  const bonePose = object.bonePose ?? createDefaultBonePose(object.gender ?? "male");

  return (
    <group
      ref={groupRef}
      position={transform.position}
      rotation={transform.rotation}
      scale={transform.scale}
      userData={{ directorObjectId: object.id }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(object.id);
      }}
    >
      {isCamera ? (
        <DirectorCameraProp
          color={object.color}
          selected={selected}
          lookAt={object.lookAt ?? [0, 1, 0]}
          fov={object.fov ?? 45}
          position={object.transform.position}
          aspect={cameraAspect}
        />
      ) : (
        <group ref={contentRef}>
          {useMannequin ? (
            <DirectorMannequinModel
              directorObjectId={object.id}
              color={object.color}
              gender={object.gender ?? "male"}
              bonePose={bonePose}
              scaleMultiplier={object.modelScale ?? 1}
              selected={selected}
              interactive={viewportInteractive}
              poseEditMode={poseEditMode}
              onBonePoseChange={(bone, rotation) => onBonePoseChange?.(object.id, bone, rotation)}
              fallback={
                <mesh castShadow receiveShadow userData={{ directorObjectId: object.id }}>
                  <CapsulePlaceholder color={object.color} />
                </mesh>
              }
            />
          ) : useGlb && modelUrl ? (
            <CharacterGlbModel
              url={modelUrl}
              directorObjectId={object.id}
              scaleMultiplier={object.modelScale ?? 1}
              targetHeight={object.kind === "character" ? undefined : 1}
              color={object.color}
            />
          ) : (
            <mesh
              key={colorMap ? `tex-${colorMap.uuid}` : "solid"}
              castShadow={!colorMap}
              receiveShadow={!colorMap}
              userData={{ directorObjectId: object.id }}
            >
              <ShapeGeometry object={object} colorMap={allowColorMap ? colorMap : null} />
            </mesh>
          )}
        </group>
      )}
      {showLabel && object.kind === "character" ? (
        <DirectorObjectHeadLabel
          name={object.name}
          boundsRef={contentRef}
          parentRef={groupRef}
        />
      ) : null}
    </group>
  );
}
