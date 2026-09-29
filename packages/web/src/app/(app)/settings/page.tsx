"use client";

/**
 * 本地设置：左侧三个分组
 * - 外观：主题 / 强调色 / 毛玻璃 / 光晕 / 网格吸附 / 缩放（AppearanceSettingsPanel）
 * - 模型服务（默认）：接入向导 / 摘要 + 高级设置（密钥、模型、画布工具）
 * - 存储空间：数据位置 + 参考图 OSS
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cpu, Database, Palette } from "lucide-react";
import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
import { AppearanceSettingsPanel } from "@/components/settings/AppearanceSettingsPanel";
import { useAppTheme } from "@/components/providers/AppThemeProvider";
import { DataLocationSettingsPanel } from "@/components/settings/DataLocationSettingsPanel";
import { UserOssSettingsPanel } from "@/components/settings/UserOssSettingsPanel";
import pkg from "../../../../package.json";
import "./settingsPage.css";
import {
  LocalSetupHome,
  type WizardIntent,
} from "@/components/settings/LocalSetupHome";
import {
  AdvancedSettings,
  type AdvancedTab,
} from "@/components/settings/AdvancedSettings";
import { localStore } from "@/lib/local/store";
import type { LocalModel, LocalProvider } from "@/lib/local/types";
import { isSetupComplete } from "@/lib/local/setupCatalog";
import {
  LOCAL_CANVAS_TOOL_DEFS,
  emptyToolModelsMap,
  type LocalToolModelsMap,
} from "@/lib/local/canvasToolDefs";
import {
  imageAspectPresets,
  videoDurationPresets,
} from "@/lib/local/presetTemplates";
import { localGenerateText, normalizeApiKey } from "@/lib/local/generate";
import { applyEndpointDefaults } from "@/lib/local/endpointHelpers";

function uid() {
  return crypto.randomUUID();
}

type TabId = AdvancedTab;
type SettingsGroup = "appearance" | "models" | "storage";

/** 版本号取自 web 包 package.json */
const APP_VERSION = pkg.version;

const EMPTY_MODEL = (category: LocalModel["category"] = "text"): LocalModel => {
  const id = uid();
  const short = id.slice(0, 8);
  const base: LocalModel = {
    id,
    name: `${category}_${short}`,
    displayName:
      category === "text"
        ? `对话模型 ${short}`
        : category === "image"
          ? `出图模型 ${short}`
          : category === "video"
            ? `视频模型 ${short}`
            : `音频模型 ${short}`,
    category,
    mode: "openai_compatible",
    upstreamModel:
      category === "text"
        ? ""
        : category === "image"
          ? ""
          : category === "video"
            ? ""
            : "",
    enabled: true,
    sortOrder: Date.now() % 100000,
    generationPresets:
      category === "image"
        ? imageAspectPresets()
        : category === "video"
          ? videoDurationPresets()
          : undefined,
  };
  const withTpl = applyEndpointDefaults(base, { mode: "custom_template", category });
  return { ...withTpl, mode: "openai_compatible" };
};

const CAT_ZH: Record<LocalModel["category"], string> = {
  text: "对话",
  image: "出图",
  video: "出视频",
  audio: "音频",
  model3d: "3D 模型",
};

