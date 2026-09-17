/**
 * 完整剪辑多轨时间线：视频/音频、空镜 padding、高轨优先压平。
 */

import type { Asset } from "@/lib/api/assets";
import { clampTrimRange, MIN_VIDEO_TRIM_SEC } from "@/lib/canvas/videoTrim";

export const MAX_TIMELINE_CLIPS = 20;
export const MAX_CLIP_DURATION_SEC = 180;
export const MAX_TIMELINE_TOTAL_SEC = 600;
export const MIN_VIDEO_TRACKS = 2;
export const MAX_VIDEO_TRACKS = 4;
export const DEFAULT_VIDEO_TRACKS = 2;
export const MIN_AUDIO_TRACKS = 1;
export const MAX_AUDIO_TRACKS = 2;
export const DEFAULT_AUDIO_TRACKS = 1;

export type TimelineClipKind = "video" | "audio";

export type TimelineClip = {
  id: string;
  kind: TimelineClipKind;
  assetId: string;
  title: string;
  fileUrl: string;
  sourceDuration: number;
  inSec: number;
  outSec: number;
  /** 同类轨内：视频 0=底 …；音频 0=A1 */
  trackIndex: number;
  startSec: number;
  /** 片头空镜（拉长左缘） */
  padBeforeSec: number;
  /** 片尾空镜（拉长右缘） */
  padAfterSec: number;
};

export type FlattenSegment =
  | {
      kind: "video";
      clipId: string;
      assetId: string;
      inSec: number;
      outSec: number;
      startSec: number;
      duration: number;
    }
  | { kind: "gap"; startSec: number; duration: number };

export type AudioExportClip = {
  audioAssetId: string;
  inSec: number;
  outSec: number;
  startSec: number;
  padBeforeSec: number;
  padAfterSec: number;
  trackIndex: number;
};

export function newClipId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function mediaDuration(clip: TimelineClip): number {
  return Math.max(0, clip.outSec - clip.inSec);
}

/** 槽位总长（含空镜） */
export function clipDuration(clip: TimelineClip): number {
  return (
    Math.max(0, clip.padBeforeSec || 0) +
    mediaDuration(clip) +
    Math.max(0, clip.padAfterSec || 0)
  );
}

export function clipEndSec(clip: TimelineClip): number {
  return clip.startSec + clipDuration(clip);
}

export function mediaWindow(clip: TimelineClip): { mediaStart: number; mediaEnd: number } {
  const mediaStart = clip.startSec + Math.max(0, clip.padBeforeSec || 0);
  return { mediaStart, mediaEnd: mediaStart + mediaDuration(clip) };
}

export function timelineTotalDuration(clips: TimelineClip[]): number {
  if (!clips.length) return 0;
  return Math.max(0, ...clips.map(clipEndSec));
}

export function videoClipsOf(clips: TimelineClip[]): TimelineClip[] {
  return clips.filter((c) => c.kind !== "audio");
}

export function audioClipsOf(clips: TimelineClip[]): TimelineClip[] {
  return clips.filter((c) => c.kind === "audio");
}

export function resolveTrackCount(clips: TimelineClip[], preferred?: number): number {
  const vids = videoClipsOf(clips);
  const maxUsed = vids.reduce((m, c) => Math.max(m, c.trackIndex + 1), 0);
  const base = preferred ?? Math.max(DEFAULT_VIDEO_TRACKS, maxUsed);
  return Math.max(MIN_VIDEO_TRACKS, Math.min(MAX_VIDEO_TRACKS, Math.max(base, maxUsed)));
}

export function resolveAudioTrackCount(clips: TimelineClip[], preferred?: number): number {
  const auds = audioClipsOf(clips);
  const maxUsed = auds.reduce((m, c) => Math.max(m, c.trackIndex + 1), 0);
  const base = preferred ?? Math.max(DEFAULT_AUDIO_TRACKS, maxUsed);
  return Math.max(MIN_AUDIO_TRACKS, Math.min(MAX_AUDIO_TRACKS, Math.max(base, maxUsed)));
}

