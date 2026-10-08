"use client";

import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, SRGBColorSpace, Texture } from "three";

/**
 * fetch → ImageBitmap → CanvasTexture，保证彩色像素进 WebGL（不依赖 crossOrigin）。
 */
async function loadCanvasTexture(imageUrl: string): Promise<Texture> {
  const res = await fetch(imageUrl, { credentials: "same-origin", cache: "no-cache" });
  if (!res.ok) throw new Error(`贴图加载失败 HTTP ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, bitmap.width);
    canvas.height = Math.max(1, bitmap.height);
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("无法创建画布");
    ctx.drawImage(bitmap, 0, 0);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = true;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  } finally {
    bitmap.close();
  }
}

export function useColorMapTexture(imageUrl: string | null | undefined): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);
  const { invalidate } = useThree();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const genRef = useRef(0);
  const heldRef = useRef<Texture | null>(null);

  useEffect(() => {
    if (!imageUrl) {
      if (heldRef.current) {
        heldRef.current.dispose();
        heldRef.current = null;
      }
      setTexture(null);
      return;
    }

    const gen = ++genRef.current;
    let alive = true;

    void (async () => {
      try {
        const tex = await loadCanvasTexture(imageUrl);
        if (!alive || gen !== genRef.current) {
          tex.dispose();
          return;
        }
        if (heldRef.current && heldRef.current !== tex) {
          heldRef.current.dispose();
        }
        heldRef.current = tex;
        setTexture(tex);
        invalidateRef.current();
      } catch (err) {
        console.warn("[director] colorMap load failed", imageUrl, err);
        if (alive && gen === genRef.current) {
          if (heldRef.current) {
            heldRef.current.dispose();
            heldRef.current = null;
          }
          setTexture(null);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (heldRef.current) {
        heldRef.current.dispose();
        heldRef.current = null;
      }
    };
  }, []);

  return texture;
}
