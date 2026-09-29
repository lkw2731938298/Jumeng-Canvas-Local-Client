"use client";

/**
 * 任务中心：本机生成任务（列表 + 右侧详情）。
 * 功能保持：自动轮询（10s）、刷新、清空、同步上游（只查询不重提）、补填 task_id、参考图预览。
 * 数据只用本机任务记录已有字段，样式对齐设计稿。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  CloudDownload,
  ExternalLink,
  KeyRound,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";
import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localStore } from "@/lib/local/store";
import * as projectsApi from "@/lib/api/projects";
import { useAuthStore } from "@/stores/authStore";
import type { LocalGenerationJob } from "@/lib/local/generationJobs";
import "./jobsCenter.css";

type Filter = "all" | "running" | "succeeded" | "failed";

const CAT_ZH: Record<LocalGenerationJob["category"], string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  text: "文本",
  tool: "工具",
  model3d: "3D 模型",
};

/** 缩略图占位渐变（按类型） */
const CAT_GRADIENT: Record<LocalGenerationJob["category"], string> = {
  image: "linear-gradient(135deg, #19d8c4 0%, #2a9dff 100%)",
  video: "linear-gradient(135deg, #2aa8ff 0%, #6a45e0 100%)",
  audio: "linear-gradient(135deg, #f7506a 0%, #9a8bff 100%)",
  text: "linear-gradient(135deg, #9a82ff 0%, #2aa8ff 100%)",
  tool: "linear-gradient(135deg, #14d9bd 0%, #1f55d6 100%)",
  model3d: "linear-gradient(135deg, #f5a524 0%, #7c3aed 100%)",
};

/** 自动轮询间隔：上游出图普遍要几十秒，10s 一轮既不漏也不打爆网关 */
const AUTO_POLL_INTERVAL_MS = 10_000;

const TZ = "Asia/Shanghai";

/** 东八区日期键 yyyy-mm-dd，用于「今天 / 昨天」判断 */
function dayKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** 提交时间：今天 14:32 / 昨天 21:40 / 9月20日 10:02 */
function formatSubmitTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hm = d.toLocaleTimeString("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const k = dayKey(d);
  if (k === today) return `今天 ${hm}`;
  if (k === yesterday) return `昨天 ${hm}`;
  const md = d.toLocaleDateString("zh-CN", { timeZone: TZ, month: "numeric", day: "numeric" });
  return `${md} ${hm}`;
}

/** 结果图地址：仅图片任务且像完整 URL 时使用 */
function resultImageOf(job: LocalGenerationJob): string | null {
  if (job.status !== "succeeded" || job.category !== "image") return null;
  const u = String(job.resultUrlPreview || "").trim();
  if (!u) return null;
  if (/^(https?:|data:image\/|blob:|\/api\/)/i.test(u)) return u;
  return null;
}

function refPreviewUrl(u: string) {
  return `/api/local/ref-preview?url=${encodeURIComponent(u)}`;
}

/** 状态图标：进行中转圈 / 成功对勾 / 失败警告 */
function StatusIcon({ status }: { status: LocalGenerationJob["status"] }) {
  if (status === "running") return <Loader2 className="jc-status-icon running animate-spin" size={16} strokeWidth={2.2} />;
  if (status === "succeeded") return <Check className="jc-status-icon ok" size={16} strokeWidth={2.4} />;
  return <AlertTriangle className="jc-status-icon fail" size={16} strokeWidth={2} />;
}

/** 缩略图：成功图片任务显示结果，否则按类型渐变；加载失败回落渐变 */
function JobThumb({ job, className }: { job: LocalGenerationJob; className: string }) {
  const src = resultImageOf(job);
  return (
    <span className={className} style={{ background: CAT_GRADIENT[job.category] }}>
      {src ? <ResultImg key={src} src={src} /> : null}
    </span>
  );
}

/** 结果图：加载失败隐藏，露出底下的渐变（以 src 为 key，换图自动重置） */
function ResultImg({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setBroken(true)} />;
}

