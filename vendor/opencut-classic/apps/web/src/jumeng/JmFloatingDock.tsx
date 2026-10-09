"use client";

/**
 * 聚梦剪辑台毛玻璃浮层坞：左/右/底统一容器与折叠。
 */

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, PanelBottom } from "lucide-react";
import { cn } from "@/utils/ui";

type DockSide = "left" | "right" | "bottom";

export function JmFloatingDock({
	side,
	title,
	collapsed,
	onCollapsedChange,
	className,
	style,
	dragging,
	resizeHandle,
	children,
}: {
	side: DockSide;
	title: string;
	collapsed?: boolean;
	onCollapsedChange?: (collapsed: boolean) => void;
	className?: string;
	style?: React.CSSProperties;
	dragging?: boolean;
	resizeHandle?: ReactNode;
	children: ReactNode;
}) {
	const canCollapse = side === "left" || side === "right";
	const CollapseIcon =
		side === "left"
			? collapsed
				? ChevronRight
				: ChevronLeft
			: collapsed
				? ChevronLeft
				: ChevronRight;

	return (
		<aside
			className={cn(
				"jm-dock jm-glass",
				side === "left" && "jm-dock-left",
				side === "right" && "jm-dock-right",
				side === "bottom" && "jm-dock-bottom",
				collapsed && "is-collapsed",
				dragging && "is-dragging",
				className,
			)}
			style={style}
			data-jm-dock={side}
		>
			{resizeHandle}
			<div className="jm-dock-head">
				{!(canCollapse && collapsed) ? (
					<span className="jm-dock-title">{title}</span>
				) : (
					<span className="jm-dock-title" title={title}>
						{side === "bottom" ? <PanelBottom className="size-3.5" /> : "···"}
					</span>
				)}
				{canCollapse && onCollapsedChange ? (
					<button
						type="button"
						className="jm-icon-btn"
						aria-label={collapsed ? "展开面板" : "折叠面板"}
						onClick={() => onCollapsedChange(!collapsed)}
					>
						<CollapseIcon className="size-3.5" />
					</button>
				) : null}
			</div>
			{!(canCollapse && collapsed) ? (
				<div className="jm-dock-body">{children}</div>
			) : (
				<div className="flex flex-1 flex-col items-center gap-2 py-3">
					<button
						type="button"
						className="jm-icon-btn"
						aria-label={`展开${title}`}
						onClick={() => onCollapsedChange?.(false)}
					>
						<CollapseIcon className="size-3.5" />
					</button>
				</div>
			)}
		</aside>
	);
}
