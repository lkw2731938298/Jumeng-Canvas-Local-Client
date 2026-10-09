import type { ParamDefinition } from "@/params";

export type GraphicStrokeAlign = "inside" | "center" | "outside";

export const STROKE_ALIGN_PARAM: ParamDefinition<"strokeAlign"> = {
	key: "strokeAlign",
	label: "描边对齐",
	type: "select",
	default: "center",
	group: "stroke",
	options: [
		{ value: "inside", label: "内侧" },
		{ value: "center", label: "居中" },
		{ value: "outside", label: "外侧" },
	],
};
