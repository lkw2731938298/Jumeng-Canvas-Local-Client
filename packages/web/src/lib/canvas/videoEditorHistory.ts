/**
 * 完整剪辑时间线撤销/重做（clips 快照）。
 */

import type { TimelineClip } from "@/lib/canvas/videoEditorTimeline";

const MAX_HISTORY = 40;

export type TimelineHistory = {
  past: TimelineClip[][];
  present: TimelineClip[];
  future: TimelineClip[][];
};

export function createHistory(present: TimelineClip[] = []): TimelineHistory {
  return { past: [], present: structuredClone(present), future: [] };
}

function cloneClips(clips: TimelineClip[]): TimelineClip[] {
  return structuredClone(clips);
}

function sameClips(a: TimelineClip[], b: TimelineClip[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((c, i) => {
    const o = b[i]!;
    return (
      c.id === o.id &&
      c.assetId === o.assetId &&
      (c.kind || "video") === (o.kind || "video") &&
      c.inSec === o.inSec &&
      c.outSec === o.outSec &&
      c.trackIndex === o.trackIndex &&
      Math.abs(c.startSec - o.startSec) < 1e-6 &&
      Math.abs((c.padBeforeSec || 0) - (o.padBeforeSec || 0)) < 1e-6 &&
      Math.abs((c.padAfterSec || 0) - (o.padAfterSec || 0)) < 1e-6
    );
  });
}

export function commitHistory(h: TimelineHistory, next: TimelineClip[]): TimelineHistory {
  if (sameClips(h.present, next)) return h;
  const past = [...h.past, cloneClips(h.present)].slice(-MAX_HISTORY);
  return { past, present: cloneClips(next), future: [] };
}

export function undoHistory(h: TimelineHistory): TimelineHistory | null {
  if (!h.past.length) return null;
  const past = [...h.past];
  const previous = past.pop()!;
  return {
    past,
    present: previous,
    future: [cloneClips(h.present), ...h.future].slice(0, MAX_HISTORY),
  };
}

export function redoHistory(h: TimelineHistory): TimelineHistory | null {
  if (!h.future.length) return null;
  const [next, ...rest] = h.future;
  return {
    past: [...h.past, cloneClips(h.present)].slice(-MAX_HISTORY),
    present: cloneClips(next!),
    future: rest,
  };
}

export function canUndo(h: TimelineHistory): boolean {
  return h.past.length > 0;
}

export function canRedo(h: TimelineHistory): boolean {
  return h.future.length > 0;
}
