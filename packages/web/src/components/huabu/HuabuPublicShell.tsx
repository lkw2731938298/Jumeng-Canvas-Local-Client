"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  CircleHelp,
  LayoutGrid,
  ListChecks,
  Plus,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { JmBrandMark } from "@/components/brand/JmBrandMark";
import { CheckUpdateButton } from "./CheckUpdateButton";
import { UserAccountMenu } from "@/components/user/UserAccountMenu";
import { createProject } from "@/lib/api/projects";
import { useAuthStore } from "@/stores/authStore";
import type { Project } from "@/types";
import "./jmShell.css";

type HuabuPublicShellProps = {
  children: React.ReactNode;
  /** 左侧竖栏：仅项目页显示 */
  sidebar?: boolean;
  /** 页面标识，供样式区分（projects / jobs / settings） */
  page?: "projects" | "jobs" | "settings";
};

/** 用户头像首字：本地用户无头像，取显示名首字符 */
function avatarLetter(name: string) {
  return (name.trim()[0] || "本").toUpperCase();
}

/** 聚梦画布本地版公共外框：顶栏 + （项目页）左侧竖栏 + 光晕背景 */
export function HuabuPublicShell({ children, sidebar = false, page }: HuabuPublicShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const displayName = user?.displayName ?? "本地用户";

  const createMutation = useMutation({
    mutationFn: () => createProject("未命名项目"),
    onSuccess: (project: Project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/${project.id}`);
    },
    onError: () => toast.error("新建项目失败，请稍后重试"),
  });

  const railItems = [
    { key: "projects", icon: LayoutGrid, label: "项目", href: "/projects" },
    { key: "new", icon: Plus, label: "新建", href: null },
    { key: "jobs", icon: ListChecks, label: "任务", href: "/jobs" },
    { key: "settings", icon: Settings, label: "设置", href: "/settings" },
  ] as const;

  return (
    <div className="jm-shell" data-page={page}>
      {/* 背景光晕：外观「动态光晕」关闭时静止 */}
      <div className="jm-bg" aria-hidden="true">
        <span className="jm-glow jm-glow-a" />
        <span className="jm-glow jm-glow-b" />
        <span className="jm-glow jm-glow-c" />
      </div>

      <header className="jm-topbar">
        <Link className="jm-brand" href="/projects" aria-label="聚梦画布">
          <JmBrandMark />
          <span className="jm-brand-name">聚梦</span>
          <span className="jm-brand-rest">画布</span>
        </Link>

        <div className="jm-top-actions">
          <button
            className="jm-top-icon"
            type="button"
            aria-label="帮助"
            title="帮助"
            onClick={() => toast.message("请在本地设置中配置模型后开始创作")}
          >
            <CircleHelp size={17} strokeWidth={1.8} />
          </button>
          <span className="jm-top-divider" aria-hidden="true" />
          <CheckUpdateButton />
          <UserAccountMenu
            displayName={displayName}
            variant="projects"
            trigger={
              <span className="jm-top-user">
                <span className="jm-avatar">{avatarLetter(displayName)}</span>
                <span>{displayName}</span>
                <ChevronDown size={14} strokeWidth={1.8} className="jm-top-user-chevron" />
              </span>
            }
          />
        </div>
      </header>

      {sidebar ? (
        <aside className="jm-rail" aria-label="侧边导航">
          <nav className="jm-rail-nav">
            {railItems.map(({ key, icon: Icon, label, href }) => {
              const active = Boolean(href && pathname === href);
              const content = (
                <>
                  <span className="jm-rail-icon">
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  {!active ? <span className="jm-rail-label">{label}</span> : null}
                </>
              );
              if (href) {
                return (
                  <Link
                    key={key}
                    href={href}
                    className={active ? "jm-rail-item active" : "jm-rail-item"}
                    title={label}
                  >
                    {content}
                  </Link>
                );
              }
              return (
                <button
                  type="button"
                  key={key}
                  className="jm-rail-item"
                  title={label}
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                >
                  {content}
                </button>
              );
            })}
          </nav>
          <div className="jm-rail-foot">
            <UserAccountMenu
              displayName={displayName}
              variant="projects"
              menuPosition="side"
              trigger={<span className="jm-avatar jm-avatar-lg">{avatarLetter(displayName)}</span>}
            />
          </div>
        </aside>
      ) : null}

      <main className="jm-main">{children}</main>
    </div>
  );
}