export function trackDisplayOrder(trackCount: number): number[] {
  const out: number[] = [];
  for (let i = trackCount - 1; i >= 0; i--) out.push(i);
  return out;
}

export function trackLabel(trackIndex: number, trackCount: number): string {
  return `V${trackCount - trackIndex}`;
}

export function audioTrackLabel(trackIndex: number): string {
  return `A${trackIndex + 1}`;
}

/** 覆盖时刻 t 的最高视频轨「有画面」片段；空镜区返回 null */
export function mapTimelineTime(
  clips: TimelineClip[],
  timelineSec: number
): { clipIndex: number; clip: TimelineClip; sourceTime: number; offsetInClip: number } | null {
  const vids = videoClipsOf(clips);
  if (!vids.length) return null;
  const total = timelineTotalDuration(clips);
  if (total <= 0) return null;
  const t = Math.max(0, Math.min(timelineSec, Math.max(0, total - 0.001)));

  let best: TimelineClip | null = null;
  let bestIdx = -1;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]!;
    if (c.kind === "audio") continue;
    const end = clipEndSec(c);
    if (t >= c.startSec - 1e-6 && t < end - 1e-9) {
      if (!best || c.trackIndex > best.trackIndex) {
        best = c;
        bestIdx = i;
      }
    }
  }
  if (!best || bestIdx < 0) return null;
  const { mediaStart, mediaEnd } = mediaWindow(best);
  if (t < mediaStart - 1e-9 || t >= mediaEnd - 1e-9) {
    // 片段槽位内空镜
    return null;
  }
  const offset = Math.max(0, Math.min(t - mediaStart, mediaDuration(best) - 0.001));
  return {
    clipIndex: bestIdx,
    clip: best,
    sourceTime: best.inSec + offset,
    offsetInClip: offset,
  };
}

/** 音频：取覆盖 t 的最低轨优先（可叠多轨预览时取第一条有内容的） */
export function mapAudioAtTime(
  clips: TimelineClip[],
  timelineSec: number
): { clip: TimelineClip; sourceTime: number } | null {
  const t = timelineSec;
  let best: TimelineClip | null = null;
  for (const c of audioClipsOf(clips)) {
    const end = clipEndSec(c);
    if (t < c.startSec - 1e-6 || t >= end - 1e-9) continue;
    const { mediaStart, mediaEnd } = mediaWindow(c);
    if (t < mediaStart || t >= mediaEnd) continue;
    if (!best || c.trackIndex < best.trackIndex) best = c;
  }
  if (!best) return null;
  const { mediaStart } = mediaWindow(best);
  return { clip: best, sourceTime: best.inSec + (t - mediaStart) };
}

export function sourceToTimelineSec(
  _clips: TimelineClip[],
  clip: TimelineClip,
  sourceTime: number
): number {
  const offset = Math.max(0, Math.min(sourceTime, clip.outSec) - clip.inSec);
  return clip.startSec + Math.max(0, clip.padBeforeSec || 0) + offset;
}

export function clipsOverlapOnTrack(
  clips: TimelineClip[],
  kind: TimelineClipKind,
  trackIndex: number,
  startSec: number,
  endSec: number,
  excludeId?: string
): boolean {
  for (const c of clips) {
    if ((c.kind || "video") !== kind) continue;
    if (c.trackIndex !== trackIndex) continue;
    if (excludeId && c.id === excludeId) continue;
    const a = c.startSec;
    const b = clipEndSec(c);
    if (startSec < b - 1e-6 && endSec > a + 1e-6) return true;
  }
  return false;
}

