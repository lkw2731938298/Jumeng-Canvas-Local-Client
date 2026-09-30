"use client";

/**
 * 我的画布（项目画板）：
 * - 项目以卡片摆在可平移 / 缩放的画板上，单击选中、双击打开、拖动改位置（存本机）
 * - 选中卡片显示四角缩放把手、顶部旋转钮与悬浮工具栏：收藏 / 更多 / 移入回收站
 * - 保留原有功能：全部 / 收藏 / 回收站、搜索（Ctrl+K）、批量管理、恢复 / 永久删除、改名、封面
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  ImageIcon,
  LayoutGrid,
  Loader2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import * as api from "@/lib/api/projects";
import { resolveProjectCoverDisplayUrl } from "@/lib/api/storageUrl";
import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
import { useAppTheme } from "@/components/providers/AppThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import {
  NEW_CARD_ID,
  SLOT_H,
  assignMissingPositions,
  cardSize,
  clampScale,
  hashId,
  loadBoardLayout,
  normalizeRotation,
  poseFromResizeAnchor,
  resizeAnchor,
  rotationOf,
  saveBoardLayout,
  scaleOf,
  snapPoint,
  type BoardLayout,
  type BoardPoint,
  type ResizeCorner,
} from "@/lib/projects/boardLayout";
import type { Project } from "@/types";
import "./projectsBoard.css";

const FAVORITES_STORAGE_PREFIX = "jm_canvas_project_favorites:";

type LibraryTab = "all" | "favorites" | "trash";
type View = { x: number; y: number; k: number };

/** 默认视图：左侧让出竖栏，顶部让出标题 / 分类 */
const DEFAULT_VIEW: View = { x: 150, y: 170, k: 1 };
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3;
/** 指针移动超过该距离（屏幕 px）才算拖动，否则视为点击 */
const DRAG_THRESHOLD = 4;
/** 小地图尺寸 */
const MINI_W = 200;
const MINI_H = 124;

/** 无封面时的占位渐变（与设计稿一致的几组配色，按项目 id 固定挑一组） */
const COVER_GRADIENTS = [
  "linear-gradient(135deg, #9a82ff 0%, #5f9dff 55%, #2aa8ff 100%)",
  "linear-gradient(135deg, #19d8c4 0%, #2ab8f0 55%, #2a9dff 100%)",
  "linear-gradient(135deg, #2aa8ff 0%, #4f7cf0 50%, #6a45e0 100%)",
  "linear-gradient(135deg, #f7506a 0%, #c46fd0 50%, #9a8bff 100%)",
  "linear-gradient(135deg, #a07dff 0%, #e05e9c 50%, #ff4d6d 100%)",
  "linear-gradient(135deg, #14d9bd 0%, #2585d0 55%, #1f55d6 100%)",
  "linear-gradient(135deg, #34a0ff 0%, #5a78f5 50%, #7c5cff 100%)",
];

