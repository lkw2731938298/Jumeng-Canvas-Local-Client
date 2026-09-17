"use client";

import { Grid } from "@react-three/drei";
import { DoubleSide } from "three";
import type { DirectorObject, DirectorSceneState, DirectorTransformMode } from "@/types/director-scene";
import { applyCameraLookAtTargets, sceneGroupTransform } from "@/lib/director/sceneTransform";
import { isMannequinBuiltinModel } from "./DirectorMannequinModel";
import { DirectorLighting } from "./DirectorLighting";
import { DirectorSceneObject } from "./DirectorSceneObject";
import { DirectorPanoramaSphere } from "./DirectorPanoramaSphere";
import { DirectorTransformRegistryProvider } from "./directorTransformRegistry";
import { DirectorSelectedTransformControls } from "./DirectorSelectedTransformControls";

export function DirectorStageEnvironment({
  scene,
  panoramaUrl = null,
  selectedObjectId = null,
  transformMode = "translate",
  cameraPropViewMode = null,
  interactive = false,
  mannequinEditMode = "transform",
  onSelectObject,
  onObjectTransform,
  onCameraLiveTransform,
  onDragChange,
  resolveCharacterModelUrl,
  onBonePoseChange,
}: {
  scene: DirectorSceneState;
  panoramaUrl?: string | null;
  selectedObjectId?: string | null;
  transformMode?: DirectorTransformMode;
  cameraPropViewMode?: "firstPerson" | "thirdPerson" | null;
  interactive?: boolean;
  /** 人体模型编辑：坐标轴 / 关节（视口骨骼手柄） */
  mannequinEditMode?: "transform" | "pose";
  onSelectObject?: (id: string | null) => void;
  onObjectTransform?: (id: string, transform: DirectorObject["transform"]) => void;
  onCameraLiveTransform?: (id: string, transform: DirectorObject["transform"]) => void;
  onDragChange?: (dragging: boolean) => void;
  resolveCharacterModelUrl?: (object: DirectorObject) => string | null;
  onBonePoseChange?: (id: string, bone: string, rotation: [number, number, number]) => void;
}) {
  const settings = scene.sceneSettings;
  const aspectRatio = settings.aspectRatio ?? "16:9";
  const hasPanorama = Boolean(panoramaUrl && settings.panorama);
  // 与侧栏「球形半径」下限一致（10–500）
  const panoramaRadius = Math.max(10, settings.panorama?.sphereRadius ?? 80);
  const groupT = sceneGroupTransform(settings);
  const objects = applyCameraLookAtTargets(scene.objects);
  const selectedObject = objects.find((o) => o.id === selectedObjectId) ?? null;
  const isCameraThirdPerson =
    selectedObject?.kind === "camera" && cameraPropViewMode === "thirdPerson";
  const selectedIsMannequin =
    selectedObject?.kind === "character" &&
    isMannequinBuiltinModel(selectedObject.builtinModelId);
  const mannequinPoseEditing = selectedIsMannequin && mannequinEditMode === "pose";
  const groundY = settings.ground.height ?? 0;
  const groundOpacity = settings.ground.visible ? settings.ground.opacity : 0;

  return (
    <DirectorTransformRegistryProvider>
      <color attach="background" args={[settings.skyColor ?? "#12121c"]} />
      <fog
        attach="fog"
        args={[
          settings.skyColor ?? "#12121c",
          hasPanorama ? panoramaRadius * 0.25 : 28,
          hasPanorama ? panoramaRadius * 2.5 : 55,
        ]}
      />
      <DirectorLighting presetId={scene.lighting.preset} />

      {hasPanorama ? (
        <DirectorPanoramaSphere imageUrl={panoramaUrl} settings={settings.panorama!} />
      ) : null}

      <group position={groupT.position} rotation={groupT.rotation} scale={groupT.scale}>
        {settings.ground.visible ? (
          <>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, groundY, 0]} renderOrder={0}>
              <planeGeometry args={[40, 40]} />
              <meshStandardMaterial
                color="#1e1e2e"
                transparent
                opacity={Math.min(1, hasPanorama ? groundOpacity * 0.55 : groundOpacity * 0.3)}
                depthWrite={false}
                side={DoubleSide}
                roughness={0.95}
              />
            </mesh>
            <Grid
              args={[40, 40]}
              cellSize={1}
              cellThickness={hasPanorama ? 0.65 : 0.45}
              sectionSize={5}
              sectionThickness={hasPanorama ? 1.05 : 0.85}
              fadeDistance={hasPanorama ? 48 : 36}
              fadeStrength={1}
              infiniteGrid
              position={[0, groundY + 0.02, 0]}
              cellColor={hasPanorama ? "#5f5f8a" : "#3f3f5a"}
              sectionColor="#6366f1"
            />
          </>
        ) : null}

        {objects.map((obj) => {
          const selected = interactive && selectedObjectId === obj.id;
          const isMannequin =
            obj.kind === "character" && isMannequinBuiltinModel(obj.builtinModelId);
          const poseEditMode = selected && isMannequin && mannequinEditMode === "pose";
          const transformEnabled =
            selected &&
            interactive &&
            !poseEditMode &&
            (obj.kind !== "camera" || isCameraThirdPerson);

          return (
            <DirectorSceneObject
              key={obj.id}
              object={obj}
              selected={selected}
              transformMode={transformMode}
              transformEnabled={transformEnabled}
              // 关节模式开启视口骨骼手柄；坐标轴模式关闭，避免与 TransformControls 抢拖拽
              poseEditMode={poseEditMode}
              interactive={interactive}
              gridSnap={settings.gridSnap}
              showLabel={settings.showLabels}
              modelUrl={obj.kind === "character" ? resolveCharacterModelUrl?.(obj) ?? null : null}
              aspectRatio={aspectRatio}
              onSelect={onSelectObject ?? (() => {})}
              onBonePoseChange={onBonePoseChange}
            />
          );
        })}
      </group>

      {interactive &&
      selectedObject &&
      !mannequinPoseEditing &&
      (selectedObject.kind !== "camera" || isCameraThirdPerson) ? (
        <DirectorSelectedTransformControls
          object={selectedObject}
          transformMode={transformMode}
          gridSnap={settings.gridSnap}
          onTransform={onObjectTransform ?? (() => {})}
          onLiveTransform={
            selectedObject.kind === "camera" ? onCameraLiveTransform : undefined
          }
          onDragChange={onDragChange}
        />
      ) : null}
    </DirectorTransformRegistryProvider>
  );
}
