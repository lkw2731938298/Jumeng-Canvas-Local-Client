"use client";

/**
 * 高级设置：三块说清楚——密钥、模型、画布工具。模型卡片默认只露常用项。
 */

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Plus, Save, Trash2 } from "lucide-react";
import type { LocalModel, LocalProvider } from "@/lib/local/types";
import type { LocalCanvasToolDef, LocalToolModelsMap } from "@/lib/local/canvasToolDefs";
import { applyEndpointDefaults, JUMENGAI_SDK_API_BASE } from "@/lib/local/endpointHelpers";
import { imageAspectPresets, videoDurationPresets } from "@/lib/local/presetTemplates";
import {
  CLARITY_TIER_ORDER,
  buildExplicitCanvasCaps,
  resolveModelCanvasCaps,
  type CanvasClarityTier,
  type ImageSizeMode,
  type VideoSizeMode,
} from "@/lib/local/modelGenerationCaps";
import { normalizeApiKey } from "@/lib/local/generate";
import { UserOssSettingsPanel } from "@/components/settings/UserOssSettingsPanel";
import { DataLocationSettingsPanel } from "@/components/settings/DataLocationSettingsPanel";

export type AdvancedTab = "keys" | "models" | "tools" | "oss" | "storage";

const inputCls =
  "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
const labelCls = "text-xs text-muted-foreground";

const CAT_ZH: Record<LocalModel["category"], string> = {
  text: "对话",
  image: "出图",
  video: "出视频",
  audio: "音频",
};

type Props = {
  tab: AdvancedTab;
  onTab: (t: AdvancedTab) => void;
  providers: LocalProvider[];
  setProviders: (next: LocalProvider[] | ((p: LocalProvider[]) => LocalProvider[])) => void;
  models: LocalModel[];
  setModels: (next: LocalModel[] | ((p: LocalModel[]) => LocalModel[])) => void;
  toolModels: LocalToolModelsMap;
  setToolModels: (
    next: LocalToolModelsMap | ((p: LocalToolModelsMap) => LocalToolModelsMap)
  ) => void;
  modelFilter: "all" | LocalModel["category"];
  setModelFilter: (v: "all" | LocalModel["category"]) => void;
  testPrompt: string;
  setTestPrompt: (v: string) => void;
  testingId: string | null;
  onTestModel: (id: string) => void;
  onAddModel: (cat: LocalModel["category"]) => void;
  onFillTools: (cat: LocalModel["category"]) => void;
  countByCat: Record<"text" | "image" | "video" | "audio", number>;
  visibleModels: LocalModel[];
  modelsByCategory: (cat: string) => LocalModel[];
  toolGroups: [string, LocalCanvasToolDef[]][];
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
  backLabel: string;
  dataRoot: string;
  onDataRootChange?: (root: string) => void;
};

