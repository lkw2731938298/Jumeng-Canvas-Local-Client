"use client";

import {
  DIRECTOR_CAMERA_FAR,
  DIRECTOR_CAMERA_NEAR,
  DirectorCameraFrustum,
} from "./DirectorCameraFrustum";

function frustumFarPlane(
  position: [number, number, number],
  lookAt: [number, number, number]
): number {
  const dist = Math.hypot(
    lookAt[0] - position[0],
    lookAt[1] - position[1],
    lookAt[2] - position[2]
  );
  if (dist < 1e-4) return 5;
  return Math.min(dist, DIRECTOR_CAMERA_FAR);
}

/** 场景内可放置的摄像机造具；朝向由父级 transform.rotation 控制（-Z 为镜头方向） */
export function DirectorCameraProp({
  color,
  selected,
  lookAt,
  fov = 45,
  position,
  aspect = 16 / 9,
}: {
  color: string;
  selected: boolean;
  lookAt: [number, number, number];
  fov?: number;
  position: [number, number, number];
  aspect?: number;
}) {
  const far = frustumFarPlane(position, lookAt);

  return (
    <group>
      <DirectorCameraFrustum
        fov={fov}
        near={DIRECTOR_CAMERA_NEAR}
        far={far}
        aspect={aspect}
        color={color}
        selected={selected}
      />
      <mesh castShadow>
        <boxGeometry args={[0.32, 0.2, 0.16]} />
        <meshStandardMaterial
          color={selected ? "#fbbf24" : color}
          emissive={selected ? "#b45309" : "#000000"}
          emissiveIntensity={selected ? 0.35 : 0}
          metalness={0.25}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 0.03, -0.15]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.095, 0.18, 16]} />
        <meshStandardMaterial
          color={selected ? "#fbbf24" : color}
          metalness={0.4}
          roughness={0.35}
        />
      </mesh>
      <mesh position={[0, 0.15, 0.03]} castShadow>
        <boxGeometry args={[0.14, 0.09, 0.1]} />
        <meshStandardMaterial color="#64748b" metalness={0.2} roughness={0.5} />
      </mesh>
    </group>
  );
}
