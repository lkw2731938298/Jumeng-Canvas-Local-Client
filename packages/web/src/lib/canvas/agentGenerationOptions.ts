/**
 * Agent 写入的 generationOptions 归一化（与后端 agent_generation_options 对齐）。
 * 避免 "4s"/数字 4 无法匹配选择器 id 而回落默认 5s。
 */

export type AgentGenerationOptions = Record<string, string>;

const LIFT_KEYS: Record<string, string> = {
  duration: "duration",
  durationSec: "duration",
  duration_sec: "duration",
  seconds: "duration",
  时长: "duration",
  aspectRatio: "aspectRatio",
  aspect_ratio: "aspectRatio",
  ratio: "aspectRatio",
  画幅: "aspectRatio",
  resolution: "resolution",
  clarity: "resolution",
  清晰度: "resolution",
  realPerson: "realPerson",
  真人: "realPerson",
};

function digits(value: unknown): string | null {
  const m = String(value ?? "").trim().match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.round(n));
}

function normRatio(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/\s/g, "")
    .replace(/x/g, ":");
}

function normOnOff(value: unknown): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  const s = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "开启", "开", "是"].includes(s)) return "on";
  if (["0", "false", "no", "off", "关闭", "关", "否"].includes(s)) return "off";
  return String(value ?? "").trim();
}

/** 归一 generationOptions 对象 */
export function normalizeAgentGenerationOptions(raw: unknown): AgentGenerationOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AgentGenerationOptions = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 32)) {
    if (v == null) continue;
    let key = String(k).trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (lower === "durationsec" || lower === "duration_sec" || key === "时长" || lower === "seconds") {
      key = "duration";
    } else if (lower === "aspect_ratio" || lower === "ratio" || key === "画幅") {
      key = "aspectRatio";
    } else if (lower === "clarity" || key === "清晰度" || lower === "res") {
      key = "resolution";
    }

    if (key === "duration") {
      const d = digits(v);
      if (d) out.duration = d;
      continue;
    }
    if (key === "aspectRatio") {
      // 双写：overlay 视频选择器 group id 多为 ratio
      const ratio = normRatio(v);
      out.aspectRatio = ratio;
      out.ratio = ratio;
      continue;
    }
    if (key === "resolution") {
      const d = digits(v);
      if (d) out.resolution = d;
      continue;
    }
    if (key === "realPerson" || key === "watermark") {
      out[key] = normOnOff(v);
      continue;
    }
    if (typeof v === "boolean") {
      out[key] = v ? "on" : "off";
    } else if (typeof v === "number") {
      out[key] = String(Number.isInteger(v) ? v : Math.round(v));
    } else if (typeof v === "string" && v.trim()) {
      out[key] = v.trim();
    }
  }
  return out;
}

/**
 * 把 update/add 的 params 里 generationOptions（及顶层误写时长）合并到节点。
 */
export function mergeAgentNodeParams(
  prevParams: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(prevParams ?? {}) };
  const lifted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "generationOptions") continue;
    if (k in LIFT_KEYS) {
      lifted[LIFT_KEYS[k]] = v;
      continue;
    }
    next[k] = v;
  }
  const prevGo =
    next.generationOptions && typeof next.generationOptions === "object" && !Array.isArray(next.generationOptions)
      ? normalizeAgentGenerationOptions(next.generationOptions)
      : {};
  const fromIncoming = normalizeAgentGenerationOptions(incoming.generationOptions);
  const fromLifted = normalizeAgentGenerationOptions(lifted);
  const merged = { ...prevGo, ...fromIncoming, ...fromLifted };
  if (Object.keys(merged).length > 0) {
    next.generationOptions = merged;
  }
  return next;
}
