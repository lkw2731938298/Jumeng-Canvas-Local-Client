"use client";

/**
 * 开源本地版：本机生成任务列表（对齐商业管理端「生成任务」的查看 + 同步上游）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CloudDownload,
  KeyRound,
  ListTodo,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";
import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
import { localStore } from "@/lib/local/store";
import type { LocalGenerationJob } from "@/lib/local/generationJobs";

const STATUS_ZH: Record<LocalGenerationJob["status"], string> = {
  running: "进行中",
  succeeded: "成功",
  failed: "失败",
};

const CAT_ZH: Record<LocalGenerationJob["category"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
  tool: "工具",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

/** 自动轮询间隔：上游出图普遍要几十秒，10s 一轮既不漏也不打爆网关 */
const AUTO_POLL_INTERVAL_MS = 10_000;

export default function LocalGenerationJobsPage() {
  const [jobs, setJobs] = useState<LocalGenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(false);
  /** 自动轮询进行中：避免上一轮没跑完又起一轮 */
  const autoPollBusy = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await localStore().listGenerationJobs();
      setJobs(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载任务失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 自动轮询：只查「进行中且已有 task_id」的任务，串行执行不并发压上游 */
  useEffect(() => {
    if (!autoPoll) return;
    const tick = async () => {
      if (autoPollBusy.current) return;
      autoPollBusy.current = true;
      try {
        const list = await localStore().listGenerationJobs();
        const pending = list.filter((j) => j.status === "running" && j.providerTaskId);
        if (pending.length === 0) {
          setJobs(list);
          return;
        }
        const { syncLocalGenerationJobFromUpstream } = await import("@/lib/local/generate");
        for (const j of pending) {
          try {
            await syncLocalGenerationJobFromUpstream(j.id);
          } catch {
            // 单条失败不影响其余任务，详情已写进任务记录
          }
        }
        setJobs(await localStore().listGenerationJobs());
      } catch {
        /* 轮询失败静默，手动「刷新」仍可用 */
      } finally {
        autoPollBusy.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), AUTO_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoPoll]);

  const clearAll = async () => {
    if (!window.confirm("清空本机全部生成任务记录？不可恢复。")) return;
    setClearing(true);
    try {
      await localStore().clearGenerationJobs();
      setJobs([]);
      toast.success("已清空");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败");
    } finally {
      setClearing(false);
    }
  };

  /**
   * 补录上游 task_id：提交超时 / 中途关窗时 task_id 没能落库，
   * 任务其实还在上游跑。从供应商控制台复制 id 填进来即可继续查询，不会重新提交。
   */
  const attachTaskId = async (job: LocalGenerationJob) => {
    const input = window.prompt(
      "填入上游 task_id 后可直接查询该任务（不会重新提交、不重复扣费）。\n" +
        "task_id 可在供应商控制台的任务/日志列表里找到。",
      job.providerTaskId || ""
    );
    const taskId = String(input || "").trim();
    if (!taskId) return;
    try {
      await localStore().updateGenerationJob(job.id, { providerTaskId: taskId });
      await reload();
      await syncUpstream({ ...job, providerTaskId: taskId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "写入 task_id 失败");
    }
  };

  const syncUpstream = async (job: LocalGenerationJob) => {
    if (!job.providerTaskId) {
      toast.error("没有上游 task_id，无法同步");
      return;
    }
    setSyncingId(job.id);
    try {
      const { syncLocalGenerationJobFromUpstream } = await import("@/lib/local/generate");
      const out = await syncLocalGenerationJobFromUpstream(job.id);
      if (out.status === "succeeded") toast.success(out.message);
      else if (out.status === "running") toast.message(out.message);
      else toast.error(out.message);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败");
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <HuabuPublicShell>
      <div className="mx-auto max-w-5xl px-6 py-10 text-foreground">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <ListTodo className="h-6 w-6" />
              生成任务
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              本机最近的生图 / 生视频记录（最多保留 200 条）。轮询靠上游 task_id：
              异步接口提交后会自动记下，点「同步上游」只查询、不重新提交；
              同步接口直接返回结果、本就没有 id 可查，提交超时没拿到 id 时可「补 task_id」。
              数据只存在本机。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${
                autoPoll ? "border-emerald-500 text-emerald-600 dark:text-emerald-400" : ""
              }`}
              onClick={() => setAutoPoll((v) => !v)}
              title="每 10 秒自动查询所有「进行中」且有 task_id 的任务"
            >
              <Timer className={`h-4 w-4 ${autoPoll ? "animate-pulse" : ""}`} />
              {autoPoll ? "自动轮询中" : "自动轮询"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm"
              onClick={() => void reload()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-destructive"
              onClick={() => void clearAll()}
              disabled={clearing || jobs.length === 0}
            >
              <Trash2 className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>

        {loading && jobs.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">加载中…</p>
        ) : jobs.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            还没有记录。在画布上生成图片或视频后，成功 / 失败都会出现在这里。
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">时间</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">模型</th>
                  <th className="px-3 py-2 font-medium">参考 / 上游</th>
                  <th className="px-3 py-2 font-medium">提示 / 错误</th>
                  <th className="px-3 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {formatTime(j.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          j.status === "succeeded"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : j.status === "failed"
                              ? "text-destructive"
                              : "text-amber-600 dark:text-amber-400"
                        }
                      >
                        {STATUS_ZH[j.status]}
                      </span>
                      {j.providerTaskId ? (
                        <div
                          className="mt-0.5 max-w-[140px] truncate font-mono text-[10px] text-muted-foreground"
                          title={j.providerTaskId}
                        >
                          {j.providerTaskId}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{CAT_ZH[j.category]}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{j.modelLabel || j.modelId}</div>
                      {j.upstreamModel && (
                        <div className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                          {j.upstreamModel}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{j.referenceCount ?? 0}</div>
                      {typeof j.submittedReferenceCount === "number" ? (
                        <div
                          className={
                            j.submittedReferenceCount > 0
                              ? "text-[10px] text-emerald-600 dark:text-emerald-400"
                              : "text-[10px] text-destructive"
                          }
                          title={j.submittedRefHostPreview || undefined}
                        >
                          上游 {j.submittedReferenceCount}
                          {j.submittedRefHostPreview ? ` · ${j.submittedRefHostPreview}` : ""}
                        </div>
                      ) : null}
                      {j.submittedRefUrls && j.submittedRefUrls.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {j.submittedRefUrls.map((u) => (
                            <a
                              key={u}
                              href={`/api/local/ref-preview?url=${encodeURIComponent(u)}`}
                              target="_blank"
                              rel="noreferrer"
                              title="本机代开实际上游参考（不走页面 Referer）"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/local/ref-preview?url=${encodeURIComponent(u)}`}
                                alt="提交的参考"
                                className="h-12 w-12 rounded border border-border object-cover"
                                onError={(e) => {
                                  // 聚梦临时直链约 1 小时过期；过期后给文字说明而非破图框
                                  const img = e.currentTarget;
                                  img.style.display = "none";
                                  const tip = img.parentElement?.parentElement;
                                  if (tip && !tip.querySelector("[data-ref-expired]")) {
                                    const el = document.createElement("span");
                                    el.dataset.refExpired = "1";
                                    el.className = "text-[10px] text-muted-foreground";
                                    el.textContent = "参考直链已过期，无法预览";
                                    tip.appendChild(el);
                                  }
                                }}
                              />
                            </a>
                          ))}
                        </div>
                      ) : typeof j.submittedReferenceCount !== "number" ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          旧任务无参考预览，请再生成一次
                        </p>
                      ) : j.submittedReferenceCount > 0 ? (
                        // 带了参考但没有直链：说明是 base64 内联提交，没有可预览的 URL
                        <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                          参考以 base64 内联提交（无直链可预览）
                        </p>
                      ) : (
                        <p className="mt-1 text-[10px] text-destructive">
                          参考未进上游请求
                        </p>
                      )}
                    </td>
                    <td className="max-w-md px-3 py-2">
                      {j.error ? (
                        <p className="break-words text-xs text-destructive">{j.error}</p>
                      ) : (
                        <p className="break-words text-xs text-muted-foreground">
                          {j.promptPreview || "—"}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {/* 每条任务都可点：有 task_id 直接查上游，没有则先补录一个再查 */}
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                          j.providerTaskId ? "" : "border-dashed text-muted-foreground"
                        }`}
                        disabled={syncingId === j.id}
                        onClick={() =>
                          void (j.providerTaskId ? syncUpstream(j) : attachTaskId(j))
                        }
                        title={
                          j.providerTaskId
                            ? "只查询上游结果，不重新提交、不重复扣费"
                            : "该任务没有上游 task_id（同步接口本就没有，或提交超时未拿到）。点击可填入后查询"
                        }
                      >
                        {j.providerTaskId ? (
                          <CloudDownload
                            className={`h-3.5 w-3.5 ${syncingId === j.id ? "animate-pulse" : ""}`}
                          />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5" />
                        )}
                        {syncingId === j.id ? "同步中…" : "同步"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </HuabuPublicShell>
  );
}
