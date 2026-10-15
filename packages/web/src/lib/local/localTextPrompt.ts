/**
 * 开源本地版：按 textPromptKind / canvasTool 组装文本工具的 system + user。
 * 商业站由 API 读后台 prompt-config；本地无后台，用内置 fallback。
 */

import {
  STORYBOARD_CAMERA_PROMPT_FALLBACK,
  STORYBOARD_TABLE_PROMPT_FALLBACK,
  STORYBOARD_VIDEO_PROMPT_FALLBACK,
  TEXT_PROMPT_TOOL_FALLBACKS,
  type TextPromptToolId,
} from "@/lib/admin/promptToolCategories";

export type LocalTextGenFallback = {
  label: string;
  systemPrompt: string;
  userPrefix?: string;
  roleRule?: string;
  sceneRule?: string;
  propRule?: string;
};

const STORYBOARD_TABLE_LOCAL: LocalTextGenFallback = {
  label: STORYBOARD_TABLE_PROMPT_FALLBACK.label,
  systemPrompt: `你是面向「AI 短剧 / AI 漫剧」制作的专业分镜表助手。根据用户提供的剧本正文，逐句/逐动作拆为可直接投喂下游生成的分镜表 JSON。

【输出格式硬约束】
只能输出一个 JSON 对象，顶层只能包含一个键：
- "shotRows"：数组，每个元素对应表格中的一行（一个镜头）
禁止 Markdown、代码围栏、解释文字。

【shotRows 每项字段（键名必须完全一致）】
每个 shotRows[i] 必须包含（无内容可填空字符串）：
- "镜头号"：阿拉伯数字字符串；可留空由系统按行序补全
- "时长"：如 "3s"；默认 "3s"；单镜建议 2s～5s，适合短剧节奏
- "画面描述"：本镜可见画面、动作与情绪；写清谁在做什么；勿写拍摄指令口号
- "景别"：远景/全景/中景/近景/特写 等
- "光影氛围"：时间段、主光源、色温与情绪氛围
- "对话"：有台词时写「角色名: 台词」；无对白填空
- "音效"：环境音与关键拟音；无则空

【拆分与叙事规则（短剧/漫剧）】
1. 一句对白或多个连续动作不要挤进同一镜；情绪转折、动作切换、视线切换处切开
2. 相邻镜保持空间与主体连续，避免无故跳切
3. 本步不要输出运镜提示词、视频提示词或草图提示词（后续步骤另生成）
4. 画面描述优先「可拍/可画」的具象细节，少用抽象形容词堆砌`,
};

const TEXT_SUBJECT_LOCAL: LocalTextGenFallback = {
  label: TEXT_PROMPT_TOOL_FALLBACKS.text_subject.label,
  systemPrompt:
    "你只输出合法 JSON 对象，键名与字段含义必须与用户说明一致；不要 Markdown、不要代码围栏、不要额外解释。你在为 AI 短剧/漫剧准备可复用资产描述。",
  userPrefix: `你是影视制片与美术指导助理。根据下列「本集剧本正文」提取可复用的角色/场景/道具资产，供后续「准备资产」生图与视频参考。

【输出要求（必须严格遵守）】
仅输出一个 JSON 对象。顶层字段必须为：
- "roles": 数组，每项含 "name" 与 "extractPrompt"
- "scenes": 数组，每项含 "name" 与 "extractPrompt"
- "props": 数组，每项含 "name" 与 "extractPrompt"

【name 规则】
- 短、稳定、适合 @ 引用（如「林晚」「夜市巷口」「红伞」）
- 同一主体全剧统一用同一 name，禁止男主/女主等代称当 name`,
  roleRule:
    "roles[].extractPrompt 只能输出一行中文，两段式，用中文分号「；」分隔：" +
    "第1段=年龄段+性别+身高体型+国籍/气质；" +
    "第2段=发型发色+脸型五官+肤色+妆容+上装+下装+鞋履+标志性配饰。" +
    "只写外貌与服装，禁止剧情动作、禁止表情表演句、禁止场景背景描述。",
  sceneRule:
    "scenes[].extractPrompt 只能输出一行中文，描述「空场景环境」：" +
    "时间段+地点类型+空间结构+主色调与固定光影+关键建筑/陈设。" +
    "禁止出现人物、人脸、剪影人、手部；禁止把可移动道具写成画面主体；" +
    "目标是可直接当作视频场景底板的环境描述。",
  propRule:
    "props[].extractPrompt 只能输出一行中文，描述「单件道具静物」：" +
    "品类+材质+颜色+尺寸感+关键细节。" +
    "禁止手持/人物；禁止完整室内外场景；禁止包装文案与品牌假logo；" +
    "目标是干净空背景上的单件产品参考描述。",
};

