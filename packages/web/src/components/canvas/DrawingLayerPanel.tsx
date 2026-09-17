"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import type { DrawingLayer } from "@/lib/canvas/drawingBoard/documentModel";
import {
  DRAWING_COLOR_PRESETS,
  isLayerFillTransparent,
  type DrawingLayerFillColor,
} from "@/lib/canvas/drawingBoard/types";

interface DrawingLayerPanelProps {
  layers: DrawingLayer[];
  activeLayerId: string;
  onSelectLayer: (layerId: string) => void;
  onToggleVisible: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  onFillColorChange: (layerId: string, fillColor: DrawingLayerFillColor) => void;
  onMove: (layerId: string, direction: "up" | "down") => void;
  onAddLayer: () => void;
  onRemoveLayer: (layerId: string) => void;
}

function layerKindLabel(layer: DrawingLayer): string {
  if (layer.type === "reference") return "参考";
  if (layer.type === "image") {
    return layer.reference?.includeInExport === false ? "参考" : "AI";
  }
  return "绘制";
}

/** 画板图层面板：扁平列表，选中后再展开细节 */
export function DrawingLayerPanel({
  layers,
  activeLayerId,
  onSelectLayer,
  onToggleVisible,
  onToggleLocked,
  onOpacityChange,
  onFillColorChange,
  onMove,
  onAddLayer,
  onRemoveLayer,
}: DrawingLayerPanelProps) {
  // 空参考占位不展示，避免干扰；导入后才出现
  const ordered = [...layers]
    .reverse()
    .filter((l) => !(l.type === "reference" && !l.reference));
  const [fillOpenByLayer, setFillOpenByLayer] = useState<Record<string, boolean>>({});

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[12px] font-medium text-white/75">图层</h3>
          <span className="text-[10px] text-white/30">{ordered.length}</span>
        </div>
        <button
          type="button"
          onClick={onAddLayer}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/85"
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </button>
      </div>

      <div className="overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
        {ordered.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-white/30">暂无图层</p>
        ) : (
          ordered.map((layer, index) => {
            const active = layer.id === activeLayerId;
            const isVector = layer.type === "vector";
            const isImageLayer = layer.type === "image";
            const isRefWithImage = layer.type === "reference" && layer.reference != null;
            const selectable = isVector || isImageLayer || isRefWithImage;
            const fillOpen = Boolean(fillOpenByLayer[layer.id]);
            const fill = layer.fillColor ?? "transparent";
            return (
              <div
                key={layer.id}
                className={`border-b border-white/[0.04] last:border-b-0 ${
                  active ? "bg-primary/[0.08]" : ""
                }`}
              >
                <div
                  role={selectable ? "button" : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  onClick={() => {
                    if (selectable) onSelectLayer(layer.id);
                  }}
                  onKeyDown={(e) => {
                    if (!selectable) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectLayer(layer.id);
                    }
                  }}
                  className={`flex w-full items-center gap-1.5 px-2.5 py-2 text-left ${
                    selectable ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  {/* 选中指示条 */}
                  <span
                    className={`h-4 w-0.5 shrink-0 rounded-full ${
                      active ? "bg-primary" : "bg-transparent"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisible(layer.id);
                    }}
                    className="text-white/40 transition-colors hover:text-white"
                    title={layer.visible ? "隐藏" : "显示"}
                  >
                    {layer.visible ? (
                      <Eye className="h-3.5 w-3.5" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {isVector ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleLocked(layer.id);
                      }}
                      className="text-white/35 transition-colors hover:text-white"
                      title={layer.locked ? "解锁" : "锁定"}
                    >
                      {layer.locked ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        <Unlock className="h-3 w-3" />
                      )}
                    </button>
                  ) : (
                    <span className="w-3" />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate text-[12px] ${
                      active ? "text-white/90" : "text-white/65"
                    }`}
                  >
                    {layer.name}
                  </span>
                  {!isLayerFillTransparent(fill) ? (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20"
                      style={{ backgroundColor: fill }}
                      title="图层底色"
                    />
                  ) : null}
                  <span className="shrink-0 text-[10px] text-white/25">
                    {layerKindLabel(layer)}
                  </span>
                </div>

                {active && (isImageLayer || isRefWithImage) ? (
                  <div className="flex items-center gap-2 px-3 pb-2.5 pl-5">
                    <input
                      type="range"
                      min={5}
                      max={100}
                      value={Math.round(layer.opacity * 100)}
                      onChange={(e) =>
                        onOpacityChange(layer.id, Number(e.target.value) / 100)
                      }
                      className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(layer.id)}
                      className="rounded p-0.5 text-white/35 transition-colors hover:text-red-300/90"
                      title={isRefWithImage ? "移除参考图" : "删除 AI 图层"}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}

                {active && isVector ? (
                  <div className="space-y-2 px-3 pb-2.5 pl-5">
                    <button
                      type="button"
                      onClick={() =>
                        setFillOpenByLayer((prev) => ({
                          ...prev,
                          [layer.id]: !prev[layer.id],
                        }))
                      }
                      className="flex w-full items-center justify-between text-[10px] text-white/40 hover:text-white/65"
                    >
                      <span>底色</span>
                      <span className="flex items-center gap-1">
                        {!isLayerFillTransparent(fill) ? (
                          <span
                            className="inline-block h-2 w-2 rounded-full ring-1 ring-white/20"
                            style={{ backgroundColor: fill }}
                          />
                        ) : (
                          <span className="text-white/30">透明</span>
                        )}
                        {fillOpen ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </span>
                    </button>
                    {fillOpen ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onFillColorChange(layer.id, "transparent")}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                            isLayerFillTransparent(layer.fillColor)
                              ? "bg-primary/20 text-white ring-1 ring-[var(--panel-accent-border)]"
                              : "text-white/45 hover:bg-white/[0.06]"
                          }`}
                        >
                          透明
                        </button>
                        {DRAWING_COLOR_PRESETS.map((preset) => {
                          const current = layer.fillColor ?? "transparent";
                          return (
                            <button
                              key={preset}
                              type="button"
                              title={preset}
                              onClick={() => onFillColorChange(layer.id, preset)}
                              className={`h-5 w-5 rounded-full ${
                                current === preset
                                  ? "ring-2 ring-primary ring-offset-1 ring-offset-[rgb(12,12,20)]"
                                  : "ring-1 ring-white/15"
                              }`}
                              style={{ backgroundColor: preset }}
                            />
                          );
                        })}
                        <label className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full ring-1 ring-white/20">
                          <span
                            className="absolute inset-0"
                            style={{
                              backgroundColor: isLayerFillTransparent(layer.fillColor)
                                ? "#ffffff"
                                : (layer.fillColor ?? "#ffffff"),
                            }}
                          />
                          <input
                            type="color"
                            value={
                              isLayerFillTransparent(layer.fillColor)
                                ? "#ffffff"
                                : (layer.fillColor ?? "#ffffff")
                            }
                            onChange={(e) => onFillColorChange(layer.id, e.target.value)}
                            className="absolute inset-0 opacity-0"
                            title="自定义底色"
                          />
                        </label>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={Math.round(layer.opacity * 100)}
                        onChange={(e) =>
                          onOpacityChange(layer.id, Number(e.target.value) / 100)
                        }
                        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => onMove(layer.id, "up")}
                        disabled={index === 0}
                        className="rounded p-0.5 text-white/35 hover:text-white disabled:opacity-20"
                        title="上移"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(layer.id, "down")}
                        disabled={index === ordered.length - 1}
                        className="rounded p-0.5 text-white/35 hover:text-white disabled:opacity-20"
                        title="下移"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveLayer(layer.id)}
                        className="rounded p-0.5 text-white/35 hover:text-red-300/90"
                        title="删除图层"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
