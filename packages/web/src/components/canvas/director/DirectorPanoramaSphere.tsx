"use client";

import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { BackSide, SRGBColorSpace, Texture, TextureLoader } from "three";
import type { DirectorSceneSettings } from "@/types/director-scene";

const DEFAULT_SPHERE_RADIUS = 80;

/** 全景球贴图：仅用内翻球体承载 equirectangular 图，不占用 scene.background，避免盖住模型与场地 */
export function DirectorPanoramaSphere({
  imageUrl,
  settings,
}: {
  imageUrl: string | null;
  settings: DirectorSceneSettings["panorama"];
}) {
  const [texture, setTexture] = useState<Texture | null>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    if (!imageUrl) {
      setTexture(null);
      return;
    }
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    let cancelled = false;
    loader.load(
      imageUrl,
      (tex) => {
        if (cancelled) return;
        tex.colorSpace = SRGBColorSpace;
        setTexture(tex);
        invalidate();
      },
      undefined,
      () => {
        if (!cancelled) setTexture(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [imageUrl, invalidate]);

  if (!texture) return null;

  const h = ((settings?.horizontalRotation ?? 0) * Math.PI) / 180;
  // 与侧栏滑条下限一致，允许更小的全景球
  const radius = Math.max(10, settings?.sphereRadius ?? DEFAULT_SPHERE_RADIUS);

  return (
    <mesh rotation={[0, h, 0]} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 64, 32]} />
      <meshBasicMaterial
        map={texture}
        side={BackSide}
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  );
}
