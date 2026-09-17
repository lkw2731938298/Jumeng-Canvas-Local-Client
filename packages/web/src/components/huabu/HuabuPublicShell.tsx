"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleHelp,
  Folder,
  Plus,
  ScrollText,
  Smile,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { UserAccountMenu } from "@/components/user/UserAccountMenu";
import { createProject } from "@/lib/api/projects";
import { withBasePath } from "@/lib/basePath";
import { useAuthStore } from "@/stores/authStore";
import type { Project } from "@/types";
import "./huabuTheme.css";
import "./huabuTheme.tokens.css";

type HuabuPublicShellProps = {
  children: React.ReactNode;
};

const sideNavItems = [
  { icon: Folder, label: "项目", href: "/projects" },
  { icon: Plus, label: "新建", href: null },
  { icon: ScrollText, label: "任务", href: "/jobs" },
  { icon: Smile, label: "设置", href: "/settings" },
] as const;

/** 开源本地版公共外壳：无登录 / 无算力 / 无活动入口 */
export function HuabuPublicShell({ children }: HuabuPublicShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  const createMutation = useMutation({
    mutationFn: () => createProject("未命名项目"),
    onSuccess: (project: Project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/${project.id}`);
    },
    onError: () => toast.error("新建项目失败，请稍后重试"),
  });

  return (
    <div className="huabu-scope">
      <div className="app-shell">
        <div className="noise" aria-hidden="true" />

        <header className="topbar">
          <div className="topbar-actions">
            <button
              className="topbar-icon-btn"
              type="button"
              aria-label="帮助"
              title="帮助"
              onClick={() => toast.message("请在本地设置中配置模型后开始创作")}
            >
              <CircleHelp size={17} strokeWidth={1.7} />
            </button>

            <button
              className="topbar-store"
              type="button"
              onClick={() => router.push("/settings")}
            >
              <User size={15} strokeWidth={1.8} />
              <span>本地设置</span>
            </button>

            <div className="topbar-member">
              <UserAccountMenu
                displayName={user?.displayName ?? "本地用户"}
                variant="projects"
              />
            </div>
          </div>
        </header>

        <Link className="brand-logo" href="/projects" aria-label="开源画布">
          <Image
            src={withBasePath("/brand-logo.png")}
            alt="开源画布"
            width={36}
            height={20}
            className="brand-logo-img"
            priority
            unoptimized
          />
          <span className="brand-name brand-name-primary">开源</span>
          <span className="brand-name-rest">画布</span>
        </Link>

        <aside className="sidebar">
          <nav className="side-nav" aria-label="侧边导航">
            {sideNavItems.map(({ icon: Icon, label, href }) => {
              const active = Boolean(href && pathname === href);
              const content = (
                <>
                  <Icon size={22} strokeWidth={1.6} absoluteStrokeWidth />
                  <span>{label}</span>
                </>
              );
              if (href) {
                return (
                  <Link key={label} href={href} className={active ? "active" : undefined}>
                    {content}
                  </Link>
                );
              }
              return (
                <button
                  type="button"
                  key={label}
                  onClick={() => {
                    if (label === "新建") createMutation.mutate();
                    else toast.message("资产中心即将上线");
                  }}
                  disabled={label === "新建" && createMutation.isPending}
                >
                  {content}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="main-stage">{children}</main>
      </div>
    </div>
  );
}
