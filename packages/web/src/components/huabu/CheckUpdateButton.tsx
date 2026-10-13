"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { withBasePath } from "@/lib/basePath";
import { getDesktopApi } from "@/lib/local/types";
import type {
  DesktopUpdateCheckResult,
  DesktopUpdateProgress,
} from "@/lib/local/types";

interface UpdateCheckResult {
  localVersion: string;
  remoteVersion: string;
  hasUpdate: boolean;
  canApply: boolean;
  blockedReason?: string;
  repoUrl: string;
  /** electron-nsis | gitee-zip */
  channel?: string;
}

interface UpdateApplyResult {
  updated: boolean;
  fromVersion: string;
  toVersion: string;
  filesCopied?: number;
  depsChanged?: boolean;
  restarting: boolean;
  manualRestart?: boolean;
}

const UPDATE_API = withBasePath("/api/local/update");
const SESSION_KEY = "jm_update_check_v1";
const RESTART_TIMEOUT_MS = 10 * 60_000;

function isDesktopUpdaterAvailable(): boolean {
  const api = getDesktopApi();
  return Boolean(api?.checkDesktopUpdate && api?.applyDesktopUpdate);
}

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function requestCheck(): Promise<UpdateCheckResult> {
  if (isDesktopUpdaterAvailable()) {
    const r = (await getDesktopApi()!.checkDesktopUpdate!()) as DesktopUpdateCheckResult;
    return {
      localVersion: r.localVersion,
      remoteVersion: r.remoteVersion,
      hasUpdate: r.hasUpdate,
      canApply: r.canApply,
      blockedReason: r.blockedReason,
      repoUrl: r.repoUrl,
      channel: r.channel || "electron-nsis",
    };
  }
  const res = await fetch(UPDATE_API, { cache: "no-store" });
  const json = (await res.json()) as { ok: boolean; result?: UpdateCheckResult; error?: string };
  if (!json.ok || !json.result) throw new Error(json.error || "检查更新失败");
  return { ...json.result, channel: "gitee-zip" };
}

/** 等服务「先停下、再恢复」后刷新页面（bat 源码更新重启） */
async function waitForRestartThenReload(toastId: string | number) {
  const started = Date.now();
  let wentDown = false;
  while (Date.now() - started < RESTART_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await fetch(UPDATE_API, { cache: "no-store" });
      if (res.ok && wentDown) {
        window.location.reload();
        return;
      }
      if (!res.ok) wentDown = true;
    } catch {
      wentDown = true;
    }
  }
  toast.error("重启超时，请重新打开聚梦无限画布", { id: toastId, duration: 15000 });
}