export function resolveDrop(
  clips: TimelineClip[],
  id: string,
  trackIndex: number,
  startSec: number
): { ok: true; clips: TimelineClip[] } | { ok: false; reason: string } {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return { ok: false, reason: "片段不存在" };
  const kind = clip.kind || "video";
  const dur = clipDuration(clip);
  if (dur < MIN_VIDEO_TRIM_SEC) return { ok: false, reason: "片段过短" };

  let start = Math.max(0, startSec);
  let end = start + dur;
  if (end > MAX_TIMELINE_TOTAL_SEC) {
    start = Math.max(0, MAX_TIMELINE_TOTAL_SEC - dur);
    end = start + dur;
  }

  const maxTrack = kind === "audio" ? MAX_AUDIO_TRACKS - 1 : MAX_VIDEO_TRACKS - 1;
  const track = Math.max(0, Math.min(maxTrack, Math.floor(trackIndex)));

  if (!clipsOverlapOnTrack(clips, kind, track, start, end, id)) {
    const next = clips.map((c) =>
      c.id === id ? { ...c, trackIndex: track, startSec: start } : c
    );
    if (timelineTotalDuration(next) > MAX_TIMELINE_TOTAL_SEC + 0.05) {
      return { ok: false, reason: `时间线总时长不能超过 ${MAX_TIMELINE_TOTAL_SEC} 秒` };
    }
    return { ok: true, clips: next };
  }

  const others = clips
    .filter((c) => (c.kind || "video") === kind && c.trackIndex === track && c.id !== id)
    .sort((a, b) => a.startSec - b.startSec);

  const candidates: number[] = [0, start];
  for (const o of others) candidates.push(clipEndSec(o));

  let bestStart: number | null = null;
  let bestDist = Infinity;
  for (const cand of candidates) {
    let s = Math.max(0, cand);
    let e = s + dur;
    if (e > MAX_TIMELINE_TOTAL_SEC) {
      s = Math.max(0, MAX_TIMELINE_TOTAL_SEC - dur);
      e = s + dur;
    }
    if (clipsOverlapOnTrack(clips, kind, track, s, e, id)) continue;
    const dist = Math.abs(s - start);
    if (dist < bestDist) {
      bestDist = dist;
      bestStart = s;
    }
  }
  if (bestStart == null) return { ok: false, reason: "该轨道此位置已被占用" };

  const next = clips.map((c) =>
    c.id === id ? { ...c, trackIndex: track, startSec: bestStart! } : c
  );
  if (timelineTotalDuration(next) > MAX_TIMELINE_TOTAL_SEC + 0.05) {
    return { ok: false, reason: `时间线总时长不能超过 ${MAX_TIMELINE_TOTAL_SEC} 秒` };
  }
  return { ok: true, clips: next };
}

/** 同轨右侧邻居的起点（用于限制右缘） */
function nextNeighborStart(
  clips: TimelineClip[],
  kind: TimelineClipKind,
  trackIndex: number,
  selfId: string,
  selfStart: number
): number {
  let min = MAX_TIMELINE_TOTAL_SEC;
  for (const c of clips) {
    if ((c.kind || "video") !== kind || c.trackIndex !== trackIndex || c.id === selfId) continue;
    if (c.startSec >= selfStart - 1e-6) min = Math.min(min, c.startSec);
  }
  return min;
}

/** 同轨左侧邻居的终点（用于限制左缘） */
function prevNeighborEnd(
  clips: TimelineClip[],
  kind: TimelineClipKind,
  trackIndex: number,
  selfId: string,
  selfEnd: number
): number {
  let max = 0;
  for (const c of clips) {
    if ((c.kind || "video") !== kind || c.trackIndex !== trackIndex || c.id === selfId) continue;
    const end = clipEndSec(c);
    if (end <= selfEnd + 1e-6) max = Math.max(max, end);
  }
  return max;
}

/**
 * 拉右缘：
 * - 缩小：先减 padAfter 空镜，再截取 outSec
 * - 拉长：无空镜时先吃满片源，再增加 padAfter
 * （已有空镜时回拖只减空镜，禁止误把空镜「填成正片」）
 */
