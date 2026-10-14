"use client";

import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
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
  onTransform: (
    id: string,
    transform: DirectorObject["transform"],
    mode: DirectorTransformMode
  ) => void;
  onLiveTransform?: (id: string, transform: DirectorObject["transform"]) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const { getTransformGroup } = useDirectorTransformRegistry();
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const draggingRef = useRef(false);
  /** 按下时位姿；几乎未移动则不当作落盘，避免「点选」误写关键帧/跳位 */
  const dragStartRef = useRef<DirectorObject["transform"] | null>(null);
  /**
   * 拖拽过程中最后一次有效坐标。
   * 松手时 Object3D 可能已被采样/缺省打回原点，落盘必须用这个，不能用被打回的读数。
   */
  const lastTranslateRef = useRef<[number, number, number] | null>(null);
  const target = getTransformGroup(object.id);
  const isCamera = object.kind === "camera";

  const readTransform = (group: Group): DirectorObject["transform"] => ({
    position: [group.position.x, group.position.y, group.position.z],
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  });

  const transformMoved = (
    a: DirectorObject["transform"],
    b: DirectorObject["transform"]
  ) => {
    const d = (u: number[], v: number[]) =>
      Math.hypot(u[0]! - v[0]!, u[1]! - v[1]!, u[2]! - v[2]!);
    return (
      d(a.position, b.position) > 1e-4 ||
      d(a.rotation, b.rotation) > 1e-4 ||
      d(a.scale, b.scale) > 1e-4
    );
  };

  const emitTransform = () => {
    if (!target) return;
    let next = readTransform(target);
    // 平移落盘以拖拽中的最后坐标为准，避免松手读到被打回的原点
    if (transformMode === "translate" && lastTranslateRef.current) {
      next = {
        ...next,
        position: [...lastTranslateRef.current] as [number, number, number],
      };
    }
    if (gridSnap) {
      next = snapTransform(next, transformMode);
      target.position.set(...next.position);
      target.rotation.set(...next.rotation);
      target.scale.set(...next.scale);
    }
    const start = dragStartRef.current;
    if (start && !transformMoved(start, next)) return;
    // 先把物体留在落点，避免随后的 React 提交用旧采样盖回去
    if (transformMode === "translate") {
      target.position.set(...next.position);
    }
    onTransform(object.id, next, transformMode);
    lastTranslateRef.current = null;
  };

  const emitLiveTransform = () => {
    if (!target || !draggingRef.current) return;
    // 平移时实时回调（轨迹顶点跟随）；机位另用于监视器 live
    if (transformMode !== "translate" && !isCamera) return;
    const next = readTransform(target);
    if (transformMode === "translate") {
      lastTranslateRef.current = [...next.position] as [number, number, number];
    }
    onLiveTransform?.(object.id, next);
  };

  useEffect(() => {
    const controls = controlsRef.current as (TransformControlsImpl & {
      addEventListener(type: "dragging-changed", listener: (event: { value: boolean }) => void): void;
      removeEventListener(type: "dragging-changed", listener: (event: { value: boolean }) => void): void;
    }) | null;
    if (!controls || !target) return;

    const handleDraggingChanged = (event: { value: boolean }) => {
      if (event.value) {
        if (draggingRef.current) return;
        draggingRef.current = true;
        lastTranslateRef.current = null;
        dragStartRef.current = readTransform(target);
        onDragChange?.(true);
        return;
      }
      if (!draggingRef.current) return;
      draggingRef.current = false;
      // 先落盘再解除 interacting；延迟一帧 unsuspend，避免采样用旧路径写回原位
      flushSync(() => {
        emitTransform();
      });
      dragStartRef.current = null;
      requestAnimationFrame(() => {
        onDragChange?.(false);
      });
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
      onObjectChange={onLiveTransform ? emitLiveTransform : undefined}
      // 落盘只走 dragging-changed(false)，避免 mouseUp 早于 interacting 结束造成弹回
    />
  );
}
