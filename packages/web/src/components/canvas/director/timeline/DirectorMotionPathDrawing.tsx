"use client";

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { DirectorMotionPath } from "@jumeng-canvas/shared";
import {
  getMotionPathCurve,
  sanitizePathLinePoints,
} from "@/lib/director/animation/motionPathCurve";
import type { MotionPathDrawTool } from "@/lib/director/animation/motionPathDrawTools";
import {
  pointsForCircle,
  pointsForLine,
  pointsForRect,
} from "@/lib/director/animation/motionPathDrawTools";
import { DirectorPathPolyLine } from "./DirectorPathPolyLine";

export interface DirectorMotionPathDrawingProps {
  active: boolean;
  tool?: MotionPathDrawTool;
  draftPoints: [number, number, number][];
  groundHeight: number;
  existingPaths?: DirectorMotionPath[];
  onAddPoint: (point: [number, number, number]) => void;
  /** 形状/铅笔：整表替换草稿点（含预览） */
  onSetDraftPoints?: (points: [number, number, number][]) => void;
  /** 可传入最终点列，避免 React setState 未刷新就 finish */
  onFinish: (points?: [number, number, number][]) => void;
}

const PENCIL_MIN_DIST = 0.08;

/** 地面绘制运动路径 · 对齐 LibTV 多工具 */
export function DirectorMotionPathDrawing({
  active,
  tool = "pen",
  draftPoints,
  groundHeight,
  existingPaths = [],
  onAddPoint,
  onSetDraftPoints,
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
  /** 形状工具圆心/对角锚点（与 draft 预览点列分离，禁止被圆周点覆盖） */
  const anchorRef = useRef<[number, number, number] | null>(null);
  const pencilDownRef = useRef(false);
  /** 铅笔本地点列，避免松手时父 state 尚未刷新 */
  const pencilPtsRef = useRef<[number, number, number][]>([]);

  // 仅在「只有起点」时锚定；预览展开为多点后绝不能把圆周第一点当成圆心
  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      return;
    }
    if (
      (tool === "line" || tool === "rect" || tool === "circle") &&
      draftPoints.length === 1
    ) {
      const p = draftPoints[0]!;
      if ([p[0], p[1], p[2]].every(Number.isFinite)) {
        anchorRef.current = p;
      }
    }
  }, [active, tool, draftPoints]);

  const hitGround = (clientX: number, clientY: number): [number, number, number] | null => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.current.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.current.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.current.setFromCamera(ndc.current, camera);
    if (!raycaster.current.ray.intersectPlane(plane, hit.current)) return null;
    const x = hit.current.x;
    const z = hit.current.z;
    if (![x, groundHeight, z].every(Number.isFinite)) return null;
    return [x, groundHeight, z];
  };

  const draftLine = useMemo(() => {
    const pts = sanitizePathLinePoints(draftPoints);
    if (!pts) return null;
    // 闭合形状预览：视觉上接回起点
    if (
      (tool === "circle" || tool === "rect") &&
      pts.length >= 3 &&
      pts[0]!.distanceToSquared(pts[pts.length - 1]!) > 1e-6
    ) {
      return [...pts, pts[0]!.clone()];
    }
    return pts;
  }, [draftPoints, tool]);

  if (!active && existingPaths.length === 0) return null;

  return (
    <group>
      {active ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, groundHeight + 0.01, 0]}
          onPointerDown={(e) => {
            // 仅左键绘制；右键/中键交给 OrbitControls 转视角
            if (e.button !== 0) return;
            e.stopPropagation();
            const p = hitGround(e.clientX, e.clientY);
            if (!p) return;

            if (tool === "pencil") {
              pencilDownRef.current = true;
              pencilPtsRef.current = [p];
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              onSetDraftPoints?.([p]);
              return;
            }

            if (tool === "pen") {
              const now = performance.now();
              if (now - lastClickRef.current < 320 && draftPoints.length >= 2) {
                onFinish();
                lastClickRef.current = 0;
                return;
              }
              lastClickRef.current = now;
              onAddPoint(p);
              return;
            }

            // 直线 / 矩形 / 圆环：两点定形
            if (!anchorRef.current) {
              anchorRef.current = p;
              onSetDraftPoints?.([p]);
              return;
            }
            const a = anchorRef.current;
            let pts: [number, number, number][];
            if (tool === "line") pts = pointsForLine(a, p);
            else if (tool === "rect") pts = pointsForRect(a, p);
            else pts = pointsForCircle(a, p);
            if (pts.length < 2) return;
            anchorRef.current = null;
            onSetDraftPoints?.(pts);
            onFinish(pts);
          }}
          onPointerMove={(e) => {
            if (!active) return;
            if (tool === "pencil" && !pencilDownRef.current) return;
            if (
              tool !== "pencil" &&
              !(tool === "line" || tool === "rect" || tool === "circle")
            ) {
              return;
            }
            if (
              (tool === "line" || tool === "rect" || tool === "circle") &&
              !anchorRef.current
            ) {
              return;
            }
            const p = hitGround(e.clientX, e.clientY);
            if (!p) return;

            if (tool === "pencil" && pencilDownRef.current) {
              const last = pencilPtsRef.current[pencilPtsRef.current.length - 1];
              if (
                last &&
                Math.hypot(last[0] - p[0], last[2] - p[2]) < PENCIL_MIN_DIST
              ) {
                return;
              }
              pencilPtsRef.current = [...pencilPtsRef.current, p];
              onAddPoint(p);
              return;
            }

            if (
              (tool === "line" || tool === "rect" || tool === "circle") &&
              anchorRef.current
            ) {
              const a = anchorRef.current;
              let pts: [number, number, number][];
              if (tool === "line") pts = pointsForLine(a, p);
              else if (tool === "rect") pts = pointsForRect(a, p);
              else pts = pointsForCircle(a, p);
              if (pts.length >= 2) onSetDraftPoints?.(pts);
            }
          }}
          onPointerUp={(e) => {
            if (e.button !== 0) return;
            if (tool !== "pencil" || !pencilDownRef.current) return;
            pencilDownRef.current = false;
            try {
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
            } catch {
              /* ignore */
            }
            // 松手只结束本段笔触，不提交；Enter/双击才完成（可续画）
            pencilPtsRef.current = [];
          }}
          onDoubleClick={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            if (tool === "pencil" && draftPoints.length >= 2) {
              onFinish([...draftPoints]);
            }
          }}
          onContextMenu={(e) => {
            // 右键留给转视角，禁止浏览器菜单
            e.stopPropagation();
          }}
        >
          <planeGeometry args={[400, 400]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : null}

      {draftLine ? (
        <DirectorPathPolyLine points={draftLine} color="#818cf8" />
      ) : null}
      {/* 钢笔/铅笔显示控制点；圆环/矩形预览不刷一圈球 */}
      {(tool === "pen" || tool === "pencil") &&
        draftPoints.map((p, i) =>
          [p[0], p[1], p[2]].every(Number.isFinite) ? (
            <mesh key={`draft-${i}`} position={p}>
              <sphereGeometry args={[0.08, 12, 12]} />
              <meshBasicMaterial color="#a5b4fc" />
            </mesh>
          ) : null
        )}
      {/* 形状工具：起点/圆心标记（预览中仍用稳定锚点，不被圆周点顶替） */}
      {(tool === "line" || tool === "rect" || tool === "circle") &&
      draftPoints.length === 1 &&
      draftPoints[0] &&
      [draftPoints[0][0], draftPoints[0][1], draftPoints[0][2]].every(
        Number.isFinite
      ) ? (
        <mesh position={draftPoints[0]}>
          <sphereGeometry args={[0.1, 12, 12]} />
          <meshBasicMaterial color="#c7d2fe" />
        </mesh>
      ) : null}
      {(tool === "line" || tool === "rect" || tool === "circle") &&
      draftPoints.length > 1 &&
      anchorRef.current &&
      [anchorRef.current[0], anchorRef.current[1], anchorRef.current[2]].every(
        Number.isFinite
      ) ? (
        <mesh position={anchorRef.current}>
          <sphereGeometry args={[0.1, 12, 12]} />
          <meshBasicMaterial color="#c7d2fe" />
        </mesh>
      ) : null}

      {existingPaths.map((path) => {
        const curve = getMotionPathCurve(path);
        if (!curve) return null;
        const pts = sanitizePathLinePoints(curve.getPoints(64));
        if (!pts) return null;
        const closedPts =
          path.closed &&
          pts.length >= 3 &&
          pts[0]!.distanceToSquared(pts[pts.length - 1]!) > 1e-6
            ? [...pts, pts[0]!.clone()]
            : pts;
        return (
          <DirectorPathPolyLine
            key={path.id}
            points={closedPts}
            color="#6366f1"
            opacity={0.55}
          />
        );
      })}
    </group>
  );
}
