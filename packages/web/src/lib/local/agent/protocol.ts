/**
 * 本地 Agent 协议：画布快照 → 文本、系统提示词、从模型回复中解析 ops。
 * 模型用 ```ops JSON 代码块下发画布操作，操作名与云端 CanvasOp 对齐，便于复用投影辅助函数。
 */

import type { CanvasOp } from "@/lib/api/agentSessions";
import { buildCanvasSnapshot } from "@/lib/canvas/buildCanvasSnapshot";
import { LOCAL_CANVAS_TOOL_DEFS } from "@/lib/local/canvasToolDefs";
import type { LocalModel } from "@/lib/local/types";
import { useCanvasStore } from "@/stores/canvasStore";

/** 快照文本里最多列出的节点数（避免撑爆上下文） */
const MAX_SNAPSHOT_NODES = 200;
/** 非焦点节点正文摘要长度 */
const BRIEF_TEXT_MAX = 120;
/** 焦点 / @ 引用节点正文长度 */
const FOCUS_TEXT_MAX = 1500;

/** 本地 Agent 支持的全部操作名 */
export const LOCAL_AGENT_OPS = [
  "add_text_node",
  "add_image_node",
  "add_video_node",
  "add_audio_node",
  "add_storyboard_node",
  "update_node_params",
  "connect_nodes",
  "disconnect_nodes",
  "layout_hint",
  "delete_node",
  "read_node",
  "generate_node",
  "run_canvas_tool",
] as const;

/** 不在 LOCAL_CANVAS_TOOL_DEFS 但 runAgentCanvasTool 支持的工具（补充给模型） */
const EXTRA_TOOLS: Array<{ toolId: string; label: string; group: string }> = [
  { toolId: "grid_split", label: "宫格切分（把宫格图拆成单图）", group: "图片工具" },
  { toolId: "visual_style", label: "视觉风格（params.styleId）", group: "图片工具" },
  { toolId: "panorama_720", label: "720° 全景", group: "图片工具" },
  { toolId: "storyboard_batch_videos", label: "分镜表批量出视频", group: "文本 / 分镜" },
];

/** 部分工具的参数提示 */
const TOOL_PARAM_HINTS: Record<string, string> = {
  multi_angle: 'params: {"azimuth":-180~180,"elevation":-90~90,"shot":"close|medium|wide","extraPrompt":""}',
  lighting: 'params: {"direction":"left|right|top|front|back","brightness":0~100,"color":"#ffcc88","extraPrompt":""}',
  outpaint: 'params: {"aspectRatio":"16:9|9:16|1:1|original","resolution":"2k","prompt":""}',
  hd_upscale: 'params: {"hdModel":"general"}',
  portrait_adjust: 'params: {"prompt":"调整要求"}',
  emotion_adjust: 'params: {"prompt":"目标情绪"}',
  storyboard: 'params: {"prompt":"故事板要求（可选）"}',
  blocking_storyboard: 'params: {"prompt":"调度要求（可选）"}',
  video_subject_edit: 'params: {"prompt":"修改描述"}',
  video_subject_replace: 'params: {"prompt":"替换为什么"}',
  storyboard_table: "目标为剧本文本节点；可带 scriptFromNodeId 指定剧本来源",
};

function brief(raw: unknown, max: number): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * 画布快照转成紧凑文本（每次调用都从 store 现取，禁止缓存）。
 * focusIds：@ 引用 / 选中节点，给出较长正文。
 */
export function buildCanvasSnapshotText(focusIds: string[] = []): string {
  const snap = buildCanvasSnapshot({ priorityNodeIds: focusIds });
  const focus = new Set(focusIds);
  const { selectedNodeId } = useCanvasStore.getState();
  if (selectedNodeId) focus.add(selectedNodeId);
  const live = snap.liveParams || {};
  const lines: string[] = [];
  lines.push(
    `节点 ${snap.nodeCount ?? snap.nodes.length} 个，连线 ${snap.edgeCount ?? snap.edges.length} 条` +
      (selectedNodeId ? `；当前选中 ${selectedNodeId}` : "")
  );
  if (snap.nodes.length === 0) {
    lines.push("（画布为空）");
    return lines.join("\n");
  }
  lines.push("节点列表（id | 类型 | 名称 | 属性 | 正文摘要）：");
  const listed = snap.nodes.slice(0, MAX_SNAPSHOT_NODES);
  for (const n of listed) {
    const isFocus = focus.has(n.id);
    const attrs: string[] = [];
    if (n.x != null && n.y != null) attrs.push(`pos=${n.x},${n.y}`);
    if (n.model) attrs.push(`model=${n.model}`);
    attrs.push(n.hasMedia ? "已有素材" : "无素材");
    if (n.status) attrs.push(`状态=${n.status}`);
    if (n.lastError) attrs.push(`错误=${n.lastError}`);
    if (n.shotCount) attrs.push(`分镜${n.shotCount}行`);
    if (n.generationOptions) {
      attrs.push(
        `选项=${Object.entries(n.generationOptions)
          .map(([k, v]) => `${k}:${v}`)
          .join(",")}`
      );
    }
    const lp = live[n.id];
    const text =
      lp?.prompt ||
      lp?.content ||
      (lp?.htmlContent ? `[HTML] ${lp.htmlContent}` : "") ||
      (lp?.linkUrl ? `[链接] ${lp.linkUrl}` : "") ||
      "";
    const kindNote = lp?.resourceKind ? ` kind=${lp.resourceKind}` : "";
    const body = brief(text, isFocus ? FOCUS_TEXT_MAX : BRIEF_TEXT_MAX);
    lines.push(
      `- ${isFocus ? "★" : ""}${n.id} | ${n.type} | ${n.label || "(未命名)"} | ${attrs.join(" ")}${kindNote}${
        body ? ` | ${body}` : ""
      }`
    );
  }
  if (snap.nodes.length > listed.length) {
    lines.push(`…另有 ${snap.nodes.length - listed.length} 个节点未列出`);
  }
  if (snap.edges.length) {
    lines.push("连线（源 -> 目标）：");
    for (const e of snap.edges.slice(0, 300)) {
      lines.push(`- ${e.source} -> ${e.target}`);
    }
  }
  return lines.join("\n");
}

