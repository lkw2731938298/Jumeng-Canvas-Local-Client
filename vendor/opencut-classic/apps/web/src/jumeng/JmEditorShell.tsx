"use client";

/**
 * 聚梦剪辑台外壳：单层顶栏（返回画布 / 工程名 / 快捷键 / 导出）+ 背景光晕。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Clapperboard, Command, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { ExportButton } from "@/components/editor/export-button";
import { ShortcutsDialog } from "@/actions/components/shortcuts-dialog";
import { cn } from "@/utils/ui";
import "./jm-editor.css";

function returnToCanvas() {
	const bridge = (
		window as Window & {
			__jumengBridge?: { returnToCanvas: () => void };
		}
	).__jumengBridge;
	if (bridge?.returnToCanvas) {
		bridge.returnToCanvas();
		return;
	}
	if (window.opener) {
		window.close();
		return;
	}
	window.history.back();
}

export function JmEditorShell({
	banner,
	children,
}: {
	banner?: ReactNode;
	children: ReactNode;
}) {
	const { setTheme } = useTheme();

	// 聚梦嵌入强制深色：避免系统浅色主题下 bg-background / .panel 变成大白块
	useEffect(() => {
		setTheme("dark");
		document.documentElement.classList.add("dark");
		document.documentElement.style.colorScheme = "dark";
	}, [setTheme]);

	return (
		<div className="jm-editor dark">
			<div className="jm-editor-bg" aria-hidden />
			<div className="jm-editor-stage">
				{banner}
				<JmEditorTopbar />
				<div className="jm-editor-workspace">
					{children}
				</div>
			</div>
		</div>
	);
}

function JmEditorTopbar() {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [leaving, setLeaving] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);

	const handleBack = async () => {
		if (leaving) return;
		setLeaving(true);
		try {
			await editor.project.prepareExit();
		} catch (error) {
			console.error("Failed to prepare project exit:", error);
		} finally {
			try {
				editor.project.closeProject();
			} catch {
				/* ignore */
			}
			returnToCanvas();
		}
	};

	return (
		<header className="jm-editor-topbar">
			<div className="flex min-w-0 items-center gap-2">
				<button
					type="button"
					className="jm-topbar-btn"
					disabled={leaving}
					onClick={() => void handleBack()}
				>
					{leaving ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<ArrowLeft className="size-4" />
					)}
					返回画布
				</button>
				<span className="hidden text-white/25 sm:inline">|</span>
				<div className="flex min-w-0 items-center gap-2">
					<Clapperboard className="size-4 shrink-0 text-indigo-300" />
					<EditableProjectName />
				</div>
				{activeProject ? (
					<span className="hidden truncate text-xs text-white/35 md:inline">
						剪辑台 · 预览沉浸
					</span>
				) : null}
			</div>
			<nav className="flex items-center gap-2">
				<button
					type="button"
					className="jm-topbar-btn"
					onClick={() => setShortcutsOpen(true)}
				>
					<Command className="size-3.5" />
					<span className="hidden sm:inline">快捷键</span>
				</button>
				<div className="jm-export-slot">
					<ExportButton />
				</div>
				<ShortcutsDialog
					isOpen={shortcutsOpen}
					onOpenChange={setShortcutsOpen}
				/>
			</nav>
		</header>
	);
}

function EditableProjectName() {
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const [isEditing, setIsEditing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const originalNameRef = useRef("");
	const projectName = activeProject?.metadata.name || "未命名工程";

	const startEditing = () => {
		if (isEditing || !activeProject) return;
		originalNameRef.current = projectName;
		setIsEditing(true);
		requestAnimationFrame(() => inputRef.current?.select());
	};

	const saveEdit = async () => {
		if (!inputRef.current || !activeProject) return;
		const newName = inputRef.current.value.trim();
		setIsEditing(false);
		if (!newName) {
			inputRef.current.value = originalNameRef.current;
			return;
		}
		if (newName !== originalNameRef.current) {
			try {
				await editor.project.renameProject({
					id: activeProject.metadata.id,
					name: newName,
				});
			} catch (error) {
				toast.error("重命名失败", {
					description:
						error instanceof Error ? error.message : "请稍后重试",
				});
			}
		}
	};

	return (
		<input
			ref={inputRef}
			type="text"
			defaultValue={projectName}
			key={projectName}
			readOnly={!isEditing}
			onClick={startEditing}
			onBlur={() => void saveEdit()}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					inputRef.current?.blur();
				} else if (event.key === "Escape") {
					event.preventDefault();
					if (inputRef.current) {
						inputRef.current.value = originalNameRef.current;
					}
					setIsEditing(false);
					inputRef.current?.blur();
				}
			}}
			style={{ fieldSizing: "content" }}
			className={cn(
				"min-w-[4rem] max-w-[220px] truncate rounded-lg bg-transparent px-1.5 py-1 text-sm font-medium text-white/90 outline-none",
				isEditing
					? "ring-1 ring-indigo-400/50 cursor-text"
					: "cursor-pointer hover:bg-white/10",
			)}
		/>
	);
}
