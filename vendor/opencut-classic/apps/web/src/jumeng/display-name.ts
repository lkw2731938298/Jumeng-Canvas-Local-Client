/**
 * 聚梦素材显示名：去掉 [jm:…] 去重标签，并把节点 ID 式标题收成短可读文案。
 * 仅影响 UI 展示，不改 IndexedDB 里用于去重的原始 name。
 */

const JM_TAG_RE = /\[jm:([^\]]+)\]\s*$/i;
const NODE_ID_RE =
	/^(video_input_|audio_input_|image_input_|node_)[a-zA-Z0-9._-]+$/i;

export function stripJumengTag({ name }: { name: string }): string {
	return name.replace(JM_TAG_RE, "").trim();
}

export function extractJumengTagId({ name }: { name: string }): string | null {
	const m = name.match(JM_TAG_RE);
	return m?.[1] ?? null;
}

/**
 * 轨道 / 素材卡展示用短标题。
 * 例：`video_input_1790… [jm:video_input_1790…]` → `视频 · 829162`
 */
export function formatMediaDisplayName({
	name,
	fallback,
}: {
	name?: string | null;
	fallback?: string;
}): string {
	const raw = (name || "").trim();
	if (!raw) return fallback || "未命名";

	const base = stripJumengTag({ name: raw });
	if (!base) return fallback || "未命名";

	if (NODE_ID_RE.test(base)) {
		const lower = base.toLowerCase();
		const kind = lower.startsWith("audio_")
			? "音频"
			: lower.startsWith("image_")
				? "图片"
				: "视频";
		// 取最后一段数字（区分同批导入的多条素材）
		const nums = base.match(/\d{4,}/g);
		const tail = nums?.length ? nums[nums.length - 1].slice(-6) : "";
		return tail ? `${kind} · ${tail}` : kind;
	}

	// 过长文件名截断中间，保留扩展名感观
	if (base.length > 28) {
		return `${base.slice(0, 12)}…${base.slice(-10)}`;
	}
	return base;
}

/** 导入时写入的素材名：可读标题 + [jm:id]（去重仍靠标签） */
export function mediaNameForJumeng({
	title,
	id,
	category,
}: {
	title: string;
	id: string;
	category?: "video" | "audio" | "image";
}): string {
	const cleaned = stripJumengTag({ name: title || "" });
	let base = cleaned;
	if (!base || base === id || NODE_ID_RE.test(base)) {
		const kind =
			category === "audio" ? "音频" : category === "image" ? "图片" : "视频";
		const nums = id.match(/\d{4,}/g);
		const tail = nums?.length ? nums[nums.length - 1].slice(-6) : "";
		base = tail ? `${kind} · ${tail}` : kind;
	}
	return `${base} [jm:${id}]`;
}
