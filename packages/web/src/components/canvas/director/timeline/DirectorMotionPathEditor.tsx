"use client";

/**
 * 已绑定运动路径编辑（对齐 LibTV）：
 * 选中轨即显示控制点；可拖、中点插入、选中后 Delete 删除。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DirectorMotionPath } from "@jumeng-canvas/shared";
import {
  getMotionPathCurve,
  invalidateMotionPathCache,
  sanitizePathLinePoints,
} from "@/lib/director/animation/motionPathCurve";
import { DirectorPathPolyLine } from "./DirectorPathPolyLine";

export interface DirectorMotionPathEditorProps {
  path: DirectorMotionPath | null;
  groundHeight: number;
  enabled: boolean;
  /** 受控选中顶点；供右侧栏 XYZ 编辑同步 */
  selectedPointIndex?: number | null;
  onSelectPoint?: (index: number | null) => void;
  onUpdatePoint: (pathId: string, index: number, point: [number, number, number]) => void;
  onInsertPoint?: (pathId: string, afterIndex: number, point: [number, number, number]) => void;
  onDeletePoint?: (pathId: string, index: number) => void;
}

function PathControlPoint({
  pathId,
  index,
  point,
  groundHeight,
  selected,
  onSelect,
  onUpdatePoint,
}: {
  pathId: string;
  index: number;
  point: [number, number, number];
  groundHeight: number;
  selected: boolean;
  onSelect: () => void;
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

  // 地面拖 XZ，保留顶点当前 Y（高度改右侧栏）
  const project = (clientX: number, clientY: number): [number, number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(ndc.current, camera);
    if (!raycaster.current.ray.intersectPlane(plane, hit.current)) return null;
    const y = Number.isFinite(point[1]) ? point[1] : groundHeight;
    return [hit.current.x, y, hit.current.z];
  };

  return (
    <mesh
      position={point}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onSelect();
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
      <sphereGeometry args={[selected ? 0.14 : 0.11, 16, 16]} />
      <meshBasicMaterial
        color={selected ? "#fde68a" : "#fbbf24"}
        depthTest={false}
      />
    </mesh>
  );
}

/** 段中点：单击插入控制点 */
function PathMidInsert({
  pathId,
  afterIndex,
  a,
  b,
  groundHeight,
  onInsertPoint,
}: {
  pathId: string;
  afterIndex: number;
  a: [number, number, number];
  b: [number, number, number];
  groundHeight: number;
  onInsertPoint: (pathId: string, afterIndex: number, point: [number, number, number]) => void;
}) {
  const mid: [number, number, number] = [
    (a[0] + b[0]) / 2,
    groundHeight,
    (a[2] + b[2]) / 2,
  ];
  return (
    <mesh
      position={mid}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onInsertPoint(pathId, afterIndex, mid);
      }}
    >
      <sphereGeometry args={[0.07, 12, 12]} />
      <meshBasicMaterial color="#94a3b8" transparent opacity={0.75} depthTest={false} />
    </mesh>
  );
}

export function DirectorMotionPathEditor({
  path,
  groundHeight,
  enabled,
  selectedPointIndex = null,
  onSelectPoint,
  onUpdatePoint,
  onInsertPoint,
  onDeletePoint,
}: DirectorMotionPathEditorProps) {
  const [localSelected, setLocalSelected] = useState<number | null>(null);
  const selectedIndex =
    onSelectPoint != null ? selectedPointIndex : localSelected;
  const setSelectedIndex = (index: number | null) => {
    if (onSelectPoint) onSelectPoint(index);
    else setLocalSelected(index);
  };

  const curveLine = useMemo(() => {
    if (!path || path.points.length < 2) return null;
    const curve = getMotionPathCurve(path);
    if (!curve) return null;
    const pts = sanitizePathLinePoints(curve.getPoints(64));
    if (!pts) return null;
    if (
      path.closed &&
      pts.length >= 3 &&
      pts[0]!.distanceToSquared(pts[pts.length - 1]!) > 1e-6
    ) {
      return [...pts, pts[0]!.clone()];
    }
    return pts;
  }, [path]);

  // 闭合密点（如圆环）禁止中点插入，避免越插越乱、缩点易崩
  const allowMidInsert =
    Boolean(onInsertPoint) &&
    Boolean(path) &&
    !(path!.closed && path!.points.length >= 8);

  useEffect(() => {
    setSelectedIndex(null);
    // 仅路径切换时清空；勿把 setSelectedIndex 列入依赖以免循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path?.id]);

  useEffect(() => {
    if (selectedIndex == null || !path) return;
    if (selectedIndex < 0 || selectedIndex >= path.points.length) {
      setSelectedIndex(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path?.points.length, selectedIndex]);

  useEffect(() => {
    if (!enabled || !path || !onDeletePoint) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedIndex == null) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (path.points.length <= 2) return;
      onDeletePoint(path.id, selectedIndex);
      setSelectedIndex(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, path, selectedIndex, onDeletePoint]);

  if (!enabled || !path) return null;

  return (
    <group>
      {curveLine ? (
        <DirectorPathPolyLine points={curveLine} color="#f59e0b" opacity={0.85} />
      ) : null}
      {allowMidInsert
        ? path.points.slice(0, -1).map((a, i) => (
            <PathMidInsert
              key={`${path.id}-mid-${i}`}
              pathId={path.id}
              afterIndex={i}
              a={a}
              b={path.points[i + 1]!}
              groundHeight={groundHeight}
              onInsertPoint={(id, after, pt) => {
                onInsertPoint?.(id, after, pt);
                setSelectedIndex(after + 1);
              }}
            />
          ))
        : null}
      {path.points.map((p, i) =>
        [p[0], p[1], p[2]].every(Number.isFinite) ? (
          <PathControlPoint
            key={`${path.id}-${i}`}
            pathId={path.id}
            index={i}
            point={p}
            groundHeight={groundHeight}
            selected={selectedIndex === i}
            onSelect={() => setSelectedIndex(i)}
            onUpdatePoint={onUpdatePoint}
          />
        ) : null
      )}
    </group>
  );
}
