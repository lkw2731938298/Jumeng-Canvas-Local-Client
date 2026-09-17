/**
 * 一键出海：目标市场清单（单国 MVP；后续可扩展多国并行）。
 */

export type OverseasMarketId =
  | "US"
  | "JP"
  | "KR"
  | "SEA"
  | "EU"
  | "MENA"
  | "BR"
  | "IN";

export type OverseasMarket = {
  id: OverseasMarketId;
  /** 中文展示名 */
  label: string;
  /** 英文/区域名，写入 Prompt */
  region: string;
  /** 主要对白语言说明 */
  language: string;
  /** 视觉/人设提示摘要 */
  castingHint: string;
};

export const OVERSEAS_MARKETS: OverseasMarket[] = [
  {
    id: "US",
    label: "美国",
    region: "United States",
    language: "English",
    castingHint: "多元族裔都市感，英语口语对白，欧美街景与室内",
  },
  {
    id: "JP",
    label: "日本",
    region: "Japan",
    language: "Japanese",
    castingHint: "东亚面孔与日系服饰，日语对白，日本街景/居酒屋/便利店等",
  },
  {
    id: "KR",
    label: "韩国",
    region: "South Korea",
    language: "Korean",
    castingHint: "韩系妆造与服饰，韩语对白，首尔街景/咖啡馆等",
  },
  {
    id: "SEA",
    label: "东南亚",
    region: "Southeast Asia",
    language: "English (local flavor OK)",
    castingHint: "东南亚面孔与气候感，英语或当地语言混用，热带街景",
  },
  {
    id: "EU",
    label: "欧洲",
    region: "Western Europe",
    language: "English",
    castingHint: "欧洲面孔与城市风貌，英语对白，欧式街道/室内",
  },
  {
    id: "MENA",
    label: "中东",
    region: "Middle East / GCC",
    language: "Arabic or English",
    castingHint: "中东面孔与服饰习惯，注意文化得体，现代都市或沙漠城市场景",
  },
  {
    id: "BR",
    label: "巴西",
    region: "Brazil",
    language: "Portuguese",
    castingHint: "拉美面孔与活力街景，葡萄牙语对白",
  },
  {
    id: "IN",
    label: "印度",
    region: "India",
    language: "Hindi or English",
    castingHint: "南亚面孔与服饰，英语/印地语对白，印度都市街景",
  },
];

export function getOverseasMarket(id: string | undefined | null): OverseasMarket {
  const hit = OVERSEAS_MARKETS.find((m) => m.id === id);
  return hit ?? OVERSEAS_MARKETS[0];
}
