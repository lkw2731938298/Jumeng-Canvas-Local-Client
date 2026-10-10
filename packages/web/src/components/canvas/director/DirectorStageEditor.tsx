"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, View } from "@react-three/drei";
import type { PerspectiveCamera, WebGLRenderer } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type {
  CameraPropViewMode,
  DirectorCameraState,
  DirectorObject,
  DirectorSceneState,
  DirectorTransform,
  DirectorTransformMode,
} from "@/types/director-scene";
import { aspectRatioToNumber } from "@/lib/director/aspectRatio";
import { resolveDirectorCameraWorldPose } from "@/lib/director/cameraWorldPose";
import { DirectorStageEnvironment } from "./DirectorStageEnvironment";
import { computeDirectorOrbitTarget } from "@/lib/director/sceneTransform";
import { DirectorLensPreviewScene } from "./DirectorLensPreviewScene";
import type { DirectorLensPreviewSceneProps } from "./DirectorLensPreviewScene";
import { ShotCameraMarkers } from "./ShotCameraMarkers";
import { SceneCaptureBridge, type DirectorCaptureApi } from "./SceneCaptureBridge";

export interface DirectorStageCanvasProps {
  scene: DirectorSceneState;
  activeCamera: DirectorCameraState;
  trackPreviewActive?: boolean;
  selectedObjectId: string | null;
  cameraPropViewMode: CameraPropViewMode | null;
  liveCameraRef: MutableRefObject<DirectorCameraState | null>;
  /** 拖拽机位时的临时 transform，供镜头监视器与视锥对齐 */
  liveCameraTransformRef: MutableRefObject<{ id: string; transform: DirectorTransform } | null>;
  transformMode: DirectorTransformMode;
  stageBodyRef: RefObject<HTMLDivElement | null>;
  mainViewRef: RefObject<HTMLDivElement | null>;
  /** 画幅安全区轨道；进机位时主 View 追踪它，与监视器宽高比一致 */
  filmGateRef?: RefObject<HTMLDivElement | null>;
  /** true = 主 View 追踪 filmGateRef（第一人称 / 机位视角） */
  useFilmGateTrack?: boolean;
  lensPreview?: DirectorLensPreviewSceneProps & {
    trackRef: RefObject<HTMLDivElement | null>;
  } | null;
  resolveCharacterModelUrl?: (object: DirectorObject) => string | null;
  resolveColorMapUrl?: (object: DirectorObject) => string | null;
  panoramaUrl?: string | null;
  /** 人体模型：坐标轴变换 vs 视口关节拖拽（互斥） */
  mannequinEditMode?: "transform" | "pose";
  onSelectObject: (id: string | null) => void;
  onObjectTransform: (id: string, transform: DirectorObject["transform"]) => void;
  onCameraLiveTransform: (id: string, transform: DirectorObject["transform"]) => void;
  onEditorCameraChange: (camera: DirectorCameraState) => void;
  onShotCameraSelect: (id: string) => void;
  onCaptureReady: (api: DirectorCaptureApi) => void;
  onBonePoseChange?: (id: string, bone: string, rotation: [number, number, number]) => void;
  /** 动画时间轴 · 地面绘制/预览运动路径 */
  motionPathDrawing?: {
    active: boolean;
    draftPoints: [number, number, number][];
    onAddPoint: (point: [number, number, number]) => void;
    onFinish: () => void;
  } | null;
  /** 已有路径控制点编辑 */
  motionPathEditing?: {
    path: import("@jumeng-canvas/shared").DirectorMotionPath | null;
    enabled: boolean;
    onUpdatePoint: (pathId: string, index: number, point: [number, number, number]) => void;
  } | null;
  onDragChange?: (dragging: boolean) => void;
}

function DirectorViewLayers() {
  const { camera } = useThree();

  useEffect(() => {
    camera.layers.enable(1);
  }, [camera]);

  return null;
}

function WebGLRendererCleanup() {
  const { gl } = useThree();

  useEffect(() => {
    return () => {
      (gl as WebGLRenderer).dispose();
    };
  }, [gl]);

  return null;
}

function ActiveViewCamera({ state }: { state: DirectorCameraState }) {
  const { camera } = useThree();

  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    cam.position.set(...state.position);
    cam.lookAt(...state.target);
    cam.fov = state.fov;
    cam.updateProjectionMatrix();
  }, [camera, state]);

  return null;
}

/**
 * 机位第一人称：位姿与造具/监视器一致；宽高比强制为场景画幅
 *（主 View 此时应追踪 filmGateRef，size 即为画幅安全区）。
 */
