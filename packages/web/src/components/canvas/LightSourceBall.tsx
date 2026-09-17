"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  directionToAngles,
  type LightingViewMode,
} from "@/lib/canvas/lightingPresets";
import type { LightDirection } from "@/lib/canvas/renderToolPrompt";
import {
  normalizeAzimuth,
  normalizeElevation,
} from "@/lib/canvas/multiAnglePresets";

interface LightSourceBallProps {
  direction: LightDirection;
  viewMode: LightingViewMode;
  disabled?: boolean;
  onDirectionChange?: (direction: LightDirection) => void;
}

const SIZE = 168;
const ORBIT_R = 54;

const DIRECTION_SNAP: { direction: LightDirection; azimuth: number; elevation: number }[] = [
  { direction: "front", azimuth: 0, elevation: 0 },
  { direction: "right", azimuth: 90, elevation: 0 },
  { direction: "back", azimuth: 180, elevation: 0 },
  { direction: "left", azimuth: 270, elevation: 0 },
  { direction: "top", azimuth: 0, elevation: 90 },
  { direction: "bottom", azimuth: 0, elevation: -90 },
];

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function project(az: number, el: number, radius: number, viewMode: LightingViewMode) {
  if (viewMode === "front") {
    const azR = degToRad(normalizeAzimuth(az));
    const x = Math.sin(azR) * radius;
    const y = -Math.cos(azR) * radius * 0.55;
    return { x, y, scale: 1 };
  }
  const azR = degToRad(normalizeAzimuth(az));
  const elR = degToRad(normalizeElevation(el));
  const orbitScale = Math.cos(elR);
  const x = Math.sin(azR) * orbitScale * radius;
  const yOrbit = Math.cos(azR) * orbitScale * radius;
  const yEl = -Math.sin(elR) * radius * 0.42;
  const y = yOrbit + yEl;
  const depth = orbitScale * Math.cos(azR);
  const scale = 0.82 + Math.max(0, depth) * 0.18;
  return { x, y, scale };
}

function nearestDirection(azimuth: number, elevation: number): LightDirection {
  let best = DIRECTION_SNAP[0];
  let bestScore = Infinity;
  for (const item of DIRECTION_SNAP) {
    const azDiff = Math.abs(normalizeAzimuth(azimuth) - item.azimuth);
    const elDiff = Math.abs(normalizeElevation(elevation) - item.elevation);
    const score = Math.min(azDiff, 360 - azDiff) + Math.abs(elDiff) * 1.2;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best.direction;
}

export function LightSourceBall({
  direction,
  viewMode,
  disabled,
  onDirectionChange,
}: LightSourceBallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const { azimuth, elevation } = directionToAngles(direction);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = SIZE;
    const h = SIZE;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = w / 2;
    const cy = h / 2 + 2;
    const R = ORBIT_R;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    if (viewMode === "perspective") {
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * 0.34, R, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const subjectW = 28;
    const subjectH = 20;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.fillRect(cx - subjectW / 2, cy - subjectH / 2, subjectW, subjectH);
    ctx.strokeRect(cx - subjectW / 2, cy - subjectH / 2, subjectW, subjectH);

    const light = project(azimuth, elevation, R, viewMode);
    const lightX = cx + light.x;
    const lightY = cy + light.y;

    const grad = ctx.createLinearGradient(lightX, lightY, cx, cy);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(lightX, lightY);
    ctx.lineTo(cx - subjectW / 2, cy - subjectH / 2);
    ctx.lineTo(cx + subjectW / 2, cy - subjectH / 2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(lightX, lightY);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(20,20,20,0.95)";
    ctx.beginPath();
    ctx.arc(lightX, lightY, 6 * light.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [azimuth, elevation, viewMode]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToDirection = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !onDirectionChange) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left - rect.width / 2;
      const y = clientY - rect.top - rect.height / 2 - 2;
      const az = normalizeAzimuth((Math.atan2(x, y) * 180) / Math.PI);
      const dist = Math.min(Math.hypot(x, y), ORBIT_R);
      const radial = dist / ORBIT_R;
      const el = normalizeElevation(
        -Math.asin(Math.max(-1, Math.min(1, (y / ORBIT_R) * radial))) * (180 / Math.PI)
      );
      onDirectionChange(nearestDirection(az, el));
    },
    [onDirectionChange]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || !onDirectionChange) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointerToDirection(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled) return;
    pointerToDirection(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      className={`mx-auto touch-none rounded-full border border-white/10 bg-black/30 ${
        disabled ? "opacity-50 pointer-events-none" : onDirectionChange ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  );
}