export function resizeClipRight(
  clips: TimelineClip[],
  id: string,
  newEndSec: number
): TimelineClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const kind = (clip.kind || "video") as TimelineClipKind;
  const padBefore = Math.max(0, clip.padBeforeSec || 0);
  const mediaStart = clip.startSec + padBefore;
  const mediaLen = Math.max(MIN_VIDEO_TRIM_SEC, mediaDuration(clip));
  const mediaEnd = mediaStart + mediaLen;
  const minEnd = mediaStart + MIN_VIDEO_TRIM_SEC;
  const neighborLimit = nextNeighborStart(clips, kind, clip.trackIndex, id, clip.startSec);
  const end = Math.max(minEnd, Math.min(MAX_TIMELINE_TOTAL_SEC, neighborLimit, newEndSec));

  const maxOut = Math.min(clip.sourceDuration, clip.inSec + MAX_CLIP_DURATION_SEC);
  const maxMediaLen = Math.max(MIN_VIDEO_TRIM_SEC, maxOut - clip.inSec);
  const maxMediaEnd = mediaStart + maxMediaLen;
  const hadPad = Math.max(0, clip.padAfterSec || 0) > 1e-9;

  let outSec: number;
  let padAfter: number;
  if (end < mediaEnd - 1e-9) {
    // 缩小进入正片：截尾并清空片尾空镜
    outSec = clip.inSec + (end - mediaStart);
    padAfter = 0;
  } else if (hadPad) {
    // 已有空镜：只改 pad，不改 out（回缩=减空镜，继续拉=加空镜）
    outSec = clip.outSec;
    padAfter = Math.max(0, end - mediaEnd);
  } else if (end <= maxMediaEnd + 1e-9) {
    // 无空镜：拉长优先露出更多片源
    outSec = clip.inSec + (end - mediaStart);
    padAfter = 0;
  } else {
    // 片源吃满后再加空镜
    outSec = maxOut;
    padAfter = Math.max(0, end - maxMediaEnd);
  }

  const nextClip: TimelineClip = {
    ...clip,
    outSec: Math.min(maxOut, Math.max(clip.inSec + MIN_VIDEO_TRIM_SEC, outSec)),
    padBeforeSec: padBefore,
    padAfterSec: padAfter,
  };
  return clips.map((c) => (c.id === id ? nextClip : c));
}

/**
 * 拉左缘：右端固定；缩小先减 padBefore，再截 inSec；拉长无空镜时先吃片源。
 */
export function resizeClipLeft(
  clips: TimelineClip[],
  id: string,
  newStartSec: number
): TimelineClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const kind = (clip.kind || "video") as TimelineClipKind;
  const padAfter = Math.max(0, clip.padAfterSec || 0);
  const oldEnd = clipEndSec(clip);
  const mediaEnd = oldEnd - padAfter;
  const mediaLen = Math.max(MIN_VIDEO_TRIM_SEC, mediaDuration(clip));
  const mediaStart = mediaEnd - mediaLen;
  const neighborLimit = prevNeighborEnd(clips, kind, clip.trackIndex, id, oldEnd);
  const start = Math.max(
    0,
    neighborLimit,
    Math.min(mediaEnd - MIN_VIDEO_TRIM_SEC, newStartSec)
  );

  const maxMediaLen = Math.min(MAX_CLIP_DURATION_SEC, clip.outSec);
  const minMediaStart = mediaEnd - maxMediaLen;
  const hadPad = Math.max(0, clip.padBeforeSec || 0) > 1e-9;

  let inSec: number;
  let padBefore: number;
  let startSec: number;

  if (start > mediaStart + 1e-9) {
    // 缩小进入正片：截头并清空片头空镜（右端不动）
    padBefore = 0;
    const nextMediaLen = Math.max(MIN_VIDEO_TRIM_SEC, mediaEnd - start);
    inSec = clip.outSec - nextMediaLen;
    inSec = Math.max(0, Math.min(clip.outSec - MIN_VIDEO_TRIM_SEC, inSec));
    startSec = mediaEnd - (clip.outSec - inSec);
    startSec = Math.max(neighborLimit, startSec);
  } else if (hadPad) {
    // 已有片头空镜：只改 padBefore，锁定 in/out
    inSec = clip.inSec;
    padBefore = Math.max(0, mediaStart - start);
    startSec = start;
  } else if (start >= minMediaStart - 1e-9) {
    // 无空镜：向左拉长露出更多片源
    padBefore = 0;
    const nextMediaLen = Math.max(MIN_VIDEO_TRIM_SEC, mediaEnd - start);
    inSec = clip.outSec - nextMediaLen;
    inSec = Math.max(0, Math.min(clip.outSec - MIN_VIDEO_TRIM_SEC, inSec));
    startSec = mediaEnd - (clip.outSec - inSec);
    startSec = Math.max(neighborLimit, startSec);
  } else {
    // 片源吃满后再加片头空镜
    inSec = Math.max(0, clip.outSec - maxMediaLen);
    const nextMediaLen = clip.outSec - inSec;
    padBefore = Math.max(0, mediaEnd - nextMediaLen - start);
    startSec = start;
  }

  const nextClip: TimelineClip = {
    ...clip,
    startSec: Math.max(0, startSec),
    inSec,
    outSec: clip.outSec,
    padBeforeSec: padBefore,
    padAfterSec: padAfter,
  };
  // 右端漂移时拉回（保持拖的是左缘）
  const drift = clipEndSec(nextClip) - oldEnd;
  if (Math.abs(drift) > 1e-3) {
    nextClip.startSec = Math.max(0, nextClip.startSec - drift);
  }
  return clips.map((c) => (c.id === id ? nextClip : c));
}