export default function LocalGenerationJobsPage() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  const [jobs, setJobs] = useState<LocalGenerationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [autoPoll, setAutoPoll] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 自动轮询进行中：避免上一轮没跑完又起一轮 */
  const autoPollBusy = useRef(false);

  // 项目名：任务标题优先显示所属项目名
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", userId],
    queryFn: projectsApi.listProjects,
    enabled: Boolean(userId),
  });
  const projectTitle = useMemo(() => new Map(projects.map((p) => [p.id, p.title])), [projects]);

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

  // 首次加载：结果在异步回调里写入 state（loading 初始即为 true），避免 effect 内同步 setState
  useEffect(() => {
    let alive = true;
    localStore()
      .listGenerationJobs()
      .then((list) => {
        if (alive) setJobs(list);
      })
      .catch((err) => {
        if (alive) toast.error(err instanceof Error ? err.message : "加载任务失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

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

  const counts = useMemo(() => {
    const c = { all: jobs.length, running: 0, succeeded: 0, failed: 0, doneToday: 0 };
    const today = dayKey(new Date());
    for (const j of jobs) {
      c[j.status] += 1;
      if (j.status === "succeeded" && dayKey(new Date(j.updatedAt || j.createdAt)) === today) c.doneToday += 1;
    }
    return c;
  }, [jobs]);

  const visibleJobs = useMemo(
    () => (filter === "all" ? jobs : jobs.filter((j) => j.status === filter)),
    [jobs, filter]
  );

  // 默认选中第一条；当前选中项被筛掉 / 清空时回落到第一条
  const selected = visibleJobs.find((j) => j.id === selectedId) ?? visibleJobs[0] ?? null;
  const activeJobId = selected?.id ?? null;

  const titleOf = (j: LocalGenerationJob) =>
    (j.projectId && projectTitle.get(j.projectId)) || j.promptPreview?.slice(0, 24) || `${CAT_ZH[j.category]}任务`;

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "全部", count: counts.all },
    { id: "running", label: "进行中", count: counts.running },
    { id: "succeeded", label: "已完成", count: counts.succeeded },
    { id: "failed", label: "失败", count: counts.failed },
  ];

  /** 同步 / 补填入口：有 task_id 直接查上游，没有则先补录 */
  const syncOrAttach = (j: LocalGenerationJob) => void (j.providerTaskId ? syncUpstream(j) : attachTaskId(j));

  return (
    <HuabuPublicShell page="jobs">
      <div className="jc-wrap">
        <section className="jc-panel jm-panel" aria-label="任务中心">
          <header className="jc-head">
            <div>
              <h1>任务中心</h1>
              <p>
                {counts.running} 个进行中 · 今日已完成 {counts.doneToday}
              </p>
            </div>
            <div className="jc-head-actions">
              <button
                type="button"
                className={`jm-btn${autoPoll ? " jm-btn-primary" : ""}`}
                onClick={() => setAutoPoll((v) => !v)}
                title="每 10 秒自动查询所有「进行中」且有 task_id 的任务"
              >
                <Timer size={15} className={autoPoll ? "animate-pulse" : undefined} />
                {autoPoll ? "自动轮询中" : "自动轮询"}
              </button>
              <button type="button" className="jm-btn" onClick={() => void reload()} disabled={loading}>
                <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
                刷新
              </button>
              <button
                type="button"
                className="jm-btn jm-btn-danger-text"
                onClick={() => void clearAll()}
                disabled={clearing || jobs.length === 0}
              >
                <Trash2 size={15} />
                清空
              </button>
            </div>
          </header>

          <div className="jc-filters" role="tablist" aria-label="任务筛选">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`jm-pill${filter === f.id ? " active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label} {f.count}
              </button>
            ))}
          </div>

          <div className="jc-body">
            <div className="jc-list jm-scroll">
              {loading && jobs.length === 0 ? (
                <div className="jm-empty">
                  <Loader2 size={18} className="animate-spin" />
                  加载中…
                </div>
              ) : visibleJobs.length === 0 ? (
                <div className="jm-empty">
                  {jobs.length === 0
                    ? "还没有记录。在画布上生成图片或视频后，成功 / 失败都会出现在这里。"
                    : "当前筛选下没有任务"}
                </div>
              ) : (
                visibleJobs.map((j) => (
                  <div
                    key={j.id}
                    role="button"
                    tabIndex={0}
                    className={`jc-row${j.id === activeJobId ? " active" : ""}`}
                    onClick={() => setSelectedId(j.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedId(j.id);
                    }}
                  >
                    <span className="jc-row-status">
                      <StatusIcon status={j.status} />
                    </span>
                    <JobThumb job={j} className="jc-thumb" />
                    <div className="jc-row-main">
                      <strong title={titleOf(j)}>{titleOf(j)}</strong>
                      <span>
                        {CAT_ZH[j.category]}
                        <i>·</i>
                        {j.modelLabel || j.modelId}
                        <i>·</i>
                        {formatSubmitTime(j.createdAt)}
                      </span>
                    </div>
                    <div className={`jc-row-state ${j.status}`}>
                      {j.status === "running" ? (
                        <>
                          <span>进行中</span>
                          <span className="jc-flow" aria-hidden="true" />
                        </>
                      ) : j.status === "succeeded" ? (
                        <span>已完成</span>
                      ) : (
                        <span>生成失败</span>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="jm-dots"
                        aria-label="任务操作"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {syncingId === j.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <MoreHorizontal size={16} strokeWidth={2} />
                        )}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="z-[200] min-w-[140px] p-1">
                        <DropdownMenuItem
                          className="h-[34px] gap-2 text-xs"
                          disabled={!j.providerTaskId || syncingId === j.id}
                          onClick={() => void syncUpstream(j)}
                        >
                          <CloudDownload size={14} />
                          同步上游
                        </DropdownMenuItem>
                        <DropdownMenuItem className="h-[34px] gap-2 text-xs" onClick={() => void attachTaskId(j)}>
                          <KeyRound size={14} />
                          补填 task_id
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              )}
            </div>

            <aside className="jc-detail" aria-label="任务详情">
              <div className="jc-detail-head">
                <strong>任务详情</strong>
                {selected ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger className="jm-dots" aria-label="详情操作">
                      <MoreHorizontal size={16} strokeWidth={2} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[200] min-w-[140px] p-1">
                      <DropdownMenuItem
                        className="h-[34px] gap-2 text-xs"
                        disabled={!selected.providerTaskId || syncingId === selected.id}
                        onClick={() => void syncUpstream(selected)}
                      >
                        <CloudDownload size={14} />
                        同步上游
                      </DropdownMenuItem>
                      <DropdownMenuItem className="h-[34px] gap-2 text-xs" onClick={() => void attachTaskId(selected)}>
                        <KeyRound size={14} />
                        补填 task_id
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>

              {selected ? (
                <>
                  <div className="jc-detail-scroll jm-scroll">
                    <div className="jc-preview" style={{ background: CAT_GRADIENT[selected.category] }}>
                      <JobThumb job={selected} className="jc-preview-img" />
                      {selected.status === "running" ? (
                        <span className="jc-preview-spin">
                          <Loader2 size={34} strokeWidth={2} className="animate-spin" />
                        </span>
                      ) : null}
                      {selected.status === "failed" ? (
                        <span className="jc-preview-fail">
                          <AlertTriangle size={30} strokeWidth={1.8} />
                        </span>
                      ) : null}
                    </div>

                    <dl className="jc-info">
                      <div>
                        <dt>模型</dt>
                        <dd title={selected.upstreamModel || undefined}>{selected.modelLabel || selected.modelId}</dd>
                      </div>
                      <div>
                        <dt>提交时间</dt>
                        <dd>{formatSubmitTime(selected.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>类型</dt>
                        <dd>{CAT_ZH[selected.category]}</dd>
                      </div>
                      <div>
                        <dt>上游 task_id</dt>
                        <dd className="mono" title={selected.providerTaskId || undefined}>
                          {selected.providerTaskId || "—"}
                        </dd>
                      </div>
                    </dl>

                    <div className={`jc-log${selected.error ? " error" : ""}`}>
                      {selected.error ? selected.error : selected.promptPreview || "（无提示词）"}
                    </div>

                    {/* 参考图：本机代开实际上游参考（不走页面 Referer）；直链过期给文字说明 */}
                    <div className="jc-refs">
                      <div className="jc-refs-title">
                        参考 {selected.referenceCount ?? 0}
                        {typeof selected.submittedReferenceCount === "number" ? (
                          <span
                            className={selected.submittedReferenceCount > 0 ? "ok" : "bad"}
                            title={selected.submittedRefHostPreview || undefined}
                          >
                            上游 {selected.submittedReferenceCount} 张
                            {selected.submittedRefHostPreview ? ` · ${selected.submittedRefHostPreview}` : ""}
                          </span>
                        ) : null}
                      </div>
                      {selected.submittedRefUrls && selected.submittedRefUrls.length > 0 ? (
                        <div className="jc-ref-grid">
                          {selected.submittedRefUrls.map((u) => (
                            <a
                              key={u}
                              href={refPreviewUrl(u)}
                              target="_blank"
                              rel="noreferrer"
                              title="本机代开实际上游参考（不走页面 Referer）"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={refPreviewUrl(u)}
                                alt="提交的参考"
                                onError={(e) => {
                                  // 临时直链约 1 小时过期；过期后给文字说明而非破图框
                                  const img = e.currentTarget;
                                  img.style.display = "none";
                                  const tip = img.parentElement?.parentElement;
                                  if (tip && !tip.querySelector("[data-ref-expired]")) {
                                    const el = document.createElement("span");
                                    el.dataset.refExpired = "1";
                                    el.className = "jc-ref-note";
                                    el.textContent = "参考直链已过期，无法预览";
                                    tip.appendChild(el);
                                  }
                                }}
                              />
                            </a>
                          ))}
                        </div>
                      ) : typeof selected.submittedReferenceCount !== "number" ? (
                        <p className="jc-ref-note">旧任务无参考预览，请再生成一次</p>
                      ) : selected.submittedReferenceCount > 0 ? (
                        // 带了参考但没有直链：说明是 base64 内联提交，没有可预览的 URL
                        <p className="jc-ref-note warn">参考以 base64 内联提交（无直链可预览）</p>
                      ) : (selected.referenceCount ?? 0) > 0 ? (
                        <p className="jc-ref-note bad">参考未进上游请求</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="jc-detail-actions">
                    <button
                      type="button"
                      className="jm-btn"
                      disabled={syncingId === selected.id}
                      onClick={() => syncOrAttach(selected)}
                      title={
                        selected.providerTaskId
                          ? "只查询上游结果，不重新提交、不重复扣费"
                          : "该任务没有上游 task_id（同步接口本就没有，或提交超时未拿到）。点击可填入后查询"
                      }
                    >
                      {syncingId === selected.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : selected.providerTaskId ? (
                        <CloudDownload size={14} />
                      ) : (
                        <KeyRound size={14} />
                      )}
                      {syncingId === selected.id ? "同步中…" : selected.providerTaskId ? "同步上游" : "补填 task_id"}
                    </button>
                    <button
                      type="button"
                      className="jm-btn jc-open"
                      disabled={!selected.projectId}
                      onClick={() => selected.projectId && router.push(`/${selected.projectId}`)}
                      title={selected.projectId ? "打开任务所属项目" : "该任务未记录所属项目"}
                    >
                      <ExternalLink size={14} />
                      在画布中打开
                    </button>
                  </div>
                </>
              ) : (
                <div className="jc-detail-empty">选择左侧任务查看详情</div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </HuabuPublicShell>
  );
}
