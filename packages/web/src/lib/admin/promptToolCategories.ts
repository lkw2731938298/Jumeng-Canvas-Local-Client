/** Canvas tool prompt template tabs for admin management */

export const TEXT_PROMPT_TOOL_IDS = [
  "text_image_prompt",
  "text_video_prompt",
  "text_script",
  "text_subject",
] as const;

export type TextPromptToolId = (typeof TEXT_PROMPT_TOOL_IDS)[number];

export const DEFAULT_TEXT_PROMPT_KIND: TextPromptToolId = "text_image_prompt";

export const TEXT_PROMPT_TOOL_FALLBACKS: Record<
  TextPromptToolId,
  { label: string; systemPrompt: string }
> = {
  text_image_prompt: {
    label: "图片提示词",
    systemPrompt:
      "你是开源画布中的图片提示词助手。根据用户的描述与参考素材，输出可直接用于 AI 绘画的精炼中文提示词。只输出结果正文，不要解释。",
  },
  text_video_prompt: {
    label: "视频提示词",
    systemPrompt:
      "你是开源画布中的视频提示词助手。根据用户的描述与参考素材，输出可直接用于 AI 视频生成的精炼中文提示词，包含画面、运镜与节奏感。只输出结果正文，不要解释。",
  },
  text_script: {
    label: "生成剧本",
    systemPrompt:
      "你是专业小说剧本分镜脚本生成助手。根据用户提供的剧本或创意，逐句拆分并生成可直接用于图片与视频生成的分镜结构化结果。只输出 JSON 对象，不要 Markdown 或解释。",
  },
  text_subject: {
    label: "主体提示词",
    systemPrompt:
      "你只输出合法 JSON 对象，键名与字段含义必须与用户说明一致；不要 Markdown、不要代码围栏、不要额外解释。",
  },
};

export const STORYBOARD_TABLE_PROMPT_FALLBACK = {
  label: "分镜表提示词",
  systemPrompt:
    "你是专业影视分镜表生成助手。根据用户提供的剧本正文，逐句/逐动作拆分为分镜表结构化结果。只输出 JSON 对象，顶层仅含 shotRows 数组；每行含镜头号、时长、画面描述、景别、光影氛围、对话、音效。不要输出运镜提示词、视频提示词或草图提示词；不要 Markdown 或解释。",
};

export const STORYBOARD_CAMERA_PROMPT_FALLBACK = {
  label: "分镜运镜提示词",
  systemPrompt:
    "你是影视运镜提示词助手。根据用户提供的单镜头分镜信息，输出精炼的中文运镜提示词（推拉摇移、景别变化、节奏）。只输出提示词正文，不要 Markdown 或解释。",
};

export const STORYBOARD_VIDEO_PROMPT_FALLBACK = {
  label: "分镜视频提示词",
  systemPrompt:
    "你是 AI 视频生成提示词助手。根据用户提供的单镜头分镜信息与运镜描述，输出完整的中文视频提示词，包含画面、运镜与节奏感。只输出提示词正文，不要 Markdown 或解释。",
};

