/** Dark-theme select styles for canvas node overlays (portaled menus need high z-index). */
export const CANVAS_SELECT_TRIGGER_CLASS =
  "h-8 min-w-[96px] border-white/10 bg-[#1a1a28] px-2 text-[13px] text-white/75 hover:border-white/20 hover:bg-[#222233] data-[size=default]:h-8";

/** Model picker trigger — icon + label + chevron tight together (screenshot style). */
export const MODEL_SELECT_TRIGGER_CLASS =
  "h-8 !w-fit max-w-full justify-start gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-0 text-[14px] font-semibold tracking-wide text-white shadow-none hover:bg-white/[0.06] focus-visible:border-transparent focus-visible:ring-0 data-[size=default]:h-8 dark:bg-transparent dark:hover:bg-white/[0.06] *:data-[slot=select-value]:flex-none [&_svg:last-child]:ml-0 [&_svg:last-child]:size-3.5 [&_svg:last-child]:shrink-0 [&_svg:last-child]:text-white/45";

export const CANVAS_SELECT_CONTENT_CLASS =
  "z-[2000] max-h-60 border-white/10 bg-[#1a1a28] text-white/85 shadow-xl ring-white/10";

/** Model list: hug trigger, full label width, no scroll-arrow chrome. */
export const MODEL_SELECT_CONTENT_CLASS =
  "z-[2000] max-h-[min(320px,var(--available-height))] !w-max min-w-[var(--anchor-width)] max-w-[min(420px,calc(100vw-24px))] border-white/10 bg-[#1a1a28] p-1 text-white/85 shadow-xl ring-white/10 [&_[data-slot=select-scroll-up-button]]:hidden [&_[data-slot=select-scroll-down-button]]:hidden";

export const CANVAS_SELECT_ITEM_CLASS =
  "text-[13px] text-white/80 focus:bg-purple-500/20 focus:text-white data-highlighted:bg-purple-500/20 data-highlighted:text-white";

export const MODEL_SELECT_ITEM_CLASS =
  "cursor-pointer items-start rounded-md py-2 pr-8 pl-2.5 text-[13px] text-white/85 focus:bg-purple-500/20 focus:text-white data-highlighted:bg-purple-500/20 data-highlighted:text-white";
