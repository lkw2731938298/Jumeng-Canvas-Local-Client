/**
 * 解析爆款拉片 LLM 输出：分镜行 + 主体 + 风格摘要。
 * 复用现有分镜表 / 主体 JSON 解析，并附带 styleSummary / replacePlan。
 */

import { parseStoryboardSubjectsContent } from "@/lib/canvas/parseStoryboardSubjects";
import { parseStoryboardTableContent } from "@/lib/canvas/parseStoryboardTable";
import type { StoryboardTableRow } from "@/types/storyboard-table";
import type { StoryboardSubjectsBundle } from "@/types/storyboard-subjects";
import type { ViralRemakeShotFrame } from "@/lib/api/viralRemake";
import {
  computeSketchSourceHash,
  enrichTableRow,
  newTableRowId,
} from "@/types/storyboard-table";

export type ViralRemakeParseResult = {
  rows: StoryboardTableRow[];
  subjects: StoryboardSubjectsBundle;
  styleSummary: string;
  replacePlan: string;
  warnings: string[];
};

function tryPickMeta(content: string): { styleSummary: string; replacePlan: string } {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return { styleSummary: "", replacePlan: "" };
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    // 一键出海输出 localePlan；爆款复刻输出 replacePlan——统一落到 replacePlan 供成片链路复用
    const replacePlan = String(
      obj.replacePlan ?? obj.localePlan ?? obj["替换方案"] ?? obj["本地化方案"] ?? ""
    ).trim();
    return {
      styleSummary: String(obj.styleSummary ?? obj["风格摘要"] ?? "").trim(),
      replacePlan,
    };
  } catch {
    return { styleSummary: "", replacePlan: "" };
  }
}

/** 将切镜关键帧挂到分镜行（按序对齐，多退少补） */
export function mergeKeyframeAssetsIntoRows(
  rows: StoryboardTableRow[],
  frames: ViralRemakeShotFrame[]
): StoryboardTableRow[] {
  if (frames.length === 0) return rows;

  const byIndex = new Map(frames.map((f) => [f.index, f]));
  return rows.map((row, i) => {
    const frame = byIndex.get(row.index) ?? frames[i];
    if (!frame) return row;
    const duration =
      typeof frame.durationSec === "number" && frame.durationSec > 0
        ? `${Number(frame.durationSec.toFixed(1))}s`
        : frame.durationLabel || row.duration;
    const next = enrichTableRow({
      ...row,
      duration,
      sketchAssetId: frame.assetId,
      clipAssetId: frame.clipAssetId || row.clipAssetId,
      sketchStatus: "succeeded",
      sketchSourceHash: computeSketchSourceHash(row),
    });
    return next;
  });
}

/** 若 LLM 行数与关键帧不一致：以关键帧为底，用 LLM 描述填充 */
export function alignRowsWithKeyframes(
  rows: StoryboardTableRow[],
  frames: ViralRemakeShotFrame[]
): StoryboardTableRow[] {
  if (frames.length === 0) return rows;
  if (rows.length === 0) {
    return frames.map((f) =>
      enrichTableRow({
        id: newTableRowId(),
        index: f.index,
        shotNo: String(f.index),
        duration:
          typeof f.durationSec === "number" && f.durationSec > 0
            ? `${Number(f.durationSec.toFixed(1))}s`
            : f.durationLabel,
        description: `镜头 ${f.index}（待补充画面描述）`,
        sketchAssetId: f.assetId,
        clipAssetId: f.clipAssetId,
        sketchStatus: "succeeded",
      })
    );
  }
  if (rows.length === frames.length) {
    return mergeKeyframeAssetsIntoRows(rows, frames);
  }
  // 行数不同：按关键帧重建，尽量复用已有描述；id 必须全新，禁止复用以免多行撞 id
  return frames.map((f, i) => {
    const src = rows[i] ?? rows[rows.length - 1];
    return enrichTableRow({
      ...src,
      id: newTableRowId(),
      index: f.index,
      shotNo: String(f.index),
      duration:
        typeof f.durationSec === "number" && f.durationSec > 0
          ? `${Number(f.durationSec.toFixed(1))}s`
          : f.durationLabel || src?.duration,
      description: src?.description || `镜头 ${f.index}`,
      sketchAssetId: f.assetId,
      clipAssetId: f.clipAssetId,
      sketchStatus: "succeeded",
    });
  });
}

export function parseViralRemakeContent(content: string): ViralRemakeParseResult {
  const table = parseStoryboardTableContent(content);
  const subjects = parseStoryboardSubjectsContent(content);
  const meta = tryPickMeta(content);
  return {
    rows: table.rows,
    subjects: subjects.subjects,
    styleSummary: meta.styleSummary,
    replacePlan: meta.replacePlan,
    warnings: [...table.warnings, ...subjects.warnings],
  };
}
