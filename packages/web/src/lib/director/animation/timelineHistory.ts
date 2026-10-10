/**
 * 动画时间轴 Undo/Redo（至少 50 步）。
 * 只存 animation 快照，不碰场景其它字段。
 */

import type { DirectorAnimationTimeline } from "@jumeng-canvas/shared";

const MAX_HISTORY = 50;

function cloneTimeline(t: DirectorAnimationTimeline): DirectorAnimationTimeline {
  return structuredClone(t);
}

export class TimelineHistoryStack {
  private past: DirectorAnimationTimeline[] = [];
  private future: DirectorAnimationTimeline[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** 在变更前压入「变更前」快照 */
  pushBefore(current: DirectorAnimationTimeline): void {
    this.past.push(cloneTimeline(current));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  undo(current: DirectorAnimationTimeline): DirectorAnimationTimeline | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(cloneTimeline(current));
    if (this.future.length > MAX_HISTORY) this.future.shift();
    return prev;
  }

  redo(current: DirectorAnimationTimeline): DirectorAnimationTimeline | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(cloneTimeline(current));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
