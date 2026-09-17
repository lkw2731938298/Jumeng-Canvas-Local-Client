/** 全能 Pro 官方稳定版不可用的创作工具（下拉已隐藏的项可留空） */
export const NANO_PRO_OFFICIAL_DISABLED_IDS = new Set<string>([]);

export function isNanoProOfficialModel(modelName: string | undefined): boolean {
  return Boolean(modelName?.startsWith("nano_pro_") && modelName.includes("_official"));
}
