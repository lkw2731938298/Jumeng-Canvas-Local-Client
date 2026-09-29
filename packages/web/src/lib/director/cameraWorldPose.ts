/**
 * 将场景内摄像机造具位姿变换到世界空间，供镜头监视器 / 第一人称 / 截图对齐使用。
 * 造具挂在 sceneSettings 的缩放·平移·旋转 group 下，预览相机在 View 根节点，必须乘上 group 矩阵。
 * 朝向用 transform.rotation（与视锥造具一致），禁止用 Camera.lookAt（会丢掉滚转并与视锥不一致）。
 */

import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type {
  DirectorObject,
  DirectorSceneSettings,
  DirectorTransform,
} from "@/types/director-scene";
import { applyCameraLookAtTargets, sceneGroupTransform } from "@/lib/director/sceneTransform";
import { syncCameraLookAtFromTransform } from "@/lib/director/shotPreview";

export interface DirectorCameraWorldPose {
  position: [number, number, number];
  rotation: [number, number, number];
  /** 沿镜头 -Z 方向的注视点（世界坐标），供截图 API 兼容 */
  target: [number, number, number];
  fov: number;
}

function composeLocalMatrix(transform: DirectorTransform): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...transform.position),
    new Quaternion().setFromEuler(
      new Euler(transform.rotation[0], transform.rotation[1], transform.rotation[2], "XYZ")
    ),
    new Vector3(...transform.scale)
  );
}

function composeGroupMatrix(settings: DirectorSceneSettings): Matrix4 {
  const g = sceneGroupTransform(settings);
  return new Matrix4().compose(
    new Vector3(...g.position),
    new Quaternion().setFromEuler(new Euler(g.rotation[0], g.rotation[1], g.rotation[2], "XYZ")),
    new Vector3(...g.scale)
  );
}

/**
 * @param liveTransform 拖拽中尚未写回 scene 的临时 transform（同 cameraId）
 */
export function resolveDirectorCameraWorldPose(
  cameraId: string,
  objects: DirectorObject[],
  settings: DirectorSceneSettings,
  liveTransform?: DirectorTransform | null
): DirectorCameraWorldPose | null {
  const resolved = applyCameraLookAtTargets(objects);
  const obj = resolved.find((o) => o.id === cameraId);
  if (!obj || obj.kind !== "camera") return null;

  const transform = liveTransform ?? obj.transform;
  const lookAtLocal =
    obj.lookAt ?? syncCameraLookAtFromTransform(transform, [0, 1, 0]);

  const groupMat = composeGroupMatrix(settings);
  const worldMat = groupMat.clone().multiply(composeLocalMatrix(transform));
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  worldMat.decompose(pos, quat, scl);
  const euler = new Euler().setFromQuaternion(quat, "XYZ");

  // lookAt 与造具 position 同属场景 group 局部坐标
  const lookWorld = new Vector3(...lookAtLocal).applyMatrix4(groupMat);

  return {
    position: [pos.x, pos.y, pos.z],
    rotation: [euler.x, euler.y, euler.z],
    target: [lookWorld.x, lookWorld.y, lookWorld.z],
    fov: obj.fov ?? 45,
  };
}
