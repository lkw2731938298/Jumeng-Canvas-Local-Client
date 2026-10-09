/**
 * 聚梦画布 ↔ OpenCut classic 跨窗口协议（iframe postMessage）。
 * canvas 宿主页与 /jumeng/[id] 编辑页共用。
 */

export const JUMENG_BRIDGE_VERSION = 1;

export type JumengBridgeAsset = {
	id: string;
	title: string;
	category: "video" | "audio" | "image";
	/** 可被 classic 同源或 CORS 拉取的绝对 URL */
	fileUrl: string;
};

export type JumengInitMessage = {
	type: "jumeng:init";
	v: typeof JUMENG_BRIDGE_VERSION;
	canvasProjectId: string;
	opencutProjectId: string;
	canvasOrigin: string;
	assetId?: string | null;
	fromNodeId?: string | null;
	assets: JumengBridgeAsset[];
};

export type JumengReadyMessage = {
	type: "jumeng:ready";
	v: typeof JUMENG_BRIDGE_VERSION;
};

export type JumengReturnMessage = {
	type: "jumeng:return";
	v: typeof JUMENG_BRIDGE_VERSION;
};

export type JumengExportMessage = {
	type: "jumeng:export";
	v: typeof JUMENG_BRIDGE_VERSION;
	canvasProjectId: string;
	fromNodeId?: string | null;
	fileName: string;
	mimeType: string;
	/** base64（无 data: 前缀） */
	base64: string;
	opencutProjectId: string;
};

export type JumengExportAckMessage = {
	type: "jumeng:export-ack";
	v: typeof JUMENG_BRIDGE_VERSION;
	ok: boolean;
	error?: string;
	assetId?: string;
	nodeId?: string;
};

export type JumengHostToEditor =
	| JumengInitMessage
	| JumengExportAckMessage;

export type JumengEditorToHost =
	| JumengReadyMessage
	| JumengReturnMessage
	| JumengExportMessage;

export function isJumengMessage(data: unknown): data is JumengHostToEditor | JumengEditorToHost {
	if (!data || typeof data !== "object") return false;
	const t = (data as { type?: unknown }).type;
	return typeof t === "string" && t.startsWith("jumeng:");
}

/** OpenCut 工程 id：项目级草稿，或成片节点专属草稿 */
export function buildOpencutProjectId(params: {
	canvasProjectId: string;
	fromNodeId?: string | null;
}): string {
	const base = `jm-${params.canvasProjectId.trim()}`;
	const node = (params.fromNodeId || "").trim();
	return node ? `${base}--${node}` : base;
}
