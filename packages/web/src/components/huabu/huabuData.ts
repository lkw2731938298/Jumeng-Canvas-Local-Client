// 开源本地版首页展示数据（静态灵感卡片，不连云端运营 API）。

import { localMarketingCover, localMarketingCoverFromKey } from "@/lib/huabu/localMarketingCover";

export type Inspiration = {
  title: string;
  author: string;
  avatar: string;
  caption: string;
  image: string;
};

const insp = (
  title: string,
  author: string,
  avatarPhoto: string,
  caption: string,
  photo: string
): Inspiration => ({
  title,
  author,
  avatar: localMarketingCoverFromKey(avatarPhoto),
  caption,
  image: localMarketingCoverFromKey(photo),
});

// 首页灵感卡片
export const inspirations: Inspiration[] = [
  insp("坠入绯红星海", "Astrid Lab", "photo-1494790108377-be9c29b29330", "《坠入绯红星海》科幻感星际短片", "photo-1534447677768-be436bb09401"),
  insp("潮汐之后", "Mori Studio", "photo-1527980965255-d3b416303d12", "《潮汐之后》治愈系海洋短片", "photo-1507525428034-b723cf961d3e"),
  insp("机械梦境 2049", "KIO", "photo-1500648767791-00dcc994a43e", "《机械梦境 2049》赛博朋克概念", "photo-1519608487953-e999c86e7455"),
  insp("雾中的来信", "Still Frame", "photo-1535713875002-d1d0cf377fde", "《雾中的来信》文艺氛围短片", "photo-1486911278844-a81c5267e227"),
  insp("霓虹夜行者", "Pixel Wave", "photo-1506794778202-cad84cf45f1d", "《霓虹夜行者》都市夜景实验", "photo-1514525253161-7a46d19cd819"),
  insp("春日物语", "Luna Film", "photo-1544005313-94ddf0286df2", "《春日物语》清新生活短片", "photo-1493246507139-91e8fad9978e"),
  insp("星际漫游", "Nova Studio", "photo-1472099645785-5658abf4ff4e", "《星际漫游》太空题材概念片", "photo-1451187580459-43490279c0fa"),
  insp("古韵长安", "墨染文化", "photo-1580489944761-15a19d654956", "《古韵长安》新中式美学 TVC", "photo-1508804185872-d7badad00f7d"),
  insp("深海回响", "Blue Frame", "photo-1517841905240-472988babdf9", "《深海回响》水下世界视觉实验", "photo-1559827260-dc66d52bef19"),
  insp("云端之上", "Skyline", "photo-1524504388940-b1c1722653e1", "《云端之上》航拍风光纪录片", "photo-1469474968028-56623f02e42e"),
  insp("午夜列车", "Night Owl", "photo-1506794778202-cad84cf45f1d", "《午夜列车》悬疑氛围短片", "photo-1470071459604-3b5ec3a7fe05"),
  insp("琥珀时光", "Amber Works", "photo-1534528741775-53994a69daeb", "《琥珀时光》复古胶片叙事", "photo-1516035069371-29a1b244cc32"),
  insp("雨巷记忆", "墨色映像", "photo-1507003211169-0a1dd7228f2d", "《雨巷记忆》江南意境短片", "photo-1501594907352-04cda38ebc29"),
  insp("银色轨道", "Orbit Lab", "photo-1527980965255-d3b416303d12", "《银色轨道》未来交通概念片", "photo-1486312338219-ce68d2c6f44d"),
  insp("花开四季", "Bloom Studio", "photo-1544005313-94ddf0286df2", "《花开四季》自然风光纪录", "photo-1490750967868-88aa4486c946"),
  insp("暗巷追光", "Noir Frame", "photo-1500648767791-00dcc994a43e", "《暗巷追光》黑色电影风格", "photo-1519501025264-65ba15a82390"),
  insp("沙漠回声", "Dune Vision", "photo-1472099645785-5658abf4ff4e", "《沙漠回声》旷野叙事短片", "photo-1509316785289-025f5b846b35"),
  insp("镜中世界", "Mirror Lab", "photo-1438761681033-6461ffad8d80", "《镜中世界》超现实视觉实验", "photo-1506905925346-21bda4d32df4"),
  insp("极光旅人", "Aurora Film", "photo-1494790108377-be9c29b29330", "《极光旅人》北境风光纪录", "photo-1531366936337-7c912a4589a7"),
  insp("纸飞机", "Paper Wing", "photo-1517841905240-472988babdf9", "《纸飞机》治愈系生活短片", "photo-1501785888041-af3ef285b470"),
  insp("钢铁森林", "Urban Core", "photo-1506794778202-cad84cf45f1d", "《钢铁森林》都市建筑美学", "photo-1480714378408-67cf0d13bc1b"),
  insp("青瓷梦", "青石造物", "photo-1580489944761-15a19d654956", "《青瓷梦》东方器物美学", "photo-1515405295579-ba7b45403062"),
  insp("数字尘埃", "Glitch Works", "photo-1535713875002-d1d0cf377fde", "《数字尘埃》故障艺术短片", "photo-1550745165-9bc0b252726f"),
  insp("海边邮局", "Tide Letter", "photo-1524504388940-b1c1722653e1", "《海边邮局》温情叙事短片", "photo-1507525428034-b723cf961d3e"),
  insp("星尘拾荒", "Cosmic Dust", "photo-1472099645785-5658abf4ff4e", "《星尘拾荒》太空歌剧概念", "photo-1462331940025-496dfbfc7564"),
  insp("红墙往事", "朱门映像", "photo-1494790108377-be9c29b29330", "《红墙往事》古建人文纪录", "photo-1547981609-4b6bfe67ca0b"),
];