function CameraFirstPersonRig({
  cameraId,
  objects,
  settings,
  liveTransformRef,
  filmAspect,
}: {
  cameraId: string;
  objects: DirectorObject[];
  settings: DirectorSceneState["sceneSettings"];
  liveTransformRef: MutableRefObject<{ id: string; transform: DirectorTransform } | null>;
  filmAspect: number;
}) {
  const { camera } = useThree();
  const objectsRef = useRef(objects);
  const settingsRef = useRef(settings);
  objectsRef.current = objects;
  settingsRef.current = settings;

  useFrame(() => {
    const cam = camera as PerspectiveCamera;
    const live = liveTransformRef.current;
    const liveTransform = live?.id === cameraId ? live.transform : null;
    const pose = resolveDirectorCameraWorldPose(
      cameraId,
      objectsRef.current,
      settingsRef.current,
      liveTransform
    );
    if (!pose) return;

    cam.position.set(...pose.position);
    cam.rotation.set(...pose.rotation);
    cam.fov = pose.fov;
    cam.aspect = filmAspect;
    cam.updateProjectionMatrix();
  });

  return null;
}

/** 导演自由视角：仅在进入/切换时同步一次相机，避免与 OrbitControls 抢控制权导致抖动 */
function DirectorOrbitCameraBootstrap({
  enabled,
  cameraState,
  orbitTarget,
}: {
  enabled: boolean;
  cameraState: DirectorCameraState;
  orbitTarget: [number, number, number];
}) {
  const { camera, controls } = useThree();
  const bootedKeyRef = useRef("");

  useEffect(() => {
    if (!enabled) {
      bootedKeyRef.current = "";
      return;
    }
    const key = `${cameraState.position.join(",")}|${cameraState.fov}`;
    if (bootedKeyRef.current === key) return;
    bootedKeyRef.current = key;

    const cam = camera as PerspectiveCamera;
    cam.position.set(...cameraState.position);
    cam.fov = cameraState.fov;
    cam.updateProjectionMatrix();

    const orbit = controls as OrbitControlsImpl | null;
    if (orbit) {
      orbit.target.set(...orbitTarget);
      orbit.update();
    } else {
      cam.lookAt(...orbitTarget);
    }
  }, [camera, cameraState.fov, cameraState.position, controls, enabled, orbitTarget]);

  return null;
}

function DirectorOrbitControls({
  enabled,
  target,
  onCameraChange,
  onInteractingChange,
}: {
  enabled: boolean;
  target: [number, number, number];
  onCameraChange: (camera: DirectorCameraState) => void;
  onInteractingChange: (active: boolean) => void;
}) {
  const { camera } = useThree();

  const handleEnd = useCallback(() => {
    if (!enabled) return;
    const cam = camera as PerspectiveCamera;
    onCameraChange({
      position: [cam.position.x, cam.position.y, cam.position.z],
      target: [...target],
      fov: cam.fov,
    });
  }, [camera, enabled, onCameraChange, target]);

  return (
    <OrbitControls
      makeDefault
      enabled={enabled}
      target={target}
      onStart={() => onInteractingChange(true)}
      onEnd={() => {
        onInteractingChange(false);
        handleEnd();
      }}
      minPolarAngle={0}
      maxPolarAngle={Math.PI}
    />
  );
}