export const PROMPT_TOOL_CATEGORIES = [
  {
    id: "multi_angle",
    label: "多角度",
    description: "LibTV 多角度面板的方位、俯仰、景别与一致性约束文案",
    simpleSuffix: false,
  },
  {
    id: "panorama",
    label: "全景",
    description: "图片节点顶部菜单「全景」：追加 prompt 并以全能图片 Pro 图生图生成",
    simpleSuffix: true,
  },
  {
    id: "lighting",
    label: "打光",
    description: "LibTV 打光面板的方位、亮度、颜色与轮廓光文案",
    simpleSuffix: false,
  },
  {
    id: "grid_9",
    label: "九宫格",
    description:
      "图片节点顶部「九宫格」创作工具弹层：25宫格/四宫格/推演/设定图等各功能的生成提示词（可逐项修改）",
    simpleSuffix: false,
    creativeTools: true,
  },
  {
    id: "storyboard",
    label: "故事板",
    description:
      "创作工具「故事板」：用户剧情 + 参考图 → 一张含多镜头与说明文字的合成图（固定算力 + 后台图片模型）",
    simpleSuffix: true,
  },
  {
    id: "blocking_storyboard",
    label: "调度故事板",
    description:
      "创作工具「调度故事板」：用户剧情 + 参考图 → 一张含多镜头参数说明与俯视调度的合成图（固定算力 + 后台图片模型）",
    simpleSuffix: true,
  },
  {
    id: "grid_split",
    label: "宫格切分",
    description: "图片节点顶部菜单「宫格切分」：本地均匀切成多块图片节点并自动成组（仍扣固定算力）",
    simpleSuffix: true,
  },
  {
    id: "outpaint",
    label: "扩图",
    description: "图片节点编辑菜单「扩图」：按外扩区域图生图扩展画面（固定算力 + 后台模型）",
    simpleSuffix: true,
  },
  {
    id: "cutout",
    label: "抠图",
    description:
      "图片节点编辑菜单「抠图」：本地去背景；固定算力按后台模型名结算，提示词写入结果节点",
    simpleSuffix: true,
  },
  {
    id: "hd_upscale",
    label: "高清",
    description: "图片节点编辑菜单「高清」：超分放大提示词（固定算力 + 后台模型）",
    simpleSuffix: true,
  },
  {
    id: "portrait_adjust",
    label: "人像调节",
    description:
      "图片顶栏「人像质感调节 → 人像调节」：用户说明 + 后台追加提示词（固定算力 + 后台图片模型）",
    simpleSuffix: true,
  },
  {
    id: "emotion_adjust",
    label: "情绪调节",
    description:
      "图片顶栏「人像质感调节 → 情绪调节」：用户说明 + 后台追加提示词（固定算力 + 后台图片模型）",
    simpleSuffix: true,
  },
  {
    id: "hd_upscale_video",
    label: "视频高清",
    description: "视频节点顶栏「高清」：参考视频清晰度增强提示词（固定算力 + 后台视频模型）",
    simpleSuffix: true,
  },
  {
    id: "video_subject_remove",
    label: "主体消除",
    description:
      "视频画面编辑「主体消除」：本节点提示词 + 后台追加 → 源视频提交上游（固定算力 + 后台视频模型；源片须 ≤12 秒）",
    simpleSuffix: true,
  },
  {
    id: "video_smart_matting",
    label: "智能抠像",
    description:
      "视频画面编辑「智能抠像」：本地 rembg（固定算力 + 后台视频模型名结算；源片须 ≤12 秒）",
    simpleSuffix: true,
  },
  {
    id: "video_subject_edit",
    label: "主体修改",
    description: "视频画面编辑「主体修改」：追加提示词（固定算力 + 后台视频模型；源片须 ≤12 秒）",
    simpleSuffix: true,
  },
  {
    id: "video_subject_replace",
    label: "主体替换",
    description: "视频画面编辑「主体替换」：追加提示词（固定算力 + 后台视频模型；源片须 ≤12 秒）",
    simpleSuffix: true,
  },
  {
    id: "text_image_prompt",
    label: "图片提示词",
    description: "文本节点顶部菜单「图片提示词」：控制生成 AI 绘画用提示词",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "text_video_prompt",
    label: "视频提示词",
    description: "文本节点顶部菜单「视频提示词」：控制生成 AI 视频用提示词",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "text_script",
    label: "生成剧本",
    description: "文本节点顶部菜单「生成剧本」：参考主平台分镜规则生成分镜/剧本结构化文本",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "text_subject",
    label: "主体提示词",
    description:
      "分镜表「解析剧本」第二步 / 文本节点「主体提示词」：提取角色/场景/道具（模型 doubao_pro）",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "storyboard_table",
    label: "分镜表",
    description:
      "分镜表「解析剧本」第一步：生成分镜 shotRows（模型 doubao_pro，算力见后台「通用算力价格」）",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "storyboard_from_image",
    label: "图片提取分镜",
    description:
      "分镜表「提取分镜」连接图片时：多模态拆分镜 + 主体（模型 doubao_pro）",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "storyboard_from_video",
    label: "视频提取分镜",
    description:
      "分镜表 / 视频节点「解析」：切镜关键帧 + 拉片 JSON（模型 doubao_pro）",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "storyboard_camera",
    label: "分镜运镜",
    description: "分镜表「生成运镜」：按镜头生成运镜提示词（模型 doubao_pro）",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "storyboard_video",
    label: "分镜视频词",
    description: "分镜表「生成视频词」：按镜头生成视频提示词（模型 doubao_pro）",
    simpleSuffix: false,
    textGen: true,
  },
  {
    id: "storyboard_sketch",
    label: "分镜草图",
    description:
      "分镜表「生成草图」：文生图风格锚点文案（模型 即梦图片 doubao_image）；不出现在图片节点顶栏",
    simpleSuffix: false,
  },
  {
    id: "visual_style",
    label: "视觉风格",
    description: "图片/视频节点生成选项中的视觉风格：名称、16:9 展示图与组合提示词",
    simpleSuffix: false,
    visualStyles: true,
  },
  {
    id: "text_subject_role",
    label: "角色提示词",
    description: "分镜表「解析剧本」：角色 extractPrompt 提取规则（合并进主体提示词）",
    simpleSuffix: false,
    textGen: true,
    subjectRule: "role",
  },
] as const;

export type PromptToolId = (typeof PROMPT_TOOL_CATEGORIES)[number]["id"];

