import {
  enrichShot,
  formatActLabel,
  newShotId,
  normalizeActNumber,
  summarizeText,
  type StoryboardShot,
} from "@/types/storyboard";

export type StoryboardParseFormat = "auto" | "shot_rows" | "markdown";

export interface ParseStoryboardResult {
  shots: StoryboardShot[];
  format: "shot_rows" | "markdown" | "empty";
  warnings: string[];
}

function tryParseJson(content: string): unknown | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function pickRowField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = row[key];
    if (val != null && String(val).trim()) return String(val).trim();
  }
  return "";
}

function mapShotRow(row: Record<string, unknown>, index: number): StoryboardShot {
  const actRaw = pickRowField(row, "幕", "第几幕", "act");
  const act = actRaw ? normalizeActNumber(actRaw) || actRaw : undefined;
  const scene = pickRowField(row, "场景", "scene");
  const actLabel = act ? formatActLabel(act) : "";
  const title =
    pickRowField(row, "标题", "镜头", "title") || actLabel || `镜头 ${index}`;
  const sceneScript = pickRowField(row, "剧本", "sceneScript");
  const scriptText = pickRowField(row, "镜头剧本", "分镜描述", "对白", "scriptText");
  const imagePromptGlobal = pickRowField(row, "图片提示词");
  const imagePrompt = pickRowField(row, "镜头图片提示词", "imagePrompt");
  const videoPromptGlobal = pickRowField(row, "视频提示词");
  const videoPrompt = pickRowField(row, "镜头视频提示词", "videoPrompt");
  const duration = pickRowField(row, "时长", "duration") || undefined;

  return enrichShot({
    id: newShotId(),
    index,
    act: act || undefined,
    scene: scene || undefined,
    title,
    sceneScript: sceneScript || undefined,
    scriptText,
    imagePromptGlobal: imagePromptGlobal || undefined,
    imagePrompt,
    videoPromptGlobal: videoPromptGlobal || undefined,
    videoPrompt,
    duration,
  });
}

function parseShotRowsJson(data: unknown): StoryboardShot[] {
  if (Array.isArray(data)) {
    return data
      .filter((r) => r && typeof r === "object")
      .map((r, i) => mapShotRow(r as Record<string, unknown>, i + 1));
  }
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const rows = obj.shotRows ?? obj.shots ?? obj.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r === "object")
    .map((r, i) => mapShotRow(r as Record<string, unknown>, i + 1));
}

function extractField(block: string, label: string): string {
  const re = new RegExp(
    `\\*\\*${label}\\*\\*[：:]\\s*([\\s\\S]*?)(?=\\n\\*\\*|\\n##|\\n---|$)`,
    "i"
  );
  const m = block.match(re);
  return m?.[1]?.trim() ?? "";
}

function parseActBlock(
  raw: string,
  act: string,
  title: string,
  index: number
): StoryboardShot {
  const time = extractField(raw, "时间");
  const place = extractField(raw, "地点");
  const characters = extractField(raw, "人物");
  const goal = extractField(raw, "剧情目标");
  const mood = extractField(raw, "情绪");
  const dialogue = extractField(raw, "对白");
  const action = extractField(raw, "动作");
  const sceneScript = extractField(raw, "剧本");

  const scriptParts = [dialogue, action].filter(Boolean);
  const scriptText =
    scriptParts.join("\n\n") || raw.replace(/\*\*[^*]+\*\*[：:][^\n]*/g, "").trim();

  return enrichShot({
    id: newShotId(),
    index,
    act: normalizeActNumber(act) || act,
    title,
    sceneScript: sceneScript || undefined,
    scriptText,
    imagePrompt: "",
    videoPrompt: "",
    sceneMeta: {
      time: time || undefined,
      place: place || undefined,
      characters: characters
        ? characters.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
        : undefined,
      goal: goal || undefined,
      mood: mood || undefined,
    },
  });
}

