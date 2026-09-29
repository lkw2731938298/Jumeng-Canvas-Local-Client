"use client";

/**
 * 导演台「AI 生成 3D 模型」手动入口：文字描述 + 可选参考图 → Tripo 等 3D 模型后台生成，
 * 先放占位方块，完成后自动替换为 GLB（与 AI 对话里的 generate_model 共用同一链路）。
 */

import { useState } from "react";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { MediaAssetPicker } from "@/components/canvas/nodes/MediaAssetPicker";
import type { Asset } from "@/lib/api/assets";
import { applyDirectorOps, defaultModelName } from "@/lib/director/agent/sceneOps";
import { loadDirectorSession, saveDirectorSession, type DirectorAgentHost } from "@/lib/director/agent/session";
import { startDirectorModel3dJob } from "@/lib/director/model3dJobs";
import type { Model3dQuality } from "@/lib/local/generate";
import { DirectorModelSelect, useLocalModels } from "./DirectorAgentPanel";

export function DirectorModel3dDialog({
  host,
  onClose,
}: {
  host: DirectorAgentHost;
  onClose: () => void;
}) {
  const { models } = useLocalModels(true);
  const [modelId, setModelId] = useState(() => loadDirectorSession(host.projectId, host.nodeId).model3dModelId);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [height, setHeight] = useState(1);
  const [quality, setQuality] = useState<Model3dQuality>("standard");
  const [image, setImage] = useState<Asset | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effectiveModelId =
    modelId && models.some((m) => m.id === modelId) ? modelId : models.find((m) => m.category === "model3d")?.id ?? "";

  const submit = () => {
    if (!effectiveModelId) {
      toast.error("请先选择 3D 生成模型（在「设置」中添加 Tripo 等 3D 模型）");
      return;
    }
    if (!prompt.trim() && !image) {
      toast.error("请填写物体描述或选择参考图");
      return;
    }
    setSubmitting(true);
    try {
      // 记住所选 3D 模型，AI 对话面板共用
      const session = loadDirectorSession(host.projectId, host.nodeId);
      saveDirectorSession(host.projectId, host.nodeId, { ...session, model3dModelId: effectiveModelId });

      const label = name.trim() || defaultModelName(prompt) || image?.title || "AI 模型";
      const out = applyDirectorOps(host.getScene(), [
        {
          op: "generate_model",
          name: label,
          prompt: prompt.trim(),
          imageAssetId: image?.id,
          height,
        },
      ]);
      const gen = out.generations[0];
      if (!gen) {
        toast.error(out.results[0]?.message || "创建占位物体失败");
        return;
      }
      host.replaceScene(out.scene);
      const m = models.find((x) => x.id === effectiveModelId);
      startDirectorModel3dJob({
        projectId: host.projectId,
        nodeId: host.nodeId,
        modelId: effectiveModelId,
        modelLabel: m ? m.displayName || m.name : undefined,
        placeholderId: gen.placeholderId,
        name: gen.name,
        prompt: gen.prompt,
        imageUrl: image?.fileUrl,
        height: gen.height,
        quality,
      });
      toast.success("已提交 3D 生成，约 1~5 分钟后自动替换占位方块");
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="w-[380px] rounded-xl border border-white/10 bg-[rgba(22,22,34,0.98)] p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-medium text-white/90">AI 生成 3D 模型</span>
          <button type="button" onClick={onClose} className="ml-auto text-white/40 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2.5 text-[11px] text-white/70">
          <label className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-white/45">3D 模型</span>
            <DirectorModelSelect
              models={models}
              primaryCategory="model3d"
              value={effectiveModelId}
              onChange={setModelId}
              emptyLabel="未配置 3D 模型"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-white/45">名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：复古木椅"
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/85"
            />
          </label>
          <div className="flex gap-2">
            <span className="w-14 shrink-0 pt-1 text-white/45">描述</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="单个物体的外观描述，如：a vintage wooden chair with curved back"
              className="min-w-0 flex-1 resize-none rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/85"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-white/45">参考图</span>
            {image ? (
              <div className="flex min-w-0 items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.fileUrl} alt={image.title} className="h-10 w-10 rounded object-cover" />
                <span className="truncate text-white/60">{image.title}</span>
                <button type="button" onClick={() => setImage(null)} className="text-white/40 hover:text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-white/60 hover:bg-white/10"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                选择项目图片（可选，图生 3D）
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-white/45">高度</span>
            <input
              type="number"
              min={0.05}
              step={0.1}
              value={height}
              onChange={(e) => setHeight(Math.max(0.05, Number.parseFloat(e.target.value) || 1))}
              className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white/85"
            />
            <span className="text-white/40">米</span>
            <span className="ml-auto text-white/45">精度</span>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Model3dQuality)}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-white/80"
            >
              <option value="standard" className="bg-zinc-900">标准</option>
              <option value="detailed" className="bg-zinc-900">精细</option>
            </select>
          </div>
          <p className="text-[10px] leading-relaxed text-white/35">
            调用你在设置里配置的 API 密钥，由上游按次计费；生成约 1~5 分钟，完成后 GLB 存入素材库并自动放入场景，可在「生成任务」查看进度。
          </p>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-white/55 hover:bg-white/10">
            取消
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="flex items-center gap-1 rounded-md bg-amber-500/30 px-3 py-1.5 text-xs text-amber-50 disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            开始生成
          </button>
        </div>
      </div>
      {pickerOpen ? (
        <MediaAssetPicker
          category="image"
          onSelect={(a) => {
            setImage(a);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
          overlayZIndex={140}
        />
      ) : null}
    </div>
  );
}