export function nextStartOnTrack(
  clips: TimelineClip[],
  kind: TimelineClipKind,
  trackIndex: number
): number {
  let maxEnd = 0;
  for (const c of clips) {
    if ((c.kind || "video") === kind && c.trackIndex === trackIndex) {
      maxEnd = Math.max(maxEnd, clipEndSec(c));
    }
  }
  return maxEnd;
}

export function flattenTimeline(clips: TimelineClip[]): FlattenSegment[] {
  const vids = videoClipsOf(clips);
  if (!vids.length) return [];
  const total = timelineTotalDuration(clips);
  if (total <= 0) return [];

  const edges = new Set<number>([0, total]);
  for (const c of vids) {
    edges.add(roundTime(c.startSec));
    const { mediaStart, mediaEnd } = mediaWindow(c);
    edges.add(roundTime(mediaStart));
    edges.add(roundTime(mediaEnd));
    edges.add(roundTime(clipEndSec(c)));
  }
  const points = [...edges].sort((a, b) => a - b);
  const segments: FlattenSegment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const mapped = mapTimelineTime(clips, mid);
    if (!mapped) {
      const last = segments[segments.length - 1];
      if (last?.kind === "gap") {
        last.duration = roundTime(last.duration + (b - a));
      } else {
        segments.push({ kind: "gap", startSec: a, duration: roundTime(b - a) });
      }
      continue;
    }
    const clip = mapped.clip;
    const { mediaStart } = mediaWindow(clip);
    const srcIn = clip.inSec + (a - mediaStart);
    const srcOut = clip.inSec + (b - mediaStart);
    const last = segments[segments.length - 1];
    if (
      last?.kind === "video" &&
      last.clipId === clip.id &&
      Math.abs(last.outSec - srcIn) < 1e-3
    ) {
      last.outSec = srcOut;
      last.duration = roundTime(last.outSec - last.inSec);
    } else {
      segments.push({
        kind: "video",
        clipId: clip.id,
        assetId: clip.assetId,
        inSec: srcIn,
        outSec: srcOut,
        startSec: a,
        duration: roundTime(b - a),
      });
    }
  }
  return segments;
}

export function audioClipsForExport(clips: TimelineClip[]): AudioExportClip[] {
  return audioClipsOf(clips).map((c) => ({
    audioAssetId: c.assetId,
    inSec: c.inSec,
    outSec: c.outSec,
    startSec: c.startSec,
    padBeforeSec: c.padBeforeSec || 0,
    padAfterSec: c.padAfterSec || 0,
    trackIndex: c.trackIndex,
  }));
}