export const PROMPT_TEXT_GEN_TOOLS = PROMPT_TOOL_CATEGORIES.filter(
  (c) => "textGen" in c && c.textGen
).map((c) => c.id) as PromptToolId[];

export const PROMPT_SUFFIX_TOOLS = PROMPT_TOOL_CATEGORIES.filter((c) => c.simpleSuffix).map(
  (c) => c.id
);

export const PROMPT_SUFFIX_FALLBACKS: Record<
  (typeof PROMPT_SUFFIX_TOOLS)[number],
  { label: string; content: string }
> = {
  panorama: { label: "全景", content: "全景视图，360度环境展示" },
  storyboard: {
    label: "故事板",
    content:
      "生成一张完整的电影故事板合成长图（单图输出，图文一体，分辨率约 3840×2160 横版）：顶部深色信息栏含项目名称/片段编号/目标时长10-15秒/画幅/类型/风格标签/限制规则（无字幕无水印、角色道具场景一致、镜头连续）；中部横向排列 4-8 个连续分镜镜头（镜头01…），每格含画面与时间轴标注；下方含角色与道具索引缩略图、环境与场景设计、可选场景俯视平面图；右下为文字脚本/分镜表（镜头号、时间轴、画面动作、人物对白、音效）。图中所有可见文字（标题、信息栏、镜头编号、分镜表、角色道具索引、对白与音效说明等）必须使用简体中文，禁止英文界面文案。角色造型与参考图一致，画面电影感、高对比、无 UI 控件、无水印。",
  },
  blocking_storyboard: {
    label: "调度故事板",
    content:
      "生成一张完整的「调度故事板」合成长图（单图输出，图文一体，分辨率约 3840×2160）：左上标题「调度故事板」；顶部角色与道具索引（角色/关键道具/关键场景）；左侧简短脚本区（总时长约15秒、剧情摘要、生成约束）；中部 4-6 个镜头格子，每格上方为画面、下方为该镜参数说明（景别、运镜、动作、表情、音效、转场）；右下场景调度区为俯视平面图，标注角色移动路径与机位（机位1/2/3…）及调度图例。图中所有可见文字（标题、角色道具索引、脚本区、镜头编号、景别/运镜/动作/表情/音效/转场说明、俯视调度与机位标注、图例等）必须使用简体中文，禁止英文界面文案。角色与场景严格参考输入图，保持一致性，画面干净无字幕无水印。",
  },
  grid_split: { label: "宫格切分", content: "宫格切分布局，模块化分镜" },
  outpaint: {
    label: "扩图",
    content:
      "在保持原图主体、构图逻辑与画风一致的前提下向外扩展画面，自然补全边缘场景与光影，过渡平滑，禁止扭曲或替换原图核心主体",
  },
  cutout: {
    label: "抠图",
    content: "精确抠出主体，去除背景，边缘干净，保留头发与半透明细节，输出透明底 PNG 风格前景",
  },
  hd_upscale: {
    label: "高清",
    content:
      "高清放大，提升分辨率与细节清晰度，保持原图主体、构图、色彩与画风一致，边缘锐利自然，禁止改变人物身份或场景结构",
  },
  portrait_adjust: {
    label: "人像调节",
    content:
      "按用户说明调节人像质感与外观（肤质、妆容、发型、年龄感等），保持人物身份可辨、构图与光影自然，禁止大幅改动场景或替换主体身份",
  },
  emotion_adjust: {
    label: "情绪调节",
    content:
      "按用户说明调节人物面部情绪与表情，保持人物身份、五官结构与画面构图一致，表情自然可信，禁止改变身份或大幅改景",
  },
  hd_upscale_video: {
    label: "视频高清",
    content:
      "以参考视频为基础提升清晰度与细节，保持原视频主体、构图、运动节奏与画风一致，画面锐利自然，禁止改变人物身份或场景结构",
  },
  video_subject_remove: {
    label: "主体消除",
    content: "消除参考视频中的主体，自然补全背景，保持镜头运动与场景一致",
  },
  video_smart_matting: {
    label: "智能抠像",
    content: "精确抠出参考视频主体，去除背景，边缘干净，保留发丝与半透明细节",
  },
  video_subject_edit: {
    label: "主体修改",
    content:
      "按用户说明修改参考视频中的主体外观，保持镜头运动、场景与光影一致，输出可用成片",
  },
  video_subject_replace: {
    label: "主体替换",
    content:
      "将参考视频中的主体替换为参考图主体，保持镜头运动与场景一致，边缘自然融合",
  },
};

/** 九宫格创作工具：顶栏菜单名 + 默认追加（兼容旧后缀路径） */
export const CREATIVE_TOOLS_FALLBACK = {
  label: "九宫格",
  appendText: "九宫格构图，九张关联分镜，多机位视角一致、角色与场景设定统一",
};
