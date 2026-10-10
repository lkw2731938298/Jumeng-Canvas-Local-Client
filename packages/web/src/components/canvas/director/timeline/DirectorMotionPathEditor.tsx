"use client";

/**
 * 已绑定运动路径的控制点编辑：选中轨后显示球体，拖点改 XZ。
 */

import { useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { DirectorMotionPath } from "@jumeng-canvas/shared";
import { getMotionPathCurve, invalidateMotionPathCache } from "@/lib/director/animation/motionPathCurve";

export interface DirectorMotionPathEditorProps {
  path: DirectorMotionPath | null;
  groundHeight: number;
  enabled: boolean;
  onUpdatePoint: (pathId: string, index: number, point: [number, number, number]) => void;
}

function PathControlPoint({
  pathId,
  index,
  point,
  groundHeight,
  onUpdatePoint,
}: {
  pathId: string;
  index: number;
  point: [number, number, number];
  groundHeight: number;
  onUpdatePoint: (pathId: string, index: number, point: [number, number, number]) => void;
}) {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundHeight),
    [groundHeight]
  );
  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const hit = useRef(new THREE.Vector3());

  const project = (clientX: number, clientY: number): [number, number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(ndc.current, camera);
    if (!raycaster.current.ray.intersectPlane(plane, hit.current)) return null;
    return [hit.current.x, groundHeight + (point[1] - groundHeight), hit.current.z];
  };

  return (
    <mesh
      position={point}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        e.stopPropagation();
        const next = project(e.clientX, e.clientY);
        if (!next) return;
        invalidateMotionPathCache(pathId);
        onUpdatePoint(pathId, index, next);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <sphereGeometry args={[0.12, 16, 16]} />
      <meshBasicMaterial color="#fbbf24" depthTest={false} />
    </mesh>
  );
}

export function DirectorMotionPathEditor({
  path,
  groundHeight,
  enabled,
  onUpdatePoint,
}: DirectorMotionPathEditorProps) {
  const curveLine = useMemo(() => {
    if (!path || path.points.length < 2) return null;
    const curve = getMotionPathCurve(path);
    if (!curve) return null;
    return curve.getPoints(48);
  }, [path]);

  if (!enabled || !path) return null;

  return (
    <group>
      {curveLine ? (
        <Line points={curveLine} color="#f59e0b" lineWidth={2} transparent opacity={0.85} />
      ) : null}
      {path.points.map((p, i) => (
        <PathControlPoint
          key={`${path.id}-${i}`}
          pathId={path.id}
          index={i}
          point={p}
          groundHeight={groundHeight}
          onUpdatePoint={onUpdatePoint}
        />
      ))}
    </group>
  );
}