function roundTime(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normalizeClip(c: Partial<TimelineClip> & TimelineClip): TimelineClip {
  return {
    ...c,
    kind: c.kind === "audio" ? "audio" : "video",
    padBeforeSec: Math.max(0, Number(c.padBeforeSec) || 0),
    padAfterSec: Math.max(0, Number(c.padAfterSec) || 0),
    trackIndex: Math.max(0, Math.floor(Number(c.trackIndex) || 0)),
    startSec: Math.max(0, Number(c.startSec) || 0),
  };
}

export function migrateLegacyClips(raw: TimelineClip[]): TimelineClip[] {
  let cursor = 0;
  return raw.map((c) => {
    const hasStart = Number.isFinite(c.startSec);
    const hasTrack = Number.isFinite(c.trackIndex);
    const kind: TimelineClipKind = c.kind === "audio" ? "audio" : "video";
    if (hasStart && hasTrack) {
      return normalizeClip({
        ...c,
        kind,
        trackIndex: Math.max(
          0,
          Math.min(
            (kind === "audio" ? MAX_AUDIO_TRACKS : MAX_VIDEO_TRACKS) - 1,
            Math.floor(c.trackIndex)
          )
        ),
        startSec: Math.max(0, c.startSec),
      });
    }
    const startSec = cursor;
    const media = Math.max(0, (c.outSec || 0) - (c.inSec || 0));
    cursor += media;
    return normalizeClip({
      ...c,
      kind,
      trackIndex: 0,
      startSec,
      padBeforeSec: 0,
      padAfterSec: 0,
    });
  });
}

export function createClipFromAsset(
  asset: Asset,
  sourceDuration: number,
  options?: {
    sourceStartSec?: number;
    maxLen?: number;
    trackIndex?: number;
    timelineStartSec?: number;
    kind?: TimelineClipKind;
  }
): TimelineClip {
  const kind: TimelineClipKind =
    options?.kind ?? (asset.category === "audio" ? "audio" : "video");
  const srcDur =
    Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : MIN_VIDEO_TRIM_SEC;
  const start = Math.max(
    0,
    Math.min(options?.sourceStartSec ?? 0, Math.max(0, srcDur - MIN_VIDEO_TRIM_SEC))
  );
  const maxLen = options?.maxLen ?? MAX_CLIP_DURATION_SEC;
  const end = Math.min(srcDur, start + Math.min(maxLen, MAX_CLIP_DURATION_SEC));
  const range = clampTrimRange(start, end, srcDur);
  const maxTrack = kind === "audio" ? MAX_AUDIO_TRACKS - 1 : MAX_VIDEO_TRACKS - 1;
  return {
    id: newClipId(),
    kind,
    assetId: asset.id,
    title: asset.title || (kind === "audio" ? "未命名音频" : "未命名视频"),
    fileUrl: asset.fileUrl,
    sourceDuration: srcDur,
    inSec: range.inSec,
    outSec: range.outSec,
    trackIndex: Math.max(0, Math.min(maxTrack, options?.trackIndex ?? 0)),
    startSec: Math.max(0, options?.timelineStartSec ?? 0),
    padBeforeSec: 0,
    padAfterSec: 0,
  };
}

export function createAutoSplitClipsFromAsset(
  asset: Asset,
  sourceDuration: number,
  options: {
    existingClips: TimelineClip[];
    sourceStartSec?: number;
    trackIndex?: number;
  }
): { clips: TimelineClip[]; truncated: boolean } {
  const srcDur =
    Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : MIN_VIDEO_TRIM_SEC;
  const sourceStart = options.sourceStartSec ?? 0;
  const start = Math.max(0, Math.min(sourceStart, Math.max(0, srcDur - MIN_VIDEO_TRIM_SEC)));
  const trackIndex = options.trackIndex ?? 0;
  const roomClips = MAX_TIMELINE_CLIPS - options.existingClips.length;
  const timelineCursor0 = nextStartOnTrack(options.existingClips, "video", trackIndex);
  const out: TimelineClip[] = [];
  let cursor = start;
  let timelineCursor = timelineCursor0;
  let truncated = false;

  while (cursor < srcDur - 0.001 && out.length < roomClips) {
    const remainRoom = MAX_TIMELINE_TOTAL_SEC - timelineCursor;
    if (remainRoom < MIN_VIDEO_TRIM_SEC) {
      truncated = true;
      break;
    }
    const chunk = Math.min(MAX_CLIP_DURATION_SEC, srcDur - cursor, remainRoom);
    if (chunk < MIN_VIDEO_TRIM_SEC) {
      truncated = true;
      break;
    }
    const clip = createClipFromAsset(asset, srcDur, {
      sourceStartSec: cursor,
      maxLen: chunk,
      trackIndex,
      timelineStartSec: timelineCursor,
      kind: "video",
    });
    out.push(clip);
    timelineCursor += clipDuration(clip);
    cursor = clip.outSec;
  }
  if (cursor < srcDur - 0.05) truncated = true;
  return { clips: out, truncated };
}

/**
 * 在播放头处分割选中片段（视频/音频均可）。
 * 仅允许落在「有媒体」区间内；两侧均须 ≥ MIN。
 */
export function splitClipAtPlayhead(
  clips: TimelineClip[],
  selectedId: string,
  timelineSec: number
): TimelineClip[] | null {
  const idx = clips.findIndex((c) => c.id === selectedId);
  if (idx < 0) return null;
  const clip = clips[idx]!;
  const { mediaStart, mediaEnd } = mediaWindow(clip);
  // 播放头必须在媒体窗内（空镜区不可分割）
  if (timelineSec <= mediaStart + MIN_VIDEO_TRIM_SEC - 1e-6) return null;
  if (timelineSec >= mediaEnd - MIN_VIDEO_TRIM_SEC + 1e-6) return null;
  const splitSource = clip.inSec + (timelineSec - mediaStart);
  const leftDur = splitSource - clip.inSec;
  const rightDur = clip.outSec - splitSource;
  if (leftDur < MIN_VIDEO_TRIM_SEC || rightDur < MIN_VIDEO_TRIM_SEC) return null;

  // 左段保留片头空镜；右段从切点起，片尾空镜归右段
  const left: TimelineClip = {
    ...clip,
    id: newClipId(),
    outSec: splitSource,
    padAfterSec: 0,
  };
  const right: TimelineClip = {
    ...clip,
    id: newClipId(),
    inSec: splitSource,
    startSec: timelineSec,
    padBeforeSec: 0,
    padAfterSec: Math.max(0, clip.padAfterSec || 0),
  };
  const next = [...clips];
  next.splice(idx, 1, left, right);
  return next;
}

export function patchClipTrim(
  clips: TimelineClip[],
  id: string,
  inSec: number,
  outSec: number
): TimelineClip[] {
  const patched = clips.map((c) => {
    if (c.id !== id) return c;
    const range = clampTrimRange(inSec, outSec, c.sourceDuration);
    let nextOut = range.outSec;
    if (nextOut - range.inSec > MAX_CLIP_DURATION_SEC) {
      nextOut = range.inSec + MAX_CLIP_DURATION_SEC;
    }
    return { ...c, inSec: range.inSec, outSec: nextOut };
  });
  const clip = patched.find((c) => c.id === id);
  if (!clip) return patched;
  const end = clipEndSec(clip);
  const kind = clip.kind || "video";
  if (!clipsOverlapOnTrack(patched, kind, clip.trackIndex, clip.startSec, end, id)) {
    return patched;
  }
  const resolved = resolveDrop(patched, id, clip.trackIndex, clip.startSec);
  return resolved.ok ? resolved.clips : patched;
}

export function nudgeClipStart(
  clips: TimelineClip[],
  id: string,
  deltaSec: number
): TimelineClip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const resolved = resolveDrop(clips, id, clip.trackIndex, clip.startSec + deltaSec);
  return resolved.ok ? resolved.clips : clips;
}