export const GALLERY_PAGE_SIZE = 24;

export const galleryFilters = [
  "全部", "短剧漫剧", "电商带货", "IP口播", "AI获客",
  "达人探店", "AI信息流", "商业广告", "动漫游戏", "教育生活",
];

// 首页 Hero 提示芯片已改为拉取公开 Skill 目录（DiscoverHome.tsx）；此静态数据仅作历史对照
export const promptSuggestions: Array<{ label: string; image: string }> = [];

// 首页技能亮点（发现页 API 未返回时的前端兜底）
export const highlightFeatures = [
  { label: "一键出海", subtitle: "一键本地化出海短视频", tone: "purple", isNew: true, href: "#overseas-localize" },
  { label: "爆款复刻", subtitle: "拆解爆款结构快速复刻", tone: "blue", isNew: true, href: "#viral-remake" },
  { label: "剧本智能分集", subtitle: "长剧本智能拆分为分集", tone: "indigo", isNew: true, href: "/skills" },
  { label: "角色设计", subtitle: "统一角色外观与设定", tone: "gold", isNew: false, href: "/skills" },
];

// 首页活动预览
export const homeActivities: Array<{ title: string; subtitle: string; image: string }> = [];

// 活动页数据
export type Campaign = {
  id: string;
  title: string;
  bannerTitle?: string;
  bannerSub?: string;
  tag?: string;
  tagTone?: string;
  reward?: string;
  participants: string;
  image: string;
};

export const ongoingCampaigns: Campaign[] = [];

export const pastCampaigns: Campaign[] = [];

// 技能页：仅保留平台真实可运行 Skill（无模拟运营卡片）
export type HuabuSkill = {
  id: string;
  title: string;
  description: string;
  author: string;
  /** 使用次数展示；无真实统计时留空 */
  uses: string;
  category: string;
  image: string;
  /** 平台内置入口：viral_remake | overseas */
  entry?: "viral_remake" | "overseas";
};

/** 平台内置真实 Skill（对应可打开的弹窗 / 流水线） */
export const skillItems: HuabuSkill[] = [
  {
    id: "viral_remake",
    title: "爆款拉片复刻",
    description: "上传参考视频，按镜头切段拉片；每段≤12秒作参考，一键复刻同款。",
    author: "内置",
    uses: "",
    category: "通用技能",
    image: localMarketingCover(0),
    entry: "viral_remake",
  },
  {
    id: "overseas",
    title: "一键出海",
    description: "上传参考视频，选择目标市场；本地化主体/场景/语言后一键生成出海同款。",
    author: "内置",
    uses: "",
    category: "通用技能",
    image: localMarketingCover(1),
    entry: "overseas",
  },
  {
    id: "product_cinematic_commercial",
    title: "单一产品电影级宣传片",
    description:
      "针对单一产品，按电影质感与高级感编排分镜；支持文生/图生/实拍二次创作。",
    author: "内置",
    uses: "",
    category: "商业广告",
    image: localMarketingCover(2),
  },
  {
    id: "pov_tearjerker_short",
    title: "第一视角催泪短片导演",
    description:
      "告诉我人物关系与情感主题；先聊分镜草案、确认后再出板出片（POV 情绪工程：情感物+无声高潮+代际翻转）。",
    author: "内置",
    uses: "",
    category: "剧情短片",
    image: localMarketingCover(3),
  },
];

/** 分类 Tab：推荐 + 真实 Skill 已有分类（不再展示空模拟分类） */
export const skillCategories = [
  "推荐",
  ...Array.from(new Set(skillItems.map((s) => s.category))),
];
