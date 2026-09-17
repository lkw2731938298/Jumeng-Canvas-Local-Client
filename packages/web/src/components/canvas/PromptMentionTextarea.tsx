"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import {
  getAtomicMentionDeleteRange,
  tokenizePromptMentions,
} from "@/lib/canvas/nodeMaterialSlots";

const SHARED_FIELD_CLASS =
  "block w-full min-h-[110px] border-0 border-b border-white/10 px-4 py-3 text-sm leading-5 whitespace-pre-wrap break-words";

// 需要从 textarea 复制到镜像层的排版属性：逐字符位置必须完全一致，否则光标错位
const COPIED_STYLE_PROPS = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textIndent",
  "textTransform",
  "textRendering",
  "tabSize",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "wordWrap",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
] as const;

// SSR 环境下 useLayoutEffect 会告警，降级为 useEffect
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface PromptMentionTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  knownLabels: string[];
  onValueChange: (value: string, cursorPos: number) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * 提示词输入：底层仍是纯文本 `@label `；展示层把已识别参考标成 chip，
 * Backspace/Delete 一次删掉整段 @ 参考。提交序列化不变。
 *
 * 关键：镜像层（高亮）与 textarea（真实光标）必须逐字符对齐，否则光标定位不准、
 * 删除会误删相邻字符。因此运行时把 textarea 的计算样式复制到镜像层，并预留竖向
 * 滚动条宽度，保证两层换行与字符步进完全一致。
 */
export function PromptMentionTextarea({
  value,
  knownLabels,
  onValueChange,
  textareaRef: externalRef,
  onKeyDown,
  placeholder,
  className,
  ...rest
}: PromptMentionTextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (externalRef) {
        (externalRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      }
    },
    [externalRef]
  );

  const tokens = useMemo(
    () => tokenizePromptMentions(value, knownLabels),
    [value, knownLabels]
  );

  // 将 textarea 的排版样式与滚动位置同步到镜像层，确保逐字符对齐
  const syncMirror = useCallback(() => {
    const ta = innerRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    const cs = getComputedStyle(ta);
    const style = mirror.style as unknown as Record<string, string>;
    const computed = cs as unknown as Record<string, string>;
    for (const prop of COPIED_STYLE_PROPS) {
      const v = computed[prop];
      if (v) style[prop] = v;
    }
    // 预留 textarea 竖向滚动条宽度（Windows 经典滚动条约 17px），
    // 否则镜像可用宽度更大，换行点与 textarea 不一致，导致光标错位。
    const scrollbarW = Math.max(0, ta.offsetWidth - ta.clientWidth);
    const basePadRight = parseFloat(cs.paddingRight) || 0;
    mirror.style.paddingRight = `${basePadRight + scrollbarW}px`;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, []);

  // 内容变化后同步（可能导致滚动条出现/消失、换行改变）
  useIsomorphicLayoutEffect(() => {
    syncMirror();
  }, [value, syncMirror]);

  // textarea 拖拽 resize / 容器尺寸变化时同步
  useEffect(() => {
    const ta = innerRef.current;
    if (!ta || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncMirror());
    ro.observe(ta);
    return () => ro.disconnect();
  }, [syncMirror]);

  // 原生监听拦冒泡：React 合成事件的 stopPropagation 不一定能挡住 document 上的画布快捷键
  useEffect(() => {
    const ta = innerRef.current;
    if (!ta) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      e.stopPropagation();
    };
    ta.addEventListener("keydown", onKeyDown);
    return () => ta.removeEventListener("keydown", onKeyDown);
  }, []);

  const tryAtomicDelete = useCallback(
    (direction: "backward" | "forward"): boolean => {
      const ta = innerRef.current;
      if (!ta) return false;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      // 有选区时交还给默认行为
      if (start !== end) return false;

      const range = getAtomicMentionDeleteRange(value, start, direction, knownLabels);
      if (!range) return false;

      const next = value.slice(0, range.start) + value.slice(range.end);
      onValueChange(next, range.start);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(range.start, range.start);
        syncMirror();
      });
      return true;
    },
    [value, knownLabels, onValueChange, syncMirror]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // 不 preventDefault：保留输入框原生撤销/重做；只挡住冒泡，避免画布 Ctrl+Z 一起撤
      if (mod && (key === "z" || key === "y")) {
        e.stopPropagation();
      }

      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      if (e.key === "Backspace" && tryAtomicDelete("backward")) {
        e.preventDefault();
        return;
      }
      if (e.key === "Delete" && tryAtomicDelete("forward")) {
        e.preventDefault();
      }
    },
    [onKeyDown, tryAtomicDelete]
  );

  return (
    <div className="relative" data-canvas-typing>
      {/* 高亮镜像：运行时复制 textarea 排版样式，仅展示 @ 参考 chip */}
      <div
        ref={mirrorRef}
        aria-hidden
        className={`${SHARED_FIELD_CLASS} pointer-events-none absolute inset-0 z-0 overflow-hidden text-white/85 ${className ?? ""}`}
      >
        {value ? (
          tokens.map((token, index) =>
            token.kind === "mention" ? (
              <span
                key={`m-${index}-${token.label}`}
                // 不加 padding/margin，避免与透明 textarea 字符位置错位
                className="rounded-[3px] bg-violet-500/35 text-violet-100"
              >
                {token.text}
              </span>
            ) : (
              <span key={`t-${index}`}>{token.text}</span>
            )
          )
        ) : (
          <span className="text-white/25">{placeholder}</span>
        )}
      </div>
      <textarea
        {...rest}
        ref={setRefs}
        value={value}
        placeholder=""
        onScroll={syncMirror}
        onChange={(e) => onValueChange(e.target.value, e.target.selectionStart)}
        onKeyDown={handleKeyDown}
        className={`${SHARED_FIELD_CLASS} relative z-10 resize-y overflow-auto bg-transparent text-transparent caret-white outline-none selection:bg-violet-500/35 ${className ?? ""}`}
      />
    </div>
  );
}
