"use client";

/**
 * 导演台 AI 面板（借鉴 mcp-for-blender：对话驱动 3D 场景）。
 * - 对话模型 / 3D 生成模型由用户在顶部下拉自选（用自己的 API 密钥，本地版不涉及算力）；
 * - 每轮 AI 改场景前自动存快照，气泡上可「撤销本轮」；
 * - 可附项目图片作参考图（需所选对话模型支持看图）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Check, ImagePlus, Loader2, Send, Square, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { MediaAssetPicker } from "@/components/canvas/nodes/MediaAssetPicker";
import type { Asset } from "@/lib/api/assets";
import {
  clearFinishedDirectorModel3dJobs,
  useDirectorModel3dJobs,
} from "@/lib/director/model3dJobs";
import {
  loadDirectorSession,
  runDirectorAgentTurn,
  saveDirectorSession,
  type DirectorAgentHost,
  type DirectorAgentSession,
  type DirectorChatImage,
  type DirectorChatMessage,
} from "@/lib/director/agent/session";
import { localStore } from "@/lib/local/store";
import type { LocalModel } from "@/lib/local/types";

const EXAMPLES = [
  "按关联分镜搭建场景：摆好人物和道具，放一个摄像机取景后截图",
  "两个人在咖啡馆对坐聊天，给一个过肩镜头和一个双人中景",
  "把布光改成逆光剪影，人物改成奔跑姿态",
  "生成一把复古木椅放在角色旁边",
];

/** 本地模型列表（打开时加载；reload 用于用户刚在设置里新增 / 首次加载失败后重试） */
export function useLocalModels(active: boolean): { models: LocalModel[]; reload: () => void } {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    localStore()
      .listModels()
      .then((list) => {
        if (alive) setModels(list.filter((m) => m.enabled !== false));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [active, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { models, reload };
}

/** 模型下拉：主分类在前，其余模型放「其它模型」分组，允许用户任意选择 */
export function DirectorModelSelect({
  models,
  primaryCategory,
  value,
  onChange,
  disabled,
  emptyLabel,
  allowNone,
}: {
  models: LocalModel[];
  primaryCategory: LocalModel["category"];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  emptyLabel: string;
  allowNone?: string;
}) {
  const primary = models.filter((m) => m.category === primaryCategory);
  const others = models.filter((m) => m.category !== primaryCategory);
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 truncate rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-white/80"
    >
      {allowNone ? (
        <option value="" className="bg-zinc-900">
          {allowNone}
        </option>
      ) : !models.length ? (
        <option value="" className="bg-zinc-900">
          {emptyLabel}
        </option>
      ) : null}
      {primary.map((m) => (
        <option key={m.id} value={m.id} className="bg-zinc-900">
          {m.displayName || m.name}
        </option>
      ))}
      {others.length ? (
        <optgroup label="其它模型" className="bg-zinc-900">
          {others.map((m) => (
            <option key={m.id} value={m.id} className="bg-zinc-900">
              {m.displayName || m.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}

function ResultList({ message }: { message: DirectorChatMessage }) {
  return (
    <div className="space-y-0.5 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
      {(message.results ?? []).map((r, i) => (
        <div key={i} className={`flex gap-1 text-[10px] leading-relaxed ${r.ok ? "text-emerald-300/85" : "text-red-300/90"}`}>
          {r.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <X className="mt-0.5 h-3 w-3 shrink-0" />}
          <span className="break-all">{r.message}</span>
        </div>
      ))}
    </div>
  );
}

export function DirectorAgentPanel({
  host,
  onClose,
}: {
  host: DirectorAgentHost;
  onClose: () => void;
}) {
  const { projectId, nodeId } = host;
  const [session, setSession] = useState<DirectorAgentSession>(() => loadDirectorSession(projectId, nodeId));
  const sessionRef = useRef(session);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<DirectorChatImage[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { models, reload: reloadModels } = useLocalModels(true);
  const jobs = useDirectorModel3dJobs(projectId, nodeId);

  const commit = useCallback(
    (updater: (prev: DirectorAgentSession) => DirectorAgentSession) => {
      const next = updater(sessionRef.current);
      sessionRef.current = next;
      setSession(next);
      saveDirectorSession(projectId, nodeId, next);
    },
    [projectId, nodeId]
  );

  const textModels = useMemo(() => models.filter((m) => m.category === "text" || !m.category), [models]);
  const chatModelId =
    session.chatModelId && models.some((m) => m.id === session.chatModelId)
      ? session.chatModelId
      : textModels[0]?.id || "";
  const model3dModelId =
    session.model3dModelId && models.some((m) => m.id === session.model3dModelId) ? session.model3dModelId : "";

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [session.messages.length, busy, jobs.length]);

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || busy) return;
      if (!chatModelId) {
        toast.error("请先选择对话模型（在「设置」中添加文本模型）");
        return;
      }
      setInput("");
      const attached = images;
      setImages([]);
      setBusy(true);
      stopRef.current = false;
      const m3d = models.find((m) => m.id === model3dModelId);
      try {
        await runDirectorAgentTurn({
          host,
          session: { ...sessionRef.current, chatModelId, model3dModelId },
          userText: text,
          images: attached,
          model3dLabel: m3d ? m3d.displayName || m3d.name : undefined,
          shouldStop: () => stopRef.current,
          onMessages: (messages) => commit((prev) => ({ ...prev, chatModelId, model3dModelId, messages })),
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, chatModelId, commit, host, images, input, model3dModelId, models]
  );

  /** 撤销本轮：恢复该轮执行前快照，其后各轮的改动一并失效 */
  const undoRound = useCallback(
    (msg: DirectorChatMessage) => {
      if (!msg.undoSnapshot) return;
      host.replaceScene(structuredClone(msg.undoSnapshot));
      commit((prev) => {
        const idx = prev.messages.findIndex((m) => m.id === msg.id);
        return {
          ...prev,
          messages: prev.messages.map((m, i) => (i >= idx && m.undoSnapshot ? { ...m, undone: true } : m)),
        };
      });
      toast.success("已撤销到这一轮之前的场景");
    },
    [commit, host]
  );

  const addImage = useCallback((asset: Asset) => {
    setPickerOpen(false);
    setImages((prev) =>
      prev.some((i) => i.assetId === asset.id) || prev.length >= 4
        ? prev
        : [...prev, { assetId: asset.id, url: asset.fileUrl, title: asset.title || "参考图" }]
    );
  }, []);

  const runningJobs = jobs.filter((j) => j.status === "running");

  return (
    // 浮层覆盖在右侧属性栏上，不挤压 3D 视口（窄屏下也不会被截断）
    <aside
      className="absolute bottom-3 right-3 top-3 z-40 flex w-[340px] max-w-[90%] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[rgba(13,13,21,0.9)] shadow-[0_16px_48px_rgba(0,0,0,0.55)] ring-1 ring-fuchsia-400/10 backdrop-blur-xl"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Bot className="h-4 w-4 text-indigo-300" />
        <span className="text-xs font-medium text-white/85">AI 导演</span>
        <span className="text-[10px] text-white/35">对话搭场景</span>
        <button
          type="button"
          onClick={() => commit((prev) => ({ ...prev, messages: [] }))}
          disabled={busy || !session.messages.length}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-30"
          title="清空会话"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-white/45 hover:bg-white/10 hover:text-white"
          title="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] text-white/45">对话模型</span>
          <DirectorModelSelect
            models={models}
            primaryCategory="text"
            value={chatModelId}
            disabled={busy}
            emptyLabel="未配置模型"
            onChange={(id) => commit((prev) => ({ ...prev, chatModelId: id }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] text-white/45">3D 生成</span>
          <DirectorModelSelect
            models={models}
            primaryCategory="model3d"
            value={model3dModelId}
            disabled={busy}
            emptyLabel="未配置模型"
            allowNone="不使用（仅用体块搭建）"
            onChange={(id) => commit((prev) => ({ ...prev, model3dModelId: id }))}
          />
        </div>
        {!models.length ? (
          <p className="text-[10px] leading-relaxed text-amber-300/80">
            还没有可用模型，请先到{" "}
            <Link href="/settings" className="underline">
              设置
            </Link>{" "}
            添加文本模型；3D 生成可添加 Tripo 等「3D 模型」。
            <button type="button" onClick={reloadModels} className="ml-1 text-indigo-300 underline">
              刷新
            </button>
          </p>
        ) : null}
      </div>

      {jobs.length ? (
        <div className="space-y-1 border-b border-white/10 px-3 py-2">
          <div className="flex items-center text-[10px] text-white/45">
            3D 生成任务
            {jobs.length > runningJobs.length ? (
              <button
                type="button"
                onClick={() => clearFinishedDirectorModel3dJobs(projectId, nodeId)}
                className="ml-auto text-white/35 hover:text-white/70"
              >
                清除已结束
              </button>
            ) : null}
          </div>
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center gap-1.5 text-[10px]">
              {j.status === "running" ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-300" />
              ) : j.status === "succeeded" ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-300" />
              ) : (
                <X className="h-3 w-3 shrink-0 text-red-300" />
              )}
              <span className="truncate text-white/75">{j.name}</span>
              <span className="ml-auto shrink-0 truncate text-white/35" title={j.error}>
                {j.status === "running" ? j.progress ?? "生成中" : j.status === "succeeded" ? "已放入场景" : "失败"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!session.messages.length ? (
          <div className="space-y-1.5">
            <p className="text-[10px] leading-relaxed text-white/40">
              用自然语言描述画面，AI 会读取当前场景并摆放人物、道具、摄像机和灯光；每轮改动都可撤销。
            </p>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                disabled={busy}
                onClick={() => void send(ex)}
                className="block w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-left text-[11px] text-white/65 hover:bg-white/[0.07]"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        {session.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-6 rounded-lg bg-indigo-500/25 px-2.5 py-1.5 text-[11px] leading-relaxed text-white/90">
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              {m.images?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={img.assetId} src={img.url} alt={img.title} className="h-10 w-10 rounded object-cover" />
                  ))}
                </div>
              ) : null}
            </div>
          ) : m.role === "assistant" ? (
            <div
              key={m.id}
              className={`mr-4 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed ${
                m.error ? "bg-red-500/15 text-red-200" : "bg-white/[0.06] text-white/85"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
              {m.undoSnapshot ? (
                <button
                  type="button"
                  disabled={busy || m.undone}
                  onClick={() => undoRound(m)}
                  className="mt-1 flex items-center gap-1 text-[10px] text-indigo-300 hover:text-indigo-200 disabled:text-white/30"
                >
                  <Undo2 className="h-3 w-3" />
                  {m.undone ? "已撤销" : "撤销本轮"}
                </button>
              ) : null}
            </div>
          ) : (
            <div key={m.id} className="mr-4">
              <ResultList message={m} />
            </div>
          )
        )}
        {busy ? (
          <div className="flex items-center gap-1.5 text-[10px] text-white/45">
            <Loader2 className="h-3 w-3 animate-spin" />
            AI 正在布置场景…
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 p-2">
        {images.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {images.map((img) => (
              <div key={img.assetId} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.title} className="h-10 w-10 rounded object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((i) => i.assetId !== img.assetId))}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/80 text-white/80"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder="描述想要的画面，Enter 发送，Shift+Enter 换行"
          className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-indigo-400/50"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy || images.length >= 4}
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-white/55 hover:bg-white/10 hover:text-white disabled:opacity-30"
            title="附项目图片作参考图（需对话模型支持看图）"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            参考图
          </button>
          {busy ? (
            <button
              type="button"
              onClick={() => {
                stopRef.current = true;
              }}
              className="ml-auto flex items-center gap-1 rounded-md bg-red-500/25 px-2 py-1 text-[10px] text-red-100"
            >
              <Square className="h-3 w-3" />
              停止
            </button>
          ) : (
            <button
              type="button"
              disabled={!input.trim() || !chatModelId}
              onClick={() => void send()}
              className="ml-auto flex items-center gap-1 rounded-md bg-indigo-500/40 px-2 py-1 text-[10px] text-white disabled:opacity-30"
            >
              <Send className="h-3 w-3" />
              发送
            </button>
          )}
        </div>
      </div>

      {pickerOpen ? (
        <MediaAssetPicker category="image" onSelect={addImage} onClose={() => setPickerOpen(false)} overlayZIndex={130} />
      ) : null}
    </aside>
  );
}
