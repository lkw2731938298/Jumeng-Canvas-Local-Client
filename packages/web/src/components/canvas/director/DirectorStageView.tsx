"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Clapperboard,
  Film,
  Loader2,
  Play,
  Plus,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { fetchDirectorScene, saveDirectorScene } from "@/lib/api/directorScene";
import {
  NODE_IMAGE_SUBCATEGORY,
  uploadAsset,
  uploadModelBundle,
  lookupAsset,
  type Asset,
} from "@/lib/api/assets";
import { registerDirectorExitPreviewCapture } from "@/lib/director/exitPreviewCapture";
import {
  DIRECTOR_MODEL_SUBCATEGORY,
  GLB_ACCEPT,
  isGlbAsset,
  resolveCharacterModelUrl as resolveCharacterModelUrlFromAssets,
} from "@/lib/director/characterModels";
import { LIGHTING_PRESETS, type LightingPresetId } from "@/lib/director/lightingPresets";
import {
  createDefaultCameraTrack,
  interpolateCameraTrack,
  newCameraKeyframe,
  trackFrameTimes,
} from "@/lib/director/cameraTrack";
import { normalizeDirectorScene } from "@/lib/director/sceneNormalize";
import {
  defaultLensCaptureOptions,
  resolveLensCaptureCameraState,
} from "@/lib/director/lensCapture";
import { findBuiltinModel } from "@/lib/director/builtinModels";
import { syncCameraLookAtFromTransform, rotationFromPositionLookAt } from "@/lib/director/shotPreview";
import { applyChannelsToNodeParams, uploadDirectorChannels } from "@/lib/director/uploadChannels";
import { writeDirectorCaptureToLinkedShot } from "@/lib/canvas/storyboardNarrativeBootstrap";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { isMannequinBuiltinModel } from "@/components/canvas/director/DirectorMannequinModel";
import { createDefaultBonePose } from "@/lib/director/poseRig";
import type { DirectorBonePose } from "@jumeng-canvas/shared";
import type { WorkflowNodeData } from "@/types/workflow";
import {
  createDefaultDirectorScene,
  cameraObjectToState,
  newDirectorObject,
  newDirectorCameraObject,
  newShotCamera,
  resolveActiveCamera,
  type DirectorCameraState,
  type DirectorObject,
  type DirectorSceneState,
  type DirectorAspectRatio,
  type DirectorSceneSettings,
  type DirectorTransformMode,
  type DirectorViewMode,
  type CameraPropViewMode,
} from "@/types/director-scene";
import type { DirectorCaptureApi } from "./SceneCaptureBridge";
import { DirectorObjectList } from "./DirectorObjectList";
import { DirectorSceneInspector } from "./DirectorSceneInspector";
import { DirectorModelInspector } from "./DirectorModelInspector";
import { DirectorCameraInspector } from "./DirectorCameraInspector";
import { DirectorBottomToolbar } from "./DirectorBottomToolbar";
import { DirectorAspectOverlay } from "./DirectorAspectOverlay";
import { DirectorPosePanel } from "./DirectorPosePanel";
import { MediaAssetPicker } from "@/components/canvas/nodes/MediaAssetPicker";

export interface DirectorStageViewProps {
  projectId: string;
  nodeId: string;
}

const DirectorStageEditor = dynamic(
  () => import("./DirectorStageEditor").then((m) => m.DirectorStageEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-white/40">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载 3D 编辑器…
      </div>
    ),
  }
);

const PANEL_STYLE = {
  background: "rgba(18, 18, 28, 0.96)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(99, 102, 241, 0.35)",
} as const;

type SaveState = "idle" | "saving" | "saved" | "error";

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], filename, { type: "image/png" });
}