export default function LocalSettingsPage() {
  const [tab, setTab] = useState<TabId>("keys");
  const [providers, setProviders] = useState<LocalProvider[]>([]);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [toolModels, setToolModels] = useState<LocalToolModelsMap>(emptyToolModelsMap());
  const [dataRoot, setDataRoot] = useState("");
  const [testPrompt, setTestPrompt] = useState("用一句话介绍你自己");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<"all" | LocalModel["category"]>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pane, setPane] = useState<"home" | "advanced">("home");
  const [wizard, setWizard] = useState<WizardIntent | null>(null);
  /** 当前分组：默认模型服务 */
  const [group, setGroup] = useState<SettingsGroup>("models");
  const [storageTab, setStorageTab] = useState<"storage" | "oss">("storage");
  const { discardAppearance } = useAppTheme();

  // 离开设置页时丢弃未保存的外观预览（切换分组不丢）
  useEffect(() => () => discardAppearance(), [discardAppearance]);

  // 首次加载：结果在异步回调里写入 state（loading 初始即为 true），避免 effect 内同步 setState
  useEffect(() => {
    let alive = true;
    const api = localStore();
    Promise.all([api.listProviders(), api.listModels(), api.getDataRoot(), api.readToolModels()])
      .then(([p, m, root, tools]) => {
        if (!alive) return;
        setProviders(p);
        setModels(m);
        setDataRoot(root);
        setToolModels(tools);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const persistSetup = async (next: {
    providers: LocalProvider[];
    models: LocalModel[];
    toolModels: LocalToolModelsMap;
    toastOk?: string;
  }) => {
    const api = localStore();
    const cleanedProviders = next.providers.map((p) => ({
      ...p,
      apiKey: normalizeApiKey(p.apiKey || ""),
      apiBase: (p.apiBase || "").trim(),
    }));
    setProviders(cleanedProviders);
    setModels(next.models);
    setToolModels(next.toolModels);
    await api.saveProviders(cleanedProviders);
    await api.saveModels(next.models);
    await api.saveToolModels(next.toolModels);
    if (next.toastOk) toast.success(next.toastOk);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const counts = {
        text: models.filter((m) => m.category === "text").length,
        image: models.filter((m) => m.category === "image").length,
        video: models.filter((m) => m.category === "video").length,
        audio: models.filter((m) => m.category === "audio").length,
      };
      await persistSetup({
        providers,
        models,
        toolModels,
        toastOk: `已保存 ${models.length} 个模型（对话 ${counts.text} / 出图 ${counts.image} / 出视频 ${counts.video} / 音频 ${counts.audio}）`,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const addModel = (category: LocalModel["category"]) => {
    const created = EMPTY_MODEL(category);
    setModels((prev) => [created, ...prev]);
    setModelFilter(category);
    setTab("models");
    toast.message(`已添加${CAT_ZH[category]}模型，记得点右下角「保存到本地」`);
  };

  const countByCat = useMemo(() => {
    const c = { text: 0, image: 0, video: 0, audio: 0, model3d: 0 };
    for (const m of models) {
      if (m.category in c) c[m.category as keyof typeof c] += 1;
    }
    return c;
  }, [models]);

  const testModel = async (modelId: string) => {
    setTestingId(modelId);
    try {
      await saveAll();
      const text = await localGenerateText({ modelId, prompt: testPrompt });
      toast.success(`连通成功：${text.slice(0, 120)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTestingId(null);
    }
  };

  const visibleModels = useMemo(
    () =>
      models
        .filter((m) => modelFilter === "all" || m.category === modelFilter)
        .slice()
        .sort((a, b) => {
          const catOrder = { text: 0, image: 1, video: 2, audio: 3, model3d: 4 } as const;
          const d = catOrder[a.category] - catOrder[b.category];
          if (d !== 0) return d;
          return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        }),
    [modelFilter, models]
  );

  const modelsByCategory = (cat: string) =>
    models.filter((m) => m.enabled !== false && m.category === cat);

  const toolGroups = useMemo(() => {
    const map = new Map<string, typeof LOCAL_CANVAS_TOOL_DEFS>();
    for (const d of LOCAL_CANVAS_TOOL_DEFS) {
      const list = map.get(d.group) || [];
      list.push(d);
      map.set(d.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const fillCategoryDefaults = (cat: LocalModel["category"]) => {
    const first = modelsByCategory(cat)[0]?.name || "";
    if (!first) {
      toast.error(`请先添加并启用一个「${CAT_ZH[cat]}」模型`);
      return;
    }
    setToolModels((prev) => {
      const next = { ...prev };
      for (const d of LOCAL_CANVAS_TOOL_DEFS) {
        if (d.category !== cat) continue;
        next[d.toolId] = {
          primary: first,
          secondary: next[d.toolId]?.secondary || "",
        };
      }
      return next;
    });
    toast.success(`已将${CAT_ZH[cat]}类工具设为 ${first}`);
  };

  const groups: { id: SettingsGroup; label: string; icon: typeof Palette }[] = [
    { id: "appearance", label: "外观", icon: Palette },
    { id: "models", label: "模型服务", icon: Cpu },
    { id: "storage", label: "存储空间", icon: Database },
  ];

  return (
    <HuabuPublicShell page="settings">
      <div className="st-wrap">
        <section className="st-panel jm-panel" aria-label="设置">
          <header className="st-head">
            <h1>设置</h1>
            <p>本地工作区 · 版本 {APP_VERSION}</p>
          </header>

          <div className="st-body">
            <nav className="st-nav" aria-label="设置分组">
              {groups.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={group === id ? "active" : undefined}
                  aria-current={group === id ? "page" : undefined}
                  onClick={() => setGroup(id)}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  {label}
                </button>
              ))}
            </nav>

            <div className="st-content jm-scroll">
              {group === "appearance" ? (
                <AppearanceSettingsPanel />
              ) : group === "storage" ? (
                <div className="st-legacy">
                  <div className="st-section-head">
                    <h2>存储空间</h2>
                    <p>本机数据保存位置与参考图公网 OSS</p>
                  </div>
                  <div className="st-subtabs" role="tablist" aria-label="存储空间">
                    {[
                      { id: "storage" as const, label: "数据位置" },
                      { id: "oss" as const, label: "参考图 OSS" },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={storageTab === t.id}
                        className={`jm-pill${storageTab === t.id ? " active" : ""}`}
                        onClick={() => setStorageTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {storageTab === "storage" ? (
                    <DataLocationSettingsPanel onDataRootChange={setDataRoot} />
                  ) : (
                    <UserOssSettingsPanel />
                  )}
                </div>
              ) : (
      <div className="st-legacy">
        <div className="st-section-head">
          <h2>模型服务</h2>
          <p>
            把你的 API 接到这台电脑上的画布：粘贴密钥、勾选模型，就可以生成文字、图片和视频。
            数据只存在本机，没有登录，也不走云端算力。
          </p>
        </div>
        {pane === "home" && (!isSetupComplete(providers, models) || wizard) && (
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground underline"
            onClick={() => {
              setPane("advanced");
              setWizard(null);
            }}
          >
            高级设置
          </button>
        )}

        {loading ? (
          <p className="mt-8 text-sm text-muted-foreground">加载中…</p>
        ) : pane === "home" ? (
          <LocalSetupHome
            providers={providers}
            models={models}
            toolModels={toolModels}
            wizard={wizard}
            onWizardChange={setWizard}
            onCommitted={async (next) => {
              await persistSetup(next);
              setPane("home");
            }}
            onOpenAdvanced={() => {
              setPane("advanced");
              setWizard(null);
            }}
          />
        ) : (
          <AdvancedSettings
            tab={tab}
            onTab={setTab}
            providers={providers}
            setProviders={setProviders}
            models={models}
            setModels={setModels}
            toolModels={toolModels}
            setToolModels={setToolModels}
            modelFilter={modelFilter}
            setModelFilter={setModelFilter}
            testPrompt={testPrompt}
            setTestPrompt={setTestPrompt}
            testingId={testingId}
            onTestModel={(id) => void testModel(id)}
            onAddModel={addModel}
            onFillTools={fillCategoryDefaults}
            countByCat={countByCat}
            visibleModels={visibleModels}
            modelsByCategory={modelsByCategory}
            toolGroups={toolGroups}
            saving={saving}
            onSave={() => void saveAll()}
            onBack={() => setPane("home")}
            backLabel={
              isSetupComplete(providers, models) ? "返回已接入摘要" : "返回接入向导"
            }
            dataRoot={dataRoot}
            onDataRootChange={setDataRoot}
            tabIds={["keys", "models", "tools"]}
          />
        )}
      </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </HuabuPublicShell>
  );
}
