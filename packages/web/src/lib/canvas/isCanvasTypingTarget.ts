/** 输入控件 / 可编辑区域：画布快捷键（含 Ctrl+Z）必须让路 */
const TYPING_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  "[data-slot='select-trigger']",
  "[data-slot='input']",
  "[data-canvas-typing]",
].join(", ");

function matchesTypingSurface(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest(TYPING_SELECTOR));
}

/**
 * 判断键盘事件是否发生在可输入控件内（快捷键应让路）。
 * 同时看 event.target、composedPath、当前 focus，避免提示词框内 Ctrl+Z 误撤画布。
 */
export function isCanvasTypingTarget(source: Event | EventTarget | null): boolean {
  const candidates: EventTarget[] = [];
  if (source instanceof Event) {
    if (typeof source.composedPath === "function") {
      candidates.push(...source.composedPath());
    }
    if (source.target) candidates.push(source.target);
  } else if (source) {
    candidates.push(source);
  }
  if (typeof document !== "undefined" && document.activeElement) {
    candidates.push(document.activeElement);
  }
  return candidates.some((node) => matchesTypingSurface(node));
}
