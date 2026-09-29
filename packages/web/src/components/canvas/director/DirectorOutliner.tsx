"use client";

/**
 * 导演台 · 场景大纲（控制台版）。
 * 顶部四宫格快捷添加（人物 / 道具 / 机位 / AI 3D），下方按「人物 / 道具 / 摄像机」分组列出场景对象，
 * 支持搜索、折叠、悬停删除；AI 生成中的占位道具显示加载态。
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  ChevronDown,
  Loader2,
  PersonStanding,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import type { DirectorObject } from "@/types/director-scene";
import { DIRECTOR_BUILTIN_MODELS } from "@/lib/director/builtinModels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fovToFocalMm } from "./directorUi";

type GroupId = "character" | "prop" | "camera";

const GROUPS: { id: GroupId; label: string; accent: string; dot: string }[] = [
  { id: "character", label: "人物", accent: "text-indigo-300", dot: "bg-indigo-400" },
  { id: "prop", label: "道具", accent: "text-emerald-300", dot: "bg-emerald-400" },
  { id: "camera", label: "摄像机", accent: "text-amber-300", dot: "bg-amber-400" },
];

const MENU_CLASS = "min-w-[170px] border-white/10 bg-[rgba(16,16,26,0.98)] text-white/90";
const MENU_ITEM = "gap-2 text-xs focus:bg-white/10 focus:text-white";

/** AI 3D 生成中的占位道具（执行器以「生成中」命名 / 标记） */
function isGeneratingPlaceholder(obj: DirectorObject) {
  return obj.kind === "prop" && !obj.modelAssetId && /生成中/.test(obj.name);
}