/** 顶栏「检查更新」：Electron 走 Setup 覆盖安装；bat/源码走 Gitee zip 覆盖 */
export function CheckUpdateButton() {
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null);
  const silentChecked = useRef(false);
  const unsubProgress = useRef<(() => void) | null>(null);
  const desktopMode = isDesktopUpdaterAvailable();

  useEffect(() => {
    if (silentChecked.current) return;
    silentChecked.current = true;
    let alive = true;
    const cached = sessionStorage.getItem(SESSION_KEY);
    const load = cached
      ? Promise.resolve(JSON.parse(cached) as UpdateCheckResult)
      : requestCheck().then((r) => {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(r));
          return r;
        });
    load
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch(() => {
        /* 静默检查失败不打扰 */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      unsubProgress.current?.();
      unsubProgress.current = null;
    };
  }, []);

  const onCheck = async () => {
    if (checking || applying) return;
    setChecking(true);
    try {
      const r = await requestCheck();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(r));
      setInfo(r);
      if (!r.hasUpdate) {
        toast.success(`已是最新版本 v${r.localVersion}`);
      } else if (!r.canApply) {
        toast.message(`发现新版本 v${r.remoteVersion}（当前 v${r.localVersion}）`, {
          description: r.blockedReason,
          duration: 10000,
        });
      } else {
        setConfirmOpen(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检查更新失败");
    } finally {
      setChecking(false);
    }
  };

  const onApply = async () => {
    setConfirmOpen(false);
    setApplying(true);

    if (desktopMode) {
      setProgress({
        phase: "download",
        percent: 0,
        received: 0,
        total: null,
        message: "正在准备下载…",
      });
      setProgressOpen(true);
      unsubProgress.current?.();
      unsubProgress.current =
        getDesktopApi()?.onDesktopUpdateProgress?.((p) => {
          setProgress(p);
        }) ?? null;

      try {
        const r = await getDesktopApi()!.applyDesktopUpdate!();
        sessionStorage.removeItem(SESSION_KEY);
        if (!r.updated) {
          unsubProgress.current?.();
          unsubProgress.current = null;
          setProgressOpen(false);
          toast.success(`已是最新版本 v${r.fromVersion || r.localVersion}`);
          setApplying(false);
          return;
        }
        setProgress({
          phase: "install",
          percent: null,
          message:
            "下载完成，正在安装…本窗会关闭；请看「更新助手」与安装向导进度条，完成后会自动打开软件。",
        });
        // 主进程即将 quit；进度订阅保留到进程结束，勿在此处 unsubscribe
        return;
      } catch (err) {
        unsubProgress.current?.();
        unsubProgress.current = null;
        setProgressOpen(false);
        toast.error(err instanceof Error ? err.message : "更新失败");
        setApplying(false);
        return;
      }
    }

    const id = toast.loading("正在从 Gitee 下载新版本，可能需要 1～3 分钟…");
    try {
      const res = await fetch(UPDATE_API, {
        method: "POST",
        headers: { "x-jumeng-update": "1" },
      });
      const json = (await res.json()) as { ok: boolean; result?: UpdateApplyResult; error?: string };
      if (!json.ok || !json.result) throw new Error(json.error || "更新失败");
      const r = json.result;
      sessionStorage.removeItem(SESSION_KEY);
      if (!r.updated) {
        toast.success(`已是最新版本 v${r.fromVersion}`, { id });
        setApplying(false);
        return;
      }
      if (r.restarting) {
        toast.loading(`已更新到 v${r.toVersion}，正在重装依赖并重启画布，完成后自动刷新…`, { id });
        await waitForRestartThenReload(id);
        setApplying(false);
        return;
      }
      if (r.manualRestart) {
        toast.success(`已更新到 v${r.toVersion}`, {
          id,
          description: "依赖有变化，请在程序目录执行 npm install 后重启画布",
          duration: 15000,
        });
      } else {
        toast.success(`已更新到 v${r.toVersion}`, {
          id,
          description: "刷新页面即可使用新版本",
          duration: 15000,
          action: { label: "刷新", onClick: () => window.location.reload() },
        });
      }
      setInfo(null);
      setApplying(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败", { id });
      setApplying(false);
    }
  };

  const busy = checking || applying;
  const hasUpdate = Boolean(info?.hasUpdate);
  const downloadPct =
    progress?.phase === "download" && progress.percent != null
      ? Math.min(100, Math.max(0, Math.round(progress.percent * 100)))
      : null;
  const progressTitle =
    progress?.phase === "install"
      ? "正在安装"
      : downloadPct != null
        ? `正在下载 ${downloadPct}%`
        : "正在下载";
  const progressHint =
    progress?.message ||
    (progress?.phase === "install"
      ? "请完成安装向导；装完后会自动打开聚梦无限画布"
      : "正在从官网下载安装包…");

  return (
    <>
      <button
        className="jm-top-update"
        type="button"
        onClick={() => void onCheck()}
        disabled={busy}
        title={hasUpdate ? `发现新版本 v${info?.remoteVersion}` : "检查更新"}
      >
        {busy ? (
          <Loader2 size={15} strokeWidth={1.8} className="animate-spin" />
        ) : (
          <RefreshCw size={15} strokeWidth={1.8} />
        )}
        <span>{applying ? "更新中…" : "检查更新"}</span>
        {hasUpdate && !busy ? <span className="jm-top-update-dot" aria-label="有新版本" /> : null}
      </button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发现新版本 v{info?.remoteVersion}</DialogTitle>
            <DialogDescription>
              {desktopMode
                ? `当前版本 v${info?.localVersion}。将下载安装包并打开安装向导（可见进度）。覆盖安装即可，无需先卸载；项目与密钥在本机用户目录，不会丢失。`
                : `当前版本 v${info?.localVersion}。更新会从 Gitee 下载最新源码并覆盖程序文件，不会影响 data 目录中的项目、素材与模型配置；如依赖有变化，将自动重装并重启画布。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              稍后
            </Button>
            <Button onClick={() => void onApply()}>立即更新</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 桌面版：下载百分比 + 安装阶段提示（静默 NSIS 无细粒度安装百分比） */}
      <Dialog
        open={progressOpen}
        onOpenChange={(open) => {
          // 更新进行中不允许关掉进度窗，避免误以为已取消
          if (!open && applying) return;
          setProgressOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{progressTitle}</DialogTitle>
            <DialogDescription>{progressHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              {progress?.phase === "install" || downloadPct == null ? (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-400/80" />
              ) : (
                <div
                  className="h-full rounded-full bg-violet-400 transition-[width] duration-200 ease-out"
                  style={{ width: `${downloadPct}%` }}
                />
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/45">
              <span>
                {progress?.phase === "install"
                  ? "安装中（覆盖安装，请稍候）"
                  : downloadPct != null
                    ? `${downloadPct}%`
                    : "获取大小中…"}
              </span>
              <span>
                {progress?.phase === "download"
                  ? `${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                  : info?.remoteVersion
                    ? `v${info.remoteVersion}`
                    : ""}
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
