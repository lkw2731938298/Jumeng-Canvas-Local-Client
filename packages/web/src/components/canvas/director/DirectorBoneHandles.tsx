"use client";

import { memo, useCallback, useEffect, useRef, type RefObject } from "react";
import { invalidate, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { DirectorBonePose } from "@jumeng-canvas/shared";
import {
  findBone,
  JOINT_HANDLES,
  TWIST_HANDLES,
  type JointHandleDef,
  type TwistHandleDef,
} from "@/lib/director/boneRig";

type DragState =
  | {
      kind: "joint";
      boneName: string;
      pivot: THREE.Vector3;
      plane: THREE.Plane;
      startDir: THREE.Vector3;
      startOffsetQuat: THREE.Quaternion;
      parentWorldQuat: THREE.Quaternion;
    }
  | {
      kind: "twist";
      boneName: string;
      axis: THREE.Vector3;
      pivot: THREE.Vector3;
      startAngle: number;
      startOffsetQuat: THREE.Quaternion;
      parentWorldQuat: THREE.Quaternion;
    };

const HANDLE_COLOR = "#fbbf24";
const HANDLE_HOVER_COLOR = "#fde68a";
const PICK_SCALE = 3.4;
/** 扭转关节：相对预览版 0.35 略提高，大模型下仍跟手 */
const TWIST_SENSITIVITY = 1.0;

const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _projected = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _perp2 = new THREE.Vector3();
const _deltaQuat = new THREE.Quaternion();
const _invParent = new THREE.Quaternion();
const _deltaLocal = new THREE.Quaternion();
const _newOffset = new THREE.Quaternion();
const _euler = new THREE.Euler();

function attachSphereRaycast(mesh: THREE.Mesh, radius: number) {
  const sphere = new THREE.Sphere();
  const point = new THREE.Vector3();
  mesh.raycast = (raycaster, intersects) => {
    mesh.getWorldPosition(sphere.center);
    sphere.radius = radius;
    if (raycaster.ray.intersectSphere(sphere, point)) {
      intersects.push({
        distance: raycaster.ray.origin.distanceTo(point),
        point: point.clone(),
        object: mesh,
      });
    }
  };
}

function pointerRaycaster(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  target: THREE.Raycaster
) {
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  target.setFromCamera(_ndc, camera);
}

function JointHandle({
  def,
  boneMap,
  groupRef,
  onPointerDown,
}: {
  def: JointHandleDef;
  boneMap: Map<string, THREE.Bone>;
  groupRef: RefObject<THREE.Group | null>;
  onPointerDown: (def: JointHandleDef, e: ThreeEvent<PointerEvent>) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const world = useRef(new THREE.Vector3());

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    attachSphereRaycast(mesh, def.radius * PICK_SCALE);
  }, [def.radius]);

  useFrame(() => {
    const mesh = meshRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;
    const bone = findBone(boneMap, def.positionBone);
    if (!bone) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    bone.getWorldPosition(world.current);
    group.worldToLocal(world.current);
    mesh.position.copy(world.current);
  });

  return (
    <mesh
      ref={meshRef}
      scale={def.radius}
      renderOrder={2000}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        onPointerDown(def, e);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        const mesh = e.object as THREE.Mesh;
        mesh.scale.setScalar(def.radius * 1.25);
        (mesh.material as THREE.MeshBasicMaterial).color.set(HANDLE_HOVER_COLOR);
        document.body.style.cursor = "grab";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        const mesh = e.object as THREE.Mesh;
        mesh.scale.setScalar(def.radius);
        (mesh.material as THREE.MeshBasicMaterial).color.set(HANDLE_COLOR);
        document.body.style.cursor = "";
      }}
    >
      <sphereGeometry args={[1, 14, 10]} />
      <meshBasicMaterial color={HANDLE_COLOR} transparent opacity={0.95} depthTest={false} />
    </mesh>
  );
}

