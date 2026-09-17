"use client";

import { useMemo } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";

/** 与场景内 PerspectiveCamera（截图 / 预览）一致 */
export const DIRECTOR_CAMERA_NEAR = 0.1;
export const DIRECTOR_CAMERA_FAR = 200;
const DEFAULT_ASPECT = 16 / 9;

function buildFrustumGeometries(fovDeg: number, aspect: number, near: number, far: number) {
  const fovRad = (fovDeg * Math.PI) / 180;
  const nearH = Math.tan(fovRad / 2) * near;
  const nearW = nearH * aspect;
  const farH = Math.tan(fovRad / 2) * far;
  const farW = farH * aspect;

  const nz = -near;
  const fz = -far;

  const ntl: [number, number, number] = [-nearW, nearH, nz];
  const ntr: [number, number, number] = [nearW, nearH, nz];
  const nbr: [number, number, number] = [nearW, -nearH, nz];
  const nbl: [number, number, number] = [-nearW, -nearH, nz];
  const ftl: [number, number, number] = [-farW, farH, fz];
  const ftr: [number, number, number] = [farW, farH, fz];
  const fbr: [number, number, number] = [farW, -farH, fz];
  const fbl: [number, number, number] = [-farW, -farH, fz];

  const fill = new BufferGeometry();
  const fillVerts: number[] = [];
  const pushQuad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ) => {
    fillVerts.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  pushQuad(ntl, ntr, ftr, ftl);
  pushQuad(ntr, nbr, fbr, ftr);
  pushQuad(nbr, nbl, fbl, fbr);
  pushQuad(nbl, ntl, ftl, fbl);
  fill.setAttribute("position", new Float32BufferAttribute(fillVerts, 3));

  const line = new BufferGeometry();
  const lineVerts = [
    ...ntl,
    ...ntr,
    ...ntr,
    ...nbr,
    ...nbr,
    ...nbl,
    ...nbl,
    ...ntl,
    ...ftl,
    ...ftr,
    ...ftr,
    ...fbr,
    ...fbr,
    ...fbl,
    ...fbl,
    ...ftl,
    ...ntl,
    ...ftl,
    ...ntr,
    ...ftr,
    ...nbr,
    ...fbr,
    ...nbl,
    ...fbl,
  ];
  line.setAttribute("position", new Float32BufferAttribute(lineVerts, 3));

  return { fill, line };
}

/** LibTV 风格视锥：按真实 FOV / 宽高比 / near-far 绘制，仅导演视角可见（layer 1） */
export function DirectorCameraFrustum({
  fov,
  near,
  far,
  aspect = DEFAULT_ASPECT,
  color,
  selected,
}: {
  fov: number;
  near: number;
  far: number;
  aspect?: number;
  color: string;
  selected: boolean;
}) {
  const safeFar = Math.max(far, near + 0.05);

  const { fill, line } = useMemo(
    () => buildFrustumGeometries(fov, aspect, near, safeFar),
    [fov, aspect, near, safeFar]
  );

  const fillColor = selected ? "#fbbf24" : color;
  const fillOpacity = selected ? 0.14 : 0.08;
  const lineOpacity = selected ? 0.75 : 0.45;

  return (
    <group>
      <mesh geometry={fill} renderOrder={-1} layers={1}>
        <meshBasicMaterial
          color={fillColor}
          transparent
          opacity={fillOpacity}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <lineSegments geometry={line} layers={1}>
        <lineBasicMaterial color={fillColor} transparent opacity={lineOpacity} />
      </lineSegments>
    </group>
  );
}
