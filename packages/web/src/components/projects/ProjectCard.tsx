"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { Project } from "@/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Folder,
  ImageIcon,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { uploadProjectCover } from "@/lib/api/projects";
import { resolveProjectCoverDisplayUrl } from "@/lib/api/storageUrl";

interface ProjectCardProps {
  project: Project;
  readonly?: boolean;
  favorited?: boolean;
  onClick: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onLeave?: () => void;
  onCoverChange: (project: Project) => void;
  onToggleFavorite?: () => void;
}

function coverSrc(coverUrl: string | undefined, revision: number): string | null {
  // 预签名 OSS URL 不能追加 &v=（会破坏 Signature）；相对代理路径才做缓存破坏
  return resolveProjectCoverDisplayUrl(coverUrl, revision);
}

export function ProjectCard({
  project,
  readonly = false,
  favorited = false,
  onClick,
  onRename,
  onDelete,
  onLeave,
  onCoverChange,
  onToggleFavorite,
}: ProjectCardProps) {
  const [showRename, setShowRename] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverProject, setCoverProject] = useState(project);
  const [coverRevision, setCoverRevision] = useState(0);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCoverProject(project);
  }, [project.id, project.title, project.projectNo, project.workflowCount, project.updatedAt, project.coverUrl]);

  useEffect(() => {
    if (showRename) {
      setTitle(project.title);
      setTimeout(() => renameInputRef.current?.select(), 50);
    }
  }, [showRename, project.title]);

  const scheduleCoverPicker = useCallback(() => {
    // 等下拉/右键菜单关闭后再打开文件选择，避免菜单重置打断
    window.setTimeout(() => {
      coverInputRef.current?.click();
    }, 0);
  }, []);

  const handleRename = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== project.title) onRename(trimmed);
    setShowRename(false);
  };

  const handleDelete = () => {
    onDelete();
    setShowDelete(false);
  };

  const handleCoverFile = async (file: File) => {
    setUploadingCover(true);
    try {
      const updatedProject = await uploadProjectCover(project.id, file);
      setCoverProject((prev) => ({
        ...prev,
        coverUrl: updatedProject.coverUrl,
      }));
      setCoverRevision((n) => n + 1);
      onCoverChange({ ...project, coverUrl: updatedProject.coverUrl });
      toast.success("封面已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "封面上传失败");
    } finally {
      setUploadingCover(false);
    }
  };

  const updated = formatDate(project.updatedAt);
  const coverImageSrc = coverSrc(coverProject.coverUrl, coverRevision);

  return (
    <>
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
        }}
      />

      <ContextMenu>
        <ContextMenuTrigger
          onClick={onClick}
          className="group relative min-w-0 cursor-pointer overflow-hidden rounded-[12px] border border-white/[0.085] text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(183,154,255,0.26)]"
          style={{
            aspectRatio: "1.58 / 1",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012)), #0d0b11",
          }}
        >
          {/* 封面或文件夹水印 */}
          <div className="absolute inset-0" aria-hidden="true">
            {coverImageSrc ? (
              <img
                src={coverImageSrc}
                alt=""
                className="h-full w-full object-cover opacity-80"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-white/[0.025] scale-[1.8]">
                <Folder className="h-9 w-9" strokeWidth={1.4} />
              </div>
            )}
            {coverImageSrc ? (
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            ) : null}
          </div>

          {/* 收藏 + 更多操作 */}
          <div className="absolute right-[9px] top-[9px] z-20 flex flex-row-reverse items-center gap-1.5">
            {onToggleFavorite ? (
              <button
                type="button"
                aria-label={favorited ? "取消收藏" : "收藏项目"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                className={`grid h-7 w-7 place-items-center rounded-lg border border-white/[0.08] bg-[rgba(9,8,12,0.72)] transition-all duration-180 ${
                  favorited
                    ? "text-[#b79aff] opacity-100"
                    : "text-[#777080] opacity-0 translate-y-[-3px] group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100 focus-visible:translate-y-0"
                }`}
              >
                <Star
                  className="h-[15px] w-[15px]"
                  strokeWidth={1.8}
                  fill={favorited ? "currentColor" : "none"}
                />
              </button>
            ) : null}

            {(readonly ? onLeave : true) ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-white/[0.08] bg-[rgba(9,8,12,0.72)] text-[#777080] opacity-0 translate-y-[-3px] transition-all duration-180 hover:text-[#e5dcf2] group-hover:opacity-100 group-hover:translate-y-0 data-open:opacity-100 data-open:translate-y-0"
                  aria-label={readonly ? "协作项目操作" : "项目操作"}
                >
                  {!readonly && uploadingCover ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="z-[200] min-w-[126px] border-white/10 bg-[rgba(18,15,25,0.98)] p-1 text-[#bdb5c8] shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {readonly ? (
                    <DropdownMenuItem
                      className="h-[34px] gap-2 rounded-[7px] text-xs focus:bg-white/[0.06] focus:text-[#f0eaf7]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowLeave(true);
                      }}
                    >
                      <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
                      离开协作
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem
                        className="h-[34px] gap-2 rounded-[7px] text-xs focus:bg-white/[0.06] focus:text-[#f0eaf7]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowRename(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="h-[34px] gap-2 rounded-[7px] text-xs focus:bg-white/[0.06] focus:text-[#f0eaf7]"
                        onClick={(e) => {
                          e.stopPropagation();
                          scheduleCoverPicker();
                        }}
                      >
                        <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
                        上传封面
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="h-[34px] gap-2 rounded-[7px] text-xs text-[#d88794] focus:bg-[rgba(208,75,94,0.1)] focus:text-[#f2a3af]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDelete(true);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        删除项目
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {/* huabu library-project-copy：卡片只展示项目名称与更新时间 */}
          <div className="absolute inset-x-[13px] bottom-3 z-10 flex flex-col gap-[5px]">
            <strong className="truncate text-xs font-semibold leading-[1.35] text-[#eeeaf3]">
              {project.title}
            </strong>
            <span className="text-[10px] text-[#625c68]">{updated}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-36">
          {!readonly ? (
            <>
              <ContextMenuItem onClick={() => setShowRename(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                重命名
              </ContextMenuItem>
              <ContextMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  scheduleCoverPicker();
                }}
              >
                <ImageIcon className="mr-2 h-4 w-4" />
                上传封面
              </ContextMenuItem>
              <ContextMenuItem onClick={() => setShowDelete(true)} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </ContextMenuItem>
            </>
          ) : onLeave ? (
            <ContextMenuItem onClick={() => setShowLeave(true)}>
              <LogOut className="mr-2 h-4 w-4" />
              离开协作
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={showRename} onOpenChange={setShowRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
          </DialogHeader>
          <Input
            ref={renameInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRename(false)}>
              取消
            </Button>
            <Button onClick={handleRename}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除 &ldquo;{project.title}&rdquo; 吗？将永久清除该项目下的工作流、素材、节点文本、导演场景及本地存储文件，此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showLeave} onOpenChange={setShowLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>离开协作</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要离开「{project.title}」的协作吗？离开后需重新邀请才能访问。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeave(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                onLeave?.();
                setShowLeave(false);
              }}
            >
              离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return d.toLocaleDateString("zh-CN");
}
