import {
  BufferGeometry,
  Color,
  Euler,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshNormalMaterial,
  PerspectiveCamera,
  RGBADepthPacking,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type WebGLRenderer,
  type Object3D,
} from "three";
import { getCharacterPose } from "@/lib/director/characterPoses";
import {
  computeLensCaptureSize,
  LENS_CAPTURE_ASPECT,
  type DirectorCaptureOptions,
} from "@/lib/director/lensCapture";
import type { DirectorCameraState, DirectorObject } from "@/types/director-scene";

export type { DirectorCaptureOptions } from "@/lib/director/lensCapture";

export interface DirectorCaptureResult {
  rgb: string;
  depth: string;
  normal: string;
  segmentation: string;
  openpose: string;
}

const SEGMENTATION_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
  "#bcf60c",
  "#fabebe",
];

type MaterialCache = Map<Mesh, Material | Material[]>;

function isGridShaderMaterial(material: Material | Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((mat) => {
    const uniforms = (mat as Material & { uniforms?: Record<string, unknown> }).uniforms;
    return uniforms != null && "worldCamProjPosition" in uniforms;
  });
}

function shouldSkipCaptureMaterialSwap(mesh: Mesh): boolean {
  if (!mesh.isMesh || !mesh.material) return true;
  return isGridShaderMaterial(mesh.material);
}

function findDirectorObjectId(obj: Object3D): string | undefined {
  let node: Object3D | null = obj;
  while (node) {
    const id = node.userData?.directorObjectId as string | undefined;
    if (id) return id;
    node = node.parent;
  }
  return undefined;
}

function isGroundPlaneMesh(mesh: Mesh): boolean {
  return (
    mesh.geometry?.type === "PlaneGeometry" &&
    Math.abs(mesh.rotation.x + Math.PI / 2) < 0.05
  );
}

function isTransformControlsNode(obj: Object3D): boolean {
  const tagged = obj as Object3D & {
    isTransformControlsRoot?: boolean;
    isTransformControlsGizmo?: boolean;
    isTransformControlsPlane?: boolean;
  };
  return Boolean(
    tagged.isTransformControlsRoot ||
      tagged.isTransformControlsGizmo ||
      tagged.isTransformControlsPlane
  );
}

function isCaptureChrome(obj: Object3D, hideGrid: boolean): boolean {
  if (obj.userData?.directorCaptureExclude) return true;
  if (isTransformControlsNode(obj)) return true;
  if (!hideGrid) return false;
  const mesh = obj as Mesh;
  return mesh.isMesh && isGridShaderMaterial(mesh.material);
}

function hideCaptureChrome(scene: Scene, hideGrid: boolean): (() => void) | null {
  const toggled: { obj: Object3D; visible: boolean }[] = [];
  scene.traverse((obj) => {
    if (!obj.visible || !isCaptureChrome(obj, hideGrid)) return;
    toggled.push({ obj, visible: obj.visible });
    obj.visible = false;
  });
  if (!toggled.length) return null;
  return () => {
    toggled.forEach(({ obj, visible }) => {
      obj.visible = visible;
    });
  };
}

/** 离屏截图时用 shot 相机同步 Grid shader uniform，避免与主视口相机不一致 */
function syncGridUniformsForCapture(scene: Scene, camera: PerspectiveCamera) {
  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !isGridShaderMaterial(mesh.material)) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as ShaderMaterial;
    const camPos = material.uniforms?.worldCamProjPosition?.value as Vector3 | undefined;
    const planePos = material.uniforms?.worldPlanePosition?.value as Vector3 | undefined;
    if (!camPos || !planePos) return;
    camPos.copy(camera.position);
    planePos.set(0, 0, 0);
    mesh.localToWorld(planePos);
  });
}

function shouldIncludeInMaterialPass(mesh: Mesh): boolean {
  if (shouldSkipCaptureMaterialSwap(mesh)) return false;
  if (findDirectorObjectId(mesh)) return true;
  return isGroundPlaneMesh(mesh);
}

function shouldIncludeInSegmentation(mesh: Mesh, objects: DirectorObject[]): boolean {
  if (shouldSkipCaptureMaterialSwap(mesh)) return false;
  const id = findDirectorObjectId(mesh);
  return id != null && objects.some((o) => o.id === id);
}

