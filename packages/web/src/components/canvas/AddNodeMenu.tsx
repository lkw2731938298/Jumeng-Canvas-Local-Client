"use client";

import type { ReactNode } from "react";
import {
  Clapperboard,
  FileText,
  Globe,
  Image,
  LayoutGrid,
  Music,
  Video,
} from "lucide-react";
import { NODE_REGISTRY } from "@/types/node-registry";

/** 画布轻雾玻璃：节点周边 chrome / 侧栏 / 弹层共用 */
export const CANVAS_MIST_GLASS_STYLE = {
  background: "rgba(16, 16, 24, 0.72)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
} as const;

/** @deprecated 使用 CANVAS_MIST_GLASS_STYLE；保留别名避免旧引用断裂 */
export const ADD_NODE_MENU_GLASS_STYLE = CANVAS_MIST_GLASS_STYLE;

export interface AddNodeOption {
  type: string;
  label: string;
  icon: ReactNode;
}

/** 菜单图标色 = 对应节点卡片主色（NODE_REGISTRY.color） */
function nodeIcon(type: string, Icon: typeof FileText): ReactNode {
  const color = NODE_REGISTRY[type]?.color || "#a1a1aa";
  return <Icon className="h-4 w-4 shrink-0" style={{ color }} strokeWidth={2} />;
}

/** 画布可添加节点清单（工具栏 / 双击菜单共用；一键出海 / 提示词节点不从菜单暴露） */
export const ADD_NODE_OPTIONS: AddNodeOption[] = [
  { type: "text_input", label: "文本节点", icon: nodeIcon("text_input", FileText) },
  { type: "storyboard_grid", label: "分镜表", icon: nodeIcon("storyboard_grid", LayoutGrid) },
  { type: "image_input", label: "图片节点", icon: nodeIcon("image_input", Image) },
  { type: "video_input", label: "视频节点", icon: nodeIcon("video_input", Video) },
  { type: "audio_input", label: "音频节点", icon: nodeIcon("audio_input", Music) },
  { type: "document_input", label: "文档/链接", icon: nodeIcon("document_input", Globe) },
  { type: "director_stage", label: "导演台", icon: nodeIcon("director_stage", Clapperboard) },
];

interface AddNodeMenuListProps {
  onSelect: (type: string) => void;
  /** 例如连线松手添加时的说明 */
  hint?: string;
  /** 双击菜单用 mousedown 避免在 blur/click 前关闭；工具栏用 click */
  useMouseDown?: boolean;
  /**
   * 限定可选用的节点类型（如素材库拉线落空）。
   * 传入时：可连类型高亮可点，其余置灰不可点。
   */
  enabledTypes?: string[] | null;
}

/** 扁平添加节点列表（无搜索、无分类折叠） */
export function AddNodeMenuList({
  onSelect,
  hint,
  useMouseDown,
  enabledTypes,
}: AddNodeMenuListProps) {
  const filterActive = Array.isArray(enabledTypes) && enabledTypes.length > 0;
  const enabledSet = filterActive ? new Set(enabledTypes) : null;
  // 素材库拉线：只展示可连接类型并高亮；普通菜单展示全部
  const options = filterActive
    ? ADD_NODE_OPTIONS.filter((node) => enabledSet!.has(node.type))
    : ADD_NODE_OPTIONS;

  return (
    <div
      className="flex min-w-[160px] select-none flex-col gap-0.5 rounded-xl px-1.5 py-1.5"
      style={ADD_NODE_MENU_GLASS_STYLE}
    >
      {hint ? <p className="px-2.5 pb-1 pt-0.5 text-[10px] text-white/35">{hint}</p> : null}
      {options.map((node) => (
        <button
          key={node.type}
          type="button"
          onClick={useMouseDown ? undefined : () => onSelect(node.type)}
          onMouseDown={
            useMouseDown
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(node.type);
                }
              : undefined
          }
          className={
            filterActive
              ? "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white transition-colors bg-white/12 ring-1 ring-white/25 hover:bg-white/18"
              : "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          }
        >
          {node.icon}
          {node.label}
        </button>
      ))}
    </div>
  );
}
