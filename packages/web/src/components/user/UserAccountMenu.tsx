"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Settings, User } from "lucide-react";
import { useAppTheme } from "@/components/providers/AppThemeProvider";
import { AppThemePicker } from "@/components/user/AppThemePicker";
import { GlobalWatermarkToggle } from "@/components/user/GlobalWatermarkToggle";

interface UserAccountMenuProps {
  displayName: string;
  onLogout?: () => void;
  variant?: "canvas" | "projects";
  /** 自定义触发器：传入时替换默认账户胶囊，保留 hover 下拉。 */
  trigger?: React.ReactNode;
}

/** 开源本地版账户菜单：仅设置 / 主题 / 水印 */
export function UserAccountMenu({
  displayName,
  variant = "canvas",
  trigger,
}: UserAccountMenuProps) {
  const router = useRouter();
  const { themeId, selectTheme } = useAppTheme();
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const showMenu = (menu: HTMLElement) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    menu.style.display = "block";
  };

  const hideMenu = (menu: HTMLElement) => {
    hideTimerRef.current = setTimeout(() => {
      menu.style.display = "none";
    }, 180);
  };

  const closeMenu = () => {
    if (menuRef.current) menuRef.current.style.display = "none";
  };

  const goSettings = () => {
    closeMenu();
    router.push("/settings");
  };

  const triggerClass =
    variant === "projects"
      ? "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
      : "border-border bg-[var(--chrome-frost)] text-muted-foreground hover:bg-muted/50";

  const menuClass = "border-border bg-popover/95 shadow-lg";
  const itemClass = "text-foreground/80 hover:bg-muted hover:text-foreground";
  const labelClass = "text-muted-foreground";
  const dividerClass = "border-border";

  return (
    <div
      className="relative"
      onMouseEnter={(e) => {
        showMenu(e.currentTarget.querySelector(".user-account-menu") as HTMLElement);
      }}
      onMouseLeave={(e) => {
        hideMenu(e.currentTarget.querySelector(".user-account-menu") as HTMLElement);
      }}
    >
      {trigger ? (
        <div
          role="button"
          tabIndex={0}
          onClick={goSettings}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              goSettings();
            }
          }}
          className="cursor-pointer"
        >
          {trigger}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={goSettings}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              goSettings();
            }
          }}
          className={`relative flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${triggerClass}`}
          style={{ backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
        >
          <User
            className={`h-3.5 w-3.5 ${variant === "projects" ? "text-white/50" : "text-muted-foreground"}`}
          />
          <span className={variant === "projects" ? "text-white/90" : "text-foreground"}>
            {displayName}
          </span>
        </div>
      )}

      <div
        ref={menuRef}
        className={`user-account-menu absolute right-0 top-full z-40 mt-0 w-56 rounded-xl border py-1 ${menuClass}`}
        style={{
          display: "none",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
        onMouseEnter={() => {
          if (hideTimerRef.current) {
            clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
          }
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.display = "none";
        }}
      >
        <button
          type="button"
          onClick={goSettings}
          className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${itemClass}`}
        >
          <Settings className="h-4 w-4" />
          本地设置
        </button>
        <div className={`my-1 border-t ${dividerClass}`} />
        <GlobalWatermarkToggle itemClass={itemClass} labelClass={labelClass} />
        <AppThemePicker
          value={themeId}
          onChange={selectTheme}
          itemClass={itemClass}
          labelClass={labelClass}
        />
      </div>
    </div>
  );
}