function swapMaterials(scene: Scene, factory: () => Material, cache: MaterialCache) {
  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!shouldIncludeInMaterialPass(mesh)) return;
    const original = mesh.material;
    if (!original) return;
    if (Array.isArray(original)) {
      cache.set(mesh, original);
      mesh.material = original.map(() => factory());
      return;
    }
    cache.set(mesh, original);
    mesh.material = factory();
  });
}

function restoreMaterials(cache: MaterialCache) {
  cache.forEach((material, mesh) => {
    mesh.material = material;
  });
  cache.clear();
}

const captureTargetCache = new WeakMap<WebGLRenderer, Map<string, WebGLRenderTarget>>();

function getCaptureRenderTarget(gl: WebGLRenderer, width: number, height: number): WebGLRenderTarget {
  let pool = captureTargetCache.get(gl);
  if (!pool) {
    pool = new Map();
    captureTargetCache.set(gl, pool);
  }
  const key = `${width}x${height}`;
  let rt = pool.get(key);
  if (!rt) {
    rt = new WebGLRenderTarget(width, height);
    pool.set(key, rt);
  }
  return rt;
}

/**
 * 截图后勿向默认 framebuffer 做全屏 gl.render。
 * 导演台 Canvas 盖住左右栏（View 多视口），全屏 render 会把 3D 画面铺满两侧工具栏区域。
 * 清成透明后交由 R3F View.Port 下一帧重绘各 track。
 */
function resetDefaultFramebufferForViews(gl: WebGLRenderer) {
  gl.setRenderTarget(null);
  const prevClearAlpha = gl.getClearAlpha();
  gl.setClearAlpha(0);
  gl.clear(true, true, true);
  gl.setClearAlpha(prevClearAlpha);
}

function renderToDataUrl(
  gl: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number
): string {
  const rt = getCaptureRenderTarget(gl, width, height);
  const prevTarget = gl.getRenderTarget();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  gl.setRenderTarget(rt);
  gl.clear(true, true, true);
  gl.render(scene, camera);
  const dataUrl = renderToCanvasFromTarget(gl, rt, width, height);
  gl.setRenderTarget(prevTarget);
  return dataUrl;
}

function renderToCanvasFromTarget(
  gl: WebGLRenderer,
  rt: WebGLRenderTarget,
  width: number,
  height: number,
  mapPixel?: (r: number, g: number, b: number, a: number) => [number, number, number, number]
): string {
  const pixels = new Uint8Array(width * height * 4);
  gl.readRenderTargetPixels(rt, 0, 0, width, height, pixels);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcY = height - 1 - y;
      const srcIdx = (srcY * width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      const r = pixels[srcIdx]!;
      const g = pixels[srcIdx + 1]!;
      const b = pixels[srcIdx + 2]!;
      const a = pixels[srcIdx + 3]!;
      const mapped = mapPixel ? mapPixel(r, g, b, a) : [r, g, b, a];
      imageData.data[dstIdx] = mapped[0]!;
      imageData.data[dstIdx + 1] = mapped[1]!;
      imageData.data[dstIdx + 2] = mapped[2]!;
      imageData.data[dstIdx + 3] = mapped[3]!;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function renderMaterialPass(
  gl: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  factory: () => Material,
  mapPixel?: (r: number, g: number, b: number, a: number) => [number, number, number, number]
): string {
  const cache: MaterialCache = new Map();
  const rt = new WebGLRenderTarget(width, height);
  swapMaterials(scene, factory, cache);

  const prevTarget = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.clear(true, true, true);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  gl.render(scene, camera);
  const dataUrl = renderToCanvasFromTarget(gl, rt, width, height, mapPixel);

  restoreMaterials(cache);
  gl.setRenderTarget(prevTarget);
  rt.dispose();
  return dataUrl;
}

function segmentationColor(index: number): Color {
  const hex = SEGMENTATION_PALETTE[index % SEGMENTATION_PALETTE.length]!;
  return new Color(hex);
}

function renderSegmentationPass(
  gl: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  objects: DirectorObject[]
): string {
  const cache: MaterialCache = new Map();
  let meshIdx = 0;

  scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!shouldIncludeInSegmentation(mesh, objects)) return;
    cache.set(mesh, mesh.material);
    const objectIndex = objects.findIndex((o) => o.id === findDirectorObjectId(mesh));
    const color = segmentationColor(objectIndex >= 0 ? objectIndex : meshIdx);
    mesh.material = new MeshBasicMaterial({ color });
    meshIdx += 1;
  });

  const rt = new WebGLRenderTarget(width, height);
  const prevTarget = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.clear(true, true, true);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  gl.render(scene, camera);
  const dataUrl = renderToCanvasFromTarget(gl, rt, width, height);

  restoreMaterials(cache);
  gl.setRenderTarget(prevTarget);
  rt.dispose();
  return dataUrl;
}

