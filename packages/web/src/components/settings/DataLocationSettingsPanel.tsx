"use client";

/**
 * 本机：用户数据与素材保存位置。
 * 用系统文件夹对话框选择路径；切换时迁移数据并删除旧目录。
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, FolderSearch, RotateCcw, Save } from "lucide-react";
import { localStore } from "@/lib/local/store";
import type { JumengDataLocationInfo } from "@/lib/local/types";

const pathBoxCls =
  "mt-1 w-full rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground break-all";

export function DataLocationSettingsPanel(props: {
  onDataRootChange?: (root: string) => void;
}) {
  const [info, setInfo] = useState<JumengDataLocationInfo | null>(null);
  /** 用户新选中的父目录或完整 JumengCanvas 路径（保存前展示） */
  const [pickedPath, setPickedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await localStore().getDataLocationInfo();
      setInfo(next);
      setPickedPath(null);
      props.onDataRootChange?.(next.dataRoot);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取保存位置失败");
    } finally {
      setLoading(false);
    }
  }, [props]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onPick = async () => {
    setPicking(true);
    try {
      const start =
        info?.dataRoot?.replace(/[\\/]JumengCanvas$/i, "") || info?.dataRoot || undefined;
      const picked = await localStore().pickDataDirectory(start);
      if (!picked) {
        toast.message("已取消选择");
        return;
      }
      setPickedPath(picked);
      toast.success("已选择文件夹，请确认后点击「迁移到此位置」");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开文件夹选择失败");
    } finally {
      setPicking(false);
    }
  };

  const onMigrate = async () => {
    if (!pickedPath) {
      toast.error("请先选择文件夹");
      return;
    }
    const oldPath = info?.dataRoot || "";
    const ok = window.confirm(
      `将把全部本机数据迁移到新位置，并删除旧目录：\n\n旧：${oldPath}\n新：（所选文件夹下的 JumengCanvas）\n\n此操作不可恢复，确定继续？`
    );
    if (!ok) return;

    setSaving(true);
    try {
      const next = await localStore().setDataLocation(pickedPath, {
        deleteOld: true,
      });
      setInfo(next);
      setPickedPath(null);
      props.onDataRootChange?.(next.dataRoot);
      toast.success("已迁移到新位置，旧目录已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "迁移失败");
    } finally {
      setSaving(false);
    }
  };

  const onReset = async () => {
    const oldPath = info?.dataRoot || "";
    const ok = window.confirm(
      `恢复默认保存位置，并把当前数据迁回默认目录，然后删除旧目录：\n\n${oldPath}\n\n确定继续？`
    );
    if (!ok) return;
    setSaving(true);
    try {
      const next = await localStore().resetDataLocation({ deleteOld: true });
      setInfo(next);
      setPickedPath(null);
      props.onDataRootChange?.(next.dataRoot);
      toast.success("已恢复默认位置，旧目录已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !info) {
    return <p className="mt-6 text-sm text-muted-foreground">读取保存位置…</p>;
  }

  const envHint = info?.envOverride;
  const busy = saving || picking;

  return (
    <section className="mt-8 space-y-4 text-foreground">
      <div>
        <h3 className="inline-flex items-center gap-2 text-base font-medium text-foreground">
          <FolderOpen className="h-4 w-4" />
          用户数据与素材保存位置
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          通过系统对话框选择文件夹。确认迁移后，会把当前数据全部搬到新位置（自动使用其下的
          JumengCanvas），并删除旧目录。
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground">
        <div>
          <span className="text-muted-foreground">当前生效：</span>
          <code className="ml-1 break-all rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
            {info?.dataRoot || "…"}
          </code>
        </div>
        <div className="mt-1">
          <span className="text-muted-foreground">默认位置：</span>
          <code className="ml-1 break-all rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
            {info?.defaultDataRoot || "…"}
          </code>
        </div>
        {info?.isCustom ? (
          <div className="mt-1 font-medium text-amber-700 dark:text-amber-300">已使用自定义路径</div>
        ) : (
          <div className="mt-1 text-muted-foreground">当前为默认路径</div>
        )}
      </div>

      {envHint ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          检测到环境变量{" "}
          <code className="rounded bg-muted px-1 text-foreground">JUMENG_LOCAL_DATA_DIR</code>
          （{envHint}）。设置页迁移写入的引导文件优先生效。
        </p>
      ) : null}

      <div>
        <div className="text-xs text-muted-foreground">已选择的目标文件夹</div>
        <div className={pathBoxCls}>{pickedPath || "尚未选择（点击下方按钮打开系统目录对话框）"}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onPick()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <FolderSearch className="h-4 w-4" />
          {picking ? "请在弹出窗口中选择…" : "选择文件夹…"}
        </button>
        <button
          type="button"
          disabled={busy || !pickedPath}
          onClick={() => void onMigrate()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "迁移中…" : "迁移到此位置（删除旧目录）"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReset()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          恢复默认
        </button>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>选择父目录即可，系统会自动使用其中的 <code className="rounded bg-muted px-1 text-foreground">JumengCanvas</code>。</li>
        <li>
          路径指针：
          <code className="ml-1 break-all rounded bg-muted px-1 text-foreground">
            {info?.bootstrapPath || "data/jumeng-data-location.json"}
          </code>
          （不会随数据目录一起删除）。
        </li>
        <li>文件夹对话框由本机服务弹出；若未出现，请检查是否被其它窗口挡住。</li>
      </ul>
    </section>
  );
}
