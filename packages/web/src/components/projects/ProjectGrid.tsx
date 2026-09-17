"use client";

import type { Project } from "@/types";
import { ProjectCard } from "./ProjectCard";
import { Folder, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type ProjectLibraryTab = "all" | "favorites";

interface ProjectGridProps {
  projects: Project[];
  readonly?: boolean;
  showCreateCard?: boolean;
  scope: "owned" | "shared";
  onScopeChange: (scope: "owned" | "shared") => void;
  sharedCount?: number;
  libraryTab: ProjectLibraryTab;
  onLibraryTabChange: (tab: ProjectLibraryTab) => void;
  search: string;
  onSearchChange: (value: string) => void;
  favoriteIds: string[];
  onToggleFavorite: (projectId: string) => void;
  onClick: (project: Project) => void;
  onRename: (project: Project, title: string) => void;
  onDelete: (project: Project) => void;
  onLeave?: (project: Project) => void;
  onCoverChange: (project: Project) => void;
  onCreateNew: () => void;
}

const LIBRARY_TABS: { id: ProjectLibraryTab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "favorites", label: "我的收藏" },
];

export function ProjectGrid({
  projects,
  readonly = false,
  showCreateCard = true,
  scope,
  onScopeChange,
  sharedCount = 0,
  libraryTab,
  onLibraryTabChange,
  search,
  onSearchChange,
  favoriteIds,
  onToggleFavorite,
  onClick,
  onRename,
  onDelete,
  onLeave,
  onCoverChange,
  onCreateNew,
}: ProjectGridProps) {
  // 仅自有项目的「全部」且无搜索时展示进入创作卡，与 huabu 一致
  const showCreate =
    scope === "owned" && showCreateCard && libraryTab === "all" && !search.trim();
  const empty = projects.length === 0 && !showCreate;

  return (
    <div className="w-full">
      {/* 完整复刻 huabu projects-toolbar，协作作为本系统扩展筛选项 */}
      <div className="mb-[18px] flex w-full flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-[7px]" role="tablist" aria-label="项目筛选">
          {LIBRARY_TABS.map((item) => (
            <button
              type="button"
              key={item.id}
              role="tab"
              aria-selected={scope === "owned" && libraryTab === item.id}
              onClick={() => {
                onScopeChange("owned");
                onLibraryTabChange(item.id);
              }}
              className={`h-8 rounded-full px-[15px] text-xs transition-colors ${
                scope === "owned" && libraryTab === item.id
                  ? "bg-white/[0.13] text-white"
                  : "bg-transparent text-[#777080] hover:text-[#d4cddc]"
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={scope === "shared"}
            onClick={() => {
              onScopeChange("shared");
              onLibraryTabChange("all");
            }}
            className={`h-8 rounded-full px-[15px] text-xs transition-colors ${
              scope === "shared"
                ? "bg-white/[0.13] text-white"
                : "bg-transparent text-[#777080] hover:text-[#d4cddc]"
            }`}
          >
            与我协作
            {sharedCount > 0 ? <span className="ml-1 text-[10px]">({sharedCount})</span> : null}
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <label className="flex h-[34px] w-full min-w-0 flex-1 items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.055] px-[11px] text-[#777080] focus-within:border-[rgba(183,154,255,0.3)] sm:w-[180px] sm:flex-none">
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索项目"
              aria-label="搜索项目"
              className="min-w-0 flex-1 bg-transparent text-xs text-[#eee9f4] outline-none placeholder:text-[#696271]"
            />
            <Search className="h-[15px] w-[15px] shrink-0" strokeWidth={1.8} />
          </label>
          <button
            type="button"
            onClick={() => toast.message("回收站功能即将上线")}
            className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-white/[0.09] bg-transparent px-[13px] text-xs text-[#8d8595] transition-colors hover:border-white/[0.18] hover:text-[#d9d2e1]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            回收站
          </button>
        </div>
      </div>

      {empty ? (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-[13px] text-[#625c68]">
          <Folder className="h-[34px] w-[34px]" strokeWidth={1.4} />
          <span>暂无相关项目</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-[18px] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {showCreate ? (
            <button
              type="button"
              onClick={onCreateNew}
              className="flex flex-col items-center justify-center gap-2.5 rounded-[12px] border border-dashed border-white/[0.085] text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(183,154,255,0.26)]"
              style={{
                aspectRatio: "1.58 / 1",
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.012)), #0d0b11",
              }}
            >
              <Plus className="h-[25px] w-[25px]" strokeWidth={1.8} />
              <strong className="text-[13px] font-semibold">进入创作</strong>
            </button>
          ) : null}

          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              readonly={readonly}
              favorited={favoriteIds.includes(project.id)}
              onClick={() => onClick(project)}
              onRename={(title) => onRename(project, title)}
              onDelete={() => onDelete(project)}
              onLeave={onLeave ? () => onLeave(project) : undefined}
              onCoverChange={onCoverChange}
              onToggleFavorite={() => onToggleFavorite(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