function addLine(
  group: Scene,
  a: Vector3,
  b: Vector3,
  color: string
) {
  const geometry = new BufferGeometry().setFromPoints([a, b]);
  const material = new LineBasicMaterial({ color, linewidth: 2 });
  const line = new Line(geometry, material);
  group.add(line);
}

function localJoint(
  base: Vector3,
  rotation: [number, number, number],
  poseRotation: [number, number, number],
  x: number,
  y: number,
  z: number
): Vector3 {
  const v = new Vector3(x, y, z);
  const euler = new Euler(
    rotation[0] + poseRotation[0],
    rotation[1] + poseRotation[1],
    rotation[2] + poseRotation[2]
  );
  v.applyEuler(euler);
  return v.add(base);
}

function renderOpenPosePass(
  gl: WebGLRenderer,
  camera: PerspectiveCamera,
  width: number,
  height: number,
  objects: DirectorObject[]
): string {
  const poseScene = new Scene();
  poseScene.background = new Color(0x000000);

  const characters = objects.filter((o) => o.kind === "character");
  characters.forEach((obj, index) => {
    const pose = getCharacterPose(obj.pose);
    const [px, py, pz] = obj.transform.position;
    const base = new Vector3(px, py + (pose.yOffset ?? 0), pz);
    const rot = obj.transform.rotation;
    const local = (x: number, y: number, z: number) =>
      localJoint(base, rot, pose.rotation, x, y, z);

    const palette = index % 2 === 0 ? "#ff0000" : "#0000ff";
    const head = local(0, 1.75, 0);
    const neck = local(0, 1.5, 0);
    const shoulderL = local(-0.35, 1.45, 0);
    const shoulderR = local(0.35, 1.45, 0);
    const elbowL = local(-0.55, 1.1, 0);
    const elbowR = local(0.55, 1.1, 0);
    const wristL = local(-0.6, 0.75, 0);
    const wristR = local(0.6, 0.75, 0);
    const hip = local(0, 0.95, 0);
    const kneeL = local(-0.2, 0.45, 0);
    const kneeR = local(0.2, 0.45, 0);
    const ankleL = local(-0.2, 0.05, 0);
    const ankleR = local(0.2, 0.05, 0);

    addLine(poseScene, head, neck, palette);
    addLine(poseScene, neck, shoulderL, palette);
    addLine(poseScene, neck, shoulderR, palette);
    addLine(poseScene, shoulderL, elbowL, palette);
    addLine(poseScene, shoulderR, elbowR, palette);
    addLine(poseScene, elbowL, wristL, palette);
    addLine(poseScene, elbowR, wristR, palette);
    addLine(poseScene, neck, hip, palette);
    addLine(poseScene, hip, kneeL, palette);
    addLine(poseScene, hip, kneeR, palette);
    addLine(poseScene, kneeL, ankleL, palette);
    addLine(poseScene, kneeR, ankleR, palette);
  });

  return renderToDataUrl(gl, poseScene, camera, width, height);
}

export function buildPerspectiveCamera(state: DirectorCameraState, aspect: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(state.fov, aspect, 0.1, 200);
  cam.position.set(...state.position);
  cam.lookAt(...state.target);
  cam.layers.set(0);
  cam.updateProjectionMatrix();
  return cam;
}

function setSubtreeVisible(root: Object3D, visible: boolean) {
  root.visible = visible;
  root.traverse((child) => {
    child.visible = visible;
  });
}

