"use client";

import { useMemo, useState } from "react";
import { Box, Camera, Circle, Search, Trash2, User } from "lucide-react";
import type { DirectorObject } from "@/types/director-scene";

function objectIcon(obj: DirectorObject) {
  if (obj.kind === "camera") return <Camera className="h-3.5 w-3.5 shrink-0 text-amber-300" />;
  if (obj.kind === "character") return <User className="h-3.5 w-3.5 shrink-0 text-indigo-300" />;
  if (obj.shape === "sphere") return <Circle className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
  return <Box className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

export function DirectorObjectList({
  objects,
  selectedId,
  onSelect,
  onRemove,
  showSearch = true,
}: {
  objects: DirectorObject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;
  showSearch?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter((o) => o.name.toLowerCase().includes(q));
  }, [objects, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showSearch ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索场景对象"
            className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-7 pr-2 text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-indigo-400/40"
          />
        </label>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-[10px] leading-relaxed text-white/30">
          {objects.length === 0 ? "场景中暂无对象" : "无匹配结果"}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 overflow-y-auto">
          {filtered.map((obj) => {
        const active = selectedId === obj.id;
        return (
          <li key={obj.id} className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelect(obj.id)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                active
                  ? "bg-indigo-500/25 text-white ring-1 ring-indigo-400/30"
                  : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              {objectIcon(obj)}
              <span className="min-w-0 flex-1 truncate">{obj.name}</span>
              {obj.kind === "camera" ? (
                <span className="shrink-0 text-[9px] text-amber-300/80">摄像</span>
              ) : null}
            </button>
            {onRemove ? (
              <button
                type="button"
                title="删除"
                aria-label={`删除 ${obj.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(obj.id);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-300/70 transition-colors hover:bg-red-500/15 hover:text-red-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        );
      })}
        </ul>
      )}
    </div>
  );
}
