import type { NormalizedCubicBezier } from "@/animation/types";

export const PRESET_MATCH_TOLERANCE = 0.02;

export interface EasingPreset {
	id: string;
	label: string;
	value: NormalizedCubicBezier;
	isCustom?: boolean;
}

export const BUILTIN_PRESETS: EasingPreset[] = [
	{ id: "smooth", label: "平滑", value: [0.25, 0.1, 0.25, 1] },
	{ id: "ease-out", label: "缓出", value: [0, 0, 0.2, 1] },
	{ id: "ease-in", label: "缓入", value: [0.8, 0, 1, 1] },
	{ id: "ease-in-out", label: "缓入缓出", value: [0.4, 0, 0.2, 1] },
	{ id: "pop", label: "弹出", value: [0.175, 0.885, 0.32, 1.275] },
	{ id: "linear", label: "线性", value: [0, 0, 1, 1] },
];
