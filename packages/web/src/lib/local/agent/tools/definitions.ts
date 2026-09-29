/**
 * 本地 Agent：OpenAI tools 定义（画布操控）。
 * 执行仍走 executor（CanvasOp），此处只描述给模型看的 schema。
 */

import type { LocalChatTool } from "@/lib/local/generate";
import { LOCAL_CANVAS_TOOL_DEFS } from "@/lib/local/canvasToolDefs";

const nodeRefProps = {
  nodeId: { type: "string", description: "画布节点 id；本轮新建可用 tempId" },
  nodeName: { type: "string", description: "节点名称（与 id 校验；仅名称时须唯一）" },
  tempId: { type: "string", description: "本轮临时 id，供后续工具引用" },
};

function obj(
  description: string,
  properties: Record<string, unknown>,
  required?: string[]
): LocalChatTool["function"] {
  return {
    name: "",
    description,
    parameters: {
      type: "object",
      properties,
      ...(required?.length ? { required } : {}),
      additionalProperties: true,
    },
  };
}

function tool(name: string, description: string, properties: Record<string, unknown>, required?: string[]): LocalChatTool {
  const fn = obj(description, properties, required);
  fn.name = name;
  return { type: "function", function: fn };
}

const canvasToolEnum = [
  ...LOCAL_CANVAS_TOOL_DEFS.map((d) => d.toolId),
  "grid_split",
  "visual_style",
  "panorama_720",
  "storyboard_batch_videos",
];

