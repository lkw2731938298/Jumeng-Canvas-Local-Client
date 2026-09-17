import { withBasePath } from "@/lib/basePath";

/** 营销位默认封面：同域 SVG，避免 images.unsplash.com 跨境延迟 */
const COVERS = [
  "/huabu/covers/cover-violet.svg",
  "/huabu/covers/cover-indigo.svg",
  "/huabu/covers/cover-rose.svg",
] as const;

export function localMarketingCover(index = 0): string {
  return withBasePath(COVERS[Math.abs(index) % COVERS.length]);
}

/** 用稳定字符串把不同条目映射到 3 张同域封面，避免全部撞同一张 */
export function localMarketingCoverFromKey(key: string): string {
  let hash = 0;
  for (const ch of String(key || "")) hash = (hash + ch.charCodeAt(0)) % COVERS.length;
  return localMarketingCover(hash);
}
