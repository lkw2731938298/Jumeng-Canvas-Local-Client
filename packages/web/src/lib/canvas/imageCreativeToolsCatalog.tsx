import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Clapperboard,
  Clock3,
  Grid2x2,
  Grid3x3,
  Layers,
  LayoutGrid,
  Smartphone,
  Sparkles,
  User,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type IconComponent = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>;

export type CreativeToolActionId =
  | "blocking_storyboard"
  | "storyboard"
  | "grid_25"
  | "plot_grid_4"
  | "frame_forward_3s"
  | "frame_back_5s"
  | "portrait_texture"
  | "cinematic_lighting"
  | "panorama_720"
  | "multi_cam_grid_9"
  | "face_tri_view"
  | "character_sheet"
  | "character_tri_view"
  | "scene_sheet"
  | "product_sheet"
  | "visual_style";

export interface CreativeToolItem {
  id: CreativeToolActionId;
  label: string;
  description?: string;
  icon: IconComponent;
  /** Show status dot like the reference UI (top-right of icon) */
  badge?: boolean;
  /** Optional digit overlay on clock-style icons */
  iconBadge?: string;
  /** Map to existing canvas capabilities when available */
  mapsTo?: "multi_angle" | "lighting" | "panorama" | "grid_9" | "visual_style";
}

export interface CreativeToolSection {
  id: string;
  label: string;
  items: CreativeToolItem[];
}

/** 设定图分区工具：允许无参考图、仅按后台提示词文生图 */
export const CONCEPT_SHEET_TOOL_IDS = [
  "face_tri_view",
  "character_sheet",
  "character_tri_view",
  "scene_sheet",
  "product_sheet",
] as const satisfies readonly CreativeToolActionId[];

/**
 * 九宫格弹层内可独立配置主/副模型与固定算力的子功能（不含故事板入口、画风选择）。
 * 须与后端 ``CREATIVE_GRID_CHILD_TOOL_IDS`` 保持一致。
 */
export const CREATIVE_GRID_CHILD_TOOL_IDS = [
  "grid_25",
  "plot_grid_4",
  "frame_forward_3s",
  "frame_back_5s",
  "cinematic_lighting",
  "multi_cam_grid_9",
  "face_tri_view",
  "character_sheet",
  "character_tri_view",
  "scene_sheet",
  "product_sheet",
] as const satisfies readonly CreativeToolActionId[];

export function isCreativeGridChildTool(id: string): boolean {
  return (CREATIVE_GRID_CHILD_TOOL_IDS as readonly string[]).includes(id);
}

export function isConceptSheetTool(id: string): boolean {
  return (CONCEPT_SHEET_TOOL_IDS as readonly string[]).includes(id);
}

/** 角色脸部三视图：取景框 + 头像轮廓 */
export function FaceTriViewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <path
        d="M7 5H5v2M17 5h2v2M7 19H5v-2M17 19h2v-2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8.5 16.5c.8-2 2.2-3 3.5-3s2.7 1 3.5 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 角色三视图：证件框 + 人像 */
export function CharacterTriViewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <rect x="5" y="4" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8.8 16.2c.7-1.7 1.9-2.5 3.2-2.5s2.5.8 3.2 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Left / right columns matching product screenshot. */
export const CREATIVE_TOOL_COLUMNS: CreativeToolSection[][] = [
  [
    {
      id: "story_narrative",
      label: "分镜叙事",
      items: [
        {
          id: "blocking_storyboard",
          label: "调度故事板",
          description: "一张图：多镜头+参数+俯视调度",
          icon: Clapperboard,
          badge: true,
        },
        {
          id: "storyboard",
          label: "故事板",
          description: "一张图：连续分镜+说明文字",
          icon: BookOpen,
          badge: true,
        },
        {
          id: "grid_25",
          label: "25宫格连贯分镜",
          description: "生成连续分镜长图",
          icon: LayoutGrid,
        },
        {
          id: "plot_grid_4",
          label: "剧情推演四宫格",
          icon: Grid2x2,
        },
        {
          id: "frame_forward_3s",
          label: "画面推演 - 3秒后",
          icon: Clock3,
          iconBadge: "3",
        },
        {
          id: "frame_back_5s",
          label: "画面推演 - 5秒前",
          icon: Clock3,
          iconBadge: "5",
        },
      ],
    },
    {
      id: "texture",
      label: "质感调节",
      items: [
        {
          id: "cinematic_lighting",
          label: "电影级光影校正",
          icon: Sparkles,
          mapsTo: "lighting",
        },
      ],
    },
  ],
  [
    {
      id: "space_camera",
      label: "空间与机位",
      items: [
        {
          id: "multi_cam_grid_9",
          label: "多机位九宫格",
          icon: Grid3x3,
          mapsTo: "grid_9",
        },
      ],
    },
    {
      id: "concept_sheets",
      label: "设定图",
      items: [
        {
          id: "face_tri_view",
          label: "角色脸部三视图",
          icon: FaceTriViewIcon,
        },
        {
          id: "character_sheet",
          label: "角色设定图",
          icon: User,
        },
        {
          id: "character_tri_view",
          label: "角色三视图",
          icon: CharacterTriViewIcon,
        },
        {
          id: "scene_sheet",
          label: "场景设定图",
          icon: Layers,
        },
        {
          id: "product_sheet",
          label: "产品设定图",
          icon: Smartphone,
        },
      ],
    },
  ],
];
