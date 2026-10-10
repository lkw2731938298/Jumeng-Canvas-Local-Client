"use client";

import { useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { DirectorMotionPath } from "@jumeng-canvas/shared";
import { getMotionPathCurve } from "@/lib/director/animation/motionPathCurve";

export interface DirectorMotionPathDrawingProps {
  active: boolean;
  draftPoints: [number, number, number][];
  groundHeight: number;
  existingPaths?: DirectorMotionPath[];
  onAddPoint: (point: [number, number, number]) => void;
  onFinish: () => void;
}

/** 地面点击绘制运动路径（P0） */
export function DirectorMotionPathDrawing({
  active,
  draftPoints,
  groundHeight,
  existingPaths = [],
  onAddPoint,
  onFinish,
}: DirectorMotionPathDrawingProps) {
  const { camera, gl } = useThree();
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundHeight),
    [groundHeight]
  );
  const raycaster = useRef(new THREE.Raycaster());
  const ndc = useRef(new THREE.Vector2());
  const hit = useRef(new THREE.Vector3());
  const lastClickRef = useRef(0);

  const draftLine = useMemo(() => {
    if (draftPoints.length < 2) return null;
    return draftPoints.map((p) => new THREE.Vector3(...p));
  }, [draftPoints]);

  if (!active && existingPaths.length === 0) return null;

  return (
    <group>
      {active ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, groundHeight + 0.01, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            const now = performance.now();
            // 双击完成
            if (now - lastClickRef.current < 320 && draftPoints.length >= 2) {
              onFinish();
              lastClickRef.current = 0;
              return;
            }
            lastClickRef.current = now;

            const rect = gl.domElement.getBoundingClientRect();
            ndc.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            ndc.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.current.setFromCamera(ndc.current, camera);
            if (raycaster.current.ray.intersectPlane(plane, hit.current)) {
              onAddPoint([hit.current.x, groundHeight, hit.current.z]);
            }
          }}
        >
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}

      {draftLine ? (
        <Line points={draftLine} color="#818cf8" lineWidth={2} dashed={false} />
      ) : null}
      {draftPoints.map((p, i) => (
        <mesh key={`draft-${i}`} position={p}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshBasicMaterial color="#a5b4fc" />
        </mesh>
      ))}

      {existingPaths.map((path) => {
        const curve = getMotionPathCurve(path);
        if (!curve) return null;
        const pts = curve.getPoints(48);
        return (
          <Line
            key={path.id}
            points={pts}
            color="#6366f1"
            lineWidth={1.5}
            transparent
            opacity={0.55}
          />
        );
      })}
    </group>
  );
}