function TwistHandle({
  def,
  boneMap,
  groupRef,
  onPointerDown,
}: {
  def: TwistHandleDef;
  boneMap: Map<string, THREE.Bone>;
  groupRef: RefObject<THREE.Group | null>;
  onPointerDown: (def: TwistHandleDef, e: ThreeEvent<PointerEvent>) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const pa = useRef(new THREE.Vector3());
  const pb = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  const yAxis = useRef(new THREE.Vector3(0, 1, 0));

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    attachSphereRaycast(mesh, def.scale * PICK_SCALE * 1.2);
  }, [def.scale]);

  useFrame(() => {
    const mesh = meshRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;
    const a = findBone(boneMap, def.bone);
    const b = findBone(boneMap, def.childBone);
    if (!a || !b) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    a.getWorldPosition(pa.current);
    b.getWorldPosition(pb.current);
    mesh.position.copy(pa.current.lerp(pb.current, 0.5));
    group.worldToLocal(mesh.position);
    dir.current.copy(pb.current).sub(pa.current).normalize();
    mesh.quaternion.setFromUnitVectors(yAxis.current, dir.current);
  });

  return (
    <mesh
      ref={meshRef}
      scale={def.scale}
      renderOrder={2000}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        onPointerDown(def, e);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        const mesh = e.object as THREE.Mesh;
        mesh.scale.setScalar(def.scale * 1.25);
        (mesh.material as THREE.MeshBasicMaterial).color.set(HANDLE_HOVER_COLOR);
        document.body.style.cursor = "grab";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        const mesh = e.object as THREE.Mesh;
        mesh.scale.setScalar(def.scale);
        (mesh.material as THREE.MeshBasicMaterial).color.set(HANDLE_COLOR);
        document.body.style.cursor = "";
      }}
    >
      <capsuleGeometry args={[1, 1.8, 4, 8]} />
      <meshBasicMaterial color={HANDLE_COLOR} transparent opacity={0.95} depthTest={false} />
    </mesh>
  );
}

