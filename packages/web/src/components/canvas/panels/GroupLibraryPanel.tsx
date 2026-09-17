"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  X, Trash2, Layers, Play, Image as ImageIcon, Pencil,
  Search, Copy, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useCanvasStore } from "@/stores/canvasStore";
import { REFERENCE_INPUT_ID } from "@/lib/canvas/referencePort";
import {
  listNodeGroups,
  getNodeGroup,
  deleteNodeGroup,
  renameNodeGroup,
  updateNodeGroupTags,
  copyNodeGroupToProject,
  type NodeGroupListItem,
  type NodeGroupSort,
} from "@/lib/api/nodeGroups";
import { listProjects, listSharedProjects } from "@/lib/api/projects";
import { notifyAssetsUpdated } from "@/lib/api/assets";
import { setGroupDragData } from "@/lib/canvas/groupDrag";
import { buildOfficialTemplateSnapshot } from "@/lib/canvas/nodeGroup";
import { useProjectAssetManifest } from "@/lib/canvas/useProjectAssets";
import { ensureHttpsOssUrl } from "@/lib/signedUrl";
import type { Project } from "@/types";

const OFFICIAL = [
  {
    id: "t2i",
    label: "文生图",
    nodes: [
      { type: "text_input", position: { x: 300, y: 200 } },
      { type: "image_input", position: { x: 580, y: 200 } },
    ],
    edges: [{ source: 0, target: 1, sourceHandle: "text", targetHandle: REFERENCE_INPUT_ID }],
  },
  {
    id: "t2v",
    label: "文生视频",
    nodes: [
      { type: "text_input", position: { x: 300, y: 200 } },
      { type: "video_input", position: { x: 580, y: 200 } },
    ],
    edges: [{ source: 0, target: 1, sourceHandle: "text", targetHandle: REFERENCE_INPUT_ID }],
  },
  {
    id: "t2i2v",
    label: "文生图生视频",
    nodes: [
      { type: "text_input", position: { x: 300, y: 200 } },
      { type: "image_input", position: { x: 580, y: 200 } },
      { type: "video_input", position: { x: 860, y: 200 } },
    ],
    edges: [
      { source: 0, target: 1, sourceHandle: "text", targetHandle: REFERENCE_INPUT_ID },
      { source: 1, target: 2, sourceHandle: "image", targetHandle: REFERENCE_INPUT_ID },
    ],
  },
  {
    id: "i2v",
    label: "图生视频",
    nodes: [
      { type: "image_input", position: { x: 300, y: 200 } },
      { type: "video_input", position: { x: 580, y: 200 } },
    ],
    edges: [{ source: 0, target: 1, sourceHandle: "image", targetHandle: REFERENCE_INPUT_ID }],
  },
  {
    id: "i2t",
    label: "图生文",
    nodes: [
      { type: "image_input", position: { x: 300, y: 200 } },
      { type: "text_input", position: { x: 580, y: 200 } },
    ],
    edges: [{ source: 0, target: 1, sourceHandle: "image", targetHandle: REFERENCE_INPUT_ID }],
  },
  {
    id: "v2t",
    label: "视频转文本",
    nodes: [
      { type: "video_input", position: { x: 300, y: 200 } },
      { type: "text_input", position: { x: 580, y: 200 } },
    ],
    edges: [{ source: 0, target: 1, sourceHandle: "video", targetHandle: REFERENCE_INPUT_ID }],
  },
  {
    id: "t2a",
    label: "文生音频",
    nodes: [
      { type: "text_input", position: { x: 300, y: 200 } },
      { type: "audio_input", position: { x: 580, y: 200 } },
    ],
    edges: [{ source: 0, target: 1, sourceHandle: "text", targetHandle: REFERENCE_INPUT_ID }],
  },
];

const SORT_OPTIONS: { value: NodeGroupSort; label: string }[] = [
  { value: "updated_at", label: "最近更新" },
  { value: "created_at", label: "创建时间" },
  { value: "title", label: "名称" },
  { value: "node_count", label: "节点数" },
];

/**
 * 左侧「组」库面板：搜索/标签/排序、跨项目复制、官方模板。
 */