function MainDirectorView({
  scene,
  activeCamera,
  selectedObjectId,
  cameraPropViewMode,
  transformMode,
  liveCameraTransformRef,
  onSelectObject,
  onObjectTransform,
  onCameraLiveTransform,
  onEditorCameraChange,
  onShotCameraSelect,
  onCaptureReady,
  trackPreviewActive = false,
  resolveCharacterModelUrl,
  resolveColorMapUrl,
  panoramaUrl = null,
  mannequinEditMode = "transform",
  onBonePoseChange,
  motionPathDrawing = null,
  motionPathEditing = null,
  onDragChange,
}: Omit<DirectorStageCanvasProps, "stageBodyRef" | "mainViewRef" | "liveCameraRef" | "lensPreview">) {
  const interactionLocksRef = useRef(0);

  const setInteracting = useCallback(
    (active: boolean) => {
      interactionLocksRef.current += active ? 1 : -1;
      if (interactionLocksRef.current < 0) interactionLocksRef.current = 0;
      onDragChange?.(active);
    },
    [onDragChange]
  );

  const selectedObject = scene.objects.find((o) => o.id === selectedObjectId) ?? null;
  const isCameraFirstPerson =
    selectedObject?.kind === "camera" && cameraPropViewMode === "firstPerson";
  const isDirectorView =
    scene.viewMode === "director" &&
    !trackPreviewActive &&
    !isCameraFirstPerson &&
    !motionPathDrawing?.active;
  const filmAspect = aspectRatioToNumber(scene.sceneSettings?.aspectRatio ?? "16:9");
  const orbitTargetKey = useMemo(
    () =>
      scene.objects
        .filter((o) => o.kind !== "camera")
        .map((o) => `${o.id}:${o.transform.position.map((v) => v.toFixed(3)).join(",")}`)
        .join("|"),
    [scene.objects]
  );
  const orbitTarget = useMemo(
    () => computeDirectorOrbitTarget(scene),
    [orbitTargetKey]
  );

  return (
    <>
      <DirectorViewLayers />
      <DirectorStageEnvironment
        scene={scene}
        panoramaUrl={panoramaUrl}
        selectedObjectId={selectedObjectId}
        transformMode={transformMode}
        cameraPropViewMode={cameraPropViewMode}
        interactive
        onSelectObject={onSelectObject}
        onObjectTransform={onObjectTransform}
        onCameraLiveTransform={onCameraLiveTransform}
        onDragChange={setInteracting}
        resolveCharacterModelUrl={resolveCharacterModelUrl}
        resolveColorMapUrl={resolveColorMapUrl}
        mannequinEditMode={mannequinEditMode}
        onBonePoseChange={onBonePoseChange}
        motionPathDrawing={motionPathDrawing}
        motionPathEditing={motionPathEditing}
      />

      {isDirectorView ? (
        <ShotCameraMarkers
          cameras={scene.shotCameras}
          activeId={scene.activeShotCameraId}
          onSelect={onShotCameraSelect}
        />
      ) : null}

      {isCameraFirstPerson && selectedObject ? (
        <CameraFirstPersonRig
          cameraId={selectedObject.id}
          objects={scene.objects}
          settings={scene.sceneSettings}
          liveTransformRef={liveCameraTransformRef}
          filmAspect={filmAspect}
        />
      ) : isDirectorView ? (
        <DirectorOrbitCameraBootstrap
          enabled={isDirectorView}
          cameraState={activeCamera}
          orbitTarget={orbitTarget}
        />
      ) : (
        <ActiveViewCamera state={activeCamera} />
      )}
      <DirectorOrbitControls
        enabled={isDirectorView}
        target={orbitTarget}
        onCameraChange={onEditorCameraChange}
        onInteractingChange={setInteracting}
      />
      <SceneCaptureBridge
        onReady={onCaptureReady}
        editorTarget={scene.camera.target}
        objects={scene.objects}
      />
    </>
  );
}

/** LibTV：全屏 Canvas + View.Port；主视口与侧栏 track 分视口实时渲染 */
export function DirectorStageCanvas(props: DirectorStageCanvasProps) {
  const { lensPreview, filmGateRef, useFilmGateTrack = false, ...viewProps } = props;
  const mainTrack =
    useFilmGateTrack && filmGateRef
      ? (filmGateRef as RefObject<HTMLElement>)
      : (viewProps.mainViewRef as RefObject<HTMLElement>);
  const canvasCamera = useMemo(
    () => ({
      position: props.activeCamera.position as [number, number, number],
      fov: props.activeCamera.fov,
      near: 0.1,
      // 全景球半径可达 500，fog far≈半径×2.5，需大于裁切面
      far: 1500,
    }),
    [props.activeCamera.fov, props.activeCamera.position]
  );

  return (
    <Canvas
      className="!absolute inset-0 !h-full !w-full [&_canvas]:!pointer-events-none"
      style={{ position: "absolute", top: 0, left: 0, zIndex: 25, pointerEvents: "none" }}
      eventSource={props.mainViewRef as RefObject<HTMLElement>}
      camera={canvasCamera}
      gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
      onPointerMissed={() => props.onSelectObject(null)}
    >
      <Suspense fallback={null}>
        <WebGLRendererCleanup />
        <View.Port />
        <View
          // 切换全屏/画幅轨道时重建，避免 scissor 残留
          key={useFilmGateTrack ? `film:${props.scene.sceneSettings?.aspectRatio ?? "16:9"}` : "full"}
          track={mainTrack}
          index={1}
        >
          <MainDirectorView {...viewProps} />
        </View>
        {lensPreview ? (
          // 画幅变化时重建 View，清空旧 scissor 区域残留帧
          <View
            key={`${lensPreview.cameraId}:${lensPreview.scene.sceneSettings?.aspectRatio ?? "16:9"}`}
            track={lensPreview.trackRef as RefObject<HTMLElement>}
            index={2}
          >
            <DirectorLensPreviewScene
              scene={lensPreview.scene}
              cameraId={lensPreview.cameraId}
              liveTransformRef={props.liveCameraTransformRef}
              resolveCharacterModelUrl={props.resolveCharacterModelUrl}
              resolveColorMapUrl={props.resolveColorMapUrl}
              panoramaUrl={props.panoramaUrl}
            />
          </View>
        ) : null}
      </Suspense>
    </Canvas>
  );
}

/** @deprecated 使用 DirectorStageCanvas */
export const DirectorStageEditor = DirectorStageCanvas;