function loadFavoriteIds(userId: string | undefined): string[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${FAVORITES_STORAGE_PREFIX}${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveFavoriteIds(userId: string, ids: string[]) {
  localStorage.setItem(`${FAVORITES_STORAGE_PREFIX}${userId}`, JSON.stringify(ids));
}

/** 相对时间（东八区语义） */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(then).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function clampZoom(k: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
}

/** 拖动会话：卡片拖动、缩放、旋转或画板平移 */
type DragSession =
  | {
      kind: "card";
      id: string;
      pointerId: number;
      startX: number;
      startY: number;
      origin: BoardPoint;
      moved: boolean;
      last?: BoardPoint;
    }
  | {
      kind: "resize";
      id: string;
      pointerId: number;
      corner: ResizeCorner;
      ax: number;
      ay: number;
      startDist: number;
      originS: number;
      originR?: number;
      moved: boolean;
      last?: BoardPoint;
    }
  | {
      kind: "rotate";
      id: string;
      pointerId: number;
      centerX: number;
      centerY: number;
      startPointerAngle: number;
      originR: number;
      moved: boolean;
      lastR?: number;
    }
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      origin: View;
      moved: boolean;
    };

/** 拷贝姿态时保留 r / s */
function keepPose(base: BoardPoint, next: { x: number; y: number }): BoardPoint {
  return {
    x: next.x,
    y: next.y,
    ...(typeof base.r === "number" ? { r: base.r } : {}),
    ...(typeof base.s === "number" ? { s: base.s } : {}),
  };
}

export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const { appearance } = useAppTheme();

  const [libraryTab, setLibraryTab] = useState<LibraryTab>("all");
  const [search, setSearch] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  /** 画板上单击选中的卡片（显示把手与工具栏） */
  const [activeId, setActiveId] = useState<string | null>(null);
  /** 正在重命名的项目（弹窗放在卡片外，避免点击冒泡触发打开项目） */
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  /** 移入回收站确认（替代 window.confirm） */
  const [hideConfirmIds, setHideConfirmIds] = useState<string[] | null>(null);
  /** 永久删除确认 */
  const [purgeConfirmIds, setPurgeConfirmIds] = useState<string[] | null>(null);
  /** 当前选择封面的项目 id；文件选择框为页面级单例 */
  const coverTargetRef = useRef<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCoverId, setUploadingCoverId] = useState<string | null>(null);

  /** 画板视图：屏幕坐标 = 世界坐标 × k + (x, y) */
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const viewRef = useRef(view);
  const [layout, setLayout] = useState<BoardLayout>({});
  const layoutRef = useRef(layout);
  // 事件处理里读最新视图 / 布局
  useLayoutEffect(() => {
    viewRef.current = view;
    layoutRef.current = layout;
  }, [view, layout]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [boardSize, setBoardSize] = useState({ w: 1200, h: 800 });

  // 用户切换时在渲染期重读本地收藏与画板布局（React 推荐的「随 prop 重置 state」写法，替代 effect 内 setState）
  const [loadedUserId, setLoadedUserId] = useState<string | undefined>(undefined);
  if (userId !== loadedUserId) {
    setLoadedUserId(userId);
    setFavoriteIds(loadFavoriteIds(userId));
    setLayout(loadBoardLayout(userId));
    setLayoutReady(Boolean(userId));
  }

  /** 切换分类：清空多选与选中 */
  const changeTab = (tab: LibraryTab) => {
    setLibraryTab(tab);
    setSelectedIds([]);
    setSelectMode(false);
    setActiveId(null);
  };

  // 画板尺寸（CSS px）：用于适应画布与小地图视口框
  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const update = () => setBoardSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { data: ownedProjects = [], isLoading: loadingOwned } = useQuery({
    queryKey: ["projects", userId],
    queryFn: api.listProjects,
    enabled: Boolean(userId),
  });

  const { data: trashProjects = [], isLoading: loadingTrash } = useQuery({
    queryKey: ["projects", "trash", userId],
    queryFn: api.listTrashProjects,
    enabled: Boolean(userId) && libraryTab === "trash",
  });

  const invalidateProjects = async () => {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const createMutation = useMutation({
    mutationFn: () => api.createProject("未命名项目"),
    onSuccess: (project: Project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/${project.id}`);
    },
    onError: () => toast.error("新建项目失败，请稍后重试"),
  });

  const hideMutation = useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? api.deleteProject(ids[0]).then(() => ({ okCount: 1, failedIds: [] })) : api.batchHideProjects(ids),
    onSuccess: async (result) => {
      await invalidateProjects();
      setSelectedIds([]);
      setActiveId(null);
      toast.success(
        result.failedIds.length
          ? `已移入回收站 ${result.okCount} 个，失败 ${result.failedIds.length} 个`
          : `已移入回收站（${result.okCount}）`
      );
    },
    onError: () => toast.error("移入回收站失败"),
  });

  const restoreMutation = useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1
        ? api.restoreProject(ids[0]).then(() => ({ okCount: 1, failedIds: [] as string[] }))
        : api.batchRestoreProjects(ids),
    onSuccess: async (result) => {
      await invalidateProjects();
      setSelectedIds([]);
      setActiveId(null);
      toast.success(
        result.failedIds.length
          ? `已恢复 ${result.okCount} 个，失败 ${result.failedIds.length} 个`
          : `已恢复 ${result.okCount} 个项目`
      );
    },
    onError: () => toast.error("恢复失败"),
  });

  const purgeMutation = useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? api.purgeProject(ids[0]).then(() => ({ okCount: 1, failedIds: [] })) : api.batchPurgeProjects(ids),
    onSuccess: async (result) => {
      await invalidateProjects();
      setSelectedIds([]);
      setActiveId(null);
      toast.success(
        result.failedIds.length
          ? `已永久删除 ${result.okCount} 个，失败 ${result.failedIds.length} 个`
          : `已永久删除 ${result.okCount} 个项目`
      );
    },
    onError: () => toast.error("永久删除失败"),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.updateProject(id, { title }),
    onSuccess: async () => {
      await invalidateProjects();
      setRenameTarget(null);
      toast.success("项目名已修改");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "修改项目名失败"),
  });

  const openRename = (project: Project) => {
    setRenameTitle(project.title);
    setRenameTarget(project);
  };

  const submitRename = () => {
    if (!renameTarget) return;
    const title = renameTitle.trim();
    if (!title) {
      toast.error("项目名不能为空");
      return;
    }
    if (title === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    renameMutation.mutate({ id: renameTarget.id, title });
  };

  /** 等下拉菜单关闭后再打开文件选择，避免菜单收起打断文件框 */
  const pickCover = (projectId: string) => {
    coverTargetRef.current = projectId;
    window.setTimeout(() => coverInputRef.current?.click(), 0);
  };

  const handleCoverFile = async (file: File) => {
    const projectId = coverTargetRef.current;
    coverTargetRef.current = null;
    if (!projectId) return;
    setUploadingCoverId(projectId);
    try {
      await api.uploadProjectCover(projectId, file);
      await invalidateProjects();
      toast.success("封面已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "封面上传失败");
    } finally {
      setUploadingCoverId(null);
    }
  };

  const toggleFavorite = (id: string) => {
    if (!userId) return;
    setFavoriteIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      saveFavoriteIds(userId, next);
      return next;
    });
  };

  const sourceProjects = libraryTab === "trash" ? trashProjects : ownedProjects;

  const visibleProjects = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return sourceProjects.filter((project) => {
      if (libraryTab === "favorites" && !favoriteIds.includes(project.id)) return false;
      return project.title.toLowerCase().includes(keyword);
    });
  }, [sourceProjects, libraryTab, favoriteIds, search]);

  /** 「进入创作」卡片：仅全部页、无搜索、非批量时显示 */
  const showNewCard = libraryTab === "all" && !search && !selectMode;

  // 缺坐标的卡片自动排位（新项目放到已有卡片右侧空位），并立即持久化
  useEffect(() => {
    if (!layoutReady) return;
    const allIds = [...ownedProjects, ...trashProjects]
      .slice()
      .sort((a, b) => new Date(a.createdAt ?? a.updatedAt).getTime() - new Date(b.createdAt ?? b.updatedAt).getTime())
      .map((p) => p.id);
    const base: BoardLayout = { ...layoutRef.current };
    let changed = false;
    if (!base[NEW_CARD_ID]) {
      base[NEW_CARD_ID] = { x: 0, y: SLOT_H };
      changed = true;
    }
    const added = assignMissingPositions(base, allIds);
    if (Object.keys(added).length) changed = true;
    if (!changed) return;
    const next = { ...base, ...added };
    setLayout(next);
    saveBoardLayout(userId, next);
  }, [layoutReady, ownedProjects, trashProjects, userId]);

  const allVisibleSelected =
    visibleProjects.length > 0 && visibleProjects.every((p) => selectedIds.includes(p.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(visibleProjects.map((p) => p.id));
  };

  const confirmHide = (ids: string[]) => {
    if (!ids.length) return;
    setHideConfirmIds(ids);
  };

  const confirmRestore = (ids: string[]) => {
    if (!ids.length) return;
    restoreMutation.mutate(ids);
  };

  const confirmPurge = (ids: string[]) => {
    if (!ids.length) return;
    setPurgeConfirmIds(ids);
  };

  const hideConfirmLabel = useMemo(() => {
    if (!hideConfirmIds?.length) return "";
    if (hideConfirmIds.length === 1) {
      const p = ownedProjects.find((x) => x.id === hideConfirmIds[0]);
      const name = p?.title?.trim() || "该项目";
      return `确定将「${name}」移入回收站？可稍后在回收站恢复。`;
    }
    return `确定将选中的 ${hideConfirmIds.length} 个项目移入回收站？可稍后在回收站恢复。`;
  }, [hideConfirmIds, ownedProjects]);

  const purgeConfirmLabel = useMemo(() => {
    if (!purgeConfirmIds?.length) return "";
    if (purgeConfirmIds.length === 1) {
      const p = trashProjects.find((x) => x.id === purgeConfirmIds[0]);
      const name = p?.title?.trim() || "该项目";
      return `确定永久删除「${name}」？素材与任务将一并清除，且不可恢复。`;
    }
    return `确定永久删除选中的 ${purgeConfirmIds.length} 个项目？此操作不可恢复。`;
  }, [purgeConfirmIds, trashProjects]);

  const openProject = (project: Project) => {
    if (libraryTab === "trash") {
      toast.message("请先恢复项目后再打开");
      return;
    }
    router.push(`/${project.id}`);
  };

  const busy = hideMutation.isPending || restoreMutation.isPending || purgeMutation.isPending;
  const isLoading = libraryTab === "trash" ? loadingTrash : loadingOwned;

  /** 画板上实际渲染的卡片 id（含「进入创作」） */
  const boardIds = useMemo(() => {
    const ids = visibleProjects.map((p) => p.id);
    return showNewCard ? [NEW_CARD_ID, ...ids] : ids;
  }, [visibleProjects, showNewCard]);

  const pointOf = useCallback((id: string): BoardPoint => layout[id] ?? { x: 0, y: 0 }, [layout]);

  /** 屏幕 px → 画板 CSS px 的比例（界面缩放 zoom 时不为 1） */
  const screenScale = () => {
    const el = boardRef.current;
    if (!el || !el.clientWidth) return 1;
    return el.getBoundingClientRect().width / el.clientWidth || 1;
  };

  // ---------- 缩放 ----------
  const zoomAt = useCallback((nextK: number, cx: number, cy: number) => {
    setView((v) => {
      const k = clampZoom(nextK);
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      return { k, x: cx - wx * k, y: cy - wy * k };
    });
  }, []);

  const zoomBy = (factor: number) => {
    zoomAt(viewRef.current.k * factor, boardSize.w / 2, boardSize.h / 2);
  };

  /** 适应画布：让当前可见卡片全部落在视口内 */
  const fitView = useCallback(() => {
    if (!boardIds.length) {
      setView(DEFAULT_VIEW);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of boardIds) {
      const p = layoutRef.current[id] ?? { x: 0, y: 0 };
      const { w, h } = cardSize(p);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + w);
      maxY = Math.max(maxY, p.y + h);
    }
    const padX = 110;
    const padTop = 150;
    const padBottom = 110;
    const availW = Math.max(200, boardSize.w - padX * 2);
    const availH = Math.max(200, boardSize.h - padTop - padBottom);
    const k = clampZoom(Math.min(availW / (maxX - minX), availH / (maxY - minY), 1.25));
    setView({
      k,
      x: padX + (availW - (maxX - minX) * k) / 2 - minX * k,
      y: padTop + (availH - (maxY - minY) * k) / 2 - minY * k,
    });
  }, [boardIds, boardSize]);

  // 滚轮 / 触控板捏合：以指针为中心缩放（capture 避免被壳层抢走）
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-board-ui]")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const s = rect.width / el.clientWidth || 1;
      const cx = (e.clientX - rect.left) / s;
      const cy = (e.clientY - rect.top) / s;
      // 触控板捏合常带 ctrlKey；鼠标滚轮按档位放大步长
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; // 行
      if (e.deltaMode === 2) dy *= 320; // 页
      const intensity = e.ctrlKey || e.metaKey ? 0.012 : 0.0022;
      const factor = Math.exp(-dy * intensity);
      zoomAt(viewRef.current.k * factor, cx, cy);
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, true);
  }, [zoomAt]);

  // Ctrl/Cmd + − = 0：缩放；Esc 取消选中；Ctrl+K 搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        setActiveId(null);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomAt(viewRef.current.k * 1.2, boardSize.w / 2, boardSize.h / 2);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomAt(viewRef.current.k / 1.2, boardSize.w / 2, boardSize.h / 2);
      } else if (e.key === "0") {
        e.preventDefault();
        zoomAt(1, boardSize.w / 2, boardSize.h / 2);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomAt, boardSize.w, boardSize.h]);

  // ---------- 拖动 / 平移 ----------
  const onBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-board-ui], [data-card]")) return;
    dragRef.current = {
      kind: "pan",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: viewRef.current,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCardPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-card-ui]")) return;
    e.stopPropagation();
    const cur = layoutRef.current[id] ?? { x: 0, y: 0 };
    dragRef.current = {
      kind: "card",
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { ...cur },
      moved: false,
    };
    // 在卡片自身捕获指针：move 仍冒泡到画板处理，且双击事件目标保持为卡片
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /** 选中态顶部旋转钮：绕卡片中心拖动改角度 */
  const onRotatePointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const pos = layoutRef.current[id] ?? { x: 0, y: 0 };
    const { w, h } = cardSize(pos);
    const v = viewRef.current;
    const board = boardRef.current?.getBoundingClientRect();
    const s = screenScale();
    if (!board) return;
    const centerX = board.left + (pos.x + w / 2) * v.k * s + v.x * s;
    const centerY = board.top + (pos.y + h / 2) * v.k * s + v.y * s;
    dragRef.current = {
      kind: "rotate",
      id,
      pointerId: e.pointerId,
      centerX,
      centerY,
      startPointerAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX),
      originR: rotationOf(id, layoutRef.current),
      moved: false,
    };
    (e.currentTarget.closest("[data-card]") as HTMLElement | null)?.setPointerCapture(e.pointerId);
  };

  /** 四角把手：对角固定，等比缩放卡片 */
  const onResizePointerDown = (
    e: React.PointerEvent<HTMLElement>,
    id: string,
    corner: ResizeCorner
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const pos = layoutRef.current[id] ?? { x: 0, y: 0 };
    const { w, h } = cardSize(pos);
    const { ax, ay } = resizeAnchor(corner, pos.x, pos.y, w, h);
    const v = viewRef.current;
    const board = boardRef.current?.getBoundingClientRect();
    const scr = screenScale();
    if (!board) return;
    // 指针 → 世界坐标
    const wx = (e.clientX - board.left) / scr / v.k - v.x / v.k;
    const wy = (e.clientY - board.top) / scr / v.k - v.y / v.k;
    const startDist = Math.hypot(wx - ax, wy - ay) || 1;
    dragRef.current = {
      kind: "resize",
      id,
      pointerId: e.pointerId,
      corner,
      ax,
      ay,
      startDist,
      originS: scaleOf(pos),
      originR: typeof pos.r === "number" ? pos.r : undefined,
      moved: false,
    };
    (e.currentTarget.closest("[data-card]") as HTMLElement | null)?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const s = screenScale();
    if (d.kind === "rotate") {
      const ang = Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX);
      const deltaDeg = ((ang - d.startPointerAngle) * 180) / Math.PI;
      if (!d.moved && Math.abs(deltaDeg) < 0.8) return;
      d.moved = true;
      setDraggingId(d.id);
      let nextR = normalizeRotation(d.originR + deltaDeg);
      if (e.shiftKey) nextR = Math.round(nextR / 15) * 15;
      d.lastR = nextR;
      setLayout((cur) => {
        const base = cur[d.id] ?? { x: 0, y: 0 };
        return { ...cur, [d.id]: { ...base, r: nextR } };
      });
      return;
    }
    if (d.kind === "resize") {
      const v = viewRef.current;
      const board = boardRef.current?.getBoundingClientRect();
      if (!board) return;
      const wx = (e.clientX - board.left) / s / v.k - v.x / v.k;
      const wy = (e.clientY - board.top) / s / v.k - v.y / v.k;
      const dist = Math.hypot(wx - d.ax, wy - d.ay);
      if (!d.moved && Math.abs(dist - d.startDist) < 4) return;
      d.moved = true;
      setDraggingId(d.id);
      let nextS = clampScale(d.originS * (dist / d.startDist));
      if (e.shiftKey) nextS = clampScale(Math.round(nextS * 4) / 4); // 0.25 档
      const next = poseFromResizeAnchor(d.corner, d.ax, d.ay, nextS, {
        ...(typeof d.originR === "number" ? { r: d.originR } : {}),
      });
      d.last = next;
      setLayout((cur) => ({ ...cur, [d.id]: next }));
      return;
    }
    const dx = (e.clientX - d.startX) / s;
    const dy = (e.clientY - d.startY) / s;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      if (d.kind === "card") setDraggingId(d.id);
      else setPanning(true);
    }
    if (d.kind === "pan") {
      setView({ ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy });
    } else {
      const k = viewRef.current.k;
      let p = keepPose(d.origin, {
        x: d.origin.x + dx / k,
        y: d.origin.y + dy / k,
      });
      if (appearance.gridSnap) p = snapPoint(p);
      d.last = p;
      setLayout((cur) => ({ ...cur, [d.id]: p }));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (d.kind === "pan") {
      setPanning(false);
      if (!d.moved) setActiveId(null);
      return;
    }
    if (d.kind === "rotate") {
      setDraggingId(null);
      if (d.moved) {
        const base = layoutRef.current[d.id] ?? { x: 0, y: 0 };
        const r = d.lastR ?? base.r;
        const next = {
          ...layoutRef.current,
          [d.id]: { ...base, ...(typeof r === "number" ? { r } : {}) },
        };
        layoutRef.current = next;
        saveBoardLayout(userId, next);
        setActiveId(d.id);
      }
      return;
    }
    if (d.kind === "resize") {
      setDraggingId(null);
      if (d.moved) {
        const next = d.last ? { ...layoutRef.current, [d.id]: d.last } : layoutRef.current;
        layoutRef.current = next;
        saveBoardLayout(userId, next);
        setActiveId(d.id);
      }
      return;
    }
    setDraggingId(null);
    if (d.moved) {
      const next = d.last ? { ...layoutRef.current, [d.id]: d.last } : layoutRef.current;
      layoutRef.current = next;
      saveBoardLayout(userId, next);
      if (d.id !== NEW_CARD_ID) setActiveId(d.id);
      return;
    }
    if (d.id === NEW_CARD_ID) {
      if (!createMutation.isPending) createMutation.mutate();
      return;
    }
    if (selectMode) toggleSelect(d.id);
    else setActiveId(d.id);
  };

  // ---------- 小地图 ----------
  const minimap = useMemo(() => {
    const vw = { x: -view.x / view.k, y: -view.y / view.k, w: boardSize.w / view.k, h: boardSize.h / view.k };
    let minX = vw.x;
    let minY = vw.y;
    let maxX = vw.x + vw.w;
    let maxY = vw.y + vw.h;
    for (const id of boardIds) {
      const p = layout[id] ?? { x: 0, y: 0 };
      const { w, h } = cardSize(p);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + w);
      maxY = Math.max(maxY, p.y + h);
    }
    const pad = 80;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const scale = Math.min(MINI_W / (maxX - minX), MINI_H / (maxY - minY));
    const offX = (MINI_W - (maxX - minX) * scale) / 2;
    const offY = (MINI_H - (maxY - minY) * scale) / 2;
    const toMini = (x: number, y: number) => ({ x: offX + (x - minX) * scale, y: offY + (y - minY) * scale });
    return { vw, scale, toMini, minX, minY, offX, offY };
  }, [view, boardSize, boardIds, layout]);

  const miniDragRef = useRef<number | null>(null);
  const jumpFromMinimap = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const s = rect.width / MINI_W || 1;
    const mx = (e.clientX - rect.left) / s;
    const my = (e.clientY - rect.top) / s;
    const wx = minimap.minX + (mx - minimap.offX) / minimap.scale;
    const wy = minimap.minY + (my - minimap.offY) / minimap.scale;
    setView((v) => ({ ...v, x: boardSize.w / 2 - wx * v.k, y: boardSize.h / 2 - wy * v.k }));
  };

  const projectCount = libraryTab === "trash" ? trashProjects.length : ownedProjects.length;
  const activeProject = activeId ? visibleProjects.find((p) => p.id === activeId) ?? null : null;

  return (
    <HuabuPublicShell sidebar page="projects">
      <div
        ref={boardRef}
        className={`pb-board${panning ? " is-panning" : ""}`}
        style={
          {
            "--pb-grid": `${40 * view.k}px`,
            "--pb-gx": `${view.x}px`,
            "--pb-gy": `${view.y}px`,
          } as React.CSSProperties
        }
        onPointerDown={onBoardPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* 世界层：所有卡片按世界坐标摆放 */}
        <div
          className="pb-world"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          {showNewCard ? (
            <div
              data-card
              className={`pb-new-card${draggingId === NEW_CARD_ID ? " dragging" : ""}`}
              style={{
                left: pointOf(NEW_CARD_ID).x,
                top: pointOf(NEW_CARD_ID).y,
                width: cardSize(pointOf(NEW_CARD_ID)).w,
                height: cardSize(pointOf(NEW_CARD_ID)).h,
              }}
              role="button"
              tabIndex={0}
              aria-label="进入创作：新建项目"
              onPointerDown={(e) => onCardPointerDown(e, NEW_CARD_ID)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !createMutation.isPending) createMutation.mutate();
              }}
            >
              <span className="pb-new-icon">
                {createMutation.isPending ? (
                  <Loader2 size={22} className="animate-spin" />
                ) : (
                  <Plus size={22} strokeWidth={1.6} />
                )}
              </span>
              <strong>进入创作</strong>
            </div>
          ) : null}

          {visibleProjects.map((project) => {
            const p = pointOf(project.id);
            const size = cardSize(p);
            const isFav = favoriteIds.includes(project.id);
            const checked = selectedIds.includes(project.id);
            const active = activeId === project.id && !selectMode;
            const dragging = draggingId === project.id;
            const coverSrc = resolveProjectCoverDisplayUrl(project.coverUrl);
            const tilt = rotationOf(project.id, layout);
            const scalePct = Math.round(scaleOf(p) * 100);
            return (
              <article
                key={project.id}
                data-card
                className={`pb-card${active ? " active" : ""}${dragging ? " dragging" : ""}${checked ? " checked" : ""}`}
                style={{
                  left: p.x,
                  top: p.y,
                  width: size.w,
                  height: size.h,
                  transform: `rotate(${tilt}deg)`,
                  zIndex: dragging ? 30 : active ? 20 : undefined,
                }}
                role="button"
                tabIndex={0}
                aria-label={project.title}
                onPointerDown={(e) => onCardPointerDown(e, project.id)}
                onDoubleClick={() => {
                  if (!selectMode) openProject(project);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (selectMode) toggleSelect(project.id);
                  else openProject(project);
                }}
              >
                <div
                  className={`pb-cover${coverSrc ? " has-cover" : ""}`}
                  style={coverSrc ? undefined : { background: COVER_GRADIENTS[hashId(project.id) % COVER_GRADIENTS.length] }}
                >
                  {coverSrc ? <img src={coverSrc} alt="" draggable={false} /> : null}
                  {uploadingCoverId === project.id ? (
                    <span className="pb-cover-busy">
                      <Loader2 size={20} className="animate-spin" />
                    </span>
                  ) : null}
                </div>
                <div className="pb-meta">
                  <strong title={project.title}>{project.title}</strong>
                  <div className="pb-meta-row">
                    <span className="pb-id" title={project.id}>
                      {project.id.slice(0, 8)}
                    </span>
                    <span className="pb-time">
                      {libraryTab === "trash" ? "删除于 " : ""}
                      {formatRelative(project.updatedAt)}
                    </span>
                  </div>
                  {isFav ? <Star className="pb-fav-mark" size={14} fill="currentColor" strokeWidth={0} /> : null}
                </div>

                {selectMode ? (
                  <span className={`pb-check${checked ? " on" : ""}`} aria-hidden="true">
                    {checked ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                ) : null}

                {active ? (
                  <>
                    {(
                      [
                        ["tl", "nwse-resize"],
                        ["tr", "nesw-resize"],
                        ["bl", "nesw-resize"],
                        ["br", "nwse-resize"],
                      ] as const
                    ).map(([corner, cursor]) => (
                      <button
                        key={corner}
                        type="button"
                        className={`pb-handle ${corner}`}
                        data-card-ui
                        title={`拖动缩放（当前 ${scalePct}%，Shift 吸附 25%）`}
                        aria-label={`拖动${corner}角缩放`}
                        style={{ cursor, transform: `scale(${1 / view.k})` }}
                        onPointerDown={(e) => onResizePointerDown(e, project.id, corner)}
                      />
                    ))}
                    <button
                      type="button"
                      className="pb-rotate-handle"
                      data-card-ui
                      title={`拖动旋转（当前 ${tilt}°，按住 Shift 吸附 15°）`}
                      aria-label="拖动旋转卡片"
                      style={{ transform: `translateX(-50%) scale(${1 / view.k})` }}
                      onPointerDown={(e) => onRotatePointerDown(e, project.id)}
                    >
                      <RotateCw size={12} strokeWidth={2.2} />
                    </button>
                    <div
                      className="pb-toolbar"
                      data-card-ui
                      style={{ transform: `translateX(-50%) scale(${1 / view.k})` }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {libraryTab === "trash" ? (
                        <>
                          <button
                            type="button"
                            title="恢复"
                            aria-label="恢复项目"
                            disabled={busy}
                            onClick={() => confirmRestore([project.id])}
                          >
                            <RotateCcw size={14} strokeWidth={1.9} />
                          </button>
                          <button
                            type="button"
                            className="danger"
                            title="永久删除"
                            aria-label="永久删除项目"
                            disabled={busy}
                            onClick={() => confirmPurge([project.id])}
                          >
                            <Trash2 size={14} strokeWidth={1.9} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={isFav ? "fav on" : "fav"}
                            title={isFav ? "取消收藏" : "收藏"}
                            aria-label={isFav ? "取消收藏" : "收藏项目"}
                            onClick={() => toggleFavorite(project.id)}
                          >
                            <Star size={14} strokeWidth={1.9} fill={isFav ? "currentColor" : "none"} />
                          </button>
                          {/* 更多操作：修改项目名 / 上传封面 */}
                          <DropdownMenu>
                            <DropdownMenuTrigger className="pb-tool-more" aria-label="项目操作">
                              {uploadingCoverId === project.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <MoreHorizontal size={15} strokeWidth={2} />
                              )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="center" className="z-[200] min-w-[132px] p-1">
                              <DropdownMenuItem className="h-[34px] gap-2 text-xs" onClick={() => openRename(project)}>
                                <Pencil size={14} strokeWidth={1.8} />
                                修改项目名
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="h-[34px] gap-2 text-xs"
                                disabled={uploadingCoverId === project.id}
                                onClick={() => pickCover(project.id)}
                              >
                                <ImageIcon size={14} strokeWidth={1.8} />
                                上传封面
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <button
                            type="button"
                            title="移入回收站"
                            aria-label="移入回收站"
                            disabled={busy}
                            onClick={() => confirmHide([project.id])}
                          >
                            <Trash2 size={14} strokeWidth={1.9} />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : null}
              </article>
            );
          })}
        </div>

        {/* 左上：标题 + 分类 */}
        <div className="pb-head" data-board-ui>
          <div className="pb-title-chip">
            <strong>我的画布</strong>
            <span>{projectCount} 个项目</span>
          </div>
          <div className="pb-tabs" role="tablist" aria-label="项目筛选">
            {[
              { id: "all" as const, label: "全部" },
              { id: "favorites" as const, label: "我的收藏" },
              { id: "trash" as const, label: "回收站" },
            ].map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={libraryTab === tab.id ? "active" : ""}
                role="tab"
                aria-selected={libraryTab === tab.id}
                onClick={() => changeTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 右上：搜索 + 批量管理 + 回收站 */}
        <div className="pb-tools" data-board-ui>
          <label className="pb-search">
            <Search size={15} strokeWidth={1.8} />
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
            />
            <kbd>Ctrl K</kbd>
          </label>
          <button
            type="button"
            className={`jm-icon-btn${selectMode ? " active" : ""}`}
            title={selectMode ? "取消批量管理" : "批量管理"}
            aria-label="批量管理"
            aria-pressed={selectMode}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelectedIds([]);
              setActiveId(null);
            }}
            disabled={busy}
          >
            <LayoutGrid size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className={`jm-icon-btn${libraryTab === "trash" ? " active" : ""}`}
            title="回收站"
            aria-label="回收站"
            aria-pressed={libraryTab === "trash"}
            onClick={() => changeTab(libraryTab === "trash" ? "all" : "trash")}
          >
            <Trash2 size={16} strokeWidth={1.8} />
          </button>
        </div>

        {/* 批量操作条 */}
        {selectMode ? (
          <div className="pb-batch" data-board-ui>
            <button type="button" className="jm-btn" onClick={toggleSelectAll} disabled={busy || !visibleProjects.length}>
              {allVisibleSelected ? "取消全选" : "全选当前列表"}
            </button>
            <span className="pb-batch-count">已选 {selectedIds.length}</span>
            {libraryTab === "trash" ? (
              <>
                <button
                  type="button"
                  className="jm-btn"
                  disabled={!selectedIds.length || busy}
                  onClick={() => confirmRestore(selectedIds)}
                >
                  <RotateCcw size={14} strokeWidth={1.8} />
                  恢复
                </button>
                <button
                  type="button"
                  className="jm-btn jm-btn-danger-text"
                  disabled={!selectedIds.length || busy}
                  onClick={() => confirmPurge(selectedIds)}
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                  永久删除
                </button>
              </>
            ) : (
              <button
                type="button"
                className="jm-btn jm-btn-danger-text"
                disabled={!selectedIds.length || busy}
                onClick={() => confirmHide(selectedIds)}
              >
                <Trash2 size={14} strokeWidth={1.8} />
                移入回收站
              </button>
            )}
            <button
              type="button"
              className="jm-btn"
              onClick={() => {
                setSelectMode(false);
                setSelectedIds([]);
              }}
            >
              完成
            </button>
          </div>
        ) : null}

        {libraryTab === "trash" && !selectMode ? (
          <p className="pb-hint" data-board-ui>
            回收站内项目可恢复；永久删除将清理素材与任务，不可撤销。
          </p>
        ) : null}

        {!isLoading && visibleProjects.length === 0 && !showNewCard ? (
          <div className="pb-empty">
            {libraryTab === "trash" ? "回收站为空" : search ? "没有匹配的项目" : "暂无相关项目"}
          </div>
        ) : null}

        {/* 底部缩放控制：滚轮 / Ctrl± / 按钮 */}
        <div className="pb-zoom" data-board-ui>
          <button type="button" aria-label="缩小" title="缩小（Ctrl+-）" onClick={() => zoomBy(1 / 1.2)}>
            <Minus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="pb-zoom-value"
            title="重置为 100%（Ctrl+0）"
            onClick={() => zoomAt(1, boardSize.w / 2, boardSize.h / 2)}
          >
            {Math.round(view.k * 100)}%
          </button>
          <button type="button" aria-label="放大" title="放大（Ctrl+=）" onClick={() => zoomBy(1.2)}>
            <Plus size={14} strokeWidth={2} />
          </button>
          <button type="button" className="pb-zoom-fit" onClick={fitView}>
            适应画布
          </button>
        </div>

        {/* 右下小地图：点击 / 拖动跳转 */}
        <div
          className="pb-minimap"
          data-board-ui
          style={{ width: MINI_W, height: MINI_H }}
          onPointerDown={(e) => {
            e.stopPropagation();
            miniDragRef.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            jumpFromMinimap(e);
          }}
          onPointerMove={(e) => {
            if (miniDragRef.current === e.pointerId) jumpFromMinimap(e);
          }}
          onPointerUp={(e) => {
            miniDragRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          {/* 视口框先画，卡片叠在上面避免被遮住 */}
          {(() => {
            const m = minimap.toMini(minimap.vw.x, minimap.vw.y);
            return (
              <span
                className="pb-mini-view"
                style={{ left: m.x, top: m.y, width: minimap.vw.w * minimap.scale, height: minimap.vw.h * minimap.scale }}
              />
            );
          })()}
          {boardIds.map((id) => {
            const p = pointOf(id);
            const size = cardSize(p);
            const m = minimap.toMini(p.x, p.y);
            return (
              <span
                key={id}
                className={`pb-mini-card${id === activeProject?.id ? " active" : ""}${id === NEW_CARD_ID ? " new" : ""}`}
                style={{
                  left: m.x,
                  top: m.y,
                  width: size.w * minimap.scale,
                  height: size.h * minimap.scale,
                }}
              />
            );
          })}
        </div>
      </div>

      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleCoverFile(file);
          else coverTargetRef.current = null;
        }}
      />

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改项目名</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameTitle}
            maxLength={100}
            onChange={(e) => setRenameTitle(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={submitRename} disabled={renameMutation.isPending}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(hideConfirmIds?.length)}
        onOpenChange={(open) => !open && setHideConfirmIds(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移入回收站</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">{hideConfirmLabel}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHideConfirmIds(null)} disabled={hideMutation.isPending}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={hideMutation.isPending || !hideConfirmIds?.length}
              onClick={() => {
                if (!hideConfirmIds?.length) return;
                const ids = hideConfirmIds;
                setHideConfirmIds(null);
                hideMutation.mutate(ids);
              }}
            >
              {hideMutation.isPending ? "处理中…" : "移入回收站"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(purgeConfirmIds?.length)}
        onOpenChange={(open) => !open && setPurgeConfirmIds(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>永久删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground leading-relaxed">{purgeConfirmLabel}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeConfirmIds(null)} disabled={purgeMutation.isPending}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={purgeMutation.isPending || !purgeConfirmIds?.length}
              onClick={() => {
                if (!purgeConfirmIds?.length) return;
                const ids = purgeConfirmIds;
                setPurgeConfirmIds(null);
                purgeMutation.mutate(ids);
              }}
            >
              {purgeMutation.isPending ? "删除中…" : "永久删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </HuabuPublicShell>
  );
}
