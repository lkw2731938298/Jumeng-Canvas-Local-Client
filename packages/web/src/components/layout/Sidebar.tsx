"use client";

import { useRouter, usePathname } from "next/navigation";
import { FolderOpen, ListTodo, Settings } from "lucide-react";
import { isLocalDesktop } from "@/lib/localDesktop";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const projectsActive = pathname.startsWith("/projects");
  const settingsActive = pathname.startsWith("/settings");
  const jobsActive = pathname.startsWith("/jobs");

  return (
    <aside className="fixed left-0 top-14 bottom-0 z-30 flex w-16 flex-col items-center gap-2 border-r border-border bg-background/60 py-4 backdrop-blur-xl">
      <button
        onClick={() => router.push("/projects")}
        title="我的项目"
        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
          projectsActive
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <FolderOpen className="h-5 w-5" />
      </button>
      {isLocalDesktop && (
        <>
          <button
            onClick={() => router.push("/jobs")}
            title="生成任务"
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              jobsActive
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <ListTodo className="h-5 w-5" />
          </button>
          <button
            onClick={() => router.push("/settings")}
            title="本地设置"
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              settingsActive
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Settings className="h-5 w-5" />
          </button>
        </>
      )}
    </aside>
  );
}