export function AdvancedSettings(props: Props) {
  const tabs: { id: AdvancedTab; n: string; label: string; hint: string }[] = [
    { id: "keys", n: "1", label: "密钥", hint: "改接口地址和 Key" },
    { id: "models", n: "2", label: "模型", hint: "开关、改名、核对平台模型名" },
    { id: "tools", n: "3", label: "画布工具", hint: "每个功能默认用哪个模型" },
    { id: "oss", n: "4", label: "参考图 OSS", hint: "公网 Bucket，带参考才能被上游拉取" },
    { id: "storage", n: "5", label: "数据位置", hint: "本机用户数据与素材保存目录" },
  ];

  return (
    <>
      <div className="mt-4">
        <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={props.onBack}
        >
          {props.backLabel}
        </button>
        <h2 className="mt-3 text-lg font-medium">高级设置</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          日常用外面的向导即可。这里只在你要改密钥、微调某个模型，指定画布工具模型，配置参考图公网
          OSS，或改本机数据/素材保存位置时才需要打开。
        </p>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {tabs.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => props.onTab(t.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left ${
                  props.tab === t.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="text-xs text-muted-foreground">第 {t.n} 步</div>
                <div className="font-medium">{t.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.hint}</div>
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          数据存在：
          <code className="mx-1 break-all rounded bg-muted px-1.5 py-0.5 text-foreground">
            {props.dataRoot || "…"}
          </code>
        </p>
      </div>

      {props.tab === "keys" && <KeysPane {...props} />}
      {props.tab === "models" && <ModelsPane {...props} />}
      {props.tab === "tools" && <ToolsPane {...props} />}
      {props.tab === "oss" && <UserOssSettingsPanel />}
      {props.tab === "storage" && (
        <DataLocationSettingsPanel onDataRootChange={props.onDataRootChange} />
      )}

      {props.tab !== "oss" && props.tab !== "storage" && (
      <div className="sticky bottom-0 mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/90 py-4 backdrop-blur">
        <p className="text-xs text-muted-foreground">改完后必须点保存，否则不会写入本机。</p>
        <button
          type="button"
          disabled={props.saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          onClick={props.onSave}
        >
          <Save className="h-4 w-4" /> {props.saving ? "保存中…" : "保存到本地"}
        </button>
      </div>
      )}
    </>
  );
}

function KeysPane(props: Props) {
  return (
    <section className="mt-8">
      <h3 className="text-base font-medium">接口密钥</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        每一组是一个平台：名字随便起，地址填文档里的 Base URL，密钥从该平台控制台复制。
        模型会绑定到其中一组，生成时带上这组 Key。
      </p>
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
        onClick={() =>
          props.setProviders((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: "新接口",
              apiBase: JUMENGAI_SDK_API_BASE,
              apiKey: "",
            },
          ])
        }
      >
        <Plus className="h-4 w-4" /> 再加一组
      </button>
      <div className="mt-4 space-y-4">
        {props.providers.map((p, idx) => (
          <div key={p.id} className="rounded-xl border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                显示名称
                <input
                  className={inputCls}
                  value={p.name}
                  placeholder="例如 OpenAI 兼容网关"
                  onChange={(e) => {
                    const next = [...props.providers];
                    next[idx] = { ...p, name: e.target.value };
                    props.setProviders(next);
                  }}
                />
              </label>
              <label className={labelCls}>
                接口地址
                <input
                  className={inputCls}
                  value={p.apiBase}
                  placeholder={JUMENGAI_SDK_API_BASE}
                  onChange={(e) => {
                    const next = [...props.providers];
                    next[idx] = { ...p, apiBase: e.target.value };
                    props.setProviders(next);
                  }}
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  聚梦填{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      const next = [...props.providers];
                      next[idx] = {
                        ...p,
                        name: /新接口|新供应商/.test(p.name) ? "OpenAI 兼容" : p.name,
                        apiBase: JUMENGAI_SDK_API_BASE,
                      };
                      props.setProviders(next);
                    }}
                  >
                    {JUMENGAI_SDK_API_BASE}
                  </button>
                  （一般要带 /v1）
                </span>
              </label>
              <label className={`${labelCls} sm:col-span-2`}>
                密钥
                <input
                  type="password"
                  className={inputCls}
                  value={p.apiKey}
                  placeholder="sk-..."
                  autoComplete="off"
                  onChange={(e) => {
                    const next = [...props.providers];
                    next[idx] = { ...p, apiKey: e.target.value };
                    props.setProviders(next);
                  }}
                  onBlur={(e) => {
                    const cleaned = normalizeApiKey(e.target.value);
                    if (cleaned === p.apiKey) return;
                    const next = [...props.providers];
                    next[idx] = { ...p, apiKey: cleaned };
                    props.setProviders(next);
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 text-sm text-red-500"
              onClick={() =>
                props.setProviders((prev) => prev.filter((x) => x.id !== p.id))
              }
            >
              <Trash2 className="h-4 w-4" /> 删除这组
            </button>
          </div>
        ))}
        {props.providers.length === 0 && (
          <p className="text-sm text-muted-foreground">还没有接口。可点「再加一组」，或返回向导添加。</p>
        )}
      </div>
    </section>
  );
}

function ModelsPane(props: Props) {
  return (
    <section className="mt-8">
      <h3 className="text-base font-medium">模型清单</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        画布里能选到的，就是这里勾了「在画布显示」的模型。通常只需核对：用哪组密钥、平台上的模型名对不对。
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        对话 {props.countByCat.text} · 出图 {props.countByCat.image} · 出视频{" "}
        {props.countByCat.video} · 音频 {props.countByCat.audio}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["text", "加对话模型"],
            ["image", "加出图模型"],
            ["video", "加出视频模型"],
            ["audio", "加音频模型"],
          ] as const
        ).map(([cat, label]) => (
          <button
            key={cat}
            type="button"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            onClick={() => props.onAddModel(cat)}
          >
            <Plus className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["all", "全部"],
            ["text", "对话"],
            ["image", "出图"],
            ["video", "出视频"],
            ["audio", "音频"],
          ] as const
        ).map(([id, label]) => {
          const n =
            id === "all" ? props.models.length : props.countByCat[id as keyof typeof props.countByCat];
          return (
            <button
              key={id}
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs ${
                props.modelFilter === id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border"
              }`}
              onClick={() => props.setModelFilter(id)}
            >
              {label} ({n})
            </button>
          );
        })}
      </div>

      {props.visibleModels.some((m) => m.category === "text") && (
        <label className={`${labelCls} mt-4 block max-w-md`}>
          测对话模型时说的话
          <input
            className={inputCls}
            value={props.testPrompt}
            onChange={(e) => props.setTestPrompt(e.target.value)}
          />
        </label>
      )}

      <div className="mt-6 space-y-4">
        {props.visibleModels.map((m) => {
          const idx = props.models.findIndex((x) => x.id === m.id);
          if (idx < 0) return null;
          return (
            <ModelCard
              key={m.id}
              model={m}
              idx={idx}
              providers={props.providers}
              models={props.models}
              setModels={props.setModels}
              testingId={props.testingId}
              onTest={() => props.onTestModel(m.id)}
            />
          );
        })}
        {props.visibleModels.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            这一类还没有模型。用上面的按钮添加，或返回向导重新勾选。
          </p>
        )}
      </div>
    </section>
  );
}

function ModelCard(props: {
  model: LocalModel;
  idx: number;
  providers: LocalProvider[];
  models: LocalModel[];
  setModels: Props["setModels"];
  testingId: string | null;
  onTest: () => void;
}) {
  const { model: m, idx } = props;
  const isCustom = (m.mode || "openai_compatible") === "custom_template";
  const [more, setMore] = useState(isCustom);
  const bound = props.providers.find((p) => p.id === m.providerId);

  const patch = (next: LocalModel) => {
    const list = [...props.models];
    list[idx] = next;
    props.setModels(list);
  };

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={m.enabled !== false}
            onChange={(e) => patch({ ...m, enabled: e.target.checked })}
          />
          在画布显示
        </label>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {CAT_ZH[m.category]}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>
          画布上显示的名字
          <input
            className={inputCls}
            value={m.displayName}
            onChange={(e) => patch({ ...m, displayName: e.target.value })}
          />
        </label>
        <label className={labelCls}>
          用途
          <select
            className={inputCls}
            value={m.category}
            onChange={(e) => {
              const category = e.target.value as LocalModel["category"];
              patch(applyEndpointDefaults(m, { category }));
            }}
          >
            <option value="text">对话 / 文本</option>
            <option value="image">出图</option>
            <option value="video">出视频</option>
            <option value="audio">音频</option>
          </select>
        </label>
        <label className={labelCls}>
          用哪组密钥
          <select
            className={inputCls}
            value={m.providerId || ""}
            onChange={(e) =>
              patch({ ...m, providerId: e.target.value || undefined })
            }
          >
            <option value="">请选择</option>
            {props.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.apiKey?.trim() ? "" : "（还没填 Key）"}
              </option>
            ))}
          </select>
          {!m.providerId ? (
            <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
              不选的话生成会失败（没有密钥）。
            </span>
          ) : !bound?.apiKey?.trim() && !m.apiKey?.trim() ? (
            <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
              「{bound?.name}」还没填密钥，请到「密钥」那一页补上。
            </span>
          ) : (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              使用「{bound?.name}」的密钥
            </span>
          )}
        </label>
        <label className={labelCls}>
          平台上的模型名
          <input
            className={inputCls}
            value={m.upstreamModel || ""}
            placeholder="必须和平台控制台里的名字一致"
            onChange={(e) => patch({ ...m, upstreamModel: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {m.category === "text" && (
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            disabled={props.testingId === m.id}
            onClick={props.onTest}
          >
            {props.testingId === m.id ? "测试中…" : "测一下能不能连上"}
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground"
          onClick={() => setMore((v) => !v)}
        >
          <ChevronDown className={`h-4 w-4 transition ${more ? "rotate-180" : ""}`} />
          {more ? "收起更多" : "更多（自定义请求 / 画布选项）"}
        </button>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-sm text-red-500"
          onClick={() =>
            props.setModels((prev) => prev.filter((x) => x.id !== m.id))
          }
        >
          <Trash2 className="h-4 w-4" /> 删除
        </button>
      </div>

      {more && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            下面一般不用动。只有平台不是常规 Chat/出图/出视频接口，或要改画布上的比例、时长时才打开。
          </p>
          <label className={labelCls}>
            请求方式
            <select
              className={inputCls}
              value={m.mode || "openai_compatible"}
              onChange={(e) => {
                const mode = e.target.value as LocalModel["mode"];
                patch(applyEndpointDefaults(m, { mode }));
              }}
            >
              <option value="openai_compatible">常规（OpenAI 兼容，推荐）</option>
              <option value="custom_template">自己填完整网址和请求体</option>
            </select>
          </label>

          {isCustom && (
            <div className="grid gap-3">
              <label className={labelCls}>
                请求方法 / 完整接口地址
                <div className="mt-1 flex gap-2">
                  <select
                    className="rounded-md border bg-background px-2 py-2 text-sm"
                    value={m.method || "POST"}
                    onChange={(e) =>
                      patch({ ...m, method: e.target.value as LocalModel["method"] })
                    }
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                  </select>
                  <input
                    className={`${inputCls} mt-0 font-mono text-xs`}
                    value={m.url || ""}
                    placeholder="https://……完整 URL"
                    onChange={(e) => patch({ ...m, url: e.target.value })}
                  />
                </div>
              </label>
              <label className={labelCls}>
                请求头（JSON）
                <textarea
                  className={`${inputCls} min-h-20 font-mono text-xs`}
                  value={m.headersJson || ""}
                  onChange={(e) => patch({ ...m, headersJson: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                请求体模板
                <textarea
                  className={`${inputCls} min-h-24 font-mono text-xs`}
                  value={m.bodyTemplate || ""}
                  onChange={(e) => patch({ ...m, bodyTemplate: e.target.value })}
                />
              </label>
              <label className={labelCls}>
                从返回 JSON 里取值的路径（可选）
                <input
                  className={inputCls}
                  value={m.responsePath || ""}
                  onChange={(e) => patch({ ...m, responsePath: e.target.value })}
                />
              </label>
            </div>
          )}

          <label className={labelCls}>
            内部编号（画布引用用，改了可能让工具对不上）
            <input
              className={inputCls}
              value={m.name}
              onChange={(e) => patch({ ...m, name: e.target.value })}
            />
          </label>
          <label className={labelCls}>
            备注
            <input
              className={inputCls}
              value={m.description || ""}
              onChange={(e) => patch({ ...m, description: e.target.value })}
            />
          </label>

          {(m.category === "image" || m.category === "video") && (
            <>
              <ModelCanvasCapsEditor model={m} onPatch={patch} />
              <div className="flex flex-wrap gap-2">
                {m.category === "image" && (
                  <button
                    type="button"
                    className="rounded-md border px-2.5 py-1 text-xs"
                    onClick={() =>
                      patch({
                        ...m,
                        canvasCaps: undefined,
                        generationPresets: imageAspectPresets({
                          category: "image",
                          upstreamModel: m.upstreamModel,
                          name: m.name,
                          displayName: m.displayName,
                        }),
                      })
                    }
                  >
                    恢复自动识别（出图）
                  </button>
                )}
                {m.category === "video" && (
                  <button
                    type="button"
                    className="rounded-md border px-2.5 py-1 text-xs"
                    onClick={() =>
                      patch({
                        ...m,
                        canvasCaps: undefined,
                        generationPresets: videoDurationPresets({
                          category: "video",
                          upstreamModel: m.upstreamModel,
                          name: m.name,
                          displayName: m.displayName,
                        }),
                      })
                    }
                  >
                    恢复自动识别（清晰度 / 时长）
                  </button>
                )}
              </div>
              <label className={labelCls}>
                画布选项 JSON（高级）
                <textarea
                  className={`${inputCls} min-h-28 font-mono text-xs`}
                  defaultValue={
                    m.generationPresets ? JSON.stringify(m.generationPresets, null, 2) : ""
                  }
                  key={`${m.id}-presets-${m.category}-${JSON.stringify(m.canvasCaps || {})}`}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (!raw) {
                      patch({ ...m, generationPresets: undefined });
                      return;
                    }
                    try {
                      patch({ ...m, generationPresets: JSON.parse(raw) });
                    } catch {
                      toast.error("选项格式无效，请检查 JSON");
                    }
                  }}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 五个通用画幅，顺序与画布面板一致 */
const CANVAS_RATIO_ORDER = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

/** 生图 size 写法：默认像素，对齐 https://doc.jumengai.com/api/images */
const IMAGE_SIZE_MODE_OPTIONS: Array<{
  id: ImageSizeMode;
  label: string;
  hint: string;
}> = [
  { id: "pixel", label: "像素 宽x高", hint: "如 1080x1920，官方文档写法，比例由宽高表达" },
  { id: "star", label: "星号 宽*高", hint: "如 1080*1920，Qwen / 万相系要求" },
  { id: "aspect", label: "画幅比例", hint: "如 9:16，Gemini / Imagen 系要求" },
  { id: "tier", label: "清晰度档", hint: "如 2K，x-imagine 等旧通道要求；此模式下比例可能失效" },
];

/** 生视频 size 写法 */
const VIDEO_SIZE_MODE_OPTIONS: Array<{
  id: VideoSizeMode;
  label: string;
  hint: string;
}> = [
  { id: "ratio", label: "画幅比例", hint: "如 16:9，聚梦 Seedance 等网关按此校验，清晰度走 resolution" },
  { id: "tier", label: "清晰度档", hint: "如 720P，官方文档 /api/video 示例写法" },
];

const CAPS_SOURCE_ZH: Record<string, string> = {
  explicit: "已手改",
  presets: "来自画布选项",
  rule: "规则表自动识别",
  default: "安全兜底",
};

/** 清晰度 / 时长能力编辑：写入 canvasCaps，画布只展示这些档 */
function ModelCanvasCapsEditor(props: {
  model: LocalModel;
  onPatch: (next: LocalModel) => void;
}) {
  const { model: m, onPatch } = props;
  const resolved = resolveModelCanvasCaps({
    category: m.category,
    upstreamModel: m.upstreamModel,
    name: m.name,
    displayName: m.displayName,
    canvasCaps: m.canvasCaps,
    generationPresets: m.generationPresets,
  });

  const applyCaps = (patch: {
    clarity?: CanvasClarityTier[];
    durationSec?: number[];
    ratios?: string[];
    imageSizeMode?: ImageSizeMode;
    videoSizeMode?: VideoSizeMode;
  }) => {
    const nextCaps = buildExplicitCanvasCaps(resolved, {
      clarity: patch.clarity ?? resolved.clarity,
      durationSec: patch.durationSec ?? resolved.durationSec,
      ratios: patch.ratios ?? resolved.ratios,
      imageSizeMode: patch.imageSizeMode ?? resolved.imageSizeMode,
      videoSizeMode: patch.videoSizeMode ?? resolved.videoSizeMode,
    });
    const capsInput = {
      category: m.category,
      upstreamModel: m.upstreamModel,
      name: m.name,
      displayName: m.displayName,
      canvasCaps: nextCaps,
    };
    onPatch({
      ...m,
      canvasCaps: nextCaps,
      generationPresets:
        m.category === "video"
          ? videoDurationPresets(capsInput)
          : imageAspectPresets(capsInput),
    });
  };

  const toggleClarity = (tier: CanvasClarityTier) => {
    const set = new Set(resolved.clarity);
    if (set.has(tier)) {
      if (set.size <= 1) {
        toast.error("至少保留一档清晰度");
        return;
      }
      set.delete(tier);
    } else {
      set.add(tier);
    }
    applyCaps({
      clarity: CLARITY_TIER_ORDER.filter((t) => set.has(t)),
    });
  };

  const toggleRatio = (ratio: string) => {
    const set = new Set(resolved.ratios);
    if (set.has(ratio)) {
      if (set.size <= 1) {
        toast.error("至少保留一个比例");
        return;
      }
      set.delete(ratio);
    } else {
      set.add(ratio);
    }
    applyCaps({ ratios: CANVAS_RATIO_ORDER.filter((r) => set.has(r)) });
  };

  const sizeModeOptions =
    m.category === "video" ? VIDEO_SIZE_MODE_OPTIONS : IMAGE_SIZE_MODE_OPTIONS;
  const activeSizeMode =
    m.category === "video" ? resolved.videoSizeMode : resolved.imageSizeMode;

  return (
    <div className="rounded-lg border border-border/80 bg-muted/20 p-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-foreground">画布可选项（按模型）</div>
        <div className="text-[11px] text-muted-foreground">
          {CAPS_SOURCE_ZH[resolved.source] || resolved.source}
          {resolved.ruleId ? ` · ${resolved.ruleId}` : ""}
        </div>
      </div>
      <div>
        <div className={labelCls}>清晰度</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {CLARITY_TIER_ORDER.map((tier) => {
            const on = resolved.clarity.includes(tier);
            return (
              <button
                key={tier}
                type="button"
                onClick={() => toggleClarity(tier)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {tier}
                {on && resolved.clarityMap[tier]
                  ? ` → ${resolved.clarityMap[tier]}`
                  : ""}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className={labelCls}>比例</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {CANVAS_RATIO_ORDER.map((ratio) => {
            const on = resolved.ratios.includes(ratio);
            return (
              <button
                key={ratio}
                type="button"
                onClick={() => toggleRatio(ratio)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {ratio}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className={labelCls}>尺寸提交方式（size 字段写法）</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {sizeModeOptions.map((opt) => {
            const on = activeSizeMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                title={opt.hint}
                onClick={() =>
                  applyCaps(
                    m.category === "video"
                      ? { videoSizeMode: opt.id as VideoSizeMode }
                      : { imageSizeMode: opt.id as ImageSizeMode }
                  )
                }
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  on
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {sizeModeOptions.find((o) => o.id === activeSizeMode)?.hint ?? ""}
        </p>
      </div>
      {m.category === "video" && (
        <div>
          <div className={labelCls}>时长（秒）</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, i) => i + 5).map((sec) => {
              const on = resolved.durationSec.includes(sec);
              return (
                <button
                  key={sec}
                  type="button"
                  onClick={() => {
                    const set = new Set(resolved.durationSec);
                    if (set.has(sec)) {
                      if (set.size <= 1) {
                        toast.error("至少保留一个时长");
                        return;
                      }
                      set.delete(sec);
                    } else {
                      set.add(sec);
                    }
                    applyCaps({
                      durationSec: [...set].sort((a, b) => a - b),
                    });
                  }}
                  className={`min-w-9 rounded-md border px-1.5 py-1 text-[11px] ${
                    on
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {sec}s
                </button>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        默认七档清晰度（480p / 720p / 768p / 1080p / 1K / 2K / 4K）与五个比例全开，点选哪档就原样提交，
        模型不认由上游报错。在这里取消勾选即收窄本模型可选项，画布点不到未勾选的档。
        生图的 size 默认按官方文档发像素宽高（如 1080x1920），比例就藏在宽高里；
        若上游报尺寸错误，改成它要的写法即可。
      </p>
    </div>
  );
}

function ToolsPane(props: Props) {
  return (
    <section className="mt-8">
      <h3 className="text-base font-medium">画布工具默认用谁</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        扩图、分镜「准备资产 · 主体生图」、多角度等功能会走这里指定的模型。空着则自动用该用途下第一个启用的模型。向导里「完成并保存」已经按用途填过一遍。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["text", "image", "video", "audio"] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            className="rounded-md border px-2.5 py-1 text-xs"
            onClick={() => props.onFillTools(cat)}
          >
            全部 {CAT_ZH[cat]}工具用第一个{CAT_ZH[cat]}模型
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-8">
        {props.toolGroups.map(([group, defs]) => (
          <div key={group}>
            <h4 className="mb-2 text-sm font-medium">{group}</h4>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">功能</th>
                    <th className="px-3 py-2 font-medium">默认模型</th>
                    <th className="px-3 py-2 font-medium">备用（可空）</th>
                  </tr>
                </thead>
                <tbody>
                  {defs.map((d) => {
                    const entry = props.toolModels[d.toolId] || {
                      primary: "",
                      secondary: "",
                    };
                    const options = props.modelsByCategory(d.category);
                    return (
                      <tr key={d.toolId} className="border-b border-border/60">
                        <td className="px-3 py-2">{d.label}</td>
                        <td className="px-3 py-2">
                          <select
                            className={inputCls}
                            value={entry.primary}
                            onChange={(e) =>
                              props.setToolModels((prev) => ({
                                ...prev,
                                [d.toolId]: { ...entry, primary: e.target.value },
                              }))
                            }
                          >
                            <option value="">自动（同类第一个）</option>
                            {options.map((m) => (
                              <option key={m.id} value={m.name}>
                                {m.displayName}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className={inputCls}
                            value={entry.secondary || ""}
                            onChange={(e) =>
                              props.setToolModels((prev) => ({
                                ...prev,
                                [d.toolId]: { ...entry, secondary: e.target.value },
                              }))
                            }
                          >
                            <option value="">无</option>
                            {options.map((m) => (
                              <option key={m.id} value={m.name}>
                                {m.displayName}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