function QuickTile({
  icon,
  label,
  tone,
  onClick,
  disabled,
  asTrigger,
}: {
  icon: ReactNode;
  label: string;
  tone: string;
  onClick?: () => void;
  disabled?: boolean;
  asTrigger?: boolean;
}) {
  const cls = `group flex flex-col items-center justify-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] py-2 text-[10px] text-white/60 outline-none transition-all hover:-translate-y-px hover:border-white/15 hover:bg-white/[0.07] hover:text-white disabled:opacity-40 ${tone}`;
  const inner = (
    <>
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/[0.06] transition-colors group-hover:bg-white/10">
        {icon}
      </span>
      {label}
    </>
  );
  if (asTrigger) {
    return (
      <DropdownMenuTrigger className={cls} disabled={disabled}>
        {inner}
      </DropdownMenuTrigger>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

export function DirectorOutliner({
  objects,
  selectedId,
  disabled,
  uploadingModel,
  onSelect,
  onRemove,
  onAddBuiltin,
  onUploadModel,
  onAddCamera,
  onOpenModel3d,
}: {
  objects: DirectorObject[];
  selectedId: string | null;
  disabled?: boolean;
  uploadingModel?: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAddBuiltin: (builtinId: string) => void;
  onUploadModel: () => void;
  onAddCamera: () => void;
  onOpenModel3d: () => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<GroupId, boolean>>({
    character: false,
    prop: false,
    camera: false,
  });

  // 按分组归类并应用搜索过滤
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Record<GroupId, DirectorObject[]> = { character: [], prop: [], camera: [] };
    for (const obj of objects) {
      if (q && !obj.name.toLowerCase().includes(q)) continue;
      const key: GroupId = obj.kind === "camera" ? "camera" : obj.kind === "character" ? "character" : "prop";
      out[key].push(obj);
    }
    return out;
  }, [objects, query]);

  const characters = DIRECTOR_BUILTIN_MODELS.filter((m) => m.kind === "character");
  const props = DIRECTOR_BUILTIN_MODELS.filter((m) => m.kind !== "character");

  const rowIcon = (obj: DirectorObject) => {
    if (isGeneratingPlaceholder(obj)) return <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />;
    if (obj.kind === "camera") return <Video className="h-3.5 w-3.5 text-amber-300" />;
    if (obj.kind === "character") return <PersonStanding className="h-3.5 w-3.5 text-indigo-300" />;
    if (obj.modelAssetId) return <Sparkles className="h-3.5 w-3.5 text-emerald-300" />;
    return <Box className="h-3.5 w-3.5 text-emerald-300/80" />;
  };

  const rowMeta = (obj: DirectorObject) => {
    if (obj.kind === "camera") {
      const shots = obj.screenshots?.length ?? 0;
      return `${fovToFocalMm(obj.fov ?? 45)}mm${shots ? ` · ${shots}张` : ""}`;
    }
    if (isGeneratingPlaceholder(obj)) return "生成中";
    if (obj.modelAssetId) return "GLB";
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 快捷添加 */}
      <div className="grid grid-cols-4 gap-1.5">
        <DropdownMenu>
          <QuickTile
            asTrigger
            disabled={disabled}
            tone="hover:text-indigo-200"
            icon={<PersonStanding className="h-3.5 w-3.5 text-indigo-300" />}
            label="人物"
          />
          <DropdownMenuContent side="right" align="start" className={MENU_CLASS}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] text-white/40">添加人物</DropdownMenuLabel>
              {characters.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => onAddBuiltin(m.id)} className={MENU_ITEM}>
                  <PersonStanding className="h-3.5 w-3.5 text-indigo-300" />
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onUploadModel} disabled={uploadingModel} className={MENU_ITEM}>
              <Upload className="h-3.5 w-3.5" />
              {uploadingModel ? "上传中…" : "上传 GLB / GLTF"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <QuickTile
            asTrigger
            disabled={disabled}
            tone="hover:text-emerald-200"
            icon={<Box className="h-3.5 w-3.5 text-emerald-300" />}
            label="道具"
          />
          <DropdownMenuContent side="right" align="start" className={MENU_CLASS}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[10px] text-white/40">基础几何体</DropdownMenuLabel>
              {props.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => onAddBuiltin(m.id)} className={MENU_ITEM}>
                  <Box className="h-3.5 w-3.5 text-emerald-300" />
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenModel3d} className={MENU_ITEM}>
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              AI 生成 3D 道具…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <QuickTile
          disabled={disabled}
          onClick={onAddCamera}
          tone="hover:text-amber-200"
          icon={<Video className="h-3.5 w-3.5 text-amber-300" />}
          label="机位"
        />
        <QuickTile
          disabled={disabled}
          onClick={onOpenModel3d}
          tone="hover:text-fuchsia-200"
          icon={<Sparkles className="h-3.5 w-3.5 text-fuchsia-300" />}
          label="AI 3D"
        />
      </div>

      {/* 搜索 */}
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对象…"
          className="w-full rounded-lg border border-white/[0.06] bg-black/20 py-1.5 pl-8 pr-2 text-xs text-white/80 outline-none placeholder:text-white/25 focus:border-indigo-400/40"
        />
      </label>

      {/* 分组列表 */}
      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {objects.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center">
            <Sparkles className="h-5 w-5 text-white/25" />
            <p className="text-[11px] leading-relaxed text-white/35">
              空舞台。用上方按钮添加人物与机位，或打开「AI 导演」一句话布景。
            </p>
          </div>
        ) : null}
        {GROUPS.map((group) => {
          const items = grouped[group.id];
          if (objects.length === 0) return null;
          const isCollapsed = collapsed[group.id];
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))}
                className="flex items-center gap-1.5 rounded-md px-1 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/40 hover:text-white/70"
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                <span className={`h-1.5 w-1.5 rounded-full ${group.dot}`} />
                {group.label}
                <span className="ml-auto rounded bg-white/[0.06] px-1.5 font-mono text-[9px] normal-case tracking-normal text-white/45">
                  {items.length}
                </span>
              </button>
              {!isCollapsed
                ? items.map((obj) => {
                    const active = selectedId === obj.id;
                    const meta = rowMeta(obj);
                    return (
                      <div
                        key={obj.id}
                        className={`group relative flex items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1 text-xs transition-colors ${
                          active
                            ? "bg-gradient-to-r from-indigo-500/25 to-indigo-500/5 text-white"
                            : "text-white/60 hover:bg-white/[0.05] hover:text-white"
                        }`}
                      >
                        {active ? (
                          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-indigo-400" />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onSelect(obj.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {rowIcon(obj)}
                          <span className="min-w-0 flex-1 truncate">{obj.name}</span>
                          {meta ? (
                            <span className={`shrink-0 font-mono text-[9px] ${group.accent} opacity-70`}>{meta}</span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          title="删除"
                          aria-label={`删除 ${obj.name}`}
                          onClick={() => onRemove(obj.id)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/0 transition-colors hover:bg-red-500/15 hover:!text-red-300 group-hover:text-white/40"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
