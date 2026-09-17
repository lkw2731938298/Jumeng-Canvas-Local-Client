"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { useAuthStore } from "@/stores/authStore";
import {
  ChevronDown,
  FolderOpen,
  Home,
  Loader2,
  Play,
  Plus,
} from "lucide-react";
import { UserAccountMenu } from "@/components/user/UserAccountMenu";
import { formatPresenceLabel, useProjectPresence } from "@/lib/canvas/useProjectPresence";
import {
  createProject,
  listProjects,
} from "@/lib/api/projects";
import { withBasePath } from "@/lib/basePath";
import {
  countLikelyRunnableSelection,
  runSelectionBatch,
} from "@/lib/canvas/selectionBatchRun";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@/types";

/** 按更新时间取最近若干项目（排除当前） */
function pickRecentProjects(projects: Project[], currentId: string | null, limit = 8): Project[] {
  return [...projects]
    .filter((p) => p.id !== currentId)
    .sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    })
    .slice(0, limit);
}

export function CanvasHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    projectId,
    projectNo,
    projectName,
    projectRole,
    ownerDisplayName,
    isRunning,
    saveWorkflow,
    nodes,
    selectedFlowIds,
    selectedNodeId,
    batchRunProgress,
    requestCancelBatchRun,
  } = useCanvasStore();
  const isLoading = useCanvasStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);
  const displayName = user?.displayName ?? "本地用户";
  const isOwner = projectRole !== "editor";
  const isCollaborator = projectRole === "editor";
  const { peers } = useProjectPresence(projectId, Boolean(projectId) && !isLoading);
  const presenceLabel = formatPresenceLabel(peers);

  // 品牌菜单：最近项目列表（打开下拉时由 react-query 缓存复用）
  const projectsQuery = useQuery({
    queryKey: ["projects", user?.id],
    queryFn: listProjects,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
  const recentProjects = useMemo(
    () => pickRecentProjects(projectsQuery.data ?? [], projectId || null),
    [projectsQuery.data, projectId]
  );

  const createMutation = useMutation({
    mutationFn: () => createProject("未命名项目"),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void saveWorkflow();
      router.push(`/${project.id}`);
    },
    onError: () => toast.error("新建项目失败，请稍后重试"),
  });

  const leaveCanvas = (path: string) => {
    void saveWorkflow();
    router.push(path);
  };

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selectionIds = useMemo(() => {
    if (selectedFlowIds.length > 0) return selectedFlowIds;
    if (selectedNodeId) return [selectedNodeId];
    return [];
  }, [selectedFlowIds, selectedNodeId]);

  const runnableHint = useMemo(
    () => countLikelyRunnableSelection(selectionIds, nodes),
    [selectionIds, nodes]
  );

  const runLabel = useMemo(() => {
    if (isRunning && batchRunProgress) {
      const done =
        batchRunProgress.succeeded + batchRunProgress.failed + batchRunProgress.skipped;
      return `运行中 ${done}/${batchRunProgress.total}`;
    }
    if (isRunning) return "运行中...";
    if (runnableHint > 1) return `运行 (${runnableHint})`;
    return "运行";
  }, [isRunning, batchRunProgress, runnableHint]);

  const handleRunClick = () => {
    if (isRunning) {
      // 运行中再次点击：取消尚未提交的队列
      requestCancelBatchRun();
      return;
    }
    // 点击时从 store 取最新选中，避免闭包/框选连带选边导致的过期空列表
    const state = useCanvasStore.getState();
    const ids =
      state.selectedFlowIds.length > 0
        ? state.selectedFlowIds
        : state.selectedNodeId
          ? [state.selectedNodeId]
          : [];
    void runSelectionBatch({ selectedFlowIds: ids });
  };

  const startEdit = () => {
    if (!isOwner) return;
    setEditValue(projectName);
    setEditing(true);
  };

  const confirmEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== projectName) {
      useCanvasStore.setState({ projectName: trimmed });
      const { projectId: pid } = useCanvasStore.getState();
      if (pid) {
        import("@/lib/api/projects").then(({ updateProject }) => {
          updateProject(pid, { title: trimmed }).catch(() => {});
        });
      }
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  return (
    <>
      <div className="absolute left-0 right-0 top-0 z-30 flex h-14 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* 品牌下拉：新建 / 最近项目 / 回主页；离开前先保存工作流 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex shrink-0 items-center gap-1 text-lg font-bold text-foreground/90 transition-opacity hover:opacity-80 outline-none"
              aria-label="开源画布菜单"
            >
              <Image
                src={withBasePath("/brand-logo.png")}
                alt="开源画布"
                width={36}
                height={20}
                className="h-5 w-auto object-contain"
                priority
                unoptimized
              />
              <span className="text-primary">开源</span>
              <span>画布</span>
              <ChevronDown className="ml-0.5 h-4 w-4 text-muted-foreground/70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="min-w-[220px] border-border/60 bg-[var(--chrome-frost)] backdrop-blur-xl"
            >
              <DropdownMenuItem
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                className="gap-2"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                新建项目
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <FolderOpen className="h-4 w-4" />
                  打开最近项目
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[200px] max-w-[280px] border-border/60 bg-[var(--chrome-frost)] backdrop-blur-xl">
                  {projectsQuery.isLoading ? (
                    <DropdownMenuItem disabled className="gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      加载中…
                    </DropdownMenuItem>
                  ) : recentProjects.length === 0 ? (
                    <DropdownMenuItem disabled className="text-muted-foreground">
                      暂无其他项目
                    </DropdownMenuItem>
                  ) : (
                    recentProjects.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        className="max-w-[260px] truncate"
                        title={p.title || "未命名项目"}
                        onClick={() => leaveCanvas(`/${p.id}`)}
                      >
                        {p.title || "未命名项目"}
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2 text-muted-foreground"
                    onClick={() => leaveCanvas("/projects")}
                  >
                    查看全部项目…
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={() => leaveCanvas("/")}>
                <Home className="h-4 w-4" />
                回到主页
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-muted-foreground/40">/</span>
          {projectNo && <span className="shrink-0 font-mono text-xs text-muted-foreground/50">{projectNo}</span>}
          {projectNo && <span className="text-muted-foreground/40">/</span>}
          <div className="flex min-w-0 flex-col">
            {editing ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={confirmEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmEdit();
                  if (e.key === "Escape") cancelEdit();
                }}
                className="h-7 rounded-md border border-border bg-muted/40 px-2 text-sm text-foreground outline-none backdrop-blur-xl focus:border-primary/50"
                style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
              />
            ) : (
              <button
                onDoubleClick={startEdit}
                className="truncate text-left text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
                title={isOwner ? "双击编辑项目名称" : projectName}
              >
                {projectName || "未命名项目"}
              </button>
            )}
            {isCollaborator ? (
              <span className="truncate text-[10px] text-muted-foreground/70">
                协作项目 · 创建者 {ownerDisplayName || "—"}
              </span>
            ) : null}
            {presenceLabel ? (
              <span className="truncate text-[10px] text-primary/80">{presenceLabel}</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <UserAccountMenu displayName={displayName} variant="canvas" />

          <button
            type="button"
            onClick={handleRunClick}
            title={
              isRunning
                ? "点击取消尚未提交的节点"
                : runnableHint > 0
                  ? "按选中节点/组拓扑批量生成 (Ctrl+Enter)"
                  : "请先框选节点或选中一个组"
            }
            className="relative flex items-center gap-2 overflow-hidden rounded-xl bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-[0_4px_16px_rgba(139,92,246,0.3)] transition-all duration-200 before:absolute before:inset-0 before:-z-10 before:animate-[liquid-spin_8s_linear_infinite] before:rounded-xl before:bg-gradient-to-r before:from-purple-400/30 before:via-blue-400/30 before:to-cyan-400/30 before:blur-lg after:absolute after:inset-0 after:-z-10 after:animate-[liquid-spin_12s_linear_infinite_reverse] after:rounded-xl after:bg-gradient-to-r after:from-pink-400/20 after:via-purple-400/20 after:to-blue-400/20 after:blur-2xl hover:shadow-[0_6px_24px_rgba(139,92,246,0.4)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 backdrop-blur-xl"
            style={{ WebkitBackdropFilter: "blur(24px)" }}
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {runLabel}
          </button>
        </div>
      </div>
    </>
  );
}
