import { getPromptToolConfig } from "@/lib/api/promptConfig";
import { SKETCH_STYLE_ANCHOR, STORYBOARD_SKETCH_PROMPT_TOOL } from "@/types/storyboard-table";

let cachedStyle: string | null = null;

/** Load storyboard sketch style anchor from admin prompt-config (storyboard_sketch). */
export async function resolveStoryboardSketchStyle(): Promise<string> {
  if (cachedStyle) return cachedStyle;
  try {
    const res = await getPromptToolConfig(STORYBOARD_SKETCH_PROMPT_TOOL);
    if (res.config.kind === "append") {
      const text = res.config.appendText?.trim();
      if (text) {
        cachedStyle = text;
        return text;
      }
    }
  } catch {
    /* fallback */
  }
  return SKETCH_STYLE_ANCHOR;
}

export function invalidateStoryboardSketchStyleCache(): void {
  cachedStyle = null;
}