/** 与商业站 prompt_config.default.json storyboard_from_image 对齐，并强化短剧/漫剧资产约束 */
const STORYBOARD_FROM_IMAGE_LOCAL: LocalTextGenFallback = {
  label: "图片提取分镜",
  systemPrompt: `你是面向 AI 短剧/漫剧的专业分镜助手。用户会附带一张或多张参考图（概念图、连环分镜、剧照或宫格拼图）。请拆解为可直接写入分镜表与「准备资产」的结构化 JSON。

【输出格式硬约束】
只能输出一个 JSON 对象，禁止 Markdown、代码围栏、解释文字。
顶层键必须包含：
- "styleSummary"：画面风格、色调与叙事钩子
- "replacePlan"：主体如何复用/替换（可简短）
- "shotRows"：镜头数组
- "roles" / "scenes" / "props"：可复用资产数组（可空）

【shotRows 每项字段（键名必须完全一致）】
- "镜头号"、"时长"（建议 2s～5s）、"画面描述"、"景别"、"光影氛围"、"对话"、"音效"
- "运镜提示词"：推拉摇移、景别变化、节奏（可据画面合理推断）
- "视频提示词"：可直接用于 AI 视频生成的完整中文提示词；本镜出场主体用 @正式名 标注，且与 roles/scenes/props 的 name 一致

【roles/scenes/props】
- "name"：短且稳定、适合 @ 引用
- "extractPrompt"：一行中文，供后续生图
  · 角色：外貌服装两段式（年龄体型；发型五官服装），不要剧情动作
  · 场景：只写空环境（时空结构光影），禁止人物
  · 道具：只写单件外形材质，禁止场景与手持

【规则】
1. 单张图：按可叙事动作/景别变化拆成 2～8 镜，勿只输出一行空描述
2. 多张图：默认按附图顺序各对应一镜；宫格/连环分镜按格序展开
3. 画面描述必须忠实参考图可见内容，勿编造图中不存在的角色`,
  userPrefix:
    "请根据附带的参考图完成分镜表与资产提取（面向 AI 短剧/漫剧）。\n若用户说明了画幅或叙事意图，请严格遵守。",
};

/** 与商业站 prompt_config.default.json storyboard_from_video 对齐，并强化短剧/漫剧资产约束 */
const STORYBOARD_FROM_VIDEO_LOCAL: LocalTextGenFallback = {
  label: "视频提取分镜",
  systemPrompt: `你是面向 AI 短剧/漫剧的拉片与爆款复刻助手。用户会提供参考视频（或多张镜头关键帧），以及可选的「替换说明」与替换参考图。请拆解镜头语言与可替换资产，输出可直接用于分镜表与同款再生的 JSON。

【输出格式硬约束】
只能输出一个 JSON 对象，禁止 Markdown、代码围栏、解释文字。
顶层键必须包含：
- "styleSummary"：原片风格、色调、节奏与叙事钩子
- "replacePlan"：如何保留运镜/节奏并替换主体
- "shotRows"：镜头数组
- "roles" / "scenes" / "props"：可替换/可复用资产（可空）

【shotRows 每项字段（键名必须完全一致）】
- "镜头号"、"时长"、"画面描述"、"景别"、"光影氛围"
- "对话"：有对白时用 @角色名: "台词"；@角色名必须与 roles[].name 完全一致
- "音效"
- "运镜提示词"：推拉摇移、景别变化、节奏
- "视频提示词"：完整中文视频提示词；本镜出场的每个主体必须用 @正式名 标出，且与 roles/scenes/props 的 name 完全一致
- "替换指令"：本镜需替换的主体说明；无则空字符串

【roles/scenes/props 的 extractPrompt】
- 角色：只写外貌服装，供三视图设定表生图
- 场景：只写空环境，禁止人物，供场景底板生图
- 道具：只写单件外形，禁止场景与手，供干净静物生图

【规则】
1. 镜头数尽量对齐关键帧；整段视频按明显切镜拆分，建议 4～16 镜
2. 优先还原原片镜头结构与节奏，便于同款再生
3. 无替换说明时仍输出可编辑主体列表，画面描述保持原片主体`,
  userPrefix:
    "请根据附带的参考视频/镜头关键帧完成拉片分析（面向 AI 短剧/漫剧）。\n若用户给出了画幅、清晰度或替换说明，请严格遵守。",
};