/** 按「第 N 幕 / ## 第 N 幕」分幕解析 */
function parseMarkdownActs(content: string): StoryboardShot[] {
  const re =
    /(?:^|\n)(?:#{1,2}\s*)?第\s*((?:[0-9]{1,4})|([零〇一二三四五六七八九十百千万两廿卅貮]+))\s*幕\s*(?:[：:]\s*([^\n]*))?\s*$/gim;
  const matches: { act: string; title: string; index: number; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const actToken = (m[1] || m[2] || "").trim();
    const act = normalizeActNumber(actToken) || actToken;
    const suffix = (m[3] || "").trim();
    const title = suffix || formatActLabel(act);
    matches.push({
      act,
      title,
      index: m.index,
      start: m.index + m[0].length,
      end: content.length,
    });
  }
  for (let i = 0; i < matches.length - 1; i++) {
    matches[i].end = matches[i + 1].index;
  }
  if (matches.length === 0) return [];

  return matches.map((seg, i) => {
    const body = content.slice(seg.start, seg.end).trim();
    return parseActBlock(body, seg.act, seg.title, i + 1);
  });
}

function parseCameraSection(content: string, shots: StoryboardShot[]): StoryboardShot[] {
  const sectionMatch = content.match(/#\s*分镜建议[\s\S]*/i);
  if (!sectionMatch) return shots;

  const section = sectionMatch[0];
  const re = /\*\*镜头\s*(\d+)\*\*/gi;
  const matches: { num: number; index: number; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) !== null) {
    matches.push({
      num: parseInt(m[1], 10),
      index: m.index,
      start: m.index + m[0].length,
      end: section.length,
    });
  }
  for (let i = 0; i < matches.length - 1; i++) {
    matches[i].end = matches[i + 1].index;
  }

  const out = [...shots];
  for (const cam of matches) {
    const block = section.slice(cam.start, cam.end).trim();
    const parts: string[] = [];
    for (const label of ["景别", "焦段", "运镜", "光线", "氛围", "动作"]) {
      const v = extractField(block, label);
      if (v) parts.push(`${label}：${v}`);
    }
    const cameraNotes = parts.join("\n");
    const imagePrompt = [
      extractField(block, "景别"),
      extractField(block, "光线"),
      extractField(block, "氛围"),
      extractField(block, "动作"),
    ]
      .filter(Boolean)
      .join("，");

    const existing = out.find((s) => s.index === cam.num);
    if (existing) {
      existing.cameraNotes = cameraNotes || existing.cameraNotes;
      if (imagePrompt && !existing.imagePrompt) {
        existing.imagePrompt = imagePrompt;
        existing.promptHint = summarizeText(imagePrompt, 40);
      }
    } else {
      out.push(
        enrichShot({
          id: newShotId(),
          index: cam.num,
          title: `镜头 ${cam.num}`,
          scriptText: "",
          imagePrompt,
          videoPrompt: "",
          cameraNotes,
        })
      );
    }
  }

  return out.sort((a, b) => a.index - b.index).map((s, i) => ({ ...s, index: i + 1 }));
}

export function mergeShotsPreservingIds(
  prev: StoryboardShot[],
  next: StoryboardShot[]
): StoryboardShot[] {
  const byIndex = new Map(prev.map((s) => [s.index, s]));
  return next.map((shot) => {
    const old = byIndex.get(shot.index);
    if (!old) return shot;
    return {
      ...shot,
      id: old.id,
      assetId: old.assetId,
      act: shot.act || old.act,
      sceneScript: shot.sceneScript || old.sceneScript,
      imagePromptGlobal: shot.imagePromptGlobal || old.imagePromptGlobal,
      imagePrompt: shot.imagePrompt || old.imagePrompt,
      videoPromptGlobal: shot.videoPromptGlobal || old.videoPromptGlobal,
      videoPrompt: shot.videoPrompt || old.videoPrompt,
    };
  });
}

export function parseStoryboardContent(
  content: string,
  format: StoryboardParseFormat = "auto"
): ParseStoryboardResult {
  const warnings: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) {
    return { shots: [], format: "empty", warnings: ["剧本文本为空"] };
  }

  if (format === "auto" || format === "shot_rows") {
    const json = tryParseJson(trimmed);
    if (json) {
      const fromRows = parseShotRowsJson(json);
      if (fromRows.length > 0) {
        return { shots: fromRows, format: "shot_rows", warnings };
      }
    }
    if (format === "shot_rows") {
      warnings.push("未识别到 shotRows JSON");
      return { shots: [], format: "shot_rows", warnings };
    }
  }

  let shots = parseMarkdownActs(trimmed);
  if (shots.length === 0) {
    warnings.push("未找到「第N幕」分幕标记，已将全文作为第 1 幕");
    shots = [
      enrichShot({
        id: newShotId(),
        index: 1,
        act: "1",
        title: "第 1 幕",
        scriptText: trimmed,
        imagePrompt: "",
        videoPrompt: "",
      }),
    ];
  }

  shots = parseCameraSection(trimmed, shots);
  return { shots, format: "markdown", warnings };
}
