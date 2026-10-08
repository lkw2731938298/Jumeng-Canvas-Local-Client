"use client";

import { memo, useEffect, useRef, useState } from "react";
import { BaseEdge, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";

import { absoluteHandleCenter } from "@/lib/canvas/handleCenter";
import { useCanvasStore } from "@/stores/canvasStore";

/** 连线成功短闪时长 */
const CONNECT_FLASH_MS = 700;

/** 单条边粒子上限（多边并存时控制开销） */
const MAX_PARTICLES = 120;
/** 每帧从光头释放的粒子数 */
const SPAWN_PER_FRAME = 3;
/** 光头沿路径前进速度（约 2.8s 一圈 @60fps） */
const HEAD_SPEED = 0.006;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
};

function edgeHasConnectFlash(data: EdgeProps["data"]): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as { connectFlash?: boolean; connectFlashAt?: number };
  return Boolean(d.connectFlash) || typeof d.connectFlashAt === "number";
}

/** 从连线 stroke（终点卡片色）解析 RGB，供粒子光轨着色 */
function strokeToRgb(stroke: string): [number, number, number] {
  const rgba = stroke.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  const hex = stroke.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return [167, 139, 250];
}

/**
 * 粒子光轨连线（对齐 Desktop/line-glow-showcase 案例 6）：
 * 光头沿贝塞尔路径前进，沿途释放带速度扰动与随机寿命的粒子；
 * 颜色跟随终点节点卡片色（edge.style.stroke）。
 */
