/** 开源本地版：站点公开配置已禁用 */

export type SiteHomepage = {
  authGridImageUrls: string[];
  loginModalImageUrl: string;
};

export function getSiteHomepage(): Promise<SiteHomepage> {
  return Promise.resolve({ authGridImageUrls: [], loginModalImageUrl: "" });
}

export function getSiteFooter() {
  return Promise.resolve({
    brandText: "开源画布",
    copyright: "© Open Source",
    tagline: "",
    helpUrl: "",
    aboutUs: { label: "关于我们", href: "" },
    contactUs: { label: "联系我们", qrCodes: [] as Array<{ imageUrl?: string }> },
    socialLinks: [] as unknown[],
    friendLinks: [] as unknown[],
    friendLinksLabel: "友情链接",
    icpNumber: "",
    icpHref: "",
  });
}
