"use client";

/**
 * 开源本地版设置：默认向导/摘要；高级设置分密钥、模型、画布工具三块。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const api = localStore();
      const [p, m, root, tools] = await Promise.all([
        api.listProviders(),
        api.listModels(),
        api.getDataRoot(),
        api.readToolModels(),
      ]);
      setProviders(p);
      setModels(m);
      setDataRoot(root);
      setToolModels(tools);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    const c = { text: 0, image: 0, video: 0, audio: 0 };
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
          const catOrder = { text: 0, image: 1, video: 2, audio: 3 } as const;
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

  return (
    <HuabuPublicShell>
      <div className="mx-auto max-w-5xl px-6 py-10 text-foreground">
        <h1 className="text-2xl font-semibold tracking-tight">本地设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把你的 API 接到这台电脑上的画布：粘贴密钥、勾选模型，就可以生成文字、图片和视频。
          数据只存在本机，没有登录，也不走云端算力。
        </p>
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
          />
        )}
      </div>
    </HuabuPublicShell>
  );
}