export function GroupLibraryPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const params = useParams<{ id: string }>();
  const projectId = params.id || "";
  const [tab, setTab] = useState<"official" | "mine">("mine");
  const [groups, setGroups] = useState<NodeGroupListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<NodeGroupSort>("updated_at");
  const [tagEditId, setTagEditId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [copyId, setCopyId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [copying, setCopying] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const { assets: manifest } = useProjectAssetManifest(isOpen ? projectId : "");

  const fetchGroups = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await listNodeGroups(projectId, {
        q: search.trim() || undefined,
        tag: tagFilter.trim() || undefined,
        sort,
        order: sort === "title" ? "asc" : "desc",
      });
      setGroups(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载组库失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, search, tagFilter, sort]);

  useEffect(() => {
    if (isOpen && tab === "mine") {
      const t = window.setTimeout(() => void fetchGroups(), 200);
      return () => window.clearTimeout(t);
    }
  }, [isOpen, tab, fetchGroups]);

  useEffect(() => {
    if (!isOpen) return;
    const onUpdated = () => {
      if (tab === "mine") void fetchGroups();
    };
    window.addEventListener("canvas:node-groups-updated", onUpdated);
    return () => window.removeEventListener("canvas:node-groups-updated", onUpdated);
  }, [isOpen, tab, fetchGroups]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const t of g.tags || []) set.add(t);
    }
    return [...set].sort();
  }, [groups]);

  const resolveThumb = (assetId: string | null | undefined): string | null => {
    if (!assetId) return null;
    const a = manifest.find((m) => String(m.id) === String(assetId));
    if (!a?.fileUrl) return null;
    return ensureHttpsOssUrl(a.fileUrl) || a.fileUrl;
  };

  const handleApplyOfficial = (wf: (typeof OFFICIAL)[number]) => {
    const snapshot = buildOfficialTemplateSnapshot(wf);
    useCanvasStore.getState().addGroupFromLibrary(snapshot);
    toast.success(`已添加「${wf.label}」组`);
    onClose();
  };

  const handleApplyGroup = async (item: NodeGroupListItem) => {
    try {
      const detail = await getNodeGroup(projectId, item.id);
      // 拉入前刷新素材清单，确保跨项目复制后的新 assetId 可解析预览
      notifyAssetsUpdated();
      const missing = (detail.snapshot.assets || []).filter(
        (a) => a.assetId && !manifest.some((m) => String(m.id) === String(a.assetId))
      );
      if (missing.length > 0) {
        toast.warning(`有 ${missing.length} 个素材已不在项目中，对应节点可能无预览`);
      }
      useCanvasStore.getState().addGroupFromLibrary(detail.snapshot);
      notifyAssetsUpdated();
      toast.success("已添加组到画布");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "应用组失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteNodeGroup(projectId, id);
      setGroups((prev) => prev.filter((g) => g.id !== id));
      toast.success("已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const commitRename = async (id: string) => {
    const title = editTitle.trim() || "未命名组";
    setEditingId(null);
    try {
      const updated = await renameNodeGroup(projectId, id, title);
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, title: updated.title } : g)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败");
      void fetchGroups();
    }
  };

  const commitTags = async (id: string) => {
    const tags = tagDraft
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 16);
    setTagEditId(null);
    try {
      const updated = await updateNodeGroupTags(projectId, id, tags);
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, tags: updated.tags || [] } : g)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新标签失败");
    }
  };

  const openCopy = async (id: string) => {
    setCopyId(id);
    try {
      const [owned, shared] = await Promise.all([listProjects(), listSharedProjects()]);
      const map = new Map<string, Project>();
      for (const p of [...owned, ...shared]) {
        if (String(p.id) !== String(projectId)) map.set(String(p.id), p);
      }
      setProjects([...map.values()]);
    } catch {
      toast.error("加载项目列表失败");
      setCopyId(null);
    }
  };

  const handleCopyTo = async (targetProjectId: string) => {
    if (!copyId) return;
    const sourceProjectId =
      (projectId || useCanvasStore.getState().projectId || "").trim();
    if (!sourceProjectId) {
      toast.error("当前项目未加载");
      return;
    }
    const target = projects.find((p) => String(p.id) === String(targetProjectId));
    const targetTitle = target?.title?.trim() || `项目 #${targetProjectId}`;
    setCopying(true);
    try {
      const created = await copyNodeGroupToProject({
        groupId: copyId,
        sourceProjectId,
        targetProjectId: String(targetProjectId),
        title: groups.find((g) => g.id === copyId)?.title,
      });
      if (!created?.id) {
        toast.error("复制响应异常，请刷新目标项目组库确认");
        return;
      }
      // 回读目标组库，避免「提示成功但未落库」
      const remote = await listNodeGroups(String(targetProjectId));
      const found = remote.some((g) => String(g.id) === String(created.id));
      if (!found) {
        toast.error(
          `复制未在「${targetTitle}」组库中生效（id=${created.id}），请检查权限后重试`
        );
        return;
      }
      toast.success(
        `已复制到「${targetTitle}」的组库。打开该项目 → 左侧「组」→ 拖到画布即可使用`
      );
      setCopyId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "跨项目复制失败");
    } finally {
      setCopying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 ${dragging ? "pointer-events-none" : ""}`}
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
        <div
          className="flex w-[560px] max-h-[620px] flex-col rounded-xl"
          style={{
            background: "rgba(10,10,30,0.97)",
            backdropFilter: "blur(32px)",
            WebkitBackdropFilter: "blur(32px)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-white/80">
              <Layers className="h-4 w-4 text-primary/80" />
              组
            </span>
            <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex gap-0 border-b border-white/5 px-4">
            {(["mine", "official"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs border-b-2 transition-colors ${
                  tab === t ? "border-primary text-white" : "border-transparent text-white/40 hover:text-white/70"
                }`}
              >
                {t === "mine" ? "我的组" : "官方"}
              </button>
            ))}
          </div>

          {tab === "mine" ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2">
              <div className="relative min-w-[140px] flex-1">
                <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/35" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索组名…"
                  className="h-7 w-full rounded-md border border-white/10 bg-white/5 pl-7 pr-2 text-[11px] text-white/80 outline-none placeholder:text-white/30"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as NodeGroupSort)}
                className="h-7 rounded-md border border-white/10 bg-white/5 px-2 text-[11px] text-white/70 outline-none"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {allTags.length > 0 ? (
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-7 max-w-[120px] rounded-md border border-white/10 bg-white/5 px-2 text-[11px] text-white/70 outline-none"
                >
                  <option value="">全部标签</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {tab === "official" ? (
              <div className="grid grid-cols-2 gap-2">
                {OFFICIAL.map((wf) => (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => handleApplyOfficial(wf)}
                    className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-white/15 hover:bg-white/[0.04] group"
                  >
                    <Play className="h-4 w-4 text-white/25 transition-colors group-hover:text-primary" />
                    <span className="text-sm text-white/80">{wf.label}</span>
                  </button>
                ))}
              </div>
            ) : loading ? (
              <div className="py-8 text-center text-xs text-white/25">加载中…</div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/25">
                暂无保存的组。在画布框选节点成组后点「保存到组库」。
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => {
                  const coverId = g.coverAssetId || g.assetIds[0];
                  const thumb = resolveThumb(coverId);
                  const assetThumbs = g.assetIds.slice(0, 4).map((aid) => ({
                    id: aid,
                    url: resolveThumb(aid),
                  }));
                  const isEditing = editingId === g.id;
                  return (
                    <div
                      key={g.id}
                      draggable={!isEditing && tagEditId !== g.id}
                      onDragStart={(e) => {
                        if (isEditing || tagEditId === g.id) {
                          e.preventDefault();
                          return;
                        }
                        setDragging(true);
                        setGroupDragData(e.dataTransfer, {
                          groupId: g.id,
                          projectId,
                          title: g.title,
                        });
                      }}
                      onDragEnd={() => setDragging(false)}
                      className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/15 group cursor-grab active:cursor-grabbing"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!isEditing && tagEditId !== g.id) void handleApplyGroup(g);
                        }}
                        className="flex flex-1 items-start gap-3 text-left min-w-0"
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/5">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-white/25" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <input
                              ref={editInputRef}
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") void commitRename(g.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className="w-full rounded bg-white/10 px-1.5 py-0.5 text-xs text-white outline-none"
                            />
                          ) : (
                            <div className="truncate text-xs text-white/80">{g.title}</div>
                          )}
                          <div className="mt-0.5 text-[10px] text-white/35">
                            {g.nodeCount} 个节点 · {g.assetIds.length} 个素材
                          </div>
                          {tagEditId === g.id ? (
                            <input
                              value={tagDraft}
                              onChange={(e) => setTagDraft(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") void commitTags(g.id);
                                if (e.key === "Escape") setTagEditId(null);
                              }}
                              placeholder="标签，逗号分隔"
                              className="mt-1 w-full rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white outline-none"
                              autoFocus
                            />
                          ) : (g.tags || []).length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {g.tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary/90"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {assetThumbs.length > 0 ? (
                            <div className="mt-1.5 flex gap-1">
                              {assetThumbs.map((t) => (
                                <div
                                  key={t.id}
                                  className="h-6 w-6 overflow-hidden rounded border border-white/10 bg-white/5"
                                >
                                  {t.url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={t.url} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[8px] text-white/20">
                                      ?
                                    </div>
                                  )}
                                </div>
                              ))}
                              {g.assetIds.length > 4 ? (
                                <span className="flex h-6 items-center text-[10px] text-white/30">
                                  +{g.assetIds.length - 4}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </button>
                      <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-all group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(g.id);
                            setEditTitle(g.title);
                          }}
                          className="text-white/25 hover:text-white/70"
                          title="重命名"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagEditId(g.id);
                            setTagDraft((g.tags || []).join(", "));
                          }}
                          className="text-white/25 hover:text-white/70"
                          title="标签"
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openCopy(g.id);
                          }}
                          className="text-white/25 hover:text-white/70"
                          title="复制到其他项目"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(g.id)}
                          className="text-white/15 hover:text-red-400"
                          title="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {copyId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div
            className="w-[360px] rounded-xl border border-white/10 p-4"
            style={{ background: "rgba(16,16,28,0.98)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-white/80">复制到项目</span>
              <button type="button" onClick={() => setCopyId(null)} className="text-white/40 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-white/40">
              复制到目标项目的「组」库（含素材），不会自动出现在对方画布上；进入该项目后打开左侧「组」再拖入即可。
            </p>
            {projects.length === 0 ? (
              <p className="py-4 text-center text-xs text-white/35">没有可写入的其他项目</p>
            ) : (
              <div className="max-h-60 space-y-1 overflow-y-auto">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={copying}
                    onClick={() => void handleCopyTo(String(p.id))}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-left text-xs text-white/75 hover:bg-white/10 disabled:opacity-50"
                  >
                    {p.title || "未命名项目"}
                  </button>
                ))}
              </div>
            )}
            {copying ? <p className="mt-2 text-center text-[10px] text-white/40">正在深拷贝素材…</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