const draftKey = (projectId: string) => `jm_video_editor_timeline:${projectId}`;

/** 将任意 JSON 片段数组规范为 TimelineClip（服务端 / session / composeMeta） */
export function parseTimelineClipsFromUnknown(raw: unknown): TimelineClip[] | null {
  if (!Array.isArray(raw)) return null;
  const clips: TimelineClip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id || "").trim() || newClipId();
    const assetId = String(o.assetId || o.asset_id || "").trim();
    if (!assetId) continue;
    const inSec = Number(o.inSec ?? o.in_sec);
    const outSec = Number(o.outSec ?? o.out_sec);
    if (!(outSec > inSec)) continue;
    const startSec = Number(o.startSec ?? o.start_sec);
    const trackIndex = Number(o.trackIndex ?? o.track_index);
    const kind = o.kind === "audio" ? "audio" : "video";
    const fileUrl = String(o.fileUrl ?? o.file_url ?? "").trim();
    clips.push({
      id,
      kind,
      assetId,
      title: String(o.title || (kind === "audio" ? "音频" : "视频")),
      fileUrl,
      sourceDuration: Math.max(outSec, Number(o.sourceDuration ?? o.source_duration) || outSec),
      inSec,
      outSec,
      startSec: Number.isFinite(startSec) ? startSec : 0,
      trackIndex: Number.isFinite(trackIndex) ? trackIndex : 0,
      padBeforeSec: Math.max(0, Number(o.padBeforeSec ?? o.pad_before_sec) || 0),
      padAfterSec: Math.max(0, Number(o.padAfterSec ?? o.pad_after_sec) || 0),
    });
  }
  if (!clips.length) return null;
  return migrateLegacyClips(clips).slice(0, MAX_TIMELINE_CLIPS);
}

