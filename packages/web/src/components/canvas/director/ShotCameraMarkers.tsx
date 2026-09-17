"use client";

import type { DirectorShotCamera } from "@/types/director-scene";

function ShotCameraMarker({
  cam,
  active,
  onSelect,
}: {
  cam: DirectorShotCamera;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const dx = cam.target[0] - cam.position[0];
  const dy = cam.target[1] - cam.position[1];
  const dz = cam.target[2] - cam.position[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const yaw = Math.atan2(dx / len, dz / len);

  return (
    <group
      position={cam.position}
      userData={{ directorCaptureExclude: true }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(cam.id);
      }}
    >
      <mesh rotation={[0, yaw, 0]}>
        <coneGeometry args={[0.18, 0.45, 4]} />
        <meshStandardMaterial
          color={active ? "#818cf8" : "#64748b"}
          emissive={active ? "#4338ca" : "#000000"}
          emissiveIntensity={active ? 0.35 : 0}
        />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.28, 0.18, 0.14]} />
        <meshStandardMaterial color={active ? "#a5b4fc" : "#94a3b8"} />
      </mesh>
    </group>
  );
}

export function ShotCameraMarkers({
  cameras,
  activeId,
  onSelect,
}: {
  cameras: DirectorShotCamera[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {cameras.map((cam) => (
        <ShotCameraMarker
          key={cam.id}
          cam={cam}
          active={cam.id === activeId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
