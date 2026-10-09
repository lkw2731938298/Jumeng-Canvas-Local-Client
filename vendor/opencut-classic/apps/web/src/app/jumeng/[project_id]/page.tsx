"use client";

/**
 * 聚梦画布嵌入剪辑台：预览沉浸 + 左右/底毛玻璃浮层坞（1A+2B）。
 * 独立 /editor 布局不受影响。
 */

import { useParams, useSearchParams } from "next/navigation";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AssetsPanel } from "@/components/editor/panels/assets";
import { PropertiesPanel } from "@/components/editor/panels/properties";
import { Timeline } from "@/timeline/components";
import { PreviewPanel } from "@/preview/components";
import { EditorProvider } from "@/components/providers/editor-provider";
import { usePasteMedia } from "@/media/use-paste-media";
import { MobileGate } from "@/components/editor/mobile-gate";
import { JumengBridge, resolveJumengRouteProjectId } from "@/jumeng/JumengBridge";
import { JmEditorShell } from "@/jumeng/JmEditorShell";
import { JmFloatingDock } from "@/jumeng/JmFloatingDock";
import { buildOpencutProjectId } from "@/jumeng/bridge-protocol";
import { useEditor } from "@/editor/use-editor";
import { usePreviewStore } from "@/preview/preview-store";
import {
	createPreviewOverlayControl,
	isPreviewOverlayVisible,
	mergePreviewOverlaySources,
} from "@/preview/overlays";
import { getGuidePreviewOverlaySource } from "@/guides";
import {
	bookmarkNotesPreviewOverlay,
	getBookmarkPreviewOverlaySource,
} from "@/timeline/bookmarks/index";
import { Button } from "@/components/ui/button";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const TIMELINE_MIN = 160;
const TIMELINE_MAX_RATIO = 0.62;
const TIMELINE_DEFAULT_RATIO = 0.32;

function JumengEditorInner() {
	const params = useParams();
	const search = useSearchParams();
	const routeRaw = String(params.project_id || "");
	const canvasProjectId =
		search.get("canvasProjectId") ||
		(routeRaw.startsWith("jm-")
			? routeRaw.replace(/^jm-/, "").split("--")[0]
			: routeRaw);
	const fromNodeId = search.get("fromNodeId");
	const opencutProjectId = useMemo(
		() =>
			resolveJumengRouteProjectId({
				routeId: routeRaw.startsWith("jm-")
					? routeRaw
					: buildOpencutProjectId({
							canvasProjectId,
							fromNodeId,
						}),
				canvasProjectId,
				fromNodeId,
			}),
		[routeRaw, canvasProjectId, fromNodeId],
	);

	return (
		<MobileGate>
			<EditorProvider
				projectId={opencutProjectId}
				stableCreateIfMissing
				projectName={`画布 ${canvasProjectId}`}
			>
				<JumengBridge opencutProjectId={opencutProjectId} />
				<JmEditorShell banner={<DegradedRendererBanner />}>
					<JumengEditorLayout />
				</JmEditorShell>
			</EditorProvider>
		</MobileGate>
	);
}

function DegradedRendererBanner() {
	const isDegraded = useEditor((e) => e.renderer.isDegraded);
	const [dismissed, setDismissed] = useState(false);
	if (!isDegraded || dismissed) return null;

	return (
		<div className="jm-banner">
			<span>建议使用 Chrome 浏览器以获得最佳体验。</span>
			<Button
				variant="text"
				size="icon"
				className="p-0 w-auto text-white/60 hover:text-white [&_svg]:size-3.5"
				onClick={() => setDismissed(true)}
				aria-label="关闭"
			>
				<HugeiconsIcon icon={Cancel01Icon} />
			</Button>
		</div>
	);
}

