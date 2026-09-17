"use client";

import { useLayoutEffect, useRef } from "react";
import type { Group } from "three";
import { snapTransform } from "@/lib/director/gridSnap";
import { createDefaultBonePose } from "@/lib/director/poseRig";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import type { DirectorObject, DirectorTransformMode } from "@/types/director-scene";
import { DoubleSide } from "three";
import { DirectorCameraProp } from "./DirectorCameraProp";
import { CharacterGlbModel } from "./CharacterGlbModel";
import { DirectorMannequinModel, isMannequinBuiltinModel } from "./DirectorMannequinModel";
import { DirectorObjectHeadLabel } from "./DirectorObjectHeadLabel";
import { useDirectorTransformRegistry } from "./directorTransformRegistry";

function CapsulePlaceholder({ color }: { color: string }) {
  return (
    <>
      <capsuleGeometry args={[0.35, 1.2, 8, 16]} />
      <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
    </>
  );
}

function ShapeGeometry({ object }: { object: DirectorObject }) {
  const { shape, color } = object;
  if (shape === "capsule" || (object.kind === "character" && shape === "model")) {
    return <CapsulePlaceholder color={color} />;
  }
  if (shape === "sphere") {
    return (
      <>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} />
      </>
    );
  }
  if (shape === "cylinder") {
    return (
      <>
        <cylinderGeometry args={[0.4, 0.4, 1, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} />
      </>
    );
  }
  if (shape === "cone") {
    return (
      <>
        <coneGeometry args={[0.5, 1, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} />
      </>
    );
  }
  if (shape === "plane") {
    return (
      <>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} side={DoubleSide} />
      </>
    );
  }
  return (
    <>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
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
  const useGlb = object.kind === "character" && Boolean(modelUrl) && !useMannequin;
  const cameraAspect = aspectRatioToNumber(aspectRatio as Parameters<typeof aspectRatioToNumber>[0]);

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
            />
          ) : (
            <mesh castShadow receiveShadow userData={{ directorObjectId: object.id }}>
              <ShapeGeometry object={object} />
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
