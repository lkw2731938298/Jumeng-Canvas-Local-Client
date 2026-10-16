"use client";

/**
 * 设置页「技能设置」：本机 / Codex 技能包管理。
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderInput, FolderOpen, RefreshCw, Sparkles } from "lucide-react";
import {
  getAgentSkillsDirInfo,
  importCodexSkills,
  importLocalSkillFolder,
  listAgentSkills,
  listCodexSkillsForImport,
  openLocalAgentSkillsDir,
  type AgentSkillMeta,
} from "@/lib/local/agent/skills";

const pathBoxCls =
  "mt-1 w-full rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground break-all";

/** AI 助手技能设置面板 */
export function AgentSkillsSettingsPanel() {
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
  const [importingLocal, setImportingLocal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
    return list;
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

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const list = await reload();
      const diskN = list.filter((s) => s.source === "disk").length;
      toast.success(
        diskN > 0
          ? `已刷新：本机 ${diskN} 个，合计 ${list.length} 个技能`
          : `已刷新：合计 ${list.length} 个技能（本机目录暂无 SKILL.md 包）`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  /** 本机导入：系统文件夹对话框选技能包 → 拷入 agent-skills */
  const onImportLocal = async () => {
    setImportingLocal(true);
    try {
      const r = await importLocalSkillFolder();
      if (r.cancelled) {
        toast.message("已取消导入");
        return;
      }
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(`已导入本机技能：${r.name || r.slug}`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "本机导入失败");
    } finally {
      setImportingLocal(false);
    }
  };

  const onImportCodex = async () => {
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
    <div className="st-legacy">
      <div className="st-section-head">
        <h2>技能设置</h2>
        <p>管理 AI 助手可用的 Codex 式技能包（目录内含 SKILL.md）</p>
      </div>

      <div className="mt-6 space-y-3 rounded-xl border border-border bg-card/40 p-4">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h4 className="text-sm font-medium text-foreground">AI 助手技能</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              可用「本机导入」选择解压后的技能文件夹；也可手动放到本机技能目录后点刷新。嵌套一层文件夹也会自动识别。画布内置
              photo-relic-editorial。还可从下方勾选导入{" "}
              <code className="rounded bg-muted px-1">~/.codex/skills</code>{" "}
              （不会自动全量导入）。
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
            disabled={importingLocal}
            onClick={() => void onImportLocal()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            <FolderInput className="h-4 w-4" />
            {importingLocal ? "导入中…" : "本机导入"}
          </button>
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
            disabled={refreshing}
            onClick={() => void onRefresh()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "刷新中…" : "刷新技能列表"}
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
                            <span className="ml-1 text-muted-foreground">
                              （本机已有，导入将覆盖）
                            </span>
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
              onClick={() => void onImportCodex()}
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
    </div>
  );
}
