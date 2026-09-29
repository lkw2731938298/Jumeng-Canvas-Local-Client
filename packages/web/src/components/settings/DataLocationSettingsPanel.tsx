"use client";

/**
 * 本机：用户数据与素材保存位置。
 * 用系统文件夹对话框选择路径；切换时迁移数据并删除旧目录。
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, FolderSearch, RotateCcw, Save, Sparkles } from "lucide-react";
import { localStore } from "@/lib/local/store";
import type { JumengDataLocationInfo } from "@/lib/local/types";
import {
  getAgentSkillsDirInfo,
  importCodexSkills,
  listAgentSkills,
  listCodexSkillsForImport,
  openLocalAgentSkillsDir,
  type AgentSkillMeta,
} from "@/lib/local/agent/skills";

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

      <AgentSkillsBlock />
    </section>
  );
}

/** AI 助手技能目录（Codex 式 SKILL.md）+ 从 Codex 勾选导入 */
function AgentSkillsBlock() {
  const [info, setInfo] = useState<{
    localDir: string;
    codexDir: string;
    codexExists: boolean;
  } | null>(null);
  const [skills, setSkills] = useState<AgentSkillMeta[]>([]);
  const [codexSkills, setCodexSkills] = useState<AgentSkillMeta[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showCodex, setShowCodex] = useState(false);

  const reload = useCallback(async () => {
    const [dirInfo, list, codex] = await Promise.all([
      getAgentSkillsDirInfo().catch(() => null),
      listAgentSkills().catch(() => [] as AgentSkillMeta[]),
      listCodexSkillsForImport().catch(() => [] as AgentSkillMeta[]),
    ]);
    setInfo(dirInfo);
    setSkills(list);
    setCodexSkills(codex);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await reload();
      } catch {
        /* ignore */
      }
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [reload]);

  const onOpen = async () => {
    setOpening(true);
    try {
      const dir = await openLocalAgentSkillsDir();
      if (dir) toast.success(`已打开：${dir}`);
      else toast.message("当前环境无法打开文件夹");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "打开失败");
    } finally {
      setOpening(false);
    }
  };

  const onImport = async () => {
    const slugs = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!slugs.length) {
      toast.message("请先勾选要导入的 Codex 技能");
      return;
    }
    setImporting(true);
    try {
      const r = await importCodexSkills(slugs);
      const errN = r.errors?.length || 0;
      if (r.imported.length) {
        toast.success(`已导入 ${r.imported.length} 个技能${errN ? `，${errN} 个失败` : ""}`);
      } else {
        toast.error(errN ? r.errors[0]?.error || "导入失败" : "未导入任何技能");
      }
      setSelected({});
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  const sourceLabel = (s: AgentSkillMeta["source"]) =>
    s === "bundled" ? "内置" : s === "codex" ? "Codex" : "本机";

  const localSlugs = new Set(skills.filter((s) => s.source !== "bundled").map((s) => s.slug));

  return (
    <div className="mt-8 space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <h4 className="text-sm font-medium text-foreground">AI 助手技能</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            兼容 Codex 式技能包（目录内含 <code className="rounded bg-muted px-1">SKILL.md</code>
            ）。画布内置 photo-relic-editorial。可从下方勾选导入{" "}
            <code className="rounded bg-muted px-1">~/.codex/skills</code>{" "}
            中的技能到本机目录（不会自动全量导入）。
          </p>
        </div>
      </div>

      {info?.localDir ? (
        <div>
          <div className="text-xs text-muted-foreground">本机技能目录</div>
          <div className={pathBoxCls}>{info.localDir}</div>
        </div>
      ) : null}
      {info?.codexDir ? (
        <div>
          <div className="text-xs text-muted-foreground">
            Codex 技能目录{info.codexExists ? "（已检测到）" : "（尚未安装）"}
          </div>
          <div className={pathBoxCls}>{info.codexDir}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={opening}
          onClick={() => void onOpen()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <FolderOpen className="h-4 w-4" />
          {opening ? "打开中…" : "打开本机技能目录"}
        </button>
        <button
          type="button"
          disabled={!info?.codexExists}
          onClick={() => setShowCodex((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          {showCodex ? "收起 Codex 列表" : `从 Codex 导入（${codexSkills.length}）`}
        </button>
      </div>

      {showCodex ? (
        <div className="space-y-2 rounded-lg border border-border bg-background/50 p-3">
          {codexSkills.length === 0 ? (
            <p className="text-xs text-muted-foreground">Codex 目录下没有 SKILL.md 技能包</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto text-xs">
              {codexSkills.map((s) => {
                const already = localSlugs.has(s.slug);
                return (
                  <li key={s.slug} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!!selected[s.slug]}
                      disabled={importing}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [s.slug]: e.target.checked }))
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">
                        {s.name}
                        {already ? (
                          <span className="ml-1 text-muted-foreground">（本机已有，导入将覆盖）</span>
                        ) : null}
                      </div>
                      {s.description ? (
                        <p className="line-clamp-2 text-muted-foreground">{s.description}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            disabled={importing || !Object.values(selected).some(Boolean)}
            onClick={() => void onImport()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {importing ? "导入中…" : "导入到本机技能目录"}
          </button>
        </div>
      ) : null}

      <ul className="space-y-1 text-xs text-muted-foreground">
        <li className="text-[11px] font-medium text-foreground/80">助手当前可用：</li>
        {skills.length === 0 ? (
          <li>暂无技能（至少应有内置 photo-relic-editorial）</li>
        ) : (
          skills.map((s) => (
            <li key={`${s.source}-${s.slug}`}>
              <span className="text-foreground">{s.name}</span>
              <span className="ml-1 text-muted-foreground">（{sourceLabel(s.source)}）</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
