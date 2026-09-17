import { Euler, Object3D, Vector3 } from "three";
import type { DirectorTransform } from "@/types/director-scene";

/** 缩略图 data URL，减轻 Inspector / 画中画内存占用 */
export function downscaleDataUrl(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("preview decode failed"));
    img.src = dataUrl;
  });
}

/** 由位置与注视点计算欧拉角（-Z 为镜头朝向，与 Three.js PerspectiveCamera 一致） */
export function rotationFromPositionLookAt(
  position: [number, number, number],
  target: [number, number, number]
): [number, number, number] {
  const anchor = new Object3D();
  anchor.position.set(...position);
  const dir = new Vector3(...target).sub(anchor.position);
  if (dir.lengthSq() > 1e-8) {
    dir.normalize();
    // Object3D.lookAt 对齐 +Z；摄像机/视锥使用 -Z 为朝向
    anchor.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), dir);
  }
  return [anchor.rotation.x, anchor.rotation.y, anchor.rotation.z];
}

/** 根据造具旋转同步 lookAt，保持与 TransformControls 朝向一致 */
export function syncCameraLookAtFromTransform(
  transform: DirectorTransform,
  currentLookAt: [number, number, number]
): [number, number, number] {
  const [px, py, pz] = transform.position;
  const dist =
    Math.hypot(currentLookAt[0] - px, currentLookAt[1] - py, currentLookAt[2] - pz) || 5;
  const euler = new Euler(transform.rotation[0], transform.rotation[1], transform.rotation[2], "XYZ");
  const forward = new Vector3(0, 0, -1).applyEuler(euler);
  return [px + forward.x * dist, py + forward.y * dist, pz + forward.z * dist];
}
