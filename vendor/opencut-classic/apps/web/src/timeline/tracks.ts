import type { TrackType } from "@/timeline";

export const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
	video: "视频轨",
	text: "文字轨",
	audio: "音频轨",
	graphic: "图形轨",
	effect: "特效轨",
} as const;
