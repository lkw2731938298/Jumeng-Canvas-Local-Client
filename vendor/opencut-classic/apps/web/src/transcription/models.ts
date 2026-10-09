import type {
	TranscriptionModel,
	TranscriptionModelId,
} from "./types";

export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
	{
		id: "whisper-tiny",
		name: "极速",
		huggingFaceId: "onnx-community/whisper-tiny",
		description: "最快，准确率较低",
	},
	{
		id: "whisper-small",
		name: "小型",
		huggingFaceId: "onnx-community/whisper-small",
		description: "速度与准确率较均衡",
	},
	{
		id: "whisper-medium",
		name: "中型",
		huggingFaceId: "onnx-community/whisper-medium",
		description: "更准，更慢",
	},
	{
		id: "whisper-large-v3-turbo",
		name: "大型 v3 Turbo",
		huggingFaceId: "onnx-community/whisper-large-v3-turbo",
		description: "最准，建议开启 WebGPU",
	},
];

export const DEFAULT_TRANSCRIPTION_MODEL: TranscriptionModelId =
	"whisper-small";
