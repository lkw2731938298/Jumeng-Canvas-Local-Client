"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckSquare,
  Folder,
  Plus,
  RotateCcw,
  Search,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import * as api from "@/lib/api/projects";
import { resolveProjectCoverDisplayUrl } from "@/lib/api/storageUrl";
import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
import { useAuthStore } from "@/stores/authStore";
import type { Project } from "@/types";

const FAVORITES_STORAGE_PREFIX = "jm_canvas_project_favorites:";

type LibraryTab = "all" | "favorites" | "trash";

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

/** huabu 项目库：删除 / 批量 / 回收站 */
export default function ProjectsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;

  const [libraryTab, setLibraryTab] = useState<LibraryTab>("all");
  const [search, setSearch] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);

  useEffect(() => {
    setFavoriteIds(loadFavoriteIds(userId));
  }, [userId]);

  useEffect(() => {
    setSelectedIds([]);
    setSelectMode(false);
  }, [libraryTab]);

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
      toast.success(
        result.failedIds.length
          ? `已永久删除 ${result.okCount} 个，失败 ${result.failedIds.length} 个`
          : `已永久删除 ${result.okCount} 个项目`
      );
    },
    onError: () => toast.error("永久删除失败"),
  });

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
    if (!window.confirm(ids.length === 1 ? "确定将该项目移入回收站？" : `确定将选中的 ${ids.length} 个项目移入回收站？`)) {
      return;
    }
    hideMutation.mutate(ids);
  };

  const confirmRestore = (ids: string[]) => {
    if (!ids.length) return;
    restoreMutation.mutate(ids);
  };

  const confirmPurge = (ids: string[]) => {
    if (!ids.length) return;
    if (
      !window.confirm(
        ids.length === 1
          ? "确定永久删除该项目？素材与任务将一并清除，且不可恢复。"
          : `确定永久删除选中的 ${ids.length} 个项目？此操作不可恢复。`
      )
    ) {
      return;
    }
    purgeMutation.mutate(ids);
  };

  const busy = hideMutation.isPending || restoreMutation.isPending || purgeMutation.isPending;
  const isLoading = libraryTab === "trash" ? loadingTrash : loadingOwned;

  return (
    <HuabuPublicShell>
      <section className="projects-page" aria-label="我的项目">
        <h1 className="projects-page-title">我的项目</h1>

        <div className="projects-toolbar">
          <div className="projects-tabs" role="tablist" aria-label="项目筛选">
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
                onClick={() => setLibraryTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="projects-tools">
            <label className="projects-search">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索项目"
                aria-label="搜索项目"
              />
              <Search size={15} strokeWidth={1.8} />
            </label>
            <button
              type="button"
              className={`projects-tool-btn${selectMode ? " active" : ""}`}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelectedIds([]);
              }}
              disabled={busy}
            >
              {selectMode ? <CheckSquare size={14} strokeWidth={1.8} /> : <Square size={14} strokeWidth={1.8} />}
              {selectMode ? "取消多选" : "批量管理"}
            </button>
            <button
              type="button"
              className={`projects-recycle${libraryTab === "trash" ? " active" : ""}`}
              onClick={() => setLibraryTab(libraryTab === "trash" ? "all" : "trash")}
            >
              <Trash2 size={14} strokeWidth={1.8} />
              回收站
            </button>
          </div>
        </div>

        {selectMode && visibleProjects.length > 0 ? (
          <div className="projects-batch-bar">
            <button type="button" className="projects-tool-btn" onClick={toggleSelectAll} disabled={busy}>
              {allVisibleSelected ? "取消全选" : "全选当前列表"}
            </button>
            <span className="projects-batch-count">已选 {selectedIds.length}</span>
            <div className="projects-batch-actions">
              {libraryTab === "trash" ? (
                <>
                  <button
                    type="button"
                    className="projects-tool-btn"
                    disabled={!selectedIds.length || busy}
                    onClick={() => confirmRestore(selectedIds)}
                  >
                    <RotateCcw size={14} strokeWidth={1.8} />
                    恢复
                  </button>
                  <button
                    type="button"
                    className="projects-tool-btn danger"
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
                  className="projects-tool-btn danger"
                  disabled={!selectedIds.length || busy}
                  onClick={() => confirmHide(selectedIds)}
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                  移入回收站
                </button>
              )}
            </div>
          </div>
        ) : null}

        {libraryTab === "trash" ? (
          <p className="projects-trash-hint">回收站内项目可恢复；永久删除将清理素材与任务，不可撤销。</p>
        ) : null}

        <div className="projects-library-grid">
          {libraryTab === "all" && !search && !selectMode && (
            <button
              type="button"
              className="library-project-card library-project-new"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              <span className="library-new-icon">
                <Plus size={25} strokeWidth={1.8} />
              </span>
              <strong>进入创作</strong>
            </button>
          )}

          {visibleProjects.map((project) => {
            const isFav = favoriteIds.includes(project.id);
            const selected = selectedIds.includes(project.id);
            const coverSrc = resolveProjectCoverDisplayUrl(project.coverUrl);
            return (
              <article
                className={`library-project-card${selected ? " selected" : ""}`}
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (selectMode) {
                    toggleSelect(project.id);
                    return;
                  }
                  if (libraryTab === "trash") {
                    toast.message("请先恢复项目后再打开");
                    return;
                  }
                  router.push(`/${project.id}`);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (selectMode) {
                    toggleSelect(project.id);
                    return;
                  }
                  if (libraryTab !== "trash") router.push(`/${project.id}`);
                }}
              >
                {selectMode ? (
                  <button
                    type="button"
                    className={`library-select${selected ? " active" : ""}`}
                    aria-label={selected ? "取消选择" : "选择项目"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(project.id);
                    }}
                  >
                    {selected ? <CheckSquare size={15} strokeWidth={1.8} /> : <Square size={15} strokeWidth={1.8} />}
                  </button>
                ) : libraryTab !== "trash" ? (
                  <button
                    type="button"
                    className={`library-favorite${isFav ? " active" : ""}`}
                    aria-label={isFav ? "取消收藏" : "收藏项目"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(project.id);
                    }}
                  >
                    <Star size={15} strokeWidth={1.8} fill={isFav ? "currentColor" : "none"} />
                  </button>
                ) : null}

                {!selectMode ? (
                  <div className="library-card-actions">
                    {libraryTab === "trash" ? (
                      <>
                        <button
                          type="button"
                          title="恢复"
                          aria-label="恢复项目"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmRestore([project.id]);
                          }}
                        >
                          <RotateCcw size={14} strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          className="danger"
                          title="永久删除"
                          aria-label="永久删除项目"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmPurge([project.id]);
                          }}
                        >
                          <Trash2 size={14} strokeWidth={1.8} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="danger"
                        title="移入回收站"
                        aria-label="移入回收站"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmHide([project.id]);
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                ) : null}

                <div className="library-project-mark" aria-hidden="true">
                  {coverSrc ? <img src={coverSrc} alt="" /> : <Folder size={36} strokeWidth={1.4} />}
                </div>
                <div className="library-project-copy">
                  <strong>{project.title}</strong>
                  <span>
                    {libraryTab === "trash" ? "删除于 " : ""}
                    {formatRelative(project.updatedAt)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        {!isLoading && visibleProjects.length === 0 ? (
          <div className="projects-empty">
            <Folder size={34} strokeWidth={1.4} />
            <span>{libraryTab === "trash" ? "回收站为空" : "暂无相关项目"}</span>
          </div>
        ) : null}
      </section>
    </HuabuPublicShell>
  );
}
