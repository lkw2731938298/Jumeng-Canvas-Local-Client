"use client";

/** 开源本地版：无登录页背景网格 */
export function useSiteHomepage() {
  return { data: { authGridImageUrls: [] as string[], loginModalImageUrl: "" } };
}

export function AuthHomepageBackground() {
  return null;
}

export function SiteHomepageBackground() {
  return null;
}