/** 系统提示词：角色、可用模型、工具目录与 ops 协议 */
export function buildLocalAgentSystemPrompt(models: LocalModel[]): string {
  const byCat = (cat: string) =>
    models
      .filter((m) => m.enabled !== false && m.category === cat)
      .map((m) => `${m.name}${m.displayName && m.displayName !== m.name ? `（${m.displayName}）` : ""}`);
  const img = byCat("image");
  const vid = byCat("video");
  const aud = byCat("audio");
  const tools = [...LOCAL_CANVAS_TOOL_DEFS, ...EXTRA_TOOLS]
    .map((t) => {
      const hint = TOOL_PARAM_HINTS[t.toolId];
      return `- ${t.toolId}：${t.label}（${t.group}）${hint ? `；${hint}` : ""}`;
    })
    .join("\n");

  return `你是「聚梦画布」本地版的 AI 助手，可以读取并操控用户当前画布：添加节点、填写提示词、连线、触发生成、调用画布工具。
每轮用户消息都会附带【当前画布】快照（★ 为用户 @ 引用或选中的节点）。用户消息中形如 [节点:名称|nodeId=xxx|type=yyy] 的内容是对画布节点的引用。

## 回复格式
先用简洁中文说明你要做什么/结论；需要操作画布时，在回复末尾附一个 \`\`\`ops 代码块，内容是 JSON 数组，每项一个操作。不需要操作就不要输出代码块。

## 操作列表
- add_text_node：{"op":"add_text_node","tempId":"t1","label":"剧本","content":"正文","x":0,"y":0}
- add_image_node：{"op":"add_image_node","tempId":"img1","label":"主视觉","prompt":"画面描述","params":{"model":"模型名","generationOptions":{"aspectRatio":"16:9"}}}
- add_video_node：{"op":"add_video_node","tempId":"v1","label":"镜头1","prompt":"视频描述","params":{"model":"模型名","generationOptions":{"duration":"5"}}}
- add_audio_node：{"op":"add_audio_node","tempId":"a1","label":"配乐","prompt":"音频描述"}
- add_storyboard_node：{"op":"add_storyboard_node","tempId":"sb1","label":"分镜表"}
- update_node_params：{"op":"update_node_params","nodeId":"节点id","params":{"prompt":"新提示词","content":"文本节点正文","label":"新名称","model":"模型名","generationOptions":{}}}
- connect_nodes：{"op":"connect_nodes","source":"源id","target":"目标id"}（源作为目标的参考输入）
- disconnect_nodes：{"op":"disconnect_nodes","source":"源id","target":"目标id"}
- layout_hint：{"op":"layout_hint","nodeId":"id","x":100,"y":200}（移动节点）
- delete_node：{"op":"delete_node","nodeId":"id"}（仅在用户明确要求删除时使用）
- read_node：{"op":"read_node","nodeId":"id"}（读取节点完整提示词/正文；结果会在下一轮返回给你）
- generate_node：{"op":"generate_node","nodeId":"id"}（按节点当前提示词与模型生成，会调用付费模型，仅在用户要求生成/出图/出视频时使用）
- run_canvas_tool：{"op":"run_canvas_tool","tool":"工具id","nodeId":"目标节点id","params":{}}

## 规则
1. 引用已有节点必须用快照里的真实 id；本轮新建的节点用 tempId 引用（同一批 ops 内可直接在 connect_nodes / generate_node 中使用 tempId）。
2. 新建节点可省略 x/y，系统会自动避让摆放。
3. 提示词写具体的画面描述（主体、场景、光线、构图、风格），默认用中文。
4. 图片/视频节点的 params.model 只能从下方可用模型中选；不写则自动使用第一个可用模型。
5. 工具只作用于已有素材的节点（图片工具要求图片节点已出图，视频工具要求视频节点已有视频）。
6. 执行结果会以【画布操作执行结果】返回；若失败请根据原因修正或向用户说明，不要重复同样的错误操作。
7. 不要编造云端账号、算力或不存在的功能。

## 可用模型
- 图片：${img.join("、") || "（未配置，无法生图，请提醒用户到「设置」添加图片模型）"}
- 视频：${vid.join("、") || "（未配置）"}
- 音频：${aud.join("、") || "（未配置）"}

## 画布工具（run_canvas_tool 的 tool 取值）
${tools}`;
}

