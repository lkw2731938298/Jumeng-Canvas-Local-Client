"use client";

import {
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useEditor } from "@/editor/use-editor";
import type { PreviewOverlayControl } from "@/preview/overlays";
import { toast } from "sonner";

export function PreviewContextMenu({
	onToggleFullscreen,
	container,
	overlayControls,
	onOverlayVisibilityChange,
}: {
	onToggleFullscreen: () => void;
	container: HTMLElement | null;
	overlayControls: PreviewOverlayControl[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const editor = useEditor();
	const viewport = usePreviewViewport();

	const handleCopySnapshot = async () => {
		const result = await editor.renderer.copySnapshot();

		if (!result.success) {
			toast.error("复制快照失败", {
				description: result.error ?? "请稍后重试",
			});
			return;
		}
	};

	const handleSaveSnapshot = async () => {
		const result = await editor.renderer.saveSnapshot();

		if (!result.success) {
			toast.error("保存快照失败", {
				description: result.error ?? "请稍后重试",
			});
			return;
		}
	};

	return (
		<ContextMenuContent className="w-56" container={container}>
			<ContextMenuItem onClick={viewport.fitToScreen} inset>
				适应屏幕
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onClick={onToggleFullscreen} inset>
				全屏
			</ContextMenuItem>
			<ContextMenuItem onClick={handleSaveSnapshot} inset>
				保存快照
			</ContextMenuItem>
			<ContextMenuItem onClick={handleCopySnapshot} inset>
				复制快照
			</ContextMenuItem>
			{overlayControls.length > 0 ? <ContextMenuSeparator /> : null}
			{overlayControls.map((overlayControl) => (
				<ContextMenuCheckboxItem
					key={overlayControl.id}
					checked={overlayControl.isVisible}
					onCheckedChange={(checked) =>
						onOverlayVisibilityChange({
							overlayId: overlayControl.id,
							isVisible: !!checked,
						})
					}
				>
					{overlayControl.label}
				</ContextMenuCheckboxItem>
			))}
		</ContextMenuContent>
	);
}
