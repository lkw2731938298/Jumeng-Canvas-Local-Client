"use client";

/**
 * 普通用户第一屏：接入向导 / 已接入摘要。
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronRight, KeyRound, Plus } from "lucide-react";
import { JUMENGAI_SDK_API_BASE, isJumengaiApiBase, normalizeApiBase } from "@/lib/local/endpointHelpers";
import { normalizeApiKey } from "@/lib/local/generate";
import {
  bindToolsByFirstSelected,
  applyOverwriteProviderMediaModels,
  applySelectedModels,
  catalogSourceLabel,
  fetchAccountCatalog,
  isJumengProvider,
  maskApiKey,
  mergeCatalog,
  newManualPick,
  type CatalogPick,
} from "@/lib/local/setupCatalog";
import type { LocalModel, LocalModelCategory, LocalProvider } from "@/lib/local/types";
import type { LocalToolModelsMap } from "@/lib/local/canvasToolDefs";

const inputCls =
  "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
const labelCls = "text-xs text-muted-foreground";

export type WizardIntent = {
  mode: "new" | "change-key" | "refetch";
  providerId?: string;
};

type Props = {
  providers: LocalProvider[];
  models: LocalModel[];
  toolModels: LocalToolModelsMap;
  wizard: WizardIntent | null;
  onWizardChange: (w: WizardIntent | null) => void;
  onCommitted: (next: {
    providers: LocalProvider[];
    models: LocalModel[];
    toolModels: LocalToolModelsMap;
  }) => Promise<void>;
  onOpenAdvanced: () => void;
};

const CAT_LABEL: Record<LocalModelCategory, string> = {
  text: "对话 / 文本",
  image: "出图",
  video: "出视频",
  audio: "音频",
};

export function LocalSetupHome(props: Props) {
  const ready = props.providers.filter((p) => (p.apiKey || "").trim());
  const enabled = props.models.filter((m) => m.enabled !== false);
  const showWizard =
    Boolean(props.wizard) || ready.length === 0 || enabled.length === 0;

  const intent: WizardIntent =
    props.wizard ||
    (ready.length > 0
      ? { mode: "refetch", providerId: ready[0].id }
      : { mode: "new" });

  if (showWizard) {
    return (
      <SetupWizard
        key={`${intent.mode}-${intent.providerId || "new"}`}
        {...props}
        intent={intent}
      />
    );
  }

  return <ConnectedSummary {...props} />;
}

function ConnectedSummary(props: Props) {
  const byProvider = props.providers.filter((p) => (p.apiKey || "").trim());

  return (
    <section className="mt-6 space-y-4">
      <div>
        <h2 className="text-lg font-medium">已接入，可以直接去画布生成</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          密钥只存在你这台电脑上。要换号、加模型或接另一个平台，用下面的按钮。
        </p>
      </div>

      {byProvider.map((p) => {
        const mine = props.models.filter(
          (m) => m.providerId === p.id && m.enabled !== false
        );
        const counts = {
          text: mine.filter((m) => m.category === "text").length,
          image: mine.filter((m) => m.category === "image").length,
          video: mine.filter((m) => m.category === "video").length,
        };
        return (
          <div key={p.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium">{p.name || "未命名接口"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  密钥 {maskApiKey(p.apiKey)} ·{" "}
                  <code className="text-foreground">{normalizeApiBase(p.apiBase)}</code>
                </div>
                <div className="mt-2 text-sm">
                  已启用 {mine.length} 个模型
                  {mine.length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      （对话 {counts.text} · 出图 {counts.image} · 出视频 {counts.video}）
                    </span>
                  )}
                </div>
                {mine.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {mine.slice(0, 12).map((m) => (
                      <li
                        key={m.id}
                        className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-foreground"
                      >
                        {m.displayName || m.upstreamModel}
                      </li>
                    ))}
                    {mine.length > 12 && (
                      <li className="text-xs text-muted-foreground">+{mine.length - 12}</li>
                    )}
                  </ul>
                )}
                {(counts.image === 0 || counts.video === 0) && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {counts.image === 0 && counts.video === 0
                      ? "还没有出图、出视频模型，画布里这两类会不可用。"
                      : counts.image === 0
                        ? "还没有出图模型。"
                        : "还没有出视频模型。"}
                    点「重新拉取模型」只显示上游真实列表；勿勾「常用（未必开通）」。
                    也可手动填一个模型名。
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  onClick={() =>
                    props.onWizardChange({ mode: "change-key", providerId: p.id })
                  }
                >
                  更换密钥
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                  onClick={() =>
                    props.onWizardChange({ mode: "refetch", providerId: p.id })
                  }
                >
                  重新拉取模型
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          onClick={() => props.onWizardChange({ mode: "new" })}
        >
          <Plus className="h-4 w-4" /> 再接一个平台
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
          onClick={props.onOpenAdvanced}
        >
          高级设置
        </button>
      </div>

      <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        画布参考图/视频要给云端上游用时，请到「高级设置 → 参考图 OSS」配置公网
        Bucket。部分网关图生图不接受 base64，必须是可匿名访问的 https 直链。
      </p>
    </section>
  );
}

function SetupWizard(
  props: Props & { intent: WizardIntent }
) {
  const editing = props.providers.find((p) => p.id === props.intent.providerId);
  const startStep =
    props.intent.mode === "refetch" ? 3 : props.intent.mode === "change-key" ? 2 : 1;
  const [step, setStep] = useState(startStep);
  const [platform, setPlatform] = useState<"jumeng" | "other">(
    editing ? (isJumengProvider(editing) ? "jumeng" : "other") : "other"
  );
  const [name, setName] = useState(
    editing?.name || (platform === "jumeng" ? "聚梦 AI" : "我的接口")
  );
  const [apiBase, setApiBase] = useState(
    editing?.apiBase || (platform === "jumeng" ? JUMENGAI_SDK_API_BASE : "")
  );
  const [apiKey, setApiKey] = useState(editing?.apiKey || "");
  const [providerId] = useState(editing?.id || crypto.randomUUID());
  const [catalog, setCatalog] = useState<CatalogPick[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fetchHint, setFetchHint] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCat, setManualCat] = useState<LocalModelCategory>("image");
  /** 默认不展示「常用未必开通」，避免用户误勾成真实模型 */
  const [showBuiltinRecommended, setShowBuiltinRecommended] = useState(false);
  const [accountPicks, setAccountPicks] = useState<CatalogPick[]>([]);
  const [lastFetchError, setLastFetchError] = useState("");

  useEffect(() => {
    if (props.intent.mode !== "new" || editing) return;
    if (platform === "jumeng") {
      setName((n) => (n === "我的接口" || !n ? "聚梦 AI" : n));
      setApiBase((b) => b || JUMENGAI_SDK_API_BASE);
    } else {
      setName((n) => (n === "聚梦 AI" ? "我的接口" : n));
    }
  }, [platform, props.intent.mode, editing]);

  const rebuildCatalog = (
    account: CatalogPick[],
    opts?: { fetchError?: string; includeBuiltin?: boolean }
  ) => {
    const base = normalizeApiBase(apiBase || (platform === "jumeng" ? JUMENGAI_SDK_API_BASE : ""));
    const isJumeng = platform === "jumeng" || isJumengaiApiBase(base);
    const includeBuiltin = opts?.includeBuiltin ?? showBuiltinRecommended;
    const fetchError = opts?.fetchError ?? lastFetchError;
    const merged = mergeCatalog({
      account,
      isJumeng,
      fetchFailed: Boolean(fetchError) || account.length === 0,
      manuals: catalog.filter((c) => c.source === "manual"),
      includeBuiltin,
    });
    setCatalog(merged);
    // 关掉推荐时，去掉已勾选的 builtin，避免保存虚假开通
    if (!includeBuiltin) {
      const allowed = new Set(
        merged.filter((p) => p.source !== "builtin").map((p) => p.id)
      );
      setSelectedIds((prev) => prev.filter((id) => allowed.has(id)));
    }
    return { merged, isJumeng, fetchError };
  };

  const grouped = useMemo(() => {
    const g: Record<LocalModelCategory, CatalogPick[]> = {
      text: [],
      image: [],
      video: [],
      audio: [],
    };
    for (const p of catalog) g[p.category].push(p);
    return g;
  }, [catalog]);

  const loadCatalog = async () => {
    const key = normalizeApiKey(apiKey);
    const base = normalizeApiBase(apiBase || (platform === "jumeng" ? JUMENGAI_SDK_API_BASE : ""));
    if (!key) {
      toast.error("请先粘贴 API 密钥");
      return false;
    }
    if (!base) {
      toast.error("请填写接口地址，例如 https://api.openai.com/v1");
      return false;
    }
    setFetching(true);
    try {
      const isJumengBase = platform === "jumeng" || isJumengaiApiBase(base);
      const { picks, error } = await fetchAccountCatalog({
        apiBase: base,
        apiKey: key,
        // 聚梦生图/生视频：只要图片+视频，对齐 create 页用途
        mediaOnly: isJumengBase,
      });
      setAccountPicks(picks);
      setLastFetchError(error || "");
      // 默认不并入常用推荐；只展示上游真实返回
      setShowBuiltinRecommended(false);
      const { merged, isJumeng } = rebuildCatalog(picks, {
        fetchError: error || "",
        includeBuiltin: false,
      });
      // 拉取后默认全选图+视频，保存时覆盖该接口本地列表
      const mediaIds = merged
        .filter(
          (p) =>
            p.source === "account" &&
            (p.category === "image" || p.category === "video")
        )
        .map((p) => p.id);
      setSelectedIds(mediaIds);
      if (error) {
        setFetchHint(
          isJumeng
            ? `${error} 当前未混入「常用」清单。请点下方手动填写，或勾选「显示常用推荐（未必开通）」。`
            : `${error} 请在下方手动填写模型名（须与上游一致）。`
        );
      } else if (picks.length === 0) {
        setFetchHint("上游返回了空列表。请手动填写控制台里的准确模型名。");
      } else {
        setFetchHint(
          `已从上游拉到 ${picks.length} 个图/视频模型（展示名对齐 create 页）。已全选；保存后将覆盖本接口下本地图/视频列表。`
        );
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "拉取失败";
      setAccountPicks([]);
      setLastFetchError(msg);
      setShowBuiltinRecommended(false);
      rebuildCatalog([], { fetchError: msg, includeBuiltin: false });
      setFetchHint(msg);
      toast.error(msg);
      return false;
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (step !== 3) return;
    if (catalog.length > 0 || fetching) return;
    void loadCatalog();
    // 仅进入第 3 步时拉一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  /** 一键勾选当前列表全部模型 */
  const selectAllVisible = () => {
    setSelectedIds(catalog.map((p) => p.id));
  };

  /** 取消全部勾选 */
  const clearAllSelected = () => {
    setSelectedIds([]);
  };

  /** 勾选某一分类下全部 */
  const selectCategory = (cat: LocalModelCategory) => {
    const ids = grouped[cat].map((p) => p.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  /** 取消某一分类勾选 */
  const clearCategory = (cat: LocalModelCategory) => {
    const drop = new Set(grouped[cat].map((p) => p.id));
    setSelectedIds((prev) => prev.filter((id) => !drop.has(id)));
  };

  const addManual = () => {
    const pick = newManualPick(manualName, manualCat);
    if (!pick) {
      toast.error("请填写模型名（和平台控制台里的名字一致）");
      return;
    }
    setCatalog((prev) => {
      if (prev.some((p) => p.id === pick.id)) return prev;
      return [...prev, pick];
    });
    setSelectedIds((prev) => (prev.includes(pick.id) ? prev : [...prev, pick.id]));
    setManualName("");
    toast.success(`已加入 ${pick.id}`);
  };

  const finish = async () => {
    const key = normalizeApiKey(apiKey);
    const base = normalizeApiBase(
      apiBase || (platform === "jumeng" ? JUMENGAI_SDK_API_BASE : "")
    );
    if (!key) {
      toast.error("请填写密钥");
      setStep(2);
      return;
    }
    if (!base) {
      toast.error("请填写接口地址");
      setStep(2);
      return;
    }
      const selectedInOrder = selectedIds
      .map((id) => catalog.find((c) => c.id === id))
      .filter((x): x is CatalogPick => Boolean(x));
    if (selectedInOrder.length === 0) {
      toast.error("请至少勾选一个模型");
      return;
    }
    const builtinSelected = selectedInOrder.filter((p) => p.source === "builtin");
    if (builtinSelected.length > 0) {
      const ok = window.confirm(
        `你勾选了 ${builtinSelected.length} 个「常用（未必开通）」模型，上游可能并不存在。\n\n建议只勾「账号已有」。仍要继续保存吗？`
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      const provider: LocalProvider = {
        id: providerId,
        name: (name || (platform === "jumeng" ? "聚梦 AI" : "我的接口")).trim(),
        apiBase: base,
        apiKey: key,
      };
      const nextProviders = props.providers.some((p) => p.id === providerId)
        ? props.providers.map((p) => (p.id === providerId ? provider : p))
        : [...props.providers.filter((p) => (p.apiKey || "").trim() || p.id === providerId), provider];
      // 去掉向导过程中产生的空供应商占位
      const cleanedProviders = nextProviders.filter(
        (p) => p.id === providerId || (p.apiKey || "").trim()
      );
      const isJumengSave = platform === "jumeng" || isJumengaiApiBase(base);
      const mediaSelected = selectedInOrder.filter(
        (p) => p.category === "image" || p.category === "video"
      );
      // 聚梦：覆盖本接口下图/视频列表；其它接口仍按勾选增量启用
      const nextModels = isJumengSave
        ? applyOverwriteProviderMediaModels({
            provider,
            mediaPicks: mediaSelected.length ? mediaSelected : selectedInOrder,
            allModels: props.models,
          })
        : applySelectedModels({
            provider,
            selectedInOrder,
            allModels: props.models,
          });
      const nextTools = bindToolsByFirstSelected(
        props.toolModels,
        selectedInOrder,
        nextModels
      );
      await props.onCommitted({
        providers: cleanedProviders,
        models: nextModels,
        toolModels: nextTools,
      });
      props.onWizardChange(null);
      toast.success(
        isJumengSave
          ? `已覆盖保存 ${mediaSelected.length || selectedInOrder.length} 个图/视频模型，可在画布下拉选择`
          : "已保存，可以去画布生成了"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveKeyOnly = async () => {
    const key = normalizeApiKey(apiKey);
    const base = normalizeApiBase(
      apiBase || (platform === "jumeng" ? JUMENGAI_SDK_API_BASE : "")
    );
    if (!key) {
      toast.error("请填写密钥");
      return;
    }
    if (!base) {
      toast.error("请填写接口地址");
      return;
    }
    setSaving(true);
    try {
      const provider: LocalProvider = {
        id: providerId,
        name: (name || (platform === "jumeng" ? "聚梦 AI" : "我的接口")).trim(),
        apiBase: base,
        apiKey: key,
      };
      const nextProviders = props.providers.some((p) => p.id === providerId)
        ? props.providers.map((p) => (p.id === providerId ? provider : p))
        : [...props.providers, provider];
      await props.onCommitted({
        providers: nextProviders,
        models: props.models,
        toolModels: props.toolModels,
      });
      props.onWizardChange(null);
      toast.success("密钥已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const canCancel = props.models.some((m) => m.enabled !== false);

  return (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium">
            {props.intent.mode === "change-key"
              ? "更换密钥"
              : props.intent.mode === "refetch"
                ? "选择要用的模型"
                : "把接口接到画布"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            三步：选平台 → 粘贴密钥 → 勾选模型。密钥只存在本机。
          </p>
        </div>
        {canCancel && (
          <button
            type="button"
            className="text-sm text-muted-foreground underline"
            onClick={() => props.onWizardChange(null)}
          >
            返回已接入
          </button>
        )}
      </div>

      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {[
          [1, "选平台"],
          [2, "填密钥"],
          [3, "勾选模型"],
        ].map(([n, label]) => (
          <li
            key={n}
            className={`rounded-full px-3 py-1 ${
              step === n
                ? "bg-primary text-primary-foreground"
                : step > Number(n)
                  ? "border border-border bg-muted/50"
                  : "border border-border text-muted-foreground"
            }`}
          >
            {n}. {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className={`rounded-xl border p-4 text-left ${
              platform === "jumeng"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/40"
            }`}
            onClick={() => setPlatform("jumeng")}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">聚梦 AI</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                推荐
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              官方接口，粘贴控制台密钥即可拉取对话 / 出图 / 出视频模型。
              图生图、图生视频的参考素材直接提交，无需配置 OSS。
            </p>
          </button>
          <button
            type="button"
            className={`rounded-xl border p-4 text-left ${
              platform === "other"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/40"
            }`}
            onClick={() => setPlatform("other")}
          >
            <div className="font-medium">其他 OpenAI 兼容</div>
            <p className="mt-2 text-sm text-muted-foreground">
              ChatGPT、各类中转网关。需要自己填接口地址（一般带 /v1）。
              图生图、图生视频的参考素材需自行配置「参考图 OSS」公网直链。
            </p>
          </button>
          <div className="sm:col-span-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              onClick={() => {
                if (platform === "jumeng") {
                  setName("聚梦 AI");
                  setApiBase(JUMENGAI_SDK_API_BASE);
                }
                setStep(2);
              }}
            >
              下一步 <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="max-w-xl space-y-3">
          {platform === "other" && (
            <>
              <label className={labelCls}>
                这个接口叫什么（自己看的）
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如 OpenAI / 某中转"
                />
              </label>
              <label className={labelCls}>
                接口地址
                <input
                  className={inputCls}
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  和官方文档里的 Base URL 一致，通常以 <code>/v1</code> 结尾。
                </span>
              </label>
            </>
          )}
          {platform === "jumeng" && (
            <p className="text-sm text-muted-foreground">
              到{" "}
              <a
                className="underline"
                href="https://www.jumengai.com"
                target="_blank"
                rel="noreferrer"
              >
                聚梦控制台
              </a>{" "}
              复制 API Key。说明见{" "}
              <a
                className="underline"
                href="https://doc.jumengai.com/api/api-key"
                target="_blank"
                rel="noreferrer"
              >
                如何获取 Key
              </a>
              。不要加 Bearer 前缀。
            </p>
          )}
          <label className={labelCls}>
            API 密钥
            <input
              type="password"
              className={inputCls}
              value={apiKey}
              autoComplete="off"
              placeholder="sk-..."
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={(e) => setApiKey(normalizeApiKey(e.target.value))}
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-2">
            {props.intent.mode === "new" && (
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm"
                onClick={() => setStep(1)}
              >
                上一步
              </button>
            )}
            {props.intent.mode === "change-key" && (
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                disabled={saving}
                onClick={() => void saveKeyOnly()}
              >
                {saving ? "保存中…" : "只保存密钥"}
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              disabled={fetching}
              onClick={async () => {
                const ok = await loadCatalog();
                if (ok) setStep(3);
              }}
            >
              <KeyRound className="h-4 w-4" />
              {fetching ? "正在拉取模型…" : "拉取可用模型"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {fetchHint && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {fetchHint}
            </p>
          )}
          {fetching && <p className="text-sm text-muted-foreground">正在向平台询问有哪些模型…</p>}

          {(platform === "jumeng" || isJumengaiApiBase(apiBase)) && (
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-1"
                checked={showBuiltinRecommended}
                onChange={(e) => {
                  const on = e.target.checked;
                  setShowBuiltinRecommended(on);
                  rebuildCatalog(accountPicks, {
                    fetchError: lastFetchError,
                    includeBuiltin: on,
                  });
                }}
              />
              <span>
                显示聚梦「常用推荐」（未必开通）
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  默认关闭。只勾「账号已有」才是上游真实返回的模型。
                </span>
              </span>
            </label>
          )}

          {catalog.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={selectAllVisible}
              >
                一键全选（{catalog.length}）
              </button>
              <button
                type="button"
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                onClick={clearAllSelected}
                disabled={selectedIds.length === 0}
              >
                全部取消
              </button>
              <span className="text-xs text-muted-foreground">
                已选 {selectedIds.length} / {catalog.length}
              </span>
            </div>
          )}

          {(["text", "image", "video", "audio"] as const).map((cat) => {
            const list = grouped[cat];
            if (!list.length) return null;
            const selectedInCat = list.filter((p) => selectedIds.includes(p.id)).length;
            return (
              <div key={cat}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {CAT_LABEL[cat]}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {selectedInCat}/{list.length}
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
                      onClick={() => selectCategory(cat)}
                    >
                      全选本类
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
                      disabled={selectedInCat === 0}
                      onClick={() => clearCategory(cat)}
                    >
                      取消本类
                    </button>
                  </div>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {list.map((p) => {
                    const on = selectedIds.includes(p.id);
                    return (
                      <li key={`${p.source}-${p.id}`}>
                        <label
                          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                            on ? "border-primary bg-primary/5" : "border-border"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={on}
                            onChange={() => toggle(p.id)}
                          />
                          <span>
                            <span className="block font-medium">
                              {p.displayName}
                              {p.isDiscount ? (
                                <span className="ml-1 rounded border border-amber-500/40 px-1 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                  优惠
                                </span>
                              ) : null}
                            </span>
                            {p.displayName !== p.id && (
                              <span className="block font-mono text-[11px] text-muted-foreground">
                                {p.id}
                              </span>
                            )}
                            {p.description ? (
                              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                                {p.description}
                              </span>
                            ) : null}
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {catalogSourceLabel(p.source)}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <div className="rounded-xl border border-dashed border-border p-4">
            <div className="text-sm font-medium">列表里没有？手动填一个</div>
            <p className="mt-1 text-xs text-muted-foreground">
              填写平台文档或控制台里的模型名，并选它是对话、出图还是出视频。
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className={`${labelCls} min-w-[200px] flex-1`}>
                模型名
                <input
                  className={inputCls}
                  value={manualName}
                  placeholder="例如 seedance-2.0/discount4"
                  onChange={(e) => setManualName(e.target.value)}
                />
              </label>
              <label className={labelCls}>
                用途
                <select
                  className={inputCls}
                  value={manualCat}
                  onChange={(e) => setManualCat(e.target.value as LocalModelCategory)}
                >
                  <option value="text">对话 / 文本</option>
                  <option value="image">出图</option>
                  <option value="video">出视频</option>
                  <option value="audio">音频</option>
                </select>
              </label>
              <button
                type="button"
                className="rounded-md border px-3 py-2 text-sm"
                onClick={addManual}
              >
                加入并勾选
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm"
              onClick={() => setStep(2)}
            >
              上一步
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              disabled={saving || selectedIds.length === 0}
              onClick={() => void finish()}
            >
              <Check className="h-4 w-4" />
              {saving ? "保存中…" : "完成并保存"}
            </button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={props.onOpenAdvanced}
            >
              去高级设置
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