export function DirectorStageView({ projectId, nodeId }: DirectorStageViewProps) {
  const nodes = useCanvasStore((s) => s.nodes);
  const updateNodeParam = useCanvasStore((s) => s.updateNodeParam);
  const applyNodeGeneratedMedia = useCanvasStore((s) => s.applyNodeGeneratedMedia);
  const { assets } = useProjectAssetManifest(projectId);

  const modelAssets = useMemo(
    () => assets.filter((asset) => asset.category === "model" || isGlbAsset(asset)),
    [assets]
  );

  const resolveCharacterModelUrl = useCallback(
    (object: DirectorObject) => resolveCharacterModelUrlFromAssets(object, assets),
    [assets]
  );

  const [scene, setScene] = useState<DirectorSceneState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [capturing, setCapturing] = useState(false);
  const [exportingTrack, setExportingTrack] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<DirectorTransformMode>("translate");
  /** 人体模型右侧栏：坐标轴 ↔ 关节视口编辑 */
  const [mannequinEditMode, setMannequinEditMode] = useState<"transform" | "pose">("transform");
  const [trackTime, setTrackTime] = useState<number | null>(null);
  const [trackPlaying, setTrackPlaying] = useState(false);
  const [cameraPropViewMode, setCameraPropViewMode] = useState<CameraPropViewMode>("thirdPerson");
  const [uploadingModel, setUploadingModel] = useState(false);
  const [uiFullscreen, setUiFullscreen] = useState(false);
  const [panoramaAssetPickerOpen, setPanoramaAssetPickerOpen] = useState(false);

  const modelFileRef = useRef<HTMLInputElement | null>(null);
  const [panoramaUploadUrl, setPanoramaUploadUrl] = useState<string | null>(null);

  const stageBodyRef = useRef<HTMLDivElement | null>(null);
  const mainViewRef = useRef<HTMLDivElement | null>(null);
  const lensPreviewTrackRef = useRef<HTMLDivElement | null>(null);
  const captureApiRef = useRef<DirectorCaptureApi | null>(null);
  const liveCameraRef = useRef<DirectorCameraState | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneLoadedRef = useRef(false);
  const trackRafRef = useRef<number | null>(null);
  const trackPlayFromRef = useRef(0);

  const node = useMemo(
    () => (nodeId ? nodes.find((n) => n.id === nodeId) ?? null : null),
    [nodeId, nodes]
  );

  const label = (node?.data as WorkflowNodeData | undefined)?.label ?? "导演台";
  const selectedObject = scene?.objects.find((o) => o.id === selectedObjectId) ?? null;
  const selectedCameraObject =
    selectedObject?.kind === "camera" ? selectedObject : null;
  const selectedMannequin =
    selectedObject?.kind === "character" &&
    isMannequinBuiltinModel(selectedObject.builtinModelId)
      ? selectedObject
      : null;

  // 切换选中非人体模型时，恢复默认坐标轴模式
  useEffect(() => {
    if (!selectedMannequin) setMannequinEditMode("transform");
  }, [selectedMannequin?.id]);

  const cameraObjects = useMemo(
    () => scene?.objects.filter((o) => o.kind === "camera") ?? [],
    [scene?.objects]
  );
  const targetObjects = useMemo(
    () => scene?.objects.filter((o) => o.kind !== "camera") ?? [],
    [scene?.objects]
  );
  const panoramaPreviewUrl = useMemo(() => {
    const assetId = scene?.sceneSettings?.panorama?.assetId;
    if (!assetId) return panoramaUploadUrl;
    return lookupAsset(assets, assetId)?.fileUrl ?? panoramaUploadUrl;
  }, [assets, panoramaUploadUrl, scene?.sceneSettings?.panorama?.assetId]);
  const activeCamera = useMemo(() => {
    if (!scene) return null;
    if (selectedCameraObject && cameraPropViewMode === "firstPerson") {
      const cam = cameraObjectToState(selectedCameraObject);
      if (cam) return cam;
    }
    if (trackTime != null && scene.cameraTrack?.keyframes.length) {
      return interpolateCameraTrack(scene.cameraTrack, trackTime);
    }
    if (scene.viewMode === "shot" && scene.activeShotCameraId && !selectedCameraObject) {
      return resolveActiveCamera(scene);
    }
    return scene.camera;
  }, [scene, trackTime, selectedCameraObject, cameraPropViewMode]);
  const cameraTrack = scene?.cameraTrack ?? null;

  const lensCaptureOptions = useMemo(
    () => (scene ? defaultLensCaptureOptions(scene, selectedCameraObject?.id ?? null) : undefined),
    [scene, selectedCameraObject?.id]
  );

  const resolveCaptureCameraState = useCallback((): DirectorCameraState | null => {
    if (!scene) return null;
    return resolveLensCaptureCameraState(
      scene,
      selectedCameraObject,
      liveCameraRef.current,
      activeCamera
    );
  }, [activeCamera, scene, selectedCameraObject]);

  const handleCameraLiveTransform = useCallback(
    (id: string, transform: DirectorObject["transform"]) => {
      const obj = scene?.objects.find((o) => o.id === id);
      if (!obj || obj.kind !== "camera" || !obj.lookAt) return;
      const lookAt = syncCameraLookAtFromTransform(transform, obj.lookAt);
      liveCameraRef.current = {
        position: [...transform.position],
        target: lookAt,
        fov: obj.fov ?? 45,
      };
    },
    [scene?.objects]
  );

  useEffect(() => {
    if (!nodeId || !projectId) return;
    let cancelled = false;
    setLoading(true);
    sceneLoadedRef.current = false;

    void (async () => {
      try {
        const record = await fetchDirectorScene(projectId, nodeId);
        if (cancelled) return;
        const initial = record?.scene
          ? normalizeDirectorScene(record.scene)
          : createDefaultDirectorScene();
        setScene(initial);
        setSelectedObjectId(null);
        if (!record) {
          void saveDirectorScene(projectId, nodeId, initial).then((saved) => {
            if (!cancelled) updateNodeParam(nodeId, "sceneStateKey", saved.ossKey);
          });
        }
      } catch {
        if (!cancelled) {
          setScene(createDefaultDirectorScene());
          toast.error("加载场景失败，已使用默认布局");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          sceneLoadedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nodeId, projectId, updateNodeParam]);

  const persistScene = useCallback(
    async (nextScene: DirectorSceneState) => {
      if (!projectId || !nodeId) return;
      setSaveState("saving");
      try {
        const record = await saveDirectorScene(projectId, nodeId, nextScene);
        updateNodeParam(nodeId, "sceneStateKey", record.ossKey);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [nodeId, projectId, updateNodeParam]
  );

  const scheduleSave = useCallback(
    (nextScene: DirectorSceneState) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistScene(nextScene);
      }, 600);
    },
    [persistScene]
  );

  const patchScene = useCallback(
    (updater: (prev: DirectorSceneState) => DirectorSceneState) => {
      setScene((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        if (sceneLoadedRef.current) scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  const handleObjectTransform = useCallback(
    (id: string, transform: DirectorObject["transform"]) => {
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) => {
          if (obj.id !== id) return obj;
          const next: DirectorObject = { ...obj, transform };
          if (obj.kind === "camera" && obj.lookAt) {
            next.lookAt = syncCameraLookAtFromTransform(transform, obj.lookAt);
          }
          return next;
        }),
      }));
      liveCameraRef.current = null;
    },
    [patchScene]
  );

  const selectSceneObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
    liveCameraRef.current = null;
    if (!id) return;
    const obj = scene?.objects.find((o) => o.id === id);
    if (obj?.kind === "camera") {
      setCameraPropViewMode("thirdPerson");
    }
  }, [scene?.objects]);

  const updateSelectedObjectField = useCallback(
    (patch: Partial<DirectorObject>) => {
      if (!selectedObjectId) return;
      liveCameraRef.current = null;
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) =>
          obj.id === selectedObjectId ? { ...obj, ...patch } : obj
        ),
      }));
    },
    [patchScene, selectedObjectId]
  );

  const setObjectPositionAxis = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      if (!selectedObject) return;
      liveCameraRef.current = null;
      const pos = [...selectedObject.transform.position] as [number, number, number];
      pos[axis] = value;
      handleObjectTransform(selectedObject.id, {
        ...selectedObject.transform,
        position: pos,
      });
    },
    [handleObjectTransform, selectedObject]
  );

  const setObjectLookAtAxis = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      if (!selectedObject || selectedObject.kind !== "camera") return;
      liveCameraRef.current = null;
      const lookAt = [...(selectedObject.lookAt ?? [0, 1, 0])] as [number, number, number];
      lookAt[axis] = value;
      handleObjectTransform(selectedObject.id, {
        ...selectedObject.transform,
        rotation: rotationFromPositionLookAt(selectedObject.transform.position, lookAt),
      });
      updateSelectedObjectField({ lookAt, lookAtMode: "manual", lookAtObjectId: null });
    },
    [handleObjectTransform, selectedObject, updateSelectedObjectField]
  );

  const handleEditorCameraChange = useCallback(
    (camera: DirectorSceneState["camera"]) => {
      patchScene((prev) => ({ ...prev, camera }));
    },
    [patchScene]
  );

  const setViewMode = useCallback(
    (mode: DirectorViewMode) => {
      patchScene((prev) => ({ ...prev, viewMode: mode }));
    },
    [patchScene]
  );

  const addShotFromCurrentView = useCallback(() => {
    const current = captureApiRef.current?.getCurrentCamera();
    if (!current) {
      toast.error("编辑器尚未就绪");
      return;
    }
    patchScene((prev) => {
      const shot = newShotCamera(prev.shotCameras.length, current);
      return {
        ...prev,
        shotCameras: [...prev.shotCameras, shot],
        activeShotCameraId: shot.id,
        viewMode: "shot",
      };
    });
    toast.success("已保存当前视角为机位");
  }, [patchScene]);

  const selectShotCamera = useCallback(
    (id: string) => {
      setSelectedObjectId(null);
      patchScene((prev) => ({
        ...prev,
        activeShotCameraId: id,
        viewMode: "shot",
      }));
    },
    [patchScene]
  );

  const removeShotCamera = useCallback(
    (id: string) => {
      patchScene((prev) => {
        const shotCameras = prev.shotCameras.filter((c) => c.id !== id);
        const activeShotCameraId =
          prev.activeShotCameraId === id ? shotCameras[0]?.id ?? null : prev.activeShotCameraId;
        const viewMode =
          prev.viewMode === "shot" && !activeShotCameraId ? "director" : prev.viewMode;
        return { ...prev, shotCameras, activeShotCameraId, viewMode };
      });
    },
    [patchScene]
  );

  const setLightingPreset = useCallback(
    (preset: LightingPresetId) => {
      patchScene((prev) => ({ ...prev, lighting: { preset } }));
    },
    [patchScene]
  );

  const handleBonePoseChange = useCallback(
    (objectId: string, bone: string, rotation: [number, number, number]) => {
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) => {
          if (obj.id !== objectId || obj.kind !== "character") return obj;
          return {
            ...obj,
            bonePose: { ...(obj.bonePose ?? createDefaultBonePose(obj.gender ?? "male")), [bone]: rotation },
          };
        }),
      }));
    },
    [patchScene]
  );

  const applyBonePosePreset = useCallback(
    (pose: DirectorBonePose) => {
      if (!selectedObjectId) return;
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) =>
          obj.id === selectedObjectId && obj.kind === "character" ? { ...obj, bonePose: pose } : obj
        ),
      }));
    },
    [patchScene, selectedObjectId]
  );

  const assignCharacterModel = useCallback(
    (assetId: string | undefined, targetId?: string | null) => {
      const objectId = targetId ?? selectedObjectId;
      if (!objectId) return;
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) =>
          obj.id === objectId && obj.kind === "character"
            ? { ...obj, modelAssetId: assetId, shape: "model" }
            : obj
        ),
      }));
    },
    [patchScene, selectedObjectId]
  );

  const setCharacterModelScale = useCallback(
    (scale: number) => {
      if (!selectedObjectId) return;
      const next = Number.isFinite(scale) && scale > 0 ? scale : 1;
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) =>
          obj.id === selectedObjectId && obj.kind === "character"
            ? { ...obj, modelScale: next }
            : obj
        ),
      }));
    },
    [patchScene, selectedObjectId]
  );

  const handleModelFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const rawFiles = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (!rawFiles.length || !projectId) return;

      const bundlePattern = /\.(glb|gltf|bin|png|jpe?g|webp|ktx2?)$/i;
      const files = rawFiles.filter((f) => bundlePattern.test(f.name));
      const glb = files.find((f) => /\.glb$/i.test(f.name));
      const gltf = files.find((f) => /\.gltf$/i.test(f.name));
      const hasOnlyGlb = Boolean(glb) && !gltf && files.length === 1;

      if (!gltf && !glb) {
        toast.error("请上传 .glb 或 .gltf 模型文件（GLTF 请同时选中 .gltf 与 buffer.bin）");
        return;
      }

      if (gltf && !files.some((f) => /\.bin$/i.test(f.name))) {
        toast.error("GLTF 模型需同时上传 buffer.bin 等附属文件");
        return;
      }

      setUploadingModel(true);
      try {
        const asset = hasOnlyGlb
          ? await uploadAsset({
              file: glb!,
              projectId,
              category: "model",
              subcategory: DIRECTOR_MODEL_SUBCATEGORY,
              title: glb!.name.replace(/\.[^.]+$/, "") || "人模",
            })
          : await uploadModelBundle({
              files,
              projectId,
              subcategory: DIRECTOR_MODEL_SUBCATEGORY,
              title: (gltf ?? glb)?.name.replace(/\.[^.]+$/, "") || "人模",
            });
        if (!selectedObjectId) {
          patchScene((prev) => {
            const obj = newDirectorObject("character", "model", prev.objects);
            obj.modelAssetId = asset.id;
            setSelectedObjectId(obj.id);
            return { ...prev, objects: [...prev.objects, obj] };
          });
        } else {
          assignCharacterModel(asset.id);
        }
        toast.success(hasOnlyGlb ? "GLB 人模已上传并绑定" : "GLTF 模型包已上传并绑定");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "人模上传失败");
      } finally {
        setUploadingModel(false);
      }
    },
    [assignCharacterModel, patchScene, projectId, selectedObjectId]
  );

  const addObject = useCallback(
    (kind: DirectorObject["kind"], shape: DirectorObject["shape"]) => {
      patchScene((prev) => {
        const obj = newDirectorObject(kind, shape, prev.objects);
        setSelectedObjectId(obj.id);
        return {
          ...prev,
          objects: [...prev.objects, obj],
          viewMode: "director",
        };
      });
    },
    [patchScene]
  );

  const addCameraObject = useCallback(() => {
    const current = captureApiRef.current?.getCurrentCamera();
    patchScene((prev) => {
      const obj = newDirectorCameraObject(
        prev.objects,
        prev.objects.length * 1.5,
        current ?? undefined
      );
      setSelectedObjectId(obj.id);
      setCameraPropViewMode("thirdPerson");
      return {
        ...prev,
        objects: [...prev.objects, obj],
        viewMode: "director",
      };
    });
    toast.success("已添加摄像机");
  }, [patchScene]);

  const addBuiltinModel = useCallback(
    (builtinId: string) => {
      const preset = findBuiltinModel(builtinId);
      if (!preset) return;
      patchScene((prev) => {
        const base = newDirectorObject(preset.kind, preset.shape, prev.objects);
        const gender = builtinId === "mannequin_female" ? "female" : builtinId === "mannequin_male" ? "male" : undefined;
        const obj: DirectorObject = {
          ...base,
          builtinModelId: preset.kind === "character" ? preset.id : undefined,
          shape: preset.kind === "character" ? "model" : preset.shape,
          gender,
          bonePose: gender ? createDefaultBonePose(gender) : undefined,
          transform:
            gender != null
              ? { ...base.transform, position: [base.transform.position[0], 0, base.transform.position[2]] }
              : base.transform,
        };
        setSelectedObjectId(obj.id);
        return {
          ...prev,
          objects: [...prev.objects, obj],
          viewMode: "director",
        };
      });
    },
    [patchScene]
  );

  const patchSceneSettings = useCallback(
    (patch: Partial<DirectorSceneSettings>) => {
      patchScene((prev) => ({
        ...prev,
        sceneSettings: {
          ...prev.sceneSettings,
          ...patch,
          ground: patch.ground ? { ...prev.sceneSettings.ground, ...patch.ground } : prev.sceneSettings.ground,
          panorama:
            patch.panorama === undefined
              ? prev.sceneSettings.panorama
              : patch.panorama,
        },
      }));
    },
    [patchScene]
  );

  /** 导演台全景图仅允许选择本项目已有图片资产，禁止本地文件直传。 */
  const handlePanoramaAssetSelect = useCallback(
    (asset: Asset) => {
      if (asset.category !== "image") {
        toast.error("请选择图片资产");
        return;
      }
      if (asset.fileUrl) setPanoramaUploadUrl(asset.fileUrl);
      patchSceneSettings({
        panorama: {
          assetId: asset.id,
          horizontalRotation: 0,
          sphereRadius: 80,
        },
      });
      setPanoramaAssetPickerOpen(false);
      toast.success("全景背景已从资产设置");
    },
    [patchSceneSettings]
  );

  const handleToolbarScreenshot = useCallback(async () => {
    if (!captureApiRef.current || !scene || !projectId || !lensCaptureOptions) return;
    const current = captureApiRef.current.getCurrentCamera();
    if (!current) {
      toast.error("编辑器尚未就绪");
      return;
    }

    setCapturing(true);
    try {
      const camObj = newDirectorCameraObject(
        scene.objects,
        scene.objects.length * 1.5,
        current
      );
      const shotIndex = (camObj.screenshots?.length ?? 0) + 1;
      const rgb = captureApiRef.current.captureRgb(current, {
        ...lensCaptureOptions,
        hideObjectIds: [...(lensCaptureOptions.hideObjectIds ?? []), camObj.id],
      });
      const file = await dataUrlToFile(rgb, `director-shot-${nodeId}-${Date.now()}.png`);
      const asset = await uploadAsset({
        file,
        projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: `${camObj.name}-${String(shotIndex).padStart(2, "0")}`,
      });

      const screenshot = {
        id: `shot_${Date.now()}`,
        name: `${camObj.name}-${String(shotIndex).padStart(2, "0")}`,
        assetId: asset.id,
        createdAt: new Date().toISOString(),
      };

      patchScene((prev) => ({
        ...prev,
        objects: [
          ...prev.objects,
          { ...camObj, screenshots: [screenshot] },
        ],
        viewMode: "director",
      }));
      setSelectedObjectId(camObj.id);
      setCameraPropViewMode("thirdPerson");
      if (nodeId) {
        const linked = writeDirectorCaptureToLinkedShot({
          directorNodeId: nodeId,
          assetId: asset.id,
          cameraObjectId: camObj.id,
        });
        toast.success(linked ? "已创建机位并截图，已回写故事板草图" : "已创建机位并截图");
      } else {
        toast.success("已创建机位并截图");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "截图失败");
    } finally {
      setCapturing(false);
    }
  }, [lensCaptureOptions, nodeId, projectId, scene, patchScene]);

  const handleSelectedCameraScreenshot = useCallback(async () => {
    if (
      !captureApiRef.current ||
      !scene ||
      !projectId ||
      !selectedCameraObject ||
      selectedCameraObject.kind !== "camera" ||
      !lensCaptureOptions
    ) {
      return;
    }

    setCapturing(true);
    try {
      const cameraState =
        liveCameraRef.current ?? cameraObjectToState(selectedCameraObject);
      if (!cameraState) {
        toast.error("无法读取摄像机参数");
        return;
      }

      const hideCameraIds = scene.objects
        .filter((o) => o.kind === "camera")
        .map((o) => o.id);
      const rgb = captureApiRef.current.captureRgb(cameraState, {
        ...lensCaptureOptions,
        hideObjectIds: hideCameraIds,
      });

      const shotIndex = (selectedCameraObject.screenshots?.length ?? 0) + 1;
      const shotName = `${selectedCameraObject.name}-${String(shotIndex).padStart(2, "0")}`;
      const file = await dataUrlToFile(
        rgb,
        `director-cam-${selectedCameraObject.id}-${Date.now()}.png`
      );
      const asset = await uploadAsset({
        file,
        projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: shotName,
      });

      const screenshot = {
        id: `shot_${Date.now()}`,
        name: shotName,
        assetId: asset.id,
        createdAt: new Date().toISOString(),
      };

      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((obj) =>
          obj.id === selectedCameraObject.id
            ? { ...obj, screenshots: [...(obj.screenshots ?? []), screenshot] }
            : obj
        ),
      }));
      if (nodeId) {
        const linked = writeDirectorCaptureToLinkedShot({
          directorNodeId: nodeId,
          assetId: asset.id,
          cameraObjectId: selectedCameraObject.id,
        });
        toast.success(linked ? "相机截图已回写故事板草图" : "相机截图已保存到资产");
      } else {
        toast.success("相机截图已保存到资产");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "截图失败");
    } finally {
      setCapturing(false);
    }
  }, [
    lensCaptureOptions,
    nodeId,
    patchScene,
    projectId,
    scene,
    selectedCameraObject,
  ]);

  const setObjectRotationAxis = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      if (!selectedObject) return;
      const rot = [...selectedObject.transform.rotation] as [number, number, number];
      rot[axis] = value;
      handleObjectTransform(selectedObject.id, {
        ...selectedObject.transform,
        rotation: rot,
      });
    },
    [handleObjectTransform, selectedObject]
  );

  const setObjectScaleAxis = useCallback(
    (axis: 0 | 1 | 2, value: number) => {
      if (!selectedObject) return;
      const scale = [...selectedObject.transform.scale] as [number, number, number];
      scale[axis] = Math.max(0.01, value);
      handleObjectTransform(selectedObject.id, {
        ...selectedObject.transform,
        scale,
      });
    },
    [handleObjectTransform, selectedObject]
  );

  const setObjectUniformScale = useCallback(
    (value: number) => {
      if (!selectedObject) return;
      const v = Math.max(0.01, value);
      handleObjectTransform(selectedObject.id, {
        ...selectedObject.transform,
        scale: [v, v, v],
      });
    },
    [handleObjectTransform, selectedObject]
  );

  const setObjectColor = useCallback(
    (color: string) => updateSelectedObjectField({ color }),
    [updateSelectedObjectField]
  );

  const updateCameraLookAtMode = useCallback(
    (lookAtMode: "manual" | "target") => {
      updateSelectedObjectField({ lookAtMode });
    },
    [updateSelectedObjectField]
  );

  const updateCameraLookAtObject = useCallback(
    (lookAtObjectId: string | null) => {
      if (!selectedObject || selectedObject.kind !== "camera") return;
      if (!lookAtObjectId) {
        updateSelectedObjectField({ lookAtObjectId: null, lookAtMode: "manual" });
        return;
      }
      const target = scene?.objects.find((o) => o.id === lookAtObjectId);
      if (!target) return;
      const lookAt = [...target.transform.position] as [number, number, number];
      handleObjectTransform(selectedObject.id, {
        ...selectedObject.transform,
        rotation: rotationFromPositionLookAt(selectedObject.transform.position, lookAt),
      });
      updateSelectedObjectField({
        lookAtObjectId,
        lookAtMode: "target",
        lookAt,
      });
    },
    [handleObjectTransform, scene?.objects, selectedObject, updateSelectedObjectField]
  );

  const removeSelected = useCallback(
    (id?: string | null) => {
      const targetId = id ?? selectedObjectId;
      if (!targetId) return;
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.filter((obj) => obj.id !== targetId),
      }));
      setSelectedObjectId((current) => (current === targetId ? null : current));
    },
    [patchScene, selectedObjectId]
  );

  const selectCameraObject = useCallback((id: string) => {
    setSelectedObjectId(id);
    setCameraPropViewMode("thirdPerson");
  }, []);

  const handleCapture = useCallback(async () => {
    if (!captureApiRef.current || !nodeId || !projectId || !scene || !lensCaptureOptions) return;
    setCapturing(true);
    try {
      const cameraState = resolveCaptureCameraState() ?? resolveActiveCamera(scene);
      const channels = captureApiRef.current.capture(
        cameraState,
        scene.objects,
        lensCaptureOptions
      );
      const shotSuffix =
        scene.viewMode === "shot" && scene.activeShotCameraId
          ? `-${scene.shotCameras.find((c) => c.id === scene.activeShotCameraId)?.name ?? "机位"}`
          : trackTime != null
            ? `-t${trackTime.toFixed(1)}s`
            : "";

      const uploaded = await uploadDirectorChannels({
        projectId,
        nodeId: nodeId,
        label,
        suffix: shotSuffix,
        channels,
      });
      applyNodeGeneratedMedia(nodeId, "imageUrl", uploaded.rgb.fileUrl, uploaded.rgb.id);
      applyChannelsToNodeParams(updateNodeParam, nodeId, uploaded);
      toast.success("五通道截图已写入画布节点");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "截图失败");
    } finally {
      setCapturing(false);
    }
  }, [
    lensCaptureOptions,
    nodeId,
    label,
    projectId,
    resolveCaptureCameraState,
    scene,
    trackTime,
    applyNodeGeneratedMedia,
    updateNodeParam,
  ]);

  /** 退出导演台前：把当前视口 RGB 写入节点，供卡片与下游参考图使用 */
  const persistExitPreview = useCallback(async () => {
    if (!captureApiRef.current || !nodeId || !projectId || !scene || !lensCaptureOptions) return;
    try {
      const cameraState =
        resolveCaptureCameraState() ??
        captureApiRef.current.getCurrentCamera() ??
        resolveActiveCamera(scene);
      if (!cameraState) return;
      const hideCameraIds = scene.objects
        .filter((o) => o.kind === "camera")
        .map((o) => o.id);
      const rgb = captureApiRef.current.captureRgb(cameraState, {
        ...lensCaptureOptions,
        hideObjectIds: hideCameraIds,
      });
      const file = await dataUrlToFile(rgb, `director-exit-${nodeId}-${Date.now()}.png`);
      const asset = await uploadAsset({
        file,
        projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: `${label} 当前画面`,
      });
      applyNodeGeneratedMedia(nodeId, "imageUrl", asset.fileUrl, asset.id);
    } catch (err) {
      console.warn("[director] exit preview capture failed", err);
    }
  }, [
    applyNodeGeneratedMedia,
    label,
    lensCaptureOptions,
    nodeId,
    projectId,
    resolveCaptureCameraState,
    scene,
  ]);

  useEffect(() => {
    registerDirectorExitPreviewCapture(() => persistExitPreview());
    return () => registerDirectorExitPreviewCapture(null);
  }, [persistExitPreview]);

  const initCameraTrack = useCallback(() => {
    patchScene((prev) => ({
      ...prev,
      cameraTrack: prev.cameraTrack ?? createDefaultCameraTrack(),
    }));
  }, [patchScene]);

  const addTrackKeyframe = useCallback(() => {
    const current = captureApiRef.current?.getCurrentCamera();
    if (!current) return;
    patchScene((prev) => {
      const track = prev.cameraTrack ?? createDefaultCameraTrack();
      const time = trackTime ?? track.keyframes.at(-1)?.time ?? 0;
      const keyframe = newCameraKeyframe(time, current);
      return {
        ...prev,
        cameraTrack: { ...track, keyframes: [...track.keyframes, keyframe].sort((a, b) => a.time - b.time) },
      };
    });
    toast.success("已添加镜头关键帧");
  }, [patchScene, trackTime]);

  const exportTrackFrames = useCallback(async () => {
    if (!captureApiRef.current || !scene?.cameraTrack || !nodeId || !projectId || !lensCaptureOptions) {
      return;
    }
    if (scene.cameraTrack.keyframes.length < 2) {
      toast.error("至少需要 2 个关键帧");
      return;
    }
    setExportingTrack(true);
    try {
      const times = trackFrameTimes(scene.cameraTrack).slice(0, 24);
      let count = 0;
      for (const t of times) {
        const cam = interpolateCameraTrack(scene.cameraTrack, t);
        const rgb = captureApiRef.current.captureRgb(cam, lensCaptureOptions);
        const file = await dataUrlToFile(rgb, `director-track-${nodeId}-${count}.png`);
        await uploadAsset({
          file,
          projectId,
          category: "image",
          subcategory: NODE_IMAGE_SUBCATEGORY,
          title: `${label} 轨迹帧 ${count + 1}`,
        });
        count += 1;
      }
      toast.success(`已导出 ${count} 张轨迹序列帧到素材库`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExportingTrack(false);
    }
  }, [lensCaptureOptions, nodeId, label, projectId, scene?.cameraTrack]);

  useEffect(() => {
    if (!trackPlaying || !scene?.cameraTrack) return;
    const track = scene.cameraTrack;
    const fromTime = trackPlayFromRef.current;
    const t0 = performance.now();

    const tick = (now: number) => {
      const t = Math.min(track.duration, fromTime + (now - t0) / 1000);
      setTrackTime(t);
      if (t >= track.duration) {
        setTrackPlaying(false);
        return;
      }
      trackRafRef.current = requestAnimationFrame(tick);
    };
    trackRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (trackRafRef.current) cancelAnimationFrame(trackRafRef.current);
    };
  }, [trackPlaying, scene?.cameraTrack]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "v" || e.key === "V") setTransformMode("translate");
      if (e.key === "r" || e.key === "R") setTransformMode("rotate");
      if (e.key === "s" || e.key === "S") setTransformMode("scale");
      if ((e.key === "Delete" || e.key === "Backspace") && selectedObjectId) {
        e.preventDefault();
        removeSelected();
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        const current = captureApiRef.current?.getCurrentCamera();
        if (!current) return;
        patchScene((prev) => {
          const shotCameras = [...prev.shotCameras];
          const existing = shotCameras[index];
          const updated = {
            ...(existing ?? newShotCamera(index, current)),
            position: [...current.position] as [number, number, number],
            target: [...current.target] as [number, number, number],
            fov: current.fov,
            name: existing?.name ?? `机位 ${index + 1}`,
          };
          if (index < shotCameras.length) {
            shotCameras[index] = updated;
          } else {
            while (shotCameras.length < index) {
              shotCameras.push(newShotCamera(shotCameras.length, current));
            }
            shotCameras.push(updated);
          }
          return {
            ...prev,
            shotCameras,
            activeShotCameraId: updated.id,
            viewMode: "shot" as const,
          };
        });
        toast.success(`机位 ${index + 1} 已更新`);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [patchScene, removeSelected, selectedObjectId]);

  const isCameraFirstPerson =
    selectedCameraObject != null && cameraPropViewMode === "firstPerson";
  const isCameraThirdPerson =
    selectedCameraObject != null && cameraPropViewMode === "thirdPerson";
  const viewBadge = trackTime != null
    ? `轨迹预览 ${(scene?.cameraTrack?.duration ?? 0).toFixed(0)}s`
    : isCameraFirstPerson
      ? "摄像机视角"
      : isCameraThirdPerson
        ? "第三人称"
        : scene?.viewMode === "shot"
          ? "机位视角"
          : null;
  const aspectRatio = scene?.sceneSettings?.aspectRatio ?? "16:9";

  const advancedPanel = scene ? (
    <details className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
      <summary className="cursor-pointer text-[10px] text-white/45">高级：布光 / 轨迹 / 五通道</summary>
      <div className="mt-2 flex flex-col gap-3">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setViewMode("director")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs ${
              scene.viewMode === "director" ? "bg-indigo-500/30 text-white" : "bg-white/5 text-white/50"
            }`}
          >
            <Film className="h-3 w-3" />
            自由视角
          </button>
          <button
            type="button"
            disabled={!scene.shotCameras.length}
            onClick={() => setViewMode("shot")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs disabled:opacity-30 ${
              scene.viewMode === "shot" ? "bg-indigo-500/30 text-white" : "bg-white/5 text-white/50"
            }`}
          >
            <Video className="h-3 w-3" />
            机位视角
          </button>
        </div>
        <select
          value={scene.lighting.preset}
          onChange={(e) => setLightingPreset(e.target.value as LightingPresetId)}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
        >
          {LIGHTING_PRESETS.map((p) => (
            <option key={p.id} value={p.id} className="bg-zinc-900">
              布光 · {p.label}
            </option>
          ))}
        </select>
        {cameraTrack ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  trackPlayFromRef.current = trackTime ?? 0;
                  setTrackPlaying(true);
                }}
                disabled={trackPlaying || cameraTrack.keyframes.length < 2}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-white/70 disabled:opacity-30"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setTrackTime(null)} className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/50">
                退出轨迹
              </button>
              <button type="button" onClick={addTrackKeyframe} className="flex-1 rounded-md bg-indigo-500/20 py-1 text-[10px] text-indigo-100">
                关键帧
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={cameraTrack.duration}
              step={0.1}
              value={trackTime ?? 0}
              onChange={(e) => setTrackTime(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <button
              type="button"
              disabled={exportingTrack || cameraTrack.keyframes.length < 2}
              onClick={() => void exportTrackFrames()}
              className="rounded-md bg-white/5 py-1.5 text-[10px] text-white/60 disabled:opacity-30"
            >
              导出轨迹序列
            </button>
          </div>
        ) : (
          <button type="button" onClick={initCameraTrack} className="text-[10px] text-indigo-300">
            启用镜头轨迹
          </button>
        )}
        <button
          type="button"
          disabled={capturing || loading}
          onClick={() => void handleCapture()}
          className="flex items-center justify-center gap-1.5 rounded-md bg-indigo-500/25 py-2 text-xs text-indigo-100 disabled:opacity-40"
        >
          {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          五通道截图
        </button>
      </div>
    </details>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" style={PANEL_STYLE}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-indigo-300" />
          <span className="text-sm font-medium text-white/90">3D 导演台</span>
          {saveState === "saving" ? (
            <span className="text-[10px] text-white/35">保存中…</span>
          ) : saveState === "saved" ? (
            <span className="text-[10px] text-emerald-400/80">已保存</span>
          ) : saveState === "error" ? (
            <span className="text-[10px] text-red-400/80">保存失败</span>
          ) : null}
        </div>
        {/* 顶栏仅保留自由视角（orbit）；机位预览改由选中摄像机 / 高级面板进入 */}
        <span className="w-16 text-right text-[10px] text-white/35">{label}</span>
      </div>

      <input ref={modelFileRef} type="file" accept={GLB_ACCEPT} multiple className="hidden" onChange={(e) => void handleModelFileChange(e)} />

      <div ref={stageBodyRef} className="relative flex min-h-0 flex-1">
        {!uiFullscreen ? (
          <aside
            className="relative z-20 flex w-48 shrink-0 flex-col overflow-x-hidden border-r border-white/10 bg-[rgba(18,18,28,0.98)] p-3"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-medium text-white/70">场景</p>
            <DirectorObjectList
              objects={scene?.objects ?? []}
              selectedId={selectedObjectId}
              onSelect={selectSceneObject}
              onRemove={(id) => removeSelected(id)}
            />
          </aside>
        ) : null}

        <div className="relative min-h-0 flex-1">
          <div
            ref={mainViewRef}
            className="director-stage-canvas pointer-events-auto absolute inset-3 select-none overflow-hidden rounded-lg border border-white/10"
          >
            {viewBadge ? (
              <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-md bg-black/50 px-2 py-1 text-[10px] text-indigo-200">
                {viewBadge}
              </div>
            ) : null}
          </div>
          {scene ? (
            <DirectorAspectOverlay containerRef={mainViewRef} aspectRatio={aspectRatio} />
          ) : null}
          {!loading && scene ? (
            <DirectorBottomToolbar
              transformMode={transformMode}
              aspectRatio={aspectRatio}
              fullscreen={uiFullscreen}
              uploadingModel={uploadingModel}
              onTransformModeChange={setTransformMode}
              onUploadModel={() => modelFileRef.current?.click()}
              onAddBuiltinModel={addBuiltinModel}
              onUploadPanorama={() => setPanoramaAssetPickerOpen(true)}
              onAddCamera={addCameraObject}
              onAspectRatioChange={(ratio: DirectorAspectRatio) => patchSceneSettings({ aspectRatio: ratio })}
              onScreenshot={() => void handleToolbarScreenshot()}
              onToggleFullscreen={() => setUiFullscreen((v) => !v)}
            />
          ) : null}
          {loading || !scene || !activeCamera ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(18,18,28,0.85)] text-sm text-white/40">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载场景…
            </div>
          ) : null}
        </div>

        {!uiFullscreen ? (
          <aside
            className="relative z-20 flex w-60 shrink-0 flex-col gap-3 overflow-x-hidden overflow-y-auto overscroll-contain border-l border-white/10 bg-[rgba(18,18,28,0.98)] p-3 [contain:paint]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {selectedCameraObject ? (
              <DirectorCameraInspector
                object={selectedCameraObject}
                cameraObjects={cameraObjects}
                targetObjects={targetObjects}
                assets={assets}
                cameraViewMode={cameraPropViewMode}
                onCameraViewModeChange={setCameraPropViewMode}
                onSelectCamera={selectCameraObject}
                onNameChange={(name) => updateSelectedObjectField({ name })}
                onPositionChange={setObjectPositionAxis}
                onLookAtModeChange={updateCameraLookAtMode}
                onLookAtObjectChange={updateCameraLookAtObject}
                onLookAtChange={setObjectLookAtAxis}
                onFovChange={(fov) => updateSelectedObjectField({ fov })}
                lensPreviewTrackRef={lensPreviewTrackRef}
                onCaptureScreenshot={() => void handleSelectedCameraScreenshot()}
                capturing={capturing}
                aspectRatio={aspectRatio}
              />
            ) : selectedObject && selectedObject.kind !== "camera" ? (
              <>
                <DirectorModelInspector
                  object={selectedObject}
                  onNameChange={(name) => updateSelectedObjectField({ name })}
                  onColorChange={setObjectColor}
                  onPositionChange={setObjectPositionAxis}
                  onRotationChange={setObjectRotationAxis}
                  onScaleChange={setObjectScaleAxis}
                  onUniformScaleChange={setObjectUniformScale}
                />
                {selectedObject.kind === "character" && isMannequinBuiltinModel(selectedObject.builtinModelId) ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] text-white/45">人体编辑</span>
                      <div className="flex rounded-md border border-white/10 bg-white/5 p-0.5">
                        <button
                          type="button"
                          onClick={() => setMannequinEditMode("transform")}
                          className={`flex-1 rounded px-2 py-1.5 text-[11px] transition-colors ${
                            mannequinEditMode === "transform"
                              ? "bg-indigo-500/30 text-indigo-100"
                              : "text-white/55 hover:bg-white/10 hover:text-white/80"
                          }`}
                        >
                          坐标轴
                        </button>
                        <button
                          type="button"
                          onClick={() => setMannequinEditMode("pose")}
                          className={`flex-1 rounded px-2 py-1.5 text-[11px] transition-colors ${
                            mannequinEditMode === "pose"
                              ? "bg-indigo-500/30 text-indigo-100"
                              : "text-white/55 hover:bg-white/10 hover:text-white/80"
                          }`}
                        >
                          关节
                        </button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-white/35">
                        {mannequinEditMode === "pose"
                          ? "视口显示关节手柄，可直接拖拽骨骼；物体坐标轴已关闭。"
                          : "视口显示物体坐标轴；关节仍可在下方数值面板调整。"}
                      </p>
                    </div>
                    <DirectorPosePanel
                      bonePose={selectedObject.bonePose ?? createDefaultBonePose(selectedObject.gender ?? "male")}
                      gender={selectedObject.gender ?? "male"}
                      onPresetApply={applyBonePosePreset}
                      onUpdateBone={(bone, rotation) => handleBonePoseChange(selectedObject.id, bone, rotation)}
                    />
                  </>
                ) : null}
                {selectedObject.kind === "character" ? (
                  modelAssets.length > 0 ? (
                    <select
                      value={selectedObject.modelAssetId ?? ""}
                      onChange={(e) => assignCharacterModel(e.target.value || undefined)}
                      className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/80"
                    >
                      <option value="" className="bg-zinc-900">内置人模 / 上传 GLB</option>
                      {modelAssets.map((asset) => (
                        <option key={asset.id} value={asset.id} className="bg-zinc-900">
                          {asset.title}
                        </option>
                      ))}
                    </select>
                  ) : null
                ) : null}
              </>
            ) : scene ? (
              <>
                <DirectorSceneInspector
                  settings={scene.sceneSettings}
                  panoramaPreviewUrl={panoramaPreviewUrl}
                  onPatch={patchSceneSettings}
                  onPanoramaUpload={() => setPanoramaAssetPickerOpen(true)}
                />
                {advancedPanel}
              </>
            ) : null}
          </aside>
        ) : null}

        {!loading && scene && activeCamera ? (
          <DirectorStageEditor
            scene={scene}
            activeCamera={activeCamera}
            trackPreviewActive={trackTime != null}
            selectedObjectId={selectedObjectId}
            cameraPropViewMode={selectedCameraObject ? cameraPropViewMode : null}
            liveCameraRef={liveCameraRef}
            transformMode={transformMode}
            mannequinEditMode={mannequinEditMode}
            stageBodyRef={stageBodyRef}
            mainViewRef={mainViewRef}
            panoramaUrl={panoramaPreviewUrl}
            onSelectObject={selectSceneObject}
            onObjectTransform={handleObjectTransform}
            onCameraLiveTransform={handleCameraLiveTransform}
            onEditorCameraChange={handleEditorCameraChange}
            onShotCameraSelect={selectShotCamera}
            lensPreview={
              selectedCameraObject
                ? {
                    trackRef: lensPreviewTrackRef,
                    scene,
                    cameraId: selectedCameraObject.id,
                    liveCameraRef,
                  }
                : null
            }
            onCaptureReady={(api) => {
              captureApiRef.current = api;
            }}
            onBonePoseChange={handleBonePoseChange}
            resolveCharacterModelUrl={resolveCharacterModelUrl}
          />
        ) : null}
      </div>
      {panoramaAssetPickerOpen ? (
        <MediaAssetPicker
          category="image"
          onSelect={handlePanoramaAssetSelect}
          onClose={() => setPanoramaAssetPickerOpen(false)}
          overlayZIndex={120}
        />
      ) : null}
    </div>
  );
}