export const DirectorBoneHandles = memo(function DirectorBoneHandles({
  boneMap,
  bonePose,
  onApplyPose,
  onBonePoseChange,
}: {
  boneMap: Map<string, THREE.Bone>;
  bonePose: DirectorBonePose;
  /** 拖拽中即时写主模型 + 选中描边 */
  onApplyPose: (pose: DirectorBonePose) => void;
  onBonePoseChange: (bone: string, rotation: [number, number, number]) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const dragRef = useRef<DragState | null>(null);
  const bonePoseRef = useRef(bonePose);
  const pendingCommitRef = useRef<{ boneName: string; rotation: [number, number, number] } | null>(
    null
  );
  const controlsEnabled = useRef(true);
  const raycasterRef = useRef(new THREE.Raycaster());
  const { camera, gl, controls, events } = useThree();
  /** 主视口 DOM（View eventSource），与预览版 gl.domElement 等价 */
  const eventTarget = events.connected ?? gl.domElement;

  bonePoseRef.current = bonePose;

  const applyBoneRotation = useCallback(
    (boneName: string, rotation: [number, number, number]) => {
      const nextPose = { ...bonePoseRef.current, [boneName]: rotation };
      bonePoseRef.current = nextPose;
      onApplyPose(nextPose);
      pendingCommitRef.current = { boneName, rotation };
    },
    [onApplyPose]
  );

  const flushBoneRotation = useCallback(() => {
    const pending = pendingCommitRef.current;
    if (!pending) return;
    onBonePoseChange(pending.boneName, pending.rotation);
    pendingCommitRef.current = null;
  }, [onBonePoseChange]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const rect = eventTarget.getBoundingClientRect();
      pointerRaycaster(e.clientX, e.clientY, rect, camera, raycasterRef.current);

      if (drag.kind === "joint") {
        if (!raycasterRef.current.ray.intersectPlane(drag.plane, _hit)) return;
        _dir.copy(_hit).sub(drag.pivot);
        if (_dir.lengthSq() < 1e-6) return;
        _dir.normalize();
        _deltaQuat.setFromUnitVectors(drag.startDir, _dir);
        _invParent.copy(drag.parentWorldQuat).invert();
        _deltaLocal.copy(_invParent).multiply(_deltaQuat).multiply(drag.parentWorldQuat);
        _newOffset.copy(_deltaLocal).multiply(drag.startOffsetQuat);
        _euler.setFromQuaternion(_newOffset, "XYZ");
        applyBoneRotation(drag.boneName, [_euler.x, _euler.y, _euler.z]);
      } else {
        camera.getWorldDirection(_camDir).negate();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_camDir, drag.pivot);
        if (!raycasterRef.current.ray.intersectPlane(plane, _hit)) return;
        _offset.copy(_hit).sub(drag.pivot);
        _projected.copy(_offset).sub(drag.axis.clone().multiplyScalar(_offset.dot(drag.axis)));
        if (_projected.lengthSq() < 1e-6) return;
        _projected.normalize();
        _perp.crossVectors(drag.axis, _camDir).normalize();
        _perp2.crossVectors(_perp, drag.axis).normalize();
        const angle =
          (Math.atan2(_projected.dot(_perp), _projected.dot(_perp2)) - drag.startAngle) *
          TWIST_SENSITIVITY;
        _invParent.copy(drag.parentWorldQuat).invert();
        _deltaQuat.setFromAxisAngle(drag.axis, angle);
        _deltaLocal.copy(_invParent).multiply(_deltaQuat).multiply(drag.parentWorldQuat);
        _newOffset.copy(_deltaLocal).multiply(drag.startOffsetQuat);
        _euler.setFromQuaternion(_newOffset, "XYZ");
        applyBoneRotation(drag.boneName, [_euler.x, _euler.y, _euler.z]);
      }
      invalidate();
    },
    [applyBoneRotation, camera, eventTarget]
  );

  const endDrag = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      flushBoneRotation();
      eventTarget.releasePointerCapture(e.pointerId);
      dragRef.current = null;
      const orbit = controls as OrbitControlsImpl | null;
      if (orbit) orbit.enabled = controlsEnabled.current;
      eventTarget.removeEventListener("pointermove", onPointerMove);
      eventTarget.removeEventListener("pointerup", endDrag);
      eventTarget.removeEventListener("pointercancel", endDrag);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      (document.body.style as { webkitUserSelect?: string }).webkitUserSelect = "";
      if (eventTarget instanceof HTMLElement) eventTarget.style.userSelect = "";
      invalidate();
    },
    [controls, eventTarget, flushBoneRotation, onPointerMove]
  );

  const beginDrag = useCallback(
    (native: PointerEvent) => {
      native.preventDefault();
      document.body.style.userSelect = "none";
      (document.body.style as { webkitUserSelect?: string }).webkitUserSelect = "none";
      if (eventTarget instanceof HTMLElement) eventTarget.style.userSelect = "none";
      eventTarget.setPointerCapture(native.pointerId);
      controlsEnabled.current = (controls as OrbitControlsImpl | null)?.enabled ?? true;
      if (controls) (controls as OrbitControlsImpl).enabled = false;
      document.body.style.cursor = "grabbing";
      eventTarget.addEventListener("pointermove", onPointerMove);
      eventTarget.addEventListener("pointerup", endDrag);
      eventTarget.addEventListener("pointercancel", endDrag);
    },
    [controls, endDrag, eventTarget, onPointerMove]
  );

  const handleJointDown = useCallback(
    (def: JointHandleDef, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      const bone = findBone(boneMap, def.rotateBone);
      if (!bone) return;

      const native = e.nativeEvent;
      const pivot = new THREE.Vector3();
      bone.getWorldPosition(pivot);
      camera.getWorldDirection(_camDir).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_camDir, pivot);

      const rect = eventTarget.getBoundingClientRect();
      pointerRaycaster(native.clientX, native.clientY, rect, camera, raycasterRef.current);
      if (!raycasterRef.current.ray.intersectPlane(plane, _hit)) return;
      const startDir = _hit.clone().sub(pivot);
      if (startDir.lengthSq() < 1e-6) return;
      startDir.normalize();

      const rot = bonePoseRef.current[def.rotateBone] ?? [0, 0, 0];
      const startOffsetQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot[0], rot[1], rot[2], "XYZ")
      );
      const parentWorldQuat = new THREE.Quaternion();
      bone.parent?.getWorldQuaternion(parentWorldQuat);

      dragRef.current = {
        kind: "joint",
        boneName: def.rotateBone,
        pivot: pivot.clone(),
        plane,
        startDir,
        startOffsetQuat,
        parentWorldQuat,
      };

      beginDrag(native);
    },
    [beginDrag, boneMap, camera, eventTarget]
  );

  const handleTwistDown = useCallback(
    (def: TwistHandleDef, e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      const bone = findBone(boneMap, def.bone);
      const child = findBone(boneMap, def.childBone);
      if (!bone || !child) return;

      const native = e.nativeEvent;
      const pa = new THREE.Vector3();
      const pb = new THREE.Vector3();
      bone.getWorldPosition(pa);
      child.getWorldPosition(pb);
      const axis = pb.clone().sub(pa).normalize();
      const pivot = pa.clone().lerp(pb, 0.5);

      camera.getWorldDirection(_camDir).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(_camDir, pivot);

      const rect = eventTarget.getBoundingClientRect();
      pointerRaycaster(native.clientX, native.clientY, rect, camera, raycasterRef.current);
      if (!raycasterRef.current.ray.intersectPlane(plane, _hit)) return;
      _offset.copy(_hit).sub(pivot);
      _projected.copy(_offset).sub(axis.clone().multiplyScalar(_offset.dot(axis)));
      if (_projected.lengthSq() < 1e-6) return;
      _projected.normalize();
      _perp.crossVectors(axis, _camDir).normalize();
      _perp2.crossVectors(_perp, axis).normalize();
      const startAngle = Math.atan2(_projected.dot(_perp), _projected.dot(_perp2));

      const rot = bonePoseRef.current[def.bone] ?? [0, 0, 0];
      const startOffsetQuat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot[0], rot[1], rot[2], "XYZ")
      );
      const parentWorldQuat = new THREE.Quaternion();
      bone.parent?.getWorldQuaternion(parentWorldQuat);

      dragRef.current = {
        kind: "twist",
        boneName: def.bone,
        axis,
        pivot: pivot.clone(),
        startAngle,
        startOffsetQuat,
        parentWorldQuat,
      };

      beginDrag(native);
    },
    [beginDrag, boneMap, camera, eventTarget]
  );

  useEffect(
    () => () => {
      eventTarget.removeEventListener("pointermove", onPointerMove);
      eventTarget.removeEventListener("pointerup", endDrag);
      eventTarget.removeEventListener("pointercancel", endDrag);
      if (dragRef.current && controls) (controls as OrbitControlsImpl).enabled = controlsEnabled.current;
      dragRef.current = null;
      document.body.style.cursor = "";
    },
    [controls, endDrag, eventTarget, onPointerMove]
  );

  return (
    <group ref={groupRef}>
      {JOINT_HANDLES.map((def) => (
        <JointHandle
          key={def.rotateBone}
          def={def}
          boneMap={boneMap}
          groupRef={groupRef}
          onPointerDown={handleJointDown}
        />
      ))}
      {TWIST_HANDLES.map((def) => (
        <TwistHandle
          key={`${def.bone}-${def.childBone}`}
          def={def}
          boneMap={boneMap}
          groupRef={groupRef}
          onPointerDown={handleTwistDown}
        />
      ))}
    </group>
  );
});