/** 发给模型的全部画布工具 */
export function buildCanvasAgentTools(): LocalChatTool[] {
  return [
    tool("canvas_add_text_node", "新建文本节点", {
      ...nodeRefProps,
      label: { type: "string" },
      content: { type: "string", description: "文本正文" },
      x: { type: "number" },
      y: { type: "number" },
    }),
    tool("canvas_add_image_node", "新建图片节点", {
      ...nodeRefProps,
      label: { type: "string" },
      prompt: { type: "string", description: "生图提示词" },
      model: { type: "string", description: "本地模型 name" },
      generationOptions: { type: "object" },
      x: { type: "number" },
      y: { type: "number" },
    }),
    tool("canvas_add_video_node", "新建视频节点", {
      ...nodeRefProps,
      label: { type: "string" },
      prompt: { type: "string" },
      model: { type: "string" },
      generationOptions: { type: "object" },
      x: { type: "number" },
      y: { type: "number" },
    }),
    tool("canvas_add_audio_node", "新建音频节点", {
      ...nodeRefProps,
      label: { type: "string" },
      prompt: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
    }),
    tool("canvas_add_storyboard_node", "新建分镜表节点", {
      ...nodeRefProps,
      label: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
    }),
    tool(
      "canvas_update_node",
      "更新节点参数（提示词、正文、模型、名称、generationOptions 等）",
      {
        ...nodeRefProps,
        prompt: { type: "string" },
        content: { type: "string" },
        label: { type: "string" },
        model: { type: "string" },
        params: { type: "object", description: "其它参数键值" },
      },
      ["nodeId"]
    ),
    tool("canvas_connect", "连接两节点（源作为目标参考）", {
      source: { type: "string" },
      sourceName: { type: "string" },
      target: { type: "string" },
      targetName: { type: "string" },
    }, ["source", "target"]),
    tool("canvas_disconnect", "断开两节点连线", {
      source: { type: "string" },
      target: { type: "string" },
    }, ["source", "target"]),
    tool("canvas_move_node", "移动节点位置", {
      ...nodeRefProps,
      x: { type: "number" },
      y: { type: "number" },
    }, ["nodeId", "x", "y"]),
    tool("canvas_delete_node", "删除节点（仅当用户明确要求删除时调用）", {
      ...nodeRefProps,
    }, ["nodeId"]),
    tool("canvas_read_node", "读取节点完整提示词或文本正文", {
      ...nodeRefProps,
    }, ["nodeId"]),
    tool("canvas_generate_node", "对节点触发生成（走用户配置的图/视频等 API，会耗额度）", {
      ...nodeRefProps,
    }, ["nodeId"]),
    tool("canvas_run_tool", "对节点执行画布创作工具（多角度、打光、高清等）", {
      ...nodeRefProps,
      tool: { type: "string", enum: canvasToolEnum, description: "工具 id" },
      scriptFromNodeId: { type: "string", description: "剧本来源节点（部分分镜工具）" },
      params: { type: "object" },
    }, ["nodeId", "tool"]),
    tool(
      "canvas_set_document_link",
      "将文档/链接节点设为网址模式并写入 linkUrl（可再请用户点预览）",
      {
        ...nodeRefProps,
        linkUrl: { type: "string", description: "http(s) 网址" },
        label: { type: "string" },
        createIfMissing: {
          type: "boolean",
          description: "若找不到节点则新建 document_input",
        },
      },
      ["linkUrl"]
    ),
    tool(
      "media_inspect_images",
      "用当前对话文本模型看图（vision）：读取画布图片节点素材并回答问题。审图、写生图提示词前应先调用。用户 @ 了图片时可一次传入全部相关 nodeIds（无上限）。",
      {
        nodeId: { type: "string", description: "单个节点 id" },
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description: "多个节点 id（可全部传入，无上限）",
        },
        nodeName: { type: "string" },
        question: { type: "string", description: "要模型回答的问题；默认做创作向描述" },
        prompt: { type: "string", description: "同 question" },
      }
    ),
    tool(
      "media_list_models",
      "列出本机已配置且启用的图片/视频模型（对齐 jumeng-media list_models）。生图/生视频前可先查可用 name。",
      {
        category: {
          type: "string",
          description: "image | video | all（默认 all）",
        },
      }
    ),
    tool(
      "media_generate_image",
      "调用用户配置的图片模型生图（可带多张参考图）。用户 @ 的参考由你按任务选用传入 referenceNodeIds；系统也会把本轮 @ 媒体并入。结果写入目标图片节点。",
      {
        prompt: { type: "string", description: "生图提示词" },
        model: { type: "string", description: "图片模型 name（须在可用列表中）" },
        referenceNodeId: { type: "string" },
        referenceNodeIds: {
          type: "array",
          items: { type: "string" },
          description: "参考图节点 id（按需多选；用户 @ 的可全部列入）",
        },
        referenceNodeNames: { type: "array", items: { type: "string" } },
        targetNodeId: { type: "string", description: "写入结果的图片节点；可空则新建" },
        nodeId: { type: "string", description: "同 targetNodeId" },
        label: { type: "string" },
        aspectRatio: { type: "string", description: "如 1:1、3:4、9:16" },
        resolution: { type: "string", description: "如 1K、2K" },
        createIfMissing: { type: "boolean" },
      },
      ["prompt"]
    ),
    tool(
      "media_generate_video",
      "调用用户配置的视频模型生成视频（可带多张参考图）。用户 @ 的参考由你按任务选用；系统也会把本轮 @ 媒体并入。结果写入目标视频节点。",
      {
        prompt: { type: "string", description: "视频提示词" },
        model: { type: "string", description: "视频模型 name" },
        referenceNodeId: { type: "string", description: "单张参考图节点（多张请用 referenceNodeIds）" },
        referenceNodeIds: {
          type: "array",
          items: { type: "string" },
          description: "参考图节点 id（按需多选；用户 @ 的可全部列入）",
        },
        targetNodeId: { type: "string" },
        nodeId: { type: "string" },
        label: { type: "string" },
        durationSec: { type: "number", description: "时长秒，常见 5/10" },
        resolution: { type: "string", description: "如 768p、1080p" },
        ratio: { type: "string", description: "画幅如 16:9、9:16" },
        createIfMissing: { type: "boolean" },
      },
      ["prompt"]
    ),
    tool(
      "skill_read_reference",
      "读取已启用技能包内 references/ 文档（如 afterimage-editorial-prompt.md）",
      {
        skillSlug: { type: "string", description: "技能 slug；默认同面板当前技能" },
        path: { type: "string", description: "reference 文件名" },
        file: { type: "string" },
      }
    ),
    tool(
      "web_create_page",
      "生成单页静态 HTML 并写入文档节点（resourceKind=html），默认打开画布内预览。嵌入画布图片时：img 的 src 写 canvas-node:<节点id>（或 canvas-asset:0 对应 imageNodeIds[0]），并在 imageNodeIds 列出这些节点；系统会把本轮 @ 媒体并入并内联为 data URL。不要用不存在的外链图。仅静态页，不做部署/爬站。",
      {
        html: { type: "string", description: "完整 HTML 或 body 片段；图用 canvas-node:<id> 或 canvas-asset:N" },
        content: { type: "string", description: "同 html" },
        title: { type: "string" },
        label: { type: "string" },
        imageNodeIds: {
          type: "array",
          items: { type: "string" },
          description: "要嵌入网页的画布图片节点 id（可多选，无上限）",
        },
        imageNodeId: { type: "string" },
        referenceNodeIds: {
          type: "array",
          items: { type: "string" },
          description: "同 imageNodeIds",
        },
        ...nodeRefProps,
        createIfMissing: { type: "boolean" },
        openPreview: { type: "boolean" },
      }
    ),
    tool("web_open_preview", "打开文档节点的网址或 HTML 内嵌预览", {
      ...nodeRefProps,
    }, ["nodeId"]),
  ];
}
