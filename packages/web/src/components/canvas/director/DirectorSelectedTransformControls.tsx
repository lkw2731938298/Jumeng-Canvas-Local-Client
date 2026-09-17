"use client";

import { useEffect, useRef } from "react";
import type { Group } from "three";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import { TransformControls } from "@react-three/drei";
import { snapTransform } from "@/lib/director/gridSnap";
import type { DirectorObject, DirectorTransformMode } from "@/types/director-scene";
import { useDirectorTransformRegistry } from "./directorTransformRegistry";

/** 在场景缩放组外绑定 TransformControls，避免 gizmo 与造具错位 */
export function DirectorSelectedTransformControls({
  object,
  transformMode,
  gridSnap = false,
  onTransform,
  onLiveTransform,
  onDragChange,
}: {
  object: DirectorObject;
  transformMode: DirectorTransformMode;
  gridSnap?: boolean;
  onTransform: (id: string, transform: DirectorObject["transform"]) => void;
  onLiveTransform?: (id: string, transform: DirectorObject["transform"]) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const { getTransformGroup } = useDirectorTransformRegistry();
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const draggingRef = useRef(false);
  const target = getTransformGroup(object.id);
  const isCamera = object.kind === "camera";

  const readTransform = (group: Group): DirectorObject["transform"] => ({
    position: [group.position.x, group.position.y, group.position.z],
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  });

  const emitTransform = () => {
    if (!target) return;
    let next = readTransform(target);
    if (gridSnap) {
      next = snapTransform(next, transformMode);
      target.position.set(...next.position);
      target.rotation.set(...next.rotation);
      target.scale.set(...next.scale);
    }
    onTransform(object.id, next);
  };

  const emitLiveTransform = () => {
    if (!target || !isCamera) return;
    onLiveTransform?.(object.id, readTransform(target));
  };

  useEffect(() => {
    const controls = controlsRef.current as (TransformControlsImpl & {
      addEventListener(type: "dragging-changed", listener: (event: { value: boolean }) => void): void;
      removeEventListener(type: "dragging-changed", listener: (event: { value: boolean }) => void): void;
    }) | null;
    if (!controls || !target) return;

    const handleDraggingChanged = (event: { value: boolean }) => {
      draggingRef.current = event.value;
      onDragChange?.(event.value);
      if (!event.value) emitTransform();
    };

    controls.addEventListener("dragging-changed", handleDraggingChanged);
    return () => controls.removeEventListener("dragging-changed", handleDraggingChanged);
  }, [target, object.id, onDragChange, gridSnap, transformMode]);

  if (!target) return null;

  return (
    <TransformControls
      ref={controlsRef}
      object={target}
      mode={transformMode}
      space={isCamera && transformMode === "translate" ? "world" : "local"}
      size={isCamera ? 0.85 : 1}
      onObjectChange={isCamera ? emitLiveTransform : undefined}
      onMouseUp={emitTransform}
    />
  );
}
