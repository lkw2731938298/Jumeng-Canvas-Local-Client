"use client";

import { useState } from "react";
import { Check, ChevronDown, Palette } from "lucide-react";
import { useAppTheme } from "@/components/providers/AppThemeProvider";
import { ACCENTS, THEME_MODES, accentColor } from "@/lib/theme/appThemes";
import { cn } from "@/lib/utils";

interface AppThemePickerProps {
  className?: string;
  itemClass?: string;
  labelClass?: string;
}

/** 用户菜单里的快捷外观切换：主题模式 + 强调色，选择后立即保存（完整外观见设置页） */
export function AppThemePicker({
  className,
  itemClass = "text-foreground/80 hover:bg-muted hover:text-foreground",
  labelClass = "text-muted-foreground",
}: AppThemePickerProps) {
  const [open, setOpen] = useState(false);
  const { savedAppearance, updateAppearance, theme } = useAppTheme();
  const modeLabel = THEME_MODES.find((m) => m.id === savedAppearance.mode)?.label ?? "深色";

  return (
    <div
      className={cn(className)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn("flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors", itemClass)}
      >
        <Palette className={cn("h-4 w-4 shrink-0", labelClass)} />
        <span className="min-w-0 flex-1 text-left">全局主题</span>
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
          style={{ background: theme.preview.accent }}
        />
        <span className={cn("max-w-[4rem] truncate text-xs", labelClass)}>{modeLabel}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform duration-200", labelClass, open && "rotate-180")}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 px-3 pb-2 pt-0.5">
            <div className="grid grid-cols-3 gap-1">
              {THEME_MODES.map((m) => {
                const active = m.id === savedAppearance.mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => updateAppearance({ mode: m.id })}
                    className={cn(
                      "rounded-md px-1.5 py-1 text-xs transition-colors",
                      active ? "bg-primary/15 text-foreground ring-1 ring-primary/40" : "text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between px-0.5">
              {ACCENTS.map((a) => {
                const active = a.id === savedAppearance.accent;
                return (
                  <button
                    key={a.id}
                    type="button"
                    title={a.label}
                    onClick={() => updateAppearance({ accent: a.id })}
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full transition-transform hover:scale-110",
                      active && "ring-2 ring-foreground/70 ring-offset-1 ring-offset-popover"
                    )}
                    style={{ background: accentColor(a.id, theme.isDark) }}
                  >
                    {active ? <Check className="h-3 w-3 text-white" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
