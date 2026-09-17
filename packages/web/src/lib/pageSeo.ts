import type { Metadata } from "next";

/** 页面 SEO：title / keywords / description（开源副本中性文案） */
function pageSeo(title: string, keywords: string, description: string): Metadata {
  return {
    title,
    description,
    keywords,
    openGraph: { title, description },
  };
}

/** 发现页（已重定向，保留常量避免引用报错） */
export const DISCOVER_SEO = pageSeo(
  "开源画布",
  "开源画布,本地画布,AI 创作",
  "本机单用户开源画布：自配模型 API，本地保存项目。"
);

/** 项目页 `/projects` */
export const PROJECTS_SEO = pageSeo(
  "我的项目-开源画布",
  "我的项目,项目管理",
  "管理本机项目。"
);

/** 技能页 `/skills` */
export const SKILLS_SEO = pageSeo(
  "技能-开源画布",
  "技能,Skill",
  "画布技能入口。"
);

/** 个人中心页 `/account`（开源已重定向至设置） */
export const ACCOUNT_SEO = pageSeo(
  "本地设置-开源画布",
  "本地设置",
  "配置供应商与模型。"
);

/** 生成本机任务列表 `/jobs` */
export const JOBS_SEO = pageSeo(
  "生成任务-开源画布",
  "生成任务,任务列表",
  "查看本机生图/生视频任务记录与失败原因。"
);

/** 画布项目页用的数字编号：纯数字 projectNo，或 URL 上的数字 id */
export function projectSeoNumber(projectNo?: string | null, projectId?: string | null): string {
  const no = (projectNo ?? "").trim();
  if (/^\d+$/.test(no)) return no;
  const stripped = no.replace(/^PRJ-?/i, "");
  if (/^\d+$/.test(stripped)) return stripped;
  const id = (projectId ?? "").trim();
  if (/^\d+$/.test(id)) return id;
  return "";
}

/** 用户侧项目画布 SEO */
export function projectCanvasSeo(no: string): Metadata {
  const n = no.trim();
  if (!n) {
    return pageSeo("开源画布", "开源画布", "开源画布");
  }
  return pageSeo(`${n}-开源画布`, n, n);
}