function JumengEditorLayout() {
	usePasteMedia();
	const workspaceRef = useRef<HTMLDivElement>(null);
	const [leftCollapsed, setLeftCollapsed] = useState(false);
	const [rightCollapsed, setRightCollapsed] = useState(false);
	const [timelinePx, setTimelinePx] = useState(() =>
		typeof window !== "undefined"
			? Math.round(window.innerHeight * TIMELINE_DEFAULT_RATIO)
			: 280,
	);
	const [resizingTimeline, setResizingTimeline] = useState(false);
	const dragRaised = useDragRaiseTimeline();

	const activeScene = useEditor((editor) =>
		editor.scenes.getActiveSceneOrNull(),
	);
	const currentTime = useEditor((editor) => editor.playback.getCurrentTime());
	const activeGuide = usePreviewStore((state) => state.activeGuide);
	const overlays = usePreviewStore((state) => state.overlays);
	const setOverlayVisibility = usePreviewStore(
		(state) => state.setOverlayVisibility,
	);
	const showBookmarkNotes = isPreviewOverlayVisible({
		overlay: bookmarkNotesPreviewOverlay,
		overlays,
	});

	const overlaySource = useMemo(
		() =>
			mergePreviewOverlaySources({
				sources: [
					getGuidePreviewOverlaySource({
						guideId: activeGuide,
					}),
					activeScene
						? getBookmarkPreviewOverlaySource({
								bookmarks: activeScene.bookmarks,
								time: currentTime,
								isVisible: showBookmarkNotes,
							})
						: {
								definitions: [bookmarkNotesPreviewOverlay],
								instances: [],
							},
				],
			}),
		[activeGuide, activeScene, currentTime, showBookmarkNotes],
	);

	const overlayControls = useMemo(
		() =>
			overlaySource.definitions.map((overlay) =>
				createPreviewOverlayControl({ overlay, overlays }),
			),
		[overlaySource.definitions, overlays],
	);

	const onTimelineResizeStart = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startY = event.clientY;
			const startH = timelinePx;
			const workspaceH =
				workspaceRef.current?.clientHeight ?? window.innerHeight;
			setResizingTimeline(true);

			const onMove = (e: PointerEvent) => {
				const delta = startY - e.clientY;
				const max = Math.round(workspaceH * TIMELINE_MAX_RATIO);
				const next = Math.min(max, Math.max(TIMELINE_MIN, startH + delta));
				setTimelinePx(next);
			};
			const onUp = () => {
				setResizingTimeline(false);
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		},
		[timelinePx],
	);

	if (!activeScene) {
		return (
			<div className="flex h-full w-full min-h-[50vh] items-center justify-center text-sm text-white/70">
				初始化时间线…
			</div>
		);
	}

	const timelineStyle = {
		["--jm-timeline-h" as string]: `${timelinePx}px`,
		/* 折叠时预览只让出窄轨宽度 */
		["--jm-preview-pad-left" as string]: leftCollapsed
			? "var(--jm-dock-rail)"
			: "var(--jm-dock-left-w)",
		["--jm-preview-pad-right" as string]: rightCollapsed
			? "var(--jm-dock-rail)"
			: "var(--jm-dock-right-w)",
	};

	return (
		<div
			ref={workspaceRef}
			className="absolute inset-0 min-h-0 w-full"
			style={timelineStyle}
		>
			{/* 沉浸预览 */}
			<div className="jm-editor-preview">
				<div className="jm-editor-preview-frame">
					<PreviewPanel
						overlayControls={overlayControls}
						overlayInstances={overlaySource.instances}
						onOverlayVisibilityChange={setOverlayVisibility}
					/>
				</div>
			</div>

			{/* 左侧素材坞 */}
			<JmFloatingDock
				side="left"
				title="素材"
				collapsed={leftCollapsed}
				onCollapsedChange={setLeftCollapsed}
			>
				<AssetsPanel />
			</JmFloatingDock>

			{/* 右侧属性坞 */}
			<JmFloatingDock
				side="right"
				title="属性"
				collapsed={rightCollapsed}
				onCollapsedChange={setRightCollapsed}
			>
				<PropertiesPanel />
			</JmFloatingDock>

			{/* 底部时间线坞 */}
			<JmFloatingDock
				side="bottom"
				title="时间线"
				dragging={resizingTimeline || dragRaised}
				resizeHandle={
					<div
						className="jm-timeline-resize"
						onPointerDown={onTimelineResizeStart}
						role="separator"
						aria-orientation="horizontal"
						aria-label="调整时间线高度"
					/>
				}
			>
				<Timeline />
			</JmFloatingDock>
		</div>
	);
}

/** 拖拽素材时抬高时间线坞，保证 drop 可命中 */
function useDragRaiseTimeline() {
	const [raised, setRaised] = useState(false);
	useEffect(() => {
		const onStart = () => setRaised(true);
		const onEnd = () => setRaised(false);
		window.addEventListener("dragstart", onStart, true);
		window.addEventListener("dragend", onEnd, true);
		window.addEventListener("drop", onEnd, true);
		return () => {
			window.removeEventListener("dragstart", onStart, true);
			window.removeEventListener("dragend", onEnd, true);
			window.removeEventListener("drop", onEnd, true);
		};
	}, []);
	return raised;
}

export default function JumengEditorPage() {
	return (
		<Suspense
			fallback={
				<div className="flex h-screen w-screen items-center justify-center bg-[#030013] text-sm text-white/45">
					加载剪辑台…
				</div>
			}
		>
			<JumengEditorInner />
		</Suspense>
	);
}
