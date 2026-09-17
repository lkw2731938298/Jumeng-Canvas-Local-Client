"use client";

/**
 * 相对触发器向上展开的 fixed 菜单（portal 到 body）。
 * 用于创作框工具栏：父级 `.creation-tools` 有 overflow-x:auto、hero 有 overflow:hidden，
 * 本地 absolute 菜单会被裁切，看起来像「点不开」。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  /** 触发按钮（用于定位与「内部点击」判断） */
  anchorEl: HTMLElement | null;
  onRequestClose: () => void;
  children: ReactNode;
  className?: string;
  /** 菜单最小宽度，兼作贴边钳制 */
  minWidth?: number;
  /** 额外命中区（如同组其它参数按钮），点到不算外部 */
  ignoreClosest?: string;
};

export function FixedAboveMenu({
  open,
  anchorEl,
  onRequestClose,
  children,
  className,
  minWidth = 96,
  ignoreClosest = "[data-creation-skill-param]",
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [ready, setReady] = useState(false);
  /** 打开瞬间强制重读锚点，避免 ref.current 作 prop 时定位滞后 */
  const [openTick, setOpenTick] = useState(0);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (open) setOpenTick((n) => n + 1);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorEl) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = anchorEl.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, r.left),
        Math.max(8, window.innerWidth - minWidth - 8)
      );
      setPos({ top: r.top - 8, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorEl, minWidth, openTick]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (anchorEl?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      if (ignoreClosest && t.closest?.(ignoreClosest)) return;
      onRequestClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, anchorEl, onRequestClose, ignoreClosest]);

  if (!ready || !open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      data-creation-skill-param
      className={cn(
        "fixed z-[210] overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a28] py-1 shadow-2xl",
        className
      )}
      style={{
        left: pos.left,
        top: pos.top,
        transform: "translateY(-100%)",
        minWidth,
        maxHeight: "min(240px, 45vh)",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
