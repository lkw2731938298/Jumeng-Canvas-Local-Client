"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * 原生 THREE.Line 折线；避开 drei fat-Line 在退化点列上
 * computeBoundingSphere 半径 NaN 的问题。
 * 用 primitive，避免 JSX <line> 被 TS 当成 SVG。
 */
export function DirectorPathPolyLine({
  points,
  color,
  opacity = 1,
}: {
  points: THREE.Vector3[];
  color: string;
  opacity?: number;
}) {
  const lineObj = useMemo(() => {
    if (points.length < 2) return null;
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    geom.computeBoundingSphere();
    if (
      !geom.boundingSphere ||
      !Number.isFinite(geom.boundingSphere.radius) ||
      geom.boundingSphere.radius <= 0
    ) {
      geom.dispose();
      return null;
    }
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
    });
    return new THREE.Line(geom, mat);
  }, [points, color, opacity]);

  useEffect(() => {
    return () => {
      if (!lineObj) return;
      lineObj.geometry.dispose();
      const mat = lineObj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    };
  }, [lineObj]);

  if (!lineObj) return null;
  return <primitive object={lineObj} />;
}