export const CanvasBezierEdge = memo(function CanvasBezierEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const flagged = edgeHasConnectFlash(data);
  const [flashing, setFlashing] = useState(flagged);

  const measureRef = useRef<SVGPathElement>(null);
  const particlesGroupRef = useRef<SVGGElement>(null);
  const headCoreRef = useRef<SVGCircleElement>(null);
  const headGlowRef = useRef<SVGCircleElement>(null);
  const strokeRef = useRef<string>("rgba(167, 139, 250, 0.72)");

  useEffect(() => {
    if (!flagged) return;
    setFlashing(true);
    const clearTimer = window.setTimeout(() => {
      setFlashing(false);
      useCanvasStore.setState((state) => ({
        edges: state.edges.map((edge) => {
          if (edge.id !== id) return edge;
          const prev = (edge.data && typeof edge.data === "object" ? edge.data : {}) as Record<
            string,
            unknown
          >;
          if (!prev.connectFlash && prev.connectFlashAt == null) return edge;
          const { connectFlash: _a, connectFlashAt: _b, ...rest } = prev;
          return { ...edge, data: Object.keys(rest).length ? rest : undefined };
        }),
      }));
    }, CONNECT_FLASH_MS);
    return () => window.clearTimeout(clearTimer);
  }, [flagged, id, data]);

  const sourcePt = absoluteHandleCenter(sourceNode, "source", sourceHandleId) ?? {
    x: sourceX,
    y: sourceY,
  };
  const targetPt = absoluteHandleCenter(targetNode, "target", targetHandleId) ?? {
    x: targetX,
    y: targetY,
  };

  const [edgePath] = getBezierPath({
    sourceX: sourcePt.x,
    sourceY: sourcePt.y,
    sourcePosition,
    targetX: targetPt.x,
    targetY: targetPt.y,
    targetPosition,
  });

  const stroke = (style?.stroke as string | undefined) || "rgba(167, 139, 250, 0.72)";
  strokeRef.current = stroke;

  // 粒子光轨：rAF 直接改 SVG，避免每帧 React 重渲染
  useEffect(() => {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    // 各边错开相位，避免同步闪
    let tHead = Math.random();
    const particles: Particle[] = [];
    const circlePool: SVGCircleElement[] = [];

    const ensurePool = (n: number) => {
      const g = particlesGroupRef.current;
      if (!g) return;
      while (circlePool.length < n) {
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("pointer-events", "none");
        g.appendChild(c);
        circlePool.push(c);
      }
    };

    const hideUnused = (used: number) => {
      for (let i = used; i < circlePool.length; i++) {
        circlePool[i].setAttribute("r", "0");
        circlePool[i].setAttribute("opacity", "0");
      }
    };

    const placeHead = (x: number, y: number, r: number, g: number, b: number) => {
      const glow = headGlowRef.current;
      const core = headCoreRef.current;
      if (glow) {
        glow.setAttribute("cx", String(x));
        glow.setAttribute("cy", String(y));
        glow.setAttribute("fill", `rgba(${r},${g},${b},0.55)`);
      }
      if (core) {
        core.setAttribute("cx", String(x));
        core.setAttribute("cy", String(y));
        core.style.filter = `drop-shadow(0 0 6px rgba(${r},${g},${b},1))`;
      }
    };

    const tick = () => {
      const path = measureRef.current;
      if (!path) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const len = path.getTotalLength();
      const [r, g, b] = strokeToRgb(strokeRef.current);

      if (len <= 1 || reducedMotion) {
        // 无路径或减弱动效：光头停在中点，不刷粒子
        if (len > 1) {
          const mid = path.getPointAtLength(len * 0.5);
          placeHead(mid.x, mid.y, r, g, b);
        }
        hideUnused(0);
        if (!reducedMotion) raf = requestAnimationFrame(tick);
        return;
      }

      tHead += HEAD_SPEED;
      if (tHead > 1) tHead = 0;
      const head = path.getPointAtLength(tHead * len);

      for (let n = 0; n < SPAWN_PER_FRAME; n++) {
        if (particles.length >= MAX_PARTICLES) break;
        particles.push({
          x: head.x + (Math.random() - 0.5) * 6,
          y: head.y + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6 - 0.25,
          life: 1,
          decay: 0.012 + Math.random() * 0.02,
          size: 1 + Math.random() * 2.2,
        });
      }

      ensurePool(particles.length);
      let drawIdx = 0;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        const c = circlePool[drawIdx++];
        if (!c) continue;
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
        c.setAttribute("r", String(p.size * p.life));
        c.setAttribute("fill", `rgba(${r},${g},${b},${(p.life * 0.8).toFixed(3)})`);
        c.setAttribute("opacity", "1");
      }
      hideUnused(drawIdx);

      placeHead(head.x, head.y, r, g, b);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      circlePool.length = 0;
    };
  }, []);

  return (
    <>
      {/* 测量路径：供 getPointAtLength，与可见路径同形 */}
      <path ref={measureRef} d={edgePath} fill="none" stroke="none" pointerEvents="none" />

      {/* 常驻柔光底（终点色） */}
      <path
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={7}
        strokeLinecap="round"
        opacity={0.2}
        style={{ filter: "blur(2.5px)" }}
        pointerEvents="none"
      />

      {/* 淡轨道线（showcase drawTrack） */}
      <path
        d={edgePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.14}
        pointerEvents="none"
      />

      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} interactionWidth={20} />

      {/* 粒子层 + 光头（rAF 更新属性） */}
      <g ref={particlesGroupRef} pointerEvents="none" />
      <circle
        ref={headGlowRef}
        r={7}
        fill="transparent"
        opacity={0.7}
        style={{ filter: "blur(4px)" }}
        pointerEvents="none"
      />
      <circle
        ref={headCoreRef}
        r={3.2}
        fill="rgba(255,255,255,0.95)"
        pointerEvents="none"
      />

      {flashing ? (
        <path
          d={edgePath}
          fill="none"
          stroke="#e0e7ff"
          strokeWidth={4}
          strokeLinecap="round"
          className="canvas-edge-connect-flash"
          style={{ filter: "drop-shadow(0 0 8px rgba(224, 231, 255, 0.95))" }}
          pointerEvents="none"
        />
      ) : null}
    </>
  );
});