/** Tool Calling 主路径用的短系统提示（工具 schema 另传，不在此罗列 JSON ops） */
export function buildLocalAgentToolsSystemPrompt(models: LocalModel[]): string {
  const byCat = (cat: string) =>
    models
      .filter((m) => m.enabled !== false && m.category === cat)
      .map((m) => `${m.name}${m.displayName && m.displayName !== m.name ? `（${m.displayName}）` : ""}`);
  const img = byCat("image");
  const vid = byCat("video");
  const aud = byCat("audio");
  const toolLines = [...LOCAL_CANVAS_TOOL_DEFS, ...EXTRA_TOOLS]
    .map((t) => {
      const hint = TOOL_PARAM_HINTS[t.toolId];
      return `- ${t.toolId}：${t.label}${hint ? `；${hint}` : ""}`;
    })
    .join("\n");

  return `你是「聚梦画布」本地版 AI 助手。通过函数工具读写与操控当前画布（节点、连线、生成、创作工具、文档链接、看图/生图、技能参考、静态网页）。
每轮用户消息会附带【当前画布】快照；★ 为 @ 引用或选中节点。[节点:名称|nodeId=…] 是节点引用。

## 规则
1. 需要改画布时调用工具，不要编造已执行成功；不要输出 \`\`\`ops 代码块（除非工具不可用的兼容场景）。
2. 引用已有节点用快照真实 id；本轮新建用 tempId，后续工具可引用同一 tempId。
3. 提示词具体、默认中文；图片/视频 model 只能从下方列表选，不写则系统填默认。
4. generate / 创作工具 / media_generate_image / media_generate_video 会走用户配置的 API，仅在用户要求时调用。
5. delete 仅在用户明确要求删除时使用。
6. 文档网址用 canvas_set_document_link；外站可能无法 iframe，用户仍可新标签打开。
7. 用户 @ / 上传的参考素材会全部进入本对话（无数量上限），由你自行判断取用。写文本、改提示词、做网页、生图、生视频时都要结合这些素材，勿无视。看图用 media_inspect_images；生图用 media_generate_image；生视频用 media_generate_video（有 @ 图时优先这两个工具）；查模型用 media_list_models。按任务需要选择 referenceNodeIds / imageNodeIds；未传时系统才会自动并入本轮 @ 媒体。
8. 启用技能时按技能工作流执行；需要 references 时用 skill_read_reference（须传 path，或先不传 path 列出可用文件）。
9. 做网页用 web_create_page（静态 HTML）。要用画布上的图时：imageNodeIds 填节点 id，HTML 里 img src 写 \`canvas-node:<该id>\`（或 \`canvas-asset:0\` 对应列表第 1 张）；系统会内联素材，预览才能显示。不要编造外链图、不要承诺部署或爬站仿站。回复用简洁 Markdown。
10. 不要编造云端账号或不存在的功能。

## 可用模型
- 图片：${img.join("、") || "（未配置）"}
- 视频：${vid.join("、") || "（未配置）"}
- 音频：${aud.join("、") || "（未配置）"}

## canvas_run_tool 的 tool 取值
${toolLines}`;
}

/** 解析结果：展示文本 + ops + 解析错误 */
export type ParsedAgentReply = {
  text: string;
  ops: CanvasOp[];
  parseError?: string;
};

const OPS_BLOCK_RE = /```(?:ops|json)?\s*\n?([\s\S]*?)```/gi;

/** 从模型回复中提取 ```ops 代码块；展示文本去掉代码块 */
export function parseAgentReply(raw: string): ParsedAgentReply {
  const ops: CanvasOp[] = [];
  let parseError: string | undefined;
  let text = raw;
  for (const m of raw.matchAll(OPS_BLOCK_RE)) {
    const body = (m[1] || "").trim();
    if (!body.startsWith("[") && !body.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { ops?: unknown }).ops)
          ? ((parsed as { ops: unknown[] }).ops)
          : [parsed];
      for (const item of list) {
        if (item && typeof item === "object" && typeof (item as CanvasOp).op === "string") {
          ops.push(item as CanvasOp);
        }
      }
      text = text.replace(m[0], "");
    } catch (err) {
      parseError = `ops 代码块 JSON 解析失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { text: text.trim(), ops, parseError };
}
