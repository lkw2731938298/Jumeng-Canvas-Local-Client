"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Box,
  Clapperboard,
  Globe,
  Lightbulb,
  ListTree,
  Loader2,
  Move3d,
  PersonStanding,
  SlidersHorizontal,
  Video,
  Wand2,
  X,
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
import type { LightingPresetId } from "@/lib/director/lightingPresets";
import { interpolateCameraTrack } from "@/lib/director/cameraTrack";
import { normalizeDirectorScene } from "@/lib/director/sceneNormalize";
import {
  defaultLensCaptureOptions,
  resolveLensCaptureCameraState,
} from "@/lib/director/lensCapture";
import { findBuiltinModel } from "@/lib/director/builtinModels";
import { syncCameraLookAtFromTransform, rotationFromPositionLookAt } from "@/lib/director/shotPreview";
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
import { DirectorOutliner } from "./DirectorOutliner";
import { DirectorShotStrip } from "./DirectorShotStrip";
import { DirectorLensMonitor } from "./DirectorLensMonitor";
import { DirectorLightingCards } from "./DirectorLightingCards";
import { DirectorSmartShots } from "./DirectorSmartShots";
import { DirectorCompositionDoctor } from "./DirectorCompositionDoctor";
import { GLASS_PANEL, PanelSection } from "./directorUi";
import { framingToCameraFields } from "@/lib/director/cameraFraming";
import { DirectorSceneInspector } from "./DirectorSceneInspector";
import { DirectorModelInspector } from "./DirectorModelInspector";
import { DirectorCameraInspector } from "./DirectorCameraInspector";
import { DirectorBottomToolbar } from "./DirectorBottomToolbar";
import { DirectorAspectOverlay } from "./DirectorAspectOverlay";
import { DirectorFilmGateTrack } from "./DirectorFilmGateTrack";
import { DirectorPosePanel } from "./DirectorPosePanel";
import { MediaAssetPicker } from "@/components/canvas/nodes/MediaAssetPicker";
import { DirectorAgentPanel } from "./DirectorAgentPanel";
import { DirectorModel3dDialog } from "./DirectorModel3dDialog";
import { registerDirectorLiveHost, useDirectorModel3dJobs } from "@/lib/director/model3dJobs";
import type { DirectorAgentHost } from "@/lib/director/agent/session";

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

  /** 刚上传的贴图 URL（manifest 刷新前也能立刻喂给 3D） */
  const [colorMapUrlOverrides, setColorMapUrlOverrides] = useState<Record<string, string>>({});

  /** 仅基础造具（立方体/球/柱/锥/面）可用贴图；人模与摄像机不加贴图 */
  const objectSupportsColorMap = useCallback((object: DirectorObject) => {
    if (object.kind !== "prop") return false;
    return ["box", "sphere", "cylinder", "cone", "plane"].includes(object.shape);
  }, []);

  /** 造具颜色贴图：优先用上传即时 URL，再查项目资产 */
  const resolveColorMapUrl = useCallback(
    (object: DirectorObject) => {
      if (!objectSupportsColorMap(object)) return null;
      const override = colorMapUrlOverrides[object.id];
      if (override) return override;
      const id = object.colorMapAssetId;
      if (!id) return null;
      return lookupAsset(assets, id)?.fileUrl ?? null;
    },
    [assets, colorMapUrlOverrides, objectSupportsColorMap]
  );

  const [scene, setScene] = useState<DirectorSceneState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [capturing, setCapturing] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<DirectorTransformMode>("translate");
  /** 人体模型右侧栏：坐标轴 ↔ 关节视口编辑 */
  const [mannequinEditMode, setMannequinEditMode] = useState<"transform" | "pose">("transform");
  const [trackTime, setTrackTime] = useState<number | null>(null);
  const [trackPlaying, setTrackPlaying] = useState(false);
  const [cameraPropViewMode, setCameraPropViewMode] = useState<CameraPropViewMode>("thirdPerson");
  const [uploadingModel, setUploadingModel] = useState(false);
  const [uploadingColorMap, setUploadingColorMap] = useState(false);
  const [uiFullscreen, setUiFullscreen] = useState(false);
  /** 取景框三分线 / 中心十字构图辅助 */
  const [showGuides, setShowGuides] = useState(false);
  /** 未选中对象时右侧检查器的分页：环境 / 灯光 / 分镜 */
  const [sceneTab, setSceneTab] = useState<"env" | "light" | "lens">("env");
  const [panoramaAssetPickerOpen, setPanoramaAssetPickerOpen] = useState(false);

  const modelFileRef = useRef<HTMLInputElement | null>(null);
  const [panoramaUploadUrl, setPanoramaUploadUrl] = useState<string | null>(null);

  const stageBodyRef = useRef<HTMLDivElement | null>(null);
  const mainViewRef = useRef<HTMLDivElement | null>(null);
  /** 画幅安全区：进机位时主 View 追踪此节点，与监视器同宽高比 */
  const filmGateRef = useRef<HTMLDivElement | null>(null);
  const lensPreviewTrackRef = useRef<HTMLDivElement | null>(null);
  const captureApiRef = useRef<DirectorCaptureApi | null>(null);
  const liveCameraRef = useRef<DirectorCameraState | null>(null);
  /** 拖拽机位时的临时 transform，镜头监视器与第一人称共用 */
  const liveCameraTransformRef = useRef<{ id: string; transform: DirectorObject["transform"] } | null>(null);
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
      liveCameraTransformRef.current = { id, transform };
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

  // ---------- 导演台 AI（对话搭场景 / 3D 生成） ----------
  const [agentOpen, setAgentOpen] = useState(false);
  const [model3dDialogOpen, setModel3dDialogOpen] = useState(false);
  /** 最新场景（AI 异步流程里读取，避免闭包拿到旧值） */
  const sceneRef = useRef<DirectorSceneState | null>(null);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  const model3dJobs = useDirectorModel3dJobs(projectId, nodeId);
  const model3dJobsRef = useRef(model3dJobs);
  useEffect(() => {
    model3dJobsRef.current = model3dJobs;
  }, [model3dJobs]);

  /** AI 整体替换场景（本轮 ops 结果 / 撤销快照） */
  const replaceSceneFromAgent = useCallback(
    (next: DirectorSceneState) => {
      sceneRef.current = next;
      patchScene(() => next);
    },
    [patchScene]
  );

  // 注册实时宿主：后台 3D 生成完成时直接替换占位物体
  useEffect(() => {
    if (!projectId || !nodeId) return;
    return registerDirectorLiveHost(projectId, nodeId, {
      getScene: () => sceneRef.current ?? createDefaultDirectorScene(),
      patchScene,
    });
  }, [nodeId, patchScene, projectId]);

  /** AI 截图：等视口渲染新场景 → 用指定摄像机截图 → 存素材 → 回写关联分镜 */
  const captureFromCameraForAgent = useCallback(
    async (cameraId: string): Promise<string> => {
      // 等 React 提交 + three.js 渲染几帧（GLB 可能还在加载，多等一会）
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise((r) => setTimeout(r, 600));
      const api = captureApiRef.current;
      const current = sceneRef.current;
      if (!api || !current || !projectId) throw new Error("3D 视口尚未就绪");
      const cam = current.objects.find((o) => o.id === cameraId);
      const cameraState = cam ? cameraObjectToState(cam) : null;
      if (!cam || !cameraState) throw new Error("找不到该摄像机");
      const rgb = api.captureRgb(cameraState, {
        ...defaultLensCaptureOptions(current, cameraId),
        hideObjectIds: current.objects.filter((o) => o.kind === "camera").map((o) => o.id),
      });
      const shotIndex = (cam.screenshots?.length ?? 0) + 1;
      const shotName = `${cam.name}-${String(shotIndex).padStart(2, "0")}`;
      const file = await dataUrlToFile(rgb, `director-ai-${cam.id}-${Date.now()}.png`);
      const asset = await uploadAsset({
        file,
        projectId,
        category: "image",
        subcategory: NODE_IMAGE_SUBCATEGORY,
        title: shotName,
      });
      const screenshot = { id: `shot_${Date.now()}`, name: shotName, assetId: asset.id, createdAt: new Date().toISOString() };
      patchScene((prev) => ({
        ...prev,
        objects: prev.objects.map((o) =>
          o.id === cam.id ? { ...o, screenshots: [...(o.screenshots ?? []), screenshot] } : o
        ),
      }));
      const linked = nodeId
        ? writeDirectorCaptureToLinkedShot({ directorNodeId: nodeId, assetId: asset.id, cameraObjectId: cam.id })
        : false;
      return linked ? `已截图并回写关联分镜草图（素材 ${asset.id}）` : `已截图存入素材库（素材 ${asset.id}，未关联分镜）`;
    },
    [nodeId, patchScene, projectId]
  );

  const agentHost = useMemo<DirectorAgentHost>(
    () => ({
      projectId,
      nodeId,
      getScene: () => sceneRef.current ?? createDefaultDirectorScene(),
      replaceScene: replaceSceneFromAgent,
      capture: captureFromCameraForAgent,
      imageAssets: assets
        .filter((a) => a.category === "image")
        .map((a) => ({ id: a.id, title: a.title || a.id, url: a.fileUrl })),
      modelAssets: assets
        .filter((a) => a.category === "model" || isGlbAsset(a))
        .filter(isGlbAsset)
        .map((a) => ({ id: a.id, title: a.title || a.id })),
      pendingModel3d: () =>
        model3dJobsRef.current
          .filter((j) => j.status === "running")
          .map((j) => ({ name: j.name, placeholderId: j.placeholderId, progress: j.progress })),
    }),
    [assets, captureFromCameraForAgent, nodeId, projectId, replaceSceneFromAgent]
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
      liveCameraTransformRef.current = null;
    },
    [patchScene]
  );

  const selectSceneObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
    liveCameraRef.current = null;
      liveCameraTransformRef.current = null;
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
      liveCameraTransformRef.current = null;
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
      liveCameraTransformRef.current = null;
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
      liveCameraTransformRef.current = null;
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

  // 旧「shotCameras + 机位视角」已被场景摄像机造具 +「进机位」替代；残留 shot 模式统一拉回自由视角
  useEffect(() => {
    if (scene?.viewMode === "shot") {
      setViewMode("director");
    }
  }, [scene?.viewMode, setViewMode]);

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
        viewMode: "director",
      };
    });
    toast.success("已保存当前视角为机位");
  }, [patchScene]);

  /** 点击书签标记：把自由视角相机挪到该书签，不再切入已废弃的 shot 锁定模式 */
  const selectShotCamera = useCallback(
    (id: string) => {
      setSelectedObjectId(null);
      patchScene((prev) => {
        const shot = prev.shotCameras.find((c) => c.id === id);
        if (!shot) return prev;
        return {
          ...prev,
          activeShotCameraId: id,
          viewMode: "director",
          camera: {
            position: [...shot.position] as [number, number, number],
            target: [...shot.target] as [number, number, number],
            fov: shot.fov,
          },
        };
      });
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
      patchScene((prev) => ({
        ...prev,
        lighting: { ...prev.lighting, preset },
      }));
    },
    [patchScene]
  );

  /** 调节灯组水平角 / 俯仰，与预设叠加 */
  const patchLightingAngles = useCallback(
    (patch: { yawDeg?: number; pitchDeg?: number }) => {
      patchScene((prev) => ({
        ...prev,
        lighting: { ...prev.lighting, ...patch },
      }));
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

  type CameraFramingFields = ReturnType<typeof framingToCameraFields>;

  /** 智能分镜 / 构图医生：把取景字段写到指定机位（或新建） */
  const applyFramingToCamera = useCallback(
    (cameraId: string | null, fields: CameraFramingFields, label: string, asNew: boolean) => {
      patchScene((prev) => {
        if (!asNew && cameraId) {
          return {
            ...prev,
            objects: prev.objects.map((obj) => {
              if (obj.id !== cameraId || obj.kind !== "camera") return obj;
              return {
                ...obj,
                name: obj.name,
                fov: fields.fov,
                lookAt: fields.lookAt,
                lookAtMode: fields.lookAtMode,
                lookAtObjectId: fields.lookAtObjectId,
                transform: {
                  ...obj.transform,
                  position: fields.position,
                  rotation: fields.rotation,
                },
              };
            }),
          };
        }
        const cam = newDirectorCameraObject(prev.objects, prev.objects.filter((o) => o.kind === "camera").length * 0.4, {
          position: fields.position,
          target: fields.lookAt,
          fov: fields.fov,
        });
        cam.name = label.slice(0, 40);
        cam.lookAt = fields.lookAt;
        cam.lookAtMode = fields.lookAtMode;
        cam.lookAtObjectId = fields.lookAtObjectId;
        cam.transform = {
          ...cam.transform,
          position: fields.position,
          rotation: fields.rotation,
        };
        setSelectedObjectId(cam.id);
        setCameraPropViewMode("thirdPerson");
        return { ...prev, objects: [...prev.objects, cam], viewMode: "director" };
      });
      liveCameraRef.current = null;
      liveCameraTransformRef.current = null;
      toast.success(asNew || !cameraId ? `已新建机位「${label}」` : `已修正「${label}」`);
    },
    [patchScene]
  );

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

  /** 上传图片作为当前造具贴图（人模不可用） */
  const handleColorMapUpload = useCallback(
    async (file: File) => {
      if (!projectId || !selectedObject || !objectSupportsColorMap(selectedObject)) {
        toast.error("仅立方体 / 球体 / 圆柱 / 圆锥 / 平面可上传贴图");
        return;
      }
      if (!file.type.startsWith("image/")) {
        toast.error("请选择图片文件");
        return;
      }
      setUploadingColorMap(true);
      try {
        const asset = await uploadAsset({
          file,
          projectId,
          category: "image",
          subcategory: NODE_IMAGE_SUBCATEGORY,
          title: `${selectedObject.name}-贴图`,
        });
        // 立刻挂上 fileUrl，不等 manifest 刷新（否则 3D 侧 colorMapUrl 为空）
        setColorMapUrlOverrides((prev) => ({ ...prev, [selectedObject.id]: asset.fileUrl }));
        updateSelectedObjectField({ colorMapAssetId: asset.id });
        toast.success("造具贴图已上传");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "贴图上传失败");
      } finally {
        setUploadingColorMap(false);
      }
    },
    [objectSupportsColorMap, projectId, selectedObject, updateSelectedObjectField]
  );

  const clearObjectColorMap = useCallback(() => {
    if (selectedObjectId) {
      setColorMapUrlOverrides((prev) => {
        const next = { ...prev };
        delete next[selectedObjectId];
        return next;
      });
    }
    updateSelectedObjectField({ colorMapAssetId: undefined });
  }, [selectedObjectId, updateSelectedObjectField]);

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
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        // 组合键只处理下方 Ctrl+数字 存机位
      } else if (e.key === "Tab") {
        // 专注模式：隐藏大纲 / 检查器 / 胶片条，只留视口与控制坞
        e.preventDefault();
        setUiFullscreen((v) => !v);
        return;
      } else if (e.key === "g" || e.key === "G") {
        setShowGuides((v) => !v);
        return;
      } else if (e.key === "Escape") {
        setSelectedObjectId(null);
        return;
      }
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
            // 仅存书签，不切入已废弃的「机位视角」锁定模式
            viewMode: "director" as const,
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
        : null;
  const aspectRatio = scene?.sceneSettings?.aspectRatio ?? "16:9";

  // ── 控制台布局派生数据 ──
  const stageStats = useMemo(() => {
    const objs = scene?.objects ?? [];
    return {
      characters: objs.filter((o) => o.kind === "character").length,
      props: objs.filter((o) => o.kind !== "character" && o.kind !== "camera").length,
      cameras: objs.filter((o) => o.kind === "camera").length,
    };
  }, [scene?.objects]);
  const panelsVisible = !uiFullscreen && !!scene && !loading;
  const model3dRunning = model3dJobs.some((j) => j.status === "running");
  /** 视口中间可用区域的左右边界（避开浮动面板），供胶片条 / 控制坞 / 监视器定位 */
  const centerLeft = panelsVisible ? "left-[calc(16rem+1.5rem)]" : "left-3";
  const centerRight = agentOpen
    ? "right-[calc(340px+1.5rem)]"
    : panelsVisible
      ? "right-[calc(18rem+1.5rem)]"
      : "right-3";
  const viewportBox = panelsVisible || agentOpen
    ? `top-3 bottom-3 ${centerLeft} ${centerRight} rounded-2xl ring-1 ring-white/[0.07]`
    : "inset-0";
  const selectionTitle = selectedObject
    ? selectedObject.kind === "camera"
      ? { tag: "摄像机", tone: "bg-amber-400/15 text-amber-200", icon: <Video className="h-4 w-4 text-amber-300" /> }
      : selectedObject.kind === "character"
        ? { tag: "人物", tone: "bg-indigo-400/15 text-indigo-200", icon: <PersonStanding className="h-4 w-4 text-indigo-300" /> }
        : { tag: "道具", tone: "bg-emerald-400/15 text-emerald-200", icon: <Box className="h-4 w-4 text-emerald-300" /> }
    : null;

  /** 未选中对象时的「分镜」分页：智能分镜 + 构图医生（已移除低频轨迹/五通道） */
  const doctorCamera =
    selectedCameraObject ?? scene?.objects.find((o) => o.kind === "camera") ?? null;
  const lensTab = scene ? (
    <div className="flex flex-col gap-4">
      <DirectorSmartShots
        objects={scene.objects}
        selectedCameraId={selectedCameraObject?.id ?? null}
        onApplyNew={(fields, label) => applyFramingToCamera(null, fields, label, true)}
        onReplaceSelected={(fields, label) =>
          applyFramingToCamera(selectedCameraObject?.id ?? null, fields, label, false)
        }
      />
      <DirectorCompositionDoctor
        camera={doctorCamera}
        objects={scene.objects}
        aspectRatio={aspectRatio}
        onApplyFix={(fields, tipTitle) =>
          applyFramingToCamera(doctorCamera?.id ?? null, fields, tipTitle, !doctorCamera)
        }
      />
    </div>
  ) : null;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#08080f]"
      style={{ border: "1px solid rgba(99, 102, 241, 0.28)" }}
    >
      {/* ── 顶栏：标识 / 场景统计 + 视角 / AI 导演 ── */}
      <header className="relative z-40 flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[rgba(10,10,18,0.92)] px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-lg shadow-indigo-500/25">
            <Clapperboard className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-wide text-white/90">导演控制台</span>
            <span className="flex items-center gap-1.5 text-[10px] text-white/35">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  saveState === "saving"
                    ? "animate-pulse bg-amber-400"
                    : saveState === "error"
                      ? "bg-red-400"
                      : saveState === "saved"
                        ? "bg-emerald-400"
                        : "bg-white/25"
                }`}
              />
              <span className="max-w-[160px] truncate">{label}</span>
              <span>
                {saveState === "saving" ? "· 保存中" : saveState === "error" ? "· 保存失败" : saveState === "saved" ? "· 已保存" : ""}
              </span>
            </span>
          </div>
        </div>

        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
          <div className="flex items-center gap-3 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[10px] text-white/55">
            <span className="flex items-center gap-1"><PersonStanding className="h-3 w-3 text-indigo-300" />{stageStats.characters}</span>
            <span className="flex items-center gap-1"><Box className="h-3 w-3 text-emerald-300" />{stageStats.props}</span>
            <span className="flex items-center gap-1"><Video className="h-3 w-3 text-amber-300" />{stageStats.cameras}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={loading || !scene}
            onClick={() => setAgentOpen((v) => !v)}
            title="用对话让 AI 摆人物、道具、机位和灯光"
            className={`group relative flex items-center gap-1.5 overflow-hidden rounded-full px-3.5 py-1.5 text-xs font-medium text-white transition-all disabled:opacity-40 ${
              agentOpen
                ? "bg-white/15 ring-1 ring-white/20"
                : "bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/20 hover:shadow-fuchsia-500/40"
            }`}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {agentOpen ? "收起 AI 导演" : "AI 导演"}
            {model3dRunning ? <Loader2 className="h-3 w-3 animate-spin text-amber-200" /> : null}
          </button>
        </div>
      </header>

      <input ref={modelFileRef} type="file" accept={GLB_ACCEPT} multiple className="hidden" onChange={(e) => void handleModelFileChange(e)} />

      {/* ── 舞台：3D 视口铺满，面板以浮层叠加 ── */}
      <div ref={stageBodyRef} className="relative min-h-0 flex-1">
        {/* 面板可见时视口收进两侧面板之间（取景框与截图范围一致）；专注模式铺满 */}
        <div
          ref={mainViewRef}
          className={`director-stage-canvas pointer-events-auto absolute select-none overflow-hidden ${viewportBox}`}
        >
          {scene ? (
            <DirectorFilmGateTrack
              containerRef={mainViewRef}
              trackRef={filmGateRef}
              aspectRatio={aspectRatio}
            />
          ) : null}
        </div>
        {scene ? (
          <div className={`pointer-events-none absolute z-[26] overflow-hidden ${viewportBox}`}>
            <DirectorAspectOverlay containerRef={mainViewRef} aspectRatio={aspectRatio} showGuides={showGuides} />
          </div>
        ) : null}

        {/* 视口 HUD：当前视角 / 操作提示 */}
        {scene && !loading ? (
          <div className={`pointer-events-none absolute top-6 z-30 flex justify-center ${centerLeft} ${centerRight}`}>
            {viewBadge ? (
              <span className="flex items-center gap-1.5 rounded-full border border-indigo-400/30 bg-indigo-500/20 px-3 py-1 text-[11px] text-indigo-100 backdrop-blur-md">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300" />
                {viewBadge}
              </span>
            ) : (
              <span className="rounded-full bg-black/35 px-3 py-1 text-[10px] text-white/40 backdrop-blur-md">
                左键旋转 · 右键平移 · 滚轮缩放 · V/R/S 变换 · G 构图线 · Tab 专注
              </span>
            )}
          </div>
        ) : null}

        {/* 左：场景大纲 */}
        {panelsVisible ? (
          <aside
            className={`absolute bottom-3 left-3 top-3 z-30 flex w-64 flex-col p-3 ${GLASS_PANEL}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <ListTree className="h-3.5 w-3.5 text-white/45" />
              <span className="text-xs font-medium text-white/80">场景大纲</span>
              <span className="ml-auto font-mono text-[10px] text-white/30">{scene?.objects.length ?? 0} 个对象</span>
            </div>
            <DirectorOutliner
              objects={scene?.objects ?? []}
              selectedId={selectedObjectId}
              disabled={loading || !scene}
              uploadingModel={uploadingModel}
              onSelect={selectSceneObject}
              onRemove={(id) => removeSelected(id)}
              onAddBuiltin={addBuiltinModel}
              onUploadModel={() => modelFileRef.current?.click()}
              onAddCamera={addCameraObject}
              onOpenModel3d={() => setModel3dDialogOpen(true)}
            />
          </aside>
        ) : null}

        {/* 右：上下文检查器 */}
        {panelsVisible && scene ? (
          <div
            className="absolute bottom-3 right-3 top-3 z-30 flex w-72 flex-col gap-3"
            onPointerDown={(e) => e.stopPropagation()}
          >
          {/* 导演监视器：选中摄像机时置于右栏顶部（主视口与画幅遮罩之外，镜头画面不被压暗） */}
          {selectedCameraObject && !agentOpen ? (
            <DirectorLensMonitor
              camera={selectedCameraObject}
              trackRef={lensPreviewTrackRef}
              aspectRatio={aspectRatio}
              viewMode={cameraPropViewMode}
              capturing={capturing}
              onViewModeChange={setCameraPropViewMode}
              onCapture={() => void handleSelectedCameraScreenshot()}
              onClose={() => setSelectedObjectId(null)}
            />
          ) : null}
          <aside className={`flex min-h-0 flex-1 flex-col overflow-hidden ${GLASS_PANEL}`}>
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06]">
                {selectionTitle ? selectionTitle.icon : <SlidersHorizontal className="h-4 w-4 text-white/60" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs font-medium text-white/90">
                  {selectedObject ? selectedObject.name : "场景设置"}
                </span>
                <span className="text-[10px] text-white/35">
                  {selectedObject ? "Esc 取消选中 · Delete 删除" : "未选中对象时调整整体环境"}
                </span>
              </div>
              {selectionTitle ? (
                <>
                  <span className={`rounded-md px-1.5 py-0.5 text-[9px] ${selectionTitle.tone}`}>{selectionTitle.tag}</span>
                  <button
                    type="button"
                    title="取消选中"
                    onClick={() => setSelectedObjectId(null)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : null}
            </div>

            {!selectedObject ? (
              <div className="flex gap-1 border-b border-white/[0.06] px-3 py-2">
                {(
                  [
                    { id: "env", label: "环境", icon: <Globe className="h-3 w-3" /> },
                    { id: "light", label: "灯光", icon: <Lightbulb className="h-3 w-3" /> },
                    { id: "lens", label: "分镜", icon: <Aperture className="h-3 w-3" /> },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSceneTab(tab.id)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors ${
                      sceneTab === tab.id ? "bg-indigo-500/25 text-white" : "text-white/45 hover:bg-white/[0.05] hover:text-white/80"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 [contain:paint]">
              {selectedCameraObject ? (
                <>
                  <DirectorCameraInspector
                    embedded
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
                    onCaptureScreenshot={() => void handleSelectedCameraScreenshot()}
                    capturing={capturing}
                    aspectRatio={aspectRatio}
                  />
                  <DirectorCompositionDoctor
                    camera={selectedCameraObject}
                    objects={scene.objects}
                    aspectRatio={aspectRatio}
                    onApplyFix={(fields, tipTitle) =>
                      applyFramingToCamera(selectedCameraObject.id, fields, tipTitle, false)
                    }
                  />
                </>
              ) : selectedObject ? (
                <>
                  {selectedObject.kind === "character" && isMannequinBuiltinModel(selectedObject.builtinModelId) ? (
                    <div className="flex rounded-xl bg-black/30 p-0.5">
                      {(
                        [
                          { id: "transform", label: "物体变换", icon: <Move3d className="h-3 w-3" /> },
                          { id: "pose", label: "关节摆姿", icon: <PersonStanding className="h-3 w-3" /> },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMannequinEditMode(m.id)}
                          className={`flex flex-1 items-center justify-center gap-1 rounded-[10px] py-1.5 text-[11px] transition-colors ${
                            mannequinEditMode === m.id ? "bg-indigo-500/35 text-white" : "text-white/50 hover:text-white/80"
                          }`}
                        >
                          {m.icon}
                          {m.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selectedObject.kind === "character" && isMannequinBuiltinModel(selectedObject.builtinModelId) && mannequinEditMode === "pose" ? (
                    <>
                      <p className="rounded-lg bg-indigo-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-indigo-100/70">
                        视口中直接拖拽关节手柄摆姿；也可用下方预设与数值微调。
                      </p>
                      <DirectorPosePanel
                        bonePose={selectedObject.bonePose ?? createDefaultBonePose(selectedObject.gender ?? "male")}
                        gender={selectedObject.gender ?? "male"}
                        onPresetApply={applyBonePosePreset}
                        onUpdateBone={(bone, rotation) => handleBonePoseChange(selectedObject.id, bone, rotation)}
                      />
                    </>
                  ) : (
                    <DirectorModelInspector
                      object={selectedObject}
                      onNameChange={(name) => updateSelectedObjectField({ name })}
                      onColorChange={setObjectColor}
                      onColorMapFile={
                        objectSupportsColorMap(selectedObject)
                          ? (file) => void handleColorMapUpload(file)
                          : undefined
                      }
                      onColorMapClear={
                        objectSupportsColorMap(selectedObject) ? clearObjectColorMap : undefined
                      }
                      colorMapPreviewUrl={
                        objectSupportsColorMap(selectedObject)
                          ? resolveColorMapUrl(selectedObject)
                          : null
                      }
                      colorMapUploading={uploadingColorMap}
                      onPositionChange={setObjectPositionAxis}
                      onRotationChange={setObjectRotationAxis}
                      onScaleChange={setObjectScaleAxis}
                      onUniformScaleChange={setObjectUniformScale}
                    />
                  )}
                  {selectedObject.kind === "character" && modelAssets.length > 0 ? (
                    <PanelSection title="外观模型">
                      <select
                        value={selectedObject.modelAssetId ?? ""}
                        onChange={(e) => assignCharacterModel(e.target.value || undefined)}
                        className="w-full rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-xs text-white/80"
                      >
                        <option value="" className="bg-zinc-900">内置人模</option>
                        {modelAssets.map((asset) => (
                          <option key={asset.id} value={asset.id} className="bg-zinc-900">
                            {asset.title}
                          </option>
                        ))}
                      </select>
                    </PanelSection>
                  ) : null}
                </>
              ) : sceneTab === "env" ? (
                <DirectorSceneInspector
                  settings={scene.sceneSettings}
                  panoramaPreviewUrl={panoramaPreviewUrl}
                  onPatch={patchSceneSettings}
                  onPanoramaUpload={() => setPanoramaAssetPickerOpen(true)}
                />
              ) : sceneTab === "light" ? (
                <PanelSection title="布光预设">
                  <DirectorLightingCards
                    lighting={scene.lighting}
                    onPresetChange={(id: LightingPresetId) => setLightingPreset(id)}
                    onAngleChange={patchLightingAngles}
                  />
                  <p className="text-[10px] leading-relaxed text-white/30">
                    光斑示意灯位；下方可调水平角与俯仰。也可对 AI 导演说「换成黄金时刻」。
                  </p>
                </PanelSection>
              ) : (
                lensTab
              )}
            </div>
          </aside>
          </div>
        ) : null}

        {/* 底部：机位胶片条 + 控制坞 */}
        {!loading && scene ? (
          <div
            className={`pointer-events-none absolute bottom-6 z-30 flex flex-col items-center gap-1 px-3 ${centerLeft} ${centerRight}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {!uiFullscreen && cameraObjects.length > 0 ? (
              <DirectorShotStrip
                cameras={cameraObjects}
                selectedId={selectedCameraObject?.id ?? null}
                assets={assets}
                onSelect={selectCameraObject}
                onEnterView={(id) => {
                  setSelectedObjectId(id);
                  setCameraPropViewMode("firstPerson");
                }}
                onAdd={addCameraObject}
              />
            ) : null}
            <DirectorBottomToolbar
              transformMode={transformMode}
              aspectRatio={aspectRatio}
              focusMode={uiFullscreen}
              showGuides={showGuides}
              uploadingModel={uploadingModel}
              onTransformModeChange={setTransformMode}
              onUploadModel={() => modelFileRef.current?.click()}
              onAddBuiltinModel={addBuiltinModel}
              onUploadPanorama={() => setPanoramaAssetPickerOpen(true)}
              onAddCamera={addCameraObject}
              onAspectRatioChange={(ratio: DirectorAspectRatio) => patchSceneSettings({ aspectRatio: ratio })}
              onToggleGuides={() => setShowGuides((v) => !v)}
              onScreenshot={() => void handleToolbarScreenshot()}
              onToggleFocus={() => setUiFullscreen((v) => !v)}
            />
          </div>
        ) : null}

        {loading || !scene || !activeCamera ? (
          <div className="absolute inset-0 z-[45] flex flex-col items-center justify-center gap-3 bg-[#08080f]">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/20">
              <Clapperboard className="h-5 w-5 animate-pulse text-indigo-200" />
            </span>
            <span className="flex items-center gap-2 text-xs text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在搭建舞台…
            </span>
          </div>
        ) : null}

        {agentOpen && scene && projectId && nodeId ? (
          <DirectorAgentPanel key={`${projectId}:${nodeId}`} host={agentHost} onClose={() => setAgentOpen(false)} />
        ) : null}

        {!loading && scene && activeCamera ? (
          <DirectorStageEditor
            scene={scene}
            activeCamera={activeCamera}
            trackPreviewActive={trackTime != null}
            selectedObjectId={selectedObjectId}
            cameraPropViewMode={selectedCameraObject ? cameraPropViewMode : null}
            liveCameraRef={liveCameraRef}
            liveCameraTransformRef={liveCameraTransformRef}
            transformMode={transformMode}
            mannequinEditMode={mannequinEditMode}
            stageBodyRef={stageBodyRef}
            mainViewRef={mainViewRef}
            filmGateRef={filmGateRef}
            useFilmGateTrack={isCameraFirstPerson}
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
                    liveTransformRef: liveCameraTransformRef,
                  }
                : null
            }
            onCaptureReady={(api) => {
              captureApiRef.current = api;
            }}
            onBonePoseChange={handleBonePoseChange}
            resolveCharacterModelUrl={resolveCharacterModelUrl}
            resolveColorMapUrl={resolveColorMapUrl}
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
      {model3dDialogOpen && scene && projectId && nodeId ? (
        <DirectorModel3dDialog host={agentHost} onClose={() => setModel3dDialogOpen(false)} />
      ) : null}
    </div>
  );
}
