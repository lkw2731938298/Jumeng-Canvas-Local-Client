"use client";

/**
 * Jumeng 嵌入桥：注入画布素材（按 jm:assetId 去重）、导出回传、返回画布。
 * 工程加载由 EditorProvider(stableCreateIfMissing) 负责，禁止在此 loadProject。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import {
	buildOpencutProjectId,
	isJumengMessage,
	JUMENG_BRIDGE_VERSION,
	type JumengBridgeAsset,
	type JumengInitMessage,
} from "@/jumeng/bridge-protocol";
import {
	extractJumengTagId,
	mediaNameForJumeng,
	stripJumengTag,
} from "@/jumeng/display-name";

/** 去掉签名查询串，避免同一素材多次导入 */
function normalizeAssetUrl({ url }: { url: string }): string {
	const raw = (url || "").trim();
	if (!raw) return "";
	try {
		const u = new URL(raw);
		return `${u.origin}${u.pathname}`;
	} catch {
		return raw.split("?")[0].split("#")[0];
	}
}

function extractJumengId({ name }: { name: string }): string | null {
	return extractJumengTagId({ name });
}

function baseTitle({ name }: { name: string }): string {
	return stripJumengTag({ name }).toLowerCase();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

async function fetchAsFile(asset: JumengBridgeAsset): Promise<File | null> {
	try {
		const res = await fetch(asset.fileUrl, { mode: "cors", credentials: "omit" });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const blob = await res.blob();
		const ext =
			asset.category === "audio"
				? "mp3"
				: asset.category === "image"
					? "png"
					: "mp4";
		const name = `${asset.title || asset.id}.${ext}`;
		const type =
			blob.type ||
			(asset.category === "audio"
				? "audio/mpeg"
				: asset.category === "image"
					? "image/png"
					: "video/mp4");
		return new File([blob], name, { type });
	} catch (err) {
		console.error("[jumeng] fetch asset failed", asset.id, err);
		return null;
	}
}

/**
 * 清理 IndexedDB 重复素材：
 * 1) 同 jm:id 只留一条
 * 2) 同规范化 URL 只留一条（优先保留带 jm 标签的）
 * 3) 无 jm 标签且标题与已有 jm 素材相同 → 删掉无标签副本
 */
function dedupeExistingJumengMedia({ projectId }: { projectId: string }): void {
	const core = EditorCore.getInstance();
	const assets = core.media.getAssets();
	const keepByJm = new Map<string, string>();
	const keepByUrl = new Map<string, string>();
	const jmTitles = new Set<string>();
	const removeIds: string[] = [];
	const marked = new Set<string>();

	const markRemove = (id: string) => {
		if (marked.has(id)) return;
		marked.add(id);
		removeIds.push(id);
	};

	// 先处理带 jm 标签的，保证它们优先保留
	const sorted = [...assets].sort((a, b) => {
		const aJm = extractJumengId({ name: a.name }) ? 0 : 1;
		const bJm = extractJumengId({ name: b.name }) ? 0 : 1;
		return aJm - bJm;
	});

	for (const asset of sorted) {
		const jmId = extractJumengId({ name: asset.name });
		const titleKey = `${asset.type}:${baseTitle({ name: asset.name })}`;

		if (jmId) {
			const existing = keepByJm.get(jmId);
			if (existing) {
				markRemove(asset.id);
				continue;
			}
			keepByJm.set(jmId, asset.id);
			if (titleKey.length > 2) jmTitles.add(titleKey);
		} else if (titleKey.length > 2 && jmTitles.has(titleKey)) {
			// 有同标题的画布注入副本时，去掉历史无标签重复项
			markRemove(asset.id);
			continue;
		}

		const urlKey = normalizeAssetUrl({ url: asset.url || "" });
		if (urlKey) {
			const existingUrl = keepByUrl.get(urlKey);
			if (existingUrl && existingUrl !== asset.id) {
				markRemove(asset.id);
				continue;
			}
			keepByUrl.set(urlKey, asset.id);
		}
	}

	if (removeIds.length) {
		core.media.removeMediaAssets({ projectId, ids: removeIds });
	}
}

export function JumengBridge({
	opencutProjectId: routeProjectId,
}: {
	opencutProjectId: string;
}) {
	const search = useSearchParams();
	const active = useEditor((e) => e.project.getActiveOrNull());
	const [canvasProjectId, setCanvasProjectId] = useState(
		() => search.get("canvasProjectId") || "",
	);
	const [fromNodeId, setFromNodeId] = useState<string | null>(
		() => search.get("fromNodeId"),
	);
	const [canvasOrigin, setCanvasOrigin] = useState(
		() =>
			search.get("canvasOrigin") ||
			process.env.NEXT_PUBLIC_JUMENG_CANVAS_ORIGIN ||
			"http://127.0.0.1:3456",
	);
	const importedRef = useRef<Set<string>>(new Set());
	const readySent = useRef(false);
	const initHandled = useRef(false);
	const importLock = useRef(false);

	const seedImportedFromLibrary = useCallback(() => {
		const core = EditorCore.getInstance();
		for (const asset of core.media.getAssets()) {
			const jmId = extractJumengId({ name: asset.name });
			if (jmId) importedRef.current.add(jmId);
		}
	}, []);

	const postToParent = useCallback(
		(msg: Record<string, unknown>) => {
			if (typeof window === "undefined") return;
			if (window.parent && window.parent !== window) {
				window.parent.postMessage(msg, canvasOrigin);
			}
		},
		[canvasOrigin],
	);

	const importAssets = useCallback(
		async (assets: JumengBridgeAsset[]) => {
			if (importLock.current) return;
			importLock.current = true;
			try {
				const core = EditorCore.getInstance();
				const projectId = routeProjectId;
				if (!core.scenes.getActiveSceneOrNull()) {
					toast.message("工程尚未就绪，稍后再导入素材");
					return;
				}

				dedupeExistingJumengMedia({ projectId });
				seedImportedFromLibrary();

				const media = assets.filter(
					(a) => a.category === "video" || a.category === "audio",
				);
				// 画布侧同 URL（忽略签名参数）/ 同 id 只导入一次
				const seenUrl = new Set<string>();
				const unique: JumengBridgeAsset[] = [];
				for (const a of media) {
					if (importedRef.current.has(a.id)) continue;
					const urlKey = normalizeAssetUrl({ url: a.fileUrl }) || a.id;
					if (seenUrl.has(urlKey) || seenUrl.has(a.id)) continue;
					seenUrl.add(urlKey);
					seenUrl.add(a.id);
					unique.push(a);
				}

				let added = 0;
				for (const asset of unique) {
					if (importedRef.current.has(asset.id)) continue;
					const file = await fetchAsFile(asset);
					if (!file) continue;
					const processed = await processMediaAssets({ files: [file] });
					for (const p of processed) {
						await core.media.addMediaAsset({
							projectId,
							asset: {
								...p,
								name: mediaNameForJumeng({
									title: asset.title || p.name,
									id: asset.id,
									category:
										asset.category === "audio"
											? "audio"
											: asset.category === "image"
												? "image"
												: "video",
								}),
							},
						});
						added += 1;
					}
					importedRef.current.add(asset.id);
				}

				if (added > 0) {
					toast.success(`已导入 ${added} 个素材`);
				}
			} finally {
				importLock.current = false;
			}
		},
		[routeProjectId, seedImportedFromLibrary],
	);

	useEffect(() => {
		if (!readySent.current && active) {
			readySent.current = true;
			seedImportedFromLibrary();
			dedupeExistingJumengMedia({ projectId: routeProjectId });
			postToParent({ type: "jumeng:ready", v: JUMENG_BRIDGE_VERSION });
		}
	}, [active, postToParent, routeProjectId, seedImportedFromLibrary]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.origin !== canvasOrigin) return;
			const data = event.data;
			if (!isJumengMessage(data)) return;
			if (data.type === "jumeng:init") {
				// 宿主可能多次 postInit；只处理一次完整导入
				if (initHandled.current) return;
				initHandled.current = true;
				const init = data as JumengInitMessage;
				setCanvasProjectId(init.canvasProjectId);
				setFromNodeId(init.fromNodeId ?? null);
				setCanvasOrigin(init.canvasOrigin || canvasOrigin);
				void importAssets(init.assets || []);
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [canvasOrigin, importAssets]);

	useEffect(() => {
		const api = {
			returnToCanvas: () => {
				postToParent({ type: "jumeng:return", v: JUMENG_BRIDGE_VERSION });
			},
			exportToCanvas: async (params: {
				buffer: ArrayBuffer;
				fileName: string;
				mimeType: string;
			}) => {
				if (!canvasProjectId) {
					toast.error("缺少画布项目，无法回传成片");
					return;
				}
				postToParent({
					type: "jumeng:export",
					v: JUMENG_BRIDGE_VERSION,
					canvasProjectId,
					fromNodeId,
					fileName: params.fileName,
					mimeType: params.mimeType,
					base64: arrayBufferToBase64(params.buffer),
					opencutProjectId: routeProjectId,
				});
				toast.message("成片已发送到画布…");
			},
			getCanvasOrigin: () => canvasOrigin,
			isJumeng: true,
		};
		(
			window as Window & { __jumengBridge?: typeof api }
		).__jumengBridge = api;
		return () => {
			delete (window as Window & { __jumengBridge?: typeof api }).__jumengBridge;
		};
	}, [canvasProjectId, fromNodeId, canvasOrigin, postToParent, routeProjectId]);

	return null;
}

export function resolveJumengRouteProjectId(params: {
	routeId: string;
	canvasProjectId?: string | null;
	fromNodeId?: string | null;
}): string {
	if (params.routeId.startsWith("jm-")) return params.routeId;
	return buildOpencutProjectId({
		canvasProjectId: params.canvasProjectId || params.routeId,
		fromNodeId: params.fromNodeId,
	});
}
