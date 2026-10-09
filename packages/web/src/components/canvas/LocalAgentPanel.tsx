"use client";

/**
 * 开源本地版 Agent：多会话 + 历史；视觉对齐项目画板 / 导演台毛玻璃。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  AtSign,
  History,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AgentMarkdown } from "@/components/canvas/AgentMarkdown";
import { AgentNodeRefChip, AgentNodeRefChipRow } from "@/components/canvas/AgentNodeRefChips";
import {
  getAgentCanvasBusy,
  isAgentTurnAbortedError,
  requestAgentCanvasStop,
  subscribeAgentCanvasBusy,
} from "@/lib/canvas/agentCanvasBusy";
import {
  buildAgentNodeRef,
  enrichAgentNodeRef,
  typeLabelForNode,
  type AgentNodeRef,
} from "@/lib/canvas/agentNodeRefs";
import { localAssetFileUrl } from "@/lib/local/agent/tools/resolveCanvasMedia";
import {
  createNewSession,
  deleteSession,
  emptyInbox,
  getActiveSession,
  loadAgentInbox,
  newMessageId,
  runLocalAgentTurn,
  saveAgentInbox,
  switchSession,
  upsertActiveSession,
  type LocalAgentInbox,
  type LocalAgentMessage,
  type LocalAgentSession,
} from "@/lib/local/agent/session";
import { localStore } from "@/lib/local/store";
import type { LocalModel } from "@/lib/local/types";
import {
  listAgentSkills,
  loadSkillPrompt,
  type AgentSkillMeta,
} from "@/lib/local/agent/skills";
import { cn } from "@/lib/utils";
import { useCanvasStore } from "@/stores/canvasStore";
import "./localAgentPanel.css";

const EXAMPLES = [
  "帮我梳理一下当前画布",
  "新建一个图片节点：赛博朋克雨夜街道，霓虹灯，电影感",
  "把选中节点的提示词优化得更具体",
  "给这张图做一个多角度",
  "用看图描述选中的图片节点",
  "做一页产品介绍静态网页并预览",
];

const MENTION_LIMIT = 40;

function focusCanvasNode(nodeId: string) {
  const s = useCanvasStore.getState();
  const node = s.nodes.find((n) => n.id === nodeId);
  if (!node) {
    toast.message("节点已不在画布上");
    return;
  }
  s.selectNode(nodeId);
  const w = node.measured?.width ?? node.width ?? 240;
  const h = node.measured?.height ?? node.height ?? 200;
  s.centerFlowView?.(node.position.x + w / 2, node.position.y + h / 2);
}

function refFromNodeId(nodeId: string): AgentNodeRef | null {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  return node ? buildAgentNodeRef(node) : null;
}

async function refFromNodeIdEnriched(
  projectId: string,
  nodeId: string
): Promise<AgentNodeRef | null> {
  const base = refFromNodeId(nodeId);
  if (!base) return null;
  return enrichAgentNodeRef(projectId, base);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBase64(dataUrl: string): { b64: string; mime: string } {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return { b64: dataUrl, mime: "image/jpeg" };
  return { mime: m[1] || "image/jpeg", b64: m[2] || "" };
}

function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function OpResultList({ msg }: { msg: LocalAgentMessage }) {
  const results = msg.results || [];
  if (!results.length) return null;
  return (
    <div className="mr-4 space-y-0.5 rounded-lg border border-border/50 bg-background/35 px-2.5 py-1.5 text-[11px]">
      {results.map((r, i) => (
        <div key={i} className="flex items-start gap-1.5">
          {r.ok ? (
            <span className="mt-0.5 text-emerald-500">✓</span>
          ) : (
            <span className="mt-0.5 text-destructive">✕</span>
          )}
          <span className={cn("min-w-0 flex-1 break-words", r.ok ? "text-foreground/80" : "text-destructive")}>
            {r.message}
          </span>
          {r.nodeId ? (
            <button
              type="button"
              className="shrink-0 text-primary/80 hover:text-primary"
              onClick={() => focusCanvasNode(r.nodeId!)}
            >
              定位
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 展示助手本轮计划调用的工具（执行结果仍由后续 tool 气泡显示） */
function ToolCallPlan({ calls }: { calls: NonNullable<LocalAgentMessage["toolCalls"]> }) {
  if (!calls.length) return null;
  return (
    <div className="mt-1.5 space-y-0.5 rounded-md border border-border/40 bg-muted/25 px-2 py-1 text-[10px] text-muted-foreground">
      <div className="font-medium text-foreground/70">计划工具</div>
      {calls.map((c) => (
        <div key={c.id} className="truncate font-mono">
          → {c.name}
        </div>
      ))}
    </div>
  );
}

