"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Box3,
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Group,
} from "three";

function createLabelTexture(text: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  const font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const padX = 14;
  const padY = 8;
  canvas.width = Math.max(64, Math.ceil(metrics.width + padX * 2));
  canvas.height = 36;

  ctx.font = font;
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
  const r = 6;
  const w = canvas.width;
  const h = canvas.height;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 1);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** 3D 头顶标签（WebGL 渲染，主视图 / 镜头预览 / 截图一致）
 * 字号随角色世界高度成比例，与模型尺寸 / 统一缩放保持一致。
 */
export function DirectorObjectHeadLabel({
  name,
  boundsRef,
  parentRef,
}: {
  name: string;
  boundsRef: RefObject<Group | null>;
  parentRef: RefObject<Group | null>;
}) {
  const spriteRef = useRef<Sprite>(null);
  const box = useMemo(() => new Box3(), []);
  const headLocal = useMemo(() => new Vector3(), []);
  const headWorld = useMemo(() => new Vector3(), []);
  const parentWorldScale = useMemo(() => new Vector3(), []);

  const material = useMemo(() => {
    const map = createLabelTexture(name);
    return new SpriteMaterial({
      map,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
  }, [name]);

  useEffect(() => {
    return () => {
      material.map?.dispose();
      material.dispose();
    };
  }, [material]);

  useFrame(() => {
    const bounds = boundsRef.current;
    const parent = parentRef.current;
    const sprite = spriteRef.current;
    if (!bounds || !parent || !sprite) return;

    box.setFromObject(bounds);
    if (box.isEmpty()) return;

    headWorld.set(
      (box.min.x + box.max.x) * 0.5,
      box.max.y + 0.06,
      (box.min.z + box.max.z) * 0.5
    );
    headLocal.copy(headWorld);
    parent.worldToLocal(headLocal);
    sprite.position.copy(headLocal);

    // 世界高度随 modelScale / transform.scale 变化；换算到本地以免父级 scale 再乘一次
    const charWorldHeight = Math.max(0.15, box.max.y - box.min.y);
    const map = material.map as CanvasTexture | null;
    const img = map?.image as HTMLCanvasElement | undefined;
    const aspect = img && img.height > 0 ? img.width / img.height : 2.8;
    const worldLabelHeight = charWorldHeight * 0.055;
    parent.getWorldScale(parentWorldScale);
    const invParentY = 1 / Math.max(1e-4, Math.abs(parentWorldScale.y));
    const localHeight = worldLabelHeight * invParentY;
    sprite.scale.set(localHeight * aspect, localHeight, 1);
  });

  return (
    <sprite
      ref={spriteRef}
      material={material}
      renderOrder={20}
      userData={{ directorHeadLabel: true }}
    />
  );
}
