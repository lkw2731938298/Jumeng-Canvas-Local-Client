export const LANGUAGES = [
	{ code: "en", name: "英语" },
	{ code: "es", name: "西班牙语" },
	{ code: "it", name: "意大利语" },
	{ code: "fr", name: "法语" },
	{ code: "de", name: "德语" },
	{ code: "pt", name: "葡萄牙语" },
	{ code: "ru", name: "俄语" },
	{ code: "ja", name: "日语" },
	{ code: "zh", name: "中文" },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type LanguageCode = Language["code"];