/**
 * 从成片节点 composeMeta 回填时间线（缺少 fileUrl 时由 hydrateTimelineClips 补）。
 */
export function timelineClipsFromComposeMeta(
  meta: Record<string, unknown> | null | undefined,
  assets: Asset[]
): TimelineClip[] | null {
  if (!meta || typeof meta !== "object") return null;
  const videoRaw = meta.clips;
  const audioRaw = meta.audioClips ?? meta.audio_clips;
  const parts: unknown[] = [];
  if (Array.isArray(videoRaw)) {
    for (const row of videoRaw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      parts.push({
        ...o,
        kind: "video",
        id: String(o.id || "").trim() || newClipId(),
      });
    }
  }
  if (Array.isArray(audioRaw)) {
    for (const row of audioRaw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const assetId = String(o.audioAssetId ?? o.audio_asset_id ?? o.assetId ?? "").trim();
      if (!assetId) continue;
      parts.push({
        ...o,
        kind: "audio",
        assetId,
        id: String(o.id || "").trim() || newClipId(),
      });
    }
  }
  const parsed = parseTimelineClipsFromUnknown(parts);
  if (!parsed?.length) return null;
  return hydrateTimelineClips(parsed, assets);
}

export function loadTimelineDraft(projectId: string): TimelineClip[] | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const raw = sessionStorage.getItem(draftKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parseTimelineClipsFromUnknown(parsed);
  } catch {
    return null;
  }
}

export function saveTimelineDraft(projectId: string, clips: TimelineClip[]): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    sessionStorage.setItem(draftKey(projectId), JSON.stringify(clips));
  } catch {
    /* quota */
  }
}

export function clearTimelineDraft(projectId: string): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    sessionStorage.removeItem(draftKey(projectId));
  } catch {
    /* ignore */
  }
}

export function hydrateTimelineClips(clips: TimelineClip[], assets: Asset[]): TimelineClip[] {
  if (!clips.length) return clips;
  return clips.map((clip) => {
    const asset =
      assets.find((a) => a.id === clip.assetId || a.legacyId === clip.assetId) ?? null;
    if (!asset?.fileUrl) return clip;
    return {
      ...clip,
      fileUrl: asset.fileUrl,
      title: asset.title || clip.title,
      kind: clip.kind || (asset.category === "audio" ? "audio" : "video"),
    };
  });
}

export function findClipIndex(clips: TimelineClip[], id: string): number {
  return clips.findIndex((c) => c.id === id);
}

export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00.0";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}
