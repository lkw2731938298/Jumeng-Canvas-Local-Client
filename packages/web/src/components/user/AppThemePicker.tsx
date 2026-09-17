"use client";

import { useState } from "react";
import { ChevronDown, Palette } from "lucide-react";
import { APP_THEMES, getAppThemeDefinition, type AppThemeDefinition, type AppThemeId } from "@/lib/theme/appThemes";
import { cn } from "@/lib/utils";

interface AppThemePickerProps {
  value: AppThemeId;
  onChange: (id: AppThemeId) => void;
  className?: string;
  itemClass?: string;
  labelClass?: string;
}

function ThemeSwatch({ theme, size = "sm" }: { theme: AppThemeDefinition; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span className={cn("flex shrink-0 overflow-hidden rounded-full border border-border", dim)}>
      <span className="h-full w-1/2" style={{ background: theme.preview.bg }} />
      <span className="h-full w-1/2" style={{ background: theme.preview.accent }} />
    </span>
  );
}

export function AppThemePicker({
  value,
  onChange,
  className,
  itemClass = "text-foreground/80 hover:bg-muted hover:text-foreground",
  labelClass = "text-muted-foreground",
}: AppThemePickerProps) {
  const [open, setOpen] = useState(false);
  const current = getAppThemeDefinition(value);

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
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
          itemClass
        )}
      >
        <Palette className={cn("h-4 w-4 shrink-0", labelClass)} />
        <span className="min-w-0 flex-1 text-left">全局主题</span>
        <ThemeSwatch theme={current} />
        <span className={cn("max-w-[4rem] truncate text-xs", labelClass)}>{current.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            labelClass,
            open && "rotate-180"
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-0.5 px-3 pb-2 pt-0.5">
            {APP_THEMES.map((theme) => {
              const active = theme.id === value;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => onChange(theme.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-muted/60"
                  )}
                >
                  <ThemeSwatch theme={theme} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-foreground">{theme.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {theme.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