function hideDirectorObjects(scene: Scene, objectIds: string[]): (() => void) | null {
  if (!objectIds.length) return null;
  const idSet = new Set(objectIds);
  const toggled: Object3D[] = [];

  scene.traverse((obj) => {
    const id = obj.userData?.directorObjectId as string | undefined;
    if (id && idSet.has(id) && obj.visible) {
      toggled.push(obj);
      setSubtreeVisible(obj, false);
    }
  });

  return () => {
    toggled.forEach((obj) => setSubtreeVisible(obj, true));
  };
}

export function captureAllChannels(
  gl: WebGLRenderer,
  scene: Scene,
  liveCamera: PerspectiveCamera,
  cameraState: DirectorCameraState,
  objects: DirectorObject[],
  options: DirectorCaptureOptions = {}
): DirectorCaptureResult {
  const aspect = options.aspect ?? LENS_CAPTURE_ASPECT;
  const { width, height } = computeLensCaptureSize(gl.domElement.width, options);
  const shotCam = buildPerspectiveCamera(cameraState, aspect);
  const restoreVisibility = hideDirectorObjects(scene, options.hideObjectIds ?? []);
  const restoreChrome = hideCaptureChrome(scene, false);

  try {
    syncGridUniformsForCapture(scene, shotCam);
    const rgb = renderToDataUrl(gl, scene, shotCam, width, height);
    const restoreGrid = hideCaptureChrome(scene, true);
    try {
      const depth = renderMaterialPass(
        gl,
        scene,
        shotCam,
        width,
        height,
        () => new MeshDepthMaterial({ depthPacking: RGBADepthPacking }),
        (r) => [r, r, r, 255]
      );
      const normal = renderMaterialPass(gl, scene, shotCam, width, height, () => new MeshNormalMaterial());
      const segmentation = renderSegmentationPass(gl, scene, shotCam, width, height, objects);
      return {
        rgb,
        depth,
        normal,
        segmentation,
        openpose: renderOpenPosePass(gl, shotCam, width, height, objects),
      };
    } finally {
      restoreGrid?.();
    }
  } finally {
    restoreChrome?.();
    restoreVisibility?.();
    // 不调用 gl.render(scene, liveCamera)，避免全屏盖住左右工具栏
    resetDefaultFramebufferForViews(gl);
  }
}

export function captureRgbOnly(
  gl: WebGLRenderer,
  scene: Scene,
  _liveCamera: PerspectiveCamera,
  cameraState: DirectorCameraState,
  options: DirectorCaptureOptions = {}
): string {
  const aspect = options.aspect ?? LENS_CAPTURE_ASPECT;
  const { width, height } = computeLensCaptureSize(gl.domElement.width, options);
  const shotCam = buildPerspectiveCamera(cameraState, aspect);
  const restoreVisibility = hideDirectorObjects(scene, options.hideObjectIds ?? []);
  const restoreChrome = hideCaptureChrome(scene, false);

  try {
    syncGridUniformsForCapture(scene, shotCam);
    return renderToDataUrl(gl, scene, shotCam, width, height);
  } finally {
    restoreChrome?.();
    restoreVisibility?.();
    // 不调用 gl.render(scene, liveCamera)，避免全屏盖住左右工具栏
    resetDefaultFramebufferForViews(gl);
  }
}

/** 低分辨率离屏 RGB 捕获（与镜头预览参数一致） */
export function captureRgbPreview(
  gl: WebGLRenderer,
  scene: Scene,
  cameraState: DirectorCameraState,
  previewWidth = 320,
  previewHeight = 180,
  hideObjectIds: string[] = []
): string {
  const rt = getCaptureRenderTarget(gl, previewWidth, previewHeight);
  const shotCam = buildPerspectiveCamera(cameraState, previewWidth / previewHeight);
  const restoreVisibility = hideDirectorObjects(scene, hideObjectIds);
  const prevTarget = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.clear(true, true, true);
  gl.render(scene, shotCam);
  const dataUrl = renderToCanvasFromTarget(gl, rt, previewWidth, previewHeight);
  gl.setRenderTarget(prevTarget);
  restoreVisibility?.();
  return dataUrl;
}
