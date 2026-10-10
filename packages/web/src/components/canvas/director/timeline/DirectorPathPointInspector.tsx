"use client";

/** 路径顶点独立检查页：X/Y/Z 数值编辑 */

function AxisInput({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-white/50">
      <span className="w-3 font-mono text-white/35">{label}</span>
      <input
        type="number"
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 font-mono text-xs text-white/85 outline-none focus:border-amber-400/50"
      />
    </label>
  );
}

export function DirectorPathPointInspector({
  pathName,
  index,
  pointCount,
  point,
  canDelete,
  onAxisChange,
  onDelete,
}: {
  pathName?: string;
  index: number;
  pointCount: number;
  point: [number, number, number];
  canDelete: boolean;
  onAxisChange: (axis: 0 | 1 | 2, value: number) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[10px] leading-relaxed text-white/40">
        {pathName ? `「${pathName}」` : "运动路径"} · 第 {index + 1} / {pointCount}{" "}
        点。视口拖动改 XZ；Y 可在此抬高。Delete 可删点（至少 2 点）。
      </p>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-white/45">坐标（米）</span>
        <AxisInput label="X" value={point[0]} onChange={(v) => onAxisChange(0, v)} />
        <AxisInput label="Y" value={point[1]} onChange={(v) => onAxisChange(1, v)} />
        <AxisInput label="Z" value={point[2]} onChange={(v) => onAxisChange(2, v)} />
      </div>

      {onDelete ? (
        <button
          type="button"
          disabled={!canDelete}
          onClick={onDelete}
          className="rounded-lg border border-red-400/30 bg-red-500/15 px-2 py-1.5 text-[11px] text-red-100/90 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-35"
        >
          删除此顶点
        </button>
      ) : null}
    </div>
  );
}
