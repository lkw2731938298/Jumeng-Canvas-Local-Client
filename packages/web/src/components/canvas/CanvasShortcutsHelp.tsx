"use client";

import { useEffect, useMemo } from "react";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ShortcutRow = {
  label: string;
  keys: string[];
  /** 可选说明（如拖拽类） */
  note?: string;
};

type ShortcutSection = {
  title: string;
  rows: ShortcutRow[];
};

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function buildSections(mac: boolean): ShortcutSection[] {
  const mod = mac ? "⌘" : "Ctrl";
  const alt = mac ? "⌥" : "Alt";
  const shift = mac ? "⇧" : "Shift";
  return [
    {
      title: "编辑",
      rows: [
        { label: "撤销", keys: [mod, "Z"] },
        {
          label: "重做",
          keys: mac ? [shift, mod, "Z"] : [mod, shift, "Z"],
        },
        ...(mac ? [] : [{ label: "重做", keys: [mod, "Y"], note: "备选" }]),
        { label: "删除", keys: ["Backspace"] },
        { label: "复制", keys: [mod, "C"] },
        { label: "粘贴", keys: [mod, "V"] },
        { label: "全选", keys: [mod, "A"] },
        { label: "保存", keys: [mod, "S"] },
      ],
    },
    {
      title: "创作",
      rows: [
        { label: "成组", keys: [mod, "G"] },
        { label: "成组", keys: [alt, "G"] },
        { label: "合并分镜组", keys: [mod, alt, "G"] },
        { label: "解组", keys: [mod, shift, "G"] },
        { label: "连线", keys: [mod, "L"] },
        { label: "复制节点和连线", keys: [mod, "D"] },
        { label: "生成", keys: [mod, "Enter"] },
        { label: "新建节点", keys: ["Tab"] },
        { label: "节点复制", keys: [alt, "拖动"], note: "拖动时按住 Alt" },
        {
          label: "创建副本（含连线）",
          keys: [mod, alt, "拖动"],
          note: "拖动时按住",
        },
      ],
    },
    {
      title: "视图",
      rows: [
        { label: "适应画布", keys: [mod, "0"] },
        { label: "切换指针/拖拽", keys: [mod, "Space"] },
        { label: "取消选中/关闭", keys: ["Esc"] },
      ],
    },
  ];
}

function KeyChip({ label }: { label: string }) {
  const isBackspace = label === "Backspace";
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-white/12 bg-white/[0.06] px-1.5 text-[11px] font-medium text-white/75",
        isBackspace && "min-w-[2.25rem]"
      )}
    >
      {isBackspace ? "⌫" : label}
    </kbd>
  );
}

interface CanvasShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

/** 画布快捷键帮助面板：编辑 / 创作 / 视图 */
export function CanvasShortcutsHelp({ open, onClose }: CanvasShortcutsHelpProps) {
  const mac = useMemo(() => isMac(), []);
  const sections = useMemo(() => buildSections(mac), [mac]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[88] bg-black/40" onMouseDown={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="快捷键"
        className="fixed bottom-20 right-4 z-[89] w-[min(360px,calc(100vw-2rem))] max-h-[min(70vh,560px)] overflow-y-auto rounded-2xl border border-white/12 bg-[rgba(28,28,34,0.97)] p-4 shadow-2xl backdrop-blur-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-white/90">
            <Keyboard className="h-4 w-4 text-violet-300" />
            快捷键
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                {section.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {section.rows.map((row, idx) => (
                  <li
                    key={`${section.title}-${row.label}-${idx}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-1 py-1"
                  >
                    <span className="min-w-0 text-[13px] text-white/75">
                      {row.label}
                      {row.note ? (
                        <span className="ml-1 text-[11px] text-white/35">({row.note})</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <span key={`${k}-${i}`} className="flex items-center gap-1">
                          {i > 0 ? <span className="text-[11px] text-white/30">+</span> : null}
                          <KeyChip label={k} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
