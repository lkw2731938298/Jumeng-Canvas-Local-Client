"use client";

/**
 * 开源本地版 Agent：使用「本地设置」里配置的文本模型对话（无云端 Skill）。
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/lib/local/store";
import { localGenerateText } from "@/lib/local/generate";
import type { LocalModel } from "@/lib/local/types";

type ChatMsg = { role: "user" | "assistant"; content: string };

export function LocalAgentPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const list = (await localStore().listModels()).filter(
        (m) => m.enabled !== false && (m.category === "text" || !m.category)
      );
      setModels(list);
      if (!modelId && list[0]) setModelId(list[0].id);
    })();
  }, [open, modelId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    if (!modelId) {
      toast.error("请先在「本地设置」添加文本模型");
      return;
    }
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setBusy(true);
    try {
      // 带上短上下文，便于连续对话
      const history = messages
        .slice(-6)
        .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`)
        .join("\n");
      const fullPrompt = history
        ? `${history}\n用户: ${prompt}\n助手:`
        : prompt;
      const reply = await localGenerateText({
        modelId,
        prompt: fullPrompt,
        system:
          "你是开源画布本地助手。帮助用户写提示词、拆解分镜或解释节点操作。简洁回答，不要编造云端账号或算力。",
      });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "生成失败";
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `（失败）${msg}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90"
        title="本地 Agent"
        aria-label="本地 Agent"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </button>

      {open ? (
        <div className="fixed bottom-20 right-6 z-50 flex h-[420px] w-[360px] flex-col overflow-hidden rounded-xl border border-border bg-popover/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-sm font-medium text-foreground">本地 Agent</span>
            <span className="truncate text-[10px] text-muted-foreground" title={projectId}>
              模型自配 · 无云端 Skill
            </span>
          </div>

          <div className="border-b border-border px-3 py-2">
            <label className="mb-1 block text-[11px] text-muted-foreground">文本模型</label>
            <select
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            >
              {models.length === 0 ? (
                <option value="">请先在本地设置添加模型</option>
              ) : (
                models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {messages.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                用你在「本地设置」配置的模型对话。可写提示词、问节点用法等。
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={`${i}-${m.role}`}
                  className={`rounded-lg px-2.5 py-1.5 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "ml-6 bg-primary/15 text-foreground"
                      : "mr-6 bg-muted/60 text-foreground/90"
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2 border-t border-border p-2">
            <input
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary/50"
              placeholder="输入消息…"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