const LOCAL_TEXT_GEN_BY_KIND: Record<string, LocalTextGenFallback> = {
  text_image_prompt: TEXT_PROMPT_TOOL_FALLBACKS.text_image_prompt,
  text_video_prompt: TEXT_PROMPT_TOOL_FALLBACKS.text_video_prompt,
  text_script: TEXT_PROMPT_TOOL_FALLBACKS.text_script,
  text_subject: TEXT_SUBJECT_LOCAL,
  storyboard_table: STORYBOARD_TABLE_LOCAL,
  storyboard_from_image: STORYBOARD_FROM_IMAGE_LOCAL,
  storyboard_from_video: STORYBOARD_FROM_VIDEO_LOCAL,
  storyboard_camera: STORYBOARD_CAMERA_PROMPT_FALLBACK,
  storyboard_video: STORYBOARD_VIDEO_PROMPT_FALLBACK,
};

/** 优先 textPromptKind，其次 canvasTool（分镜表工具常两者同传） */
export function resolveLocalTextGenFallback(
  textPromptKind?: string | null,
  canvasTool?: string | null
): LocalTextGenFallback | null {
  const kind = String(textPromptKind || "").trim();
  const tool = String(canvasTool || "").trim();
  if (kind && LOCAL_TEXT_GEN_BY_KIND[kind]) return LOCAL_TEXT_GEN_BY_KIND[kind];
  if (tool && LOCAL_TEXT_GEN_BY_KIND[tool]) return LOCAL_TEXT_GEN_BY_KIND[tool];
  if (kind && kind in TEXT_PROMPT_TOOL_FALLBACKS) {
    return TEXT_PROMPT_TOOL_FALLBACKS[kind as TextPromptToolId];
  }
  return null;
}

/** 对齐商业站 build_text_gen_user_content：prefix + 规则 + 用户输入 */
export function buildLocalTextGenUserContent(
  cfg: LocalTextGenFallback,
  content: string
): string {
  const parts: string[] = [];
  if (cfg.userPrefix?.trim()) parts.push(cfg.userPrefix.trim());
  if (cfg.roleRule?.trim()) parts.push(`## 角色提取规则\n${cfg.roleRule.trim()}`);
  if (cfg.sceneRule?.trim()) parts.push(`## 场景提取规则\n${cfg.sceneRule.trim()}`);
  if (cfg.propRule?.trim()) parts.push(`## 道具提取规则\n${cfg.propRule.trim()}`);
  const body = content.trim();
  if (body) {
    parts.push(parts.length ? `## 用户输入\n${body}` : body);
  }
  return parts.join("\n\n");
}

export function composeLocalTextGeneration(opts: {
  content: string;
  textPromptKind?: string | null;
  canvasTool?: string | null;
}): { system?: string; prompt: string } {
  const cfg = resolveLocalTextGenFallback(opts.textPromptKind, opts.canvasTool);
  if (!cfg) {
    return { prompt: opts.content.trim() };
  }
  return {
    system: cfg.systemPrompt,
    prompt: buildLocalTextGenUserContent(cfg, opts.content),
  };
}