export function LocalAgentPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [skills, setSkills] = useState<AgentSkillMeta[]>([]);
  const [inbox, setInbox] = useState<LocalAgentInbox>(emptyInbox);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [refs, setRefs] = useState<AgentNodeRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inboxRef = useRef<LocalAgentInbox>(inbox);
  /** 流式刷新只更新 UI，落盘防抖，避免每 token 写盘 */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<LocalAgentInbox | null>(null);

  const canvasBusy = useSyncExternalStore(subscribeAgentCanvasBusy, getAgentCanvasBusy, getAgentCanvasBusy);
  const nodes = useCanvasStore((s) => s.nodes);
  const session = getActiveSession(inbox);

  const textModels = useMemo(
    () => models.filter((m) => m.enabled !== false && (m.category === "text" || !m.category)),
    [models]
  );
  const modelId =
    session.modelId && textModels.some((m) => m.id === session.modelId)
      ? session.modelId
      : textModels[0]?.id || "";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    localStore()
      .listModels()
      .then((list) => {
        if (alive) setModels(list);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setModelsLoaded(true);
      });
    listAgentSkills()
      .then((list) => {
        if (alive) setSkills(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    let alive = true;
    loadAgentInbox(projectId).then((box) => {
      if (!alive) return;
      inboxRef.current = box;
      setInbox(box);
      setLoadedProjectId(projectId);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [session.messages, open, canvasBusy.message, historyOpen]);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const box = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (!box || loadedProjectId !== projectId) return;
    void saveAgentInbox(projectId, box).catch(() => {});
  }, [loadedProjectId, projectId]);

  const scheduleSave = useCallback(
    (box: LocalAgentInbox) => {
      pendingSaveRef.current = box;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const next = pendingSaveRef.current;
        pendingSaveRef.current = null;
        if (!next || loadedProjectId !== projectId) return;
        void saveAgentInbox(projectId, next).catch(() => {});
      }, 450);
    },
    [loadedProjectId, projectId]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      const box = pendingSaveRef.current;
      if (box && loadedProjectId === projectId) {
        void saveAgentInbox(projectId, box).catch(() => {});
      }
    };
  }, [loadedProjectId, projectId]);

  const commitInbox = useCallback(
    (updater: (prev: LocalAgentInbox) => LocalAgentInbox, opts?: { flush?: boolean }) => {
      const next = updater(inboxRef.current);
      inboxRef.current = next;
      setInbox(next);
      if (loadedProjectId !== projectId) return;
      if (opts?.flush) {
        pendingSaveRef.current = next;
        flushSave();
      } else {
        scheduleSave(next);
      }
    },
    [flushSave, loadedProjectId, projectId, scheduleSave]
  );

  const commitSession = useCallback(
    (updater: (prev: LocalAgentSession) => LocalAgentSession, opts?: { flush?: boolean }) => {
      commitInbox((prev) => upsertActiveSession(prev, updater), opts);
    },
    [commitInbox]
  );

  const addRef = useCallback((ref: AgentNodeRef | null) => {
    if (!ref) return;
    setRefs((prev) => (prev.some((r) => r.nodeId === ref.nodeId) ? prev : [...prev, ref]));
  }, []);

  const addRefById = useCallback(
    async (nodeId: string) => {
      addRef(await refFromNodeIdEnriched(projectId, nodeId));
    },
    [addRef, projectId]
  );

  const openNodeRefPicker = () => {
    const s = useCanvasStore.getState();
    const ids = new Set<string>(s.selectedFlowIds || []);
    if (s.selectedNodeId) ids.add(s.selectedNodeId);
    if (ids.size) void Promise.all([...ids].map((id) => addRefById(id)));
    setPickerOpen((v) => !v);
    setMention(null);
    inputRef.current?.focus();
  };

  const onUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) {
      toast.message("请选择图片文件");
      return;
    }
    for (const file of list) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const { b64, mime } = dataUrlToBase64(dataUrl);
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        const id = newMessageId();
        const fileName = `agent-upload-${id}.${ext}`;
        let thumbUrl = dataUrl;
        try {
          const saved = await localStore().writeAsset(projectId, fileName, b64);
          await localStore().registerAssetMeta(projectId, {
            id,
            fileName,
            title: file.name || fileName,
            category: "image",
            subcategory: null,
            fileType: mime,
            fileSize: file.size,
            createdAt: new Date().toISOString(),
          });
          thumbUrl = saved.fileUrl.startsWith("data:")
            ? dataUrl
            : localAssetFileUrl(projectId, {
                id,
                fileName,
                title: file.name || fileName,
                category: "image",
                subcategory: null,
                fileType: mime,
                fileSize: file.size,
                createdAt: new Date().toISOString(),
              }) || saved.fileUrl;
        } catch {
          /* data URL 兜底 */
        }
        addRef({
          nodeId: `upload:${id}`,
          label: file.name || "上传图片",
          nodeType: "upload",
          thumbUrl,
          assetId: id,
          hasMedia: true,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传失败");
      }
    }
    inputRef.current?.focus();
  };

  const mentionCandidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim().toLowerCase();
    return nodes
      .filter((n) => {
        if (!q) return true;
        const label = String(n.data?.label || "").toLowerCase();
        return (
          label.includes(q) ||
          n.id.toLowerCase().includes(q) ||
          typeLabelForNode(String(n.type || "")).toLowerCase().includes(q)
        );
      })
      .slice(0, MENTION_LIMIT);
  }, [mention, nodes]);

  const pickerCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return nodes
      .filter((n) => {
        if (!q) return true;
        const label = String(n.data?.label || "").toLowerCase();
        return (
          label.includes(q) ||
          n.id.toLowerCase().includes(q) ||
          typeLabelForNode(String(n.type || "")).toLowerCase().includes(q)
        );
      })
      .slice(0, 40);
  }, [pickerQuery, nodes]);

  const onInputChange = (value: string, caret: number) => {
    setInput(value);
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]*)$/.exec(before);
    if (m) {
      setMention({ start: caret - m[2].length - 1, query: m[2] });
      setMentionIndex(0);
    } else {
      setMention(null);
    }
  };

  const pickMention = (nodeId: string) => {
    if (!mention) return;
    void addRefById(nodeId);
    const end = mention.start + 1 + mention.query.length;
    setInput((v) => v.slice(0, mention.start) + v.slice(end));
    setMention(null);
    inputRef.current?.focus();
  };

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if ((!text && !refs.length) || busy) return;
    if (!modelId) {
      toast.error("请先在「设置」中添加并启用一个文本模型");
      return;
    }
    const enriched = await Promise.all(refs.map((r) => enrichAgentNodeRef(projectId, r)));
    const userMsg: LocalAgentMessage = {
      id: newMessageId(),
      role: "user",
      content: text,
      refs: enriched.length ? enriched : undefined,
      createdAt: new Date().toISOString(),
    };
    const history = getActiveSession(inboxRef.current).messages;
    setInput("");
    setRefs([]);
    setMention(null);
    setPickerOpen(false);
    commitSession((prev) => ({ ...prev, modelId, messages: [...prev.messages, userMsg] }));
    setBusy(true);
    try {
      const dollar = /(?:^|\s)\$([a-zA-Z0-9][\w-]*)/.exec(text);
      let skillSlug = getActiveSession(inboxRef.current).activeSkillSlug || null;
      if (dollar?.[1]) {
        const hit = skills.find((s) => s.slug === dollar[1] || s.name === dollar[1]);
        if (hit) {
          skillSlug = hit.slug;
          commitSession((prev) => ({ ...prev, activeSkillSlug: hit.slug }));
        }
      }
      const skillPrompt = skillSlug ? await loadSkillPrompt(skillSlug) : "";
      await runLocalAgentTurn({
        projectId,
        modelId,
        models,
        history,
        userMessage: userMsg,
        queryClient,
        skillPrompt: skillPrompt || undefined,
        activeSkillSlug: skillSlug,
        memory: getActiveSession(inboxRef.current).memory,
        onMessage: (msg) =>
          commitSession((prev) => {
            const idx = prev.messages.findIndex((m) => m.id === msg.id);
            if (idx >= 0) {
              const messages = [...prev.messages];
              messages[idx] = msg;
              return { ...prev, messages };
            }
            return { ...prev, messages: [...prev.messages, msg] };
          }),
        onMemoryUpdate: (memory) => commitSession((prev) => ({ ...prev, memory })),
      });
    } catch (err) {
      if (isAgentTurnAbortedError(err)) return;
      const msg = err instanceof Error ? err.message : "调用模型失败";
      toast.error(msg);
      commitSession((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { id: newMessageId(), role: "assistant", content: `（失败）${msg}`, createdAt: new Date().toISOString() },
        ],
      }));
    } finally {
      setBusy(false);
      flushSave();
    }
  };

  const stop = () => {
    requestAgentCanvasStop();
    setBusy(false);
    flushSave();
    toast.message("已停止");
  };

  const onNewChat = () => {
    if (busy) {
      toast.message("请先停止当前回复");
      return;
    }
    commitInbox((prev) => createNewSession(prev));
    setRefs([]);
    setInput("");
    setHistoryOpen(false);
    toast.message("已新建会话");
  };

  const onSwitchSession = (id: string) => {
    if (busy) {
      toast.message("请先停止当前回复");
      return;
    }
    commitInbox((prev) => switchSession(prev, id));
    setRefs([]);
    setInput("");
  };

  const onDeleteSession = (id: string) => {
    if (busy) return;
    commitInbox((prev) => deleteSession(prev, id));
    toast.message("已删除会话");
  };

  const statusText = canvasBusy.busy ? canvasBusy.message : busy ? "思考中…" : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="la-fab"
        title="画布助手"
        aria-label="画布助手"
      >
        <span className="la-fab-icon">{open ? <X className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}</span>
        <span className="la-fab-label">{open ? "收起" : "画布助手"}</span>
        {busy && !open ? <span className="la-fab-pulse" /> : null}
      </button>

      {open ? (
        <div className="la-shell">
          <div className="la-head">
            <div className="la-head-row">
              <div className="la-brand">
                <span className="la-brand-mark">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="la-brand-text">
                  <p className="la-brand-title">画布助手</p>
                  <p className="la-brand-sub">{session.title || "新对话"}</p>
                </div>
              </div>
              <button
                type="button"
                className="la-icon-btn"
                title="新建会话"
                disabled={busy}
                onClick={onNewChat}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={cn("la-icon-btn", historyOpen && "is-on")}
                title="历史会话"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="la-icon-btn"
                title="关闭"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="la-selects">
              <select
                className="la-select"
                value={modelId}
                disabled={busy}
                onChange={(e) => commitSession((prev) => ({ ...prev, modelId: e.target.value }))}
                title="对话模型"
              >
                {textModels.length === 0 ? (
                  <option value="">未配置文本模型</option>
                ) : (
                  textModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName || m.name}
                    </option>
                  ))
                )}
              </select>
              <select
                className="la-select"
                value={session.activeSkillSlug || ""}
                disabled={busy}
                onChange={(e) =>
                  commitSession((prev) => ({
                    ...prev,
                    activeSkillSlug: e.target.value || null,
                  }))
                }
                title="技能"
              >
                <option value="">无技能</option>
                {skills.map((s) => (
                  <option key={s.slug} value={s.slug} title={s.description}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {session.activeSkillSlug ? (
            <div className="la-skill-bar">
              技能 <strong className="text-primary">{session.activeSkillSlug}</strong> 已启用
            </div>
          ) : null}

          <div className="la-body">
            {historyOpen ? (
              <aside className="la-history">
                <div className="la-history-head">
                  <span>历史</span>
                  <span>{inbox.sessions.length}</span>
                </div>
                <div className="la-history-list">
                  {inbox.sessions.map((s) => (
                    <div
                      key={s.id}
                      className={cn("la-history-item", s.id === session.id && "is-active")}
                    >
                      <button type="button" className="w-full text-left" onClick={() => onSwitchSession(s.id)}>
                        <div className="la-history-title">{s.title || "新对话"}</div>
                        <div className="la-history-meta">
                          {formatSessionTime(s.updatedAt)} · {s.messages.filter((m) => m.role !== "tool").length} 条
                        </div>
                      </button>
                      <button
                        type="button"
                        className="la-history-del"
                        onClick={() => onDeleteSession(s.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </aside>
            ) : null}

            <div ref={listRef} className="la-messages">
              {modelsLoaded && textModels.length === 0 ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground/90">
                  还没有可用的文本模型。请先到{" "}
                  <Link href="/settings" className="text-primary underline">
                    设置
                  </Link>{" "}
                  添加一个文本模型。
                </div>
              ) : null}

              {session.messages.length === 0 ? (
                <div className="la-empty">
                  <div>
                    <p className="la-empty-kicker">读画布 · 改节点 · 生图视频</p>
                    <p className="la-empty-desc">
                      引用节点、看图、生图/生视频、写静态网页。点左上「历史」切换旧会话，或「新建」开一局干净对话。
                    </p>
                  </div>
                  <div className="la-examples">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        className="la-example"
                        disabled={busy || !modelId}
                        onClick={() => void send(ex)}
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                session.messages.map((m) =>
                  m.role === "tool" ? (
                    <OpResultList key={m.id} msg={m} />
                  ) : (
                    <div key={m.id} className={cn("la-bubble", m.role === "user" ? "user" : "assistant")}>
                      {m.refs?.length ? (
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {m.refs.map((r) => (
                            <AgentNodeRefChip
                              key={r.nodeId}
                              refItem={r}
                              onFocus={() => {
                                if (r.nodeId.startsWith("upload:")) return;
                                focusCanvasNode(r.nodeId);
                              }}
                            />
                          ))}
                        </div>
                      ) : null}
                      {m.content ? (
                        m.role === "assistant" ? (
                          <AgentMarkdown content={m.content} />
                        ) : (
                          <div className="whitespace-pre-wrap break-words">{m.content}</div>
                        )
                      ) : null}
                      {m.role === "assistant" && m.toolCalls?.length ? (
                        <ToolCallPlan calls={m.toolCalls} />
                      ) : null}
                    </div>
                  )
                )
              )}
              {statusText ? (
                <div className="la-status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  {statusText}
                </div>
              ) : null}
            </div>
          </div>

          <div className="la-foot">
            {pickerOpen ? (
              <div className="la-pop">
                <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
                  <input
                    autoFocus
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="搜索节点…"
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  />
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setPickerOpen(false);
                      setPickerQuery("");
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto p-1">
                  {pickerCandidates.length === 0 ? (
                    <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">无匹配节点</div>
                  ) : (
                    pickerCandidates.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          void addRefById(n.id);
                          setPickerOpen(false);
                          setPickerQuery("");
                          inputRef.current?.focus();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{String(n.data?.label || n.id)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {typeLabelForNode(String(n.type || ""))}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
            {mention && mentionCandidates.length > 0 ? (
              <div className="la-pop">
                <div className="max-h-60 overflow-y-auto p-1">
                  {mentionCandidates.map((n, i) => (
                    <button
                      key={n.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMention(n.id);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                        i === mentionIndex ? "bg-primary/15" : "hover:bg-muted"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{String(n.data?.label || n.id)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {typeLabelForNode(String(n.type || ""))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <AgentNodeRefChipRow
              refs={refs}
              onRemove={(id) => setRefs((prev) => prev.filter((r) => r.nodeId !== id))}
              onFocus={(id) => {
                if (id.startsWith("upload:")) return;
                focusCanvasNode(id);
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void onUploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="la-composer">
              <button
                type="button"
                className="la-icon-btn"
                onClick={openNodeRefPicker}
                title="引用节点"
              >
                <AtSign className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="la-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                title="上传图片"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <textarea
                ref={inputRef}
                rows={2}
                placeholder="描述想法… @引用节点"
                value={input}
                onChange={(e) => onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
                onKeyDown={(e) => {
                  if (mention && mentionCandidates.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickMention(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)].id);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setMention(null);
                      return;
                    }
                  }
                  if (e.key === "Escape" && pickerOpen) {
                    e.preventDefault();
                    setPickerOpen(false);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {busy || canvasBusy.busy ? (
                <button type="button" className="la-send is-stop" onClick={stop} title="停止">
                  <Square className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  className="la-send"
                  onClick={() => void send()}
                  disabled={!input.trim() && !refs.length}
                  title="发送"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
