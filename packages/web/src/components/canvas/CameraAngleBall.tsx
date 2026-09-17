"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  normalizeAzimuth,
  normalizeElevation,
} from "@/lib/canvas/multiAnglePresets";

interface CameraAngleBallProps {
  azimuth: number;
  elevation: number;
  disabled?: boolean;
  onChange: (angle: { azimuth: number; elevation: number }) => void;
}

const SIZE = 160;
const ORBIT_R = 52;

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

/** Map orbit azimuth (0=front) + elevation to 2D canvas offset from subject center. */
function project(az: number, el: number, radius: number) {
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

export function CameraAngleBall({ azimuth, elevation, disabled, onChange }: CameraAngleBallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

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
    const cy = h / 2 + 4;
    const R = ORBIT_R;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * 0.34, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.34, R, 0, 0, Math.PI * 2);
    ctx.stroke();

    const mark = (az: number, label: string) => {
      const p = project(az, 0, R);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.font = "9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx + p.x * 1.15, cy + p.y * 1.12);
    };
    mark(0, "正");
    mark(90, "右");
    mark(180, "背");
    mark(270, "左");

    ctx.fillStyle = "rgba(139, 92, 246, 0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(167, 139, 250, 0.6)";
    ctx.stroke();

    const cam = project(azimuth, elevation, R);
    const camX = cx + cam.x;
    const camY = cy + cam.y;

    ctx.strokeStyle = "rgba(167, 139, 250, 0.45)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = `rgba(196, 181, 253, ${0.5 + cam.scale * 0.5})`;
    ctx.beginPath();
    ctx.arc(camX, camY, 7 * cam.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(233, 213, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("拖拽绕主体调整机位", cx, h - 6);
  }, [azimuth, elevation]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToAngle = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left - rect.width / 2;
      const y = clientY - rect.top - rect.height / 2 - 4;
      const R = ORBIT_R;

      const az = normalizeAzimuth((Math.atan2(x, y) * 180) / Math.PI);
      const dist = Math.min(Math.hypot(x, y), R);
      const radial = dist / R;
      const el = normalizeElevation(
        -Math.asin(Math.max(-1, Math.min(1, (y / R) * radial))) * (180 / Math.PI)
      );
      onChange({ azimuth: az, elevation: el });
    },
    [onChange]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointerToAngle(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || disabled) return;
    pointerToAngle(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      className={`mx-auto touch-none rounded-lg border border-white/10 bg-black/20 ${
        disabled ? "opacity-50 pointer-events-none" : "cursor-grab active:cursor-grabbing"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    />
  );
}
