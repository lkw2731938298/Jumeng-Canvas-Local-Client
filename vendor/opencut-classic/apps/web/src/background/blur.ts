export const BACKGROUND_BLUR_INTENSITY_PRESETS: Array<{
	label: string;
	value: number;
}> = [
	{ label: "轻", value: 100 },
	{ label: "中", value: 200 },
	{ label: "重", value: 500 },
] as const;

export const DEFAULT_BACKGROUND_BLUR_INTENSITY = 10;
