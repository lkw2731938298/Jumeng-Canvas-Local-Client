"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  FilePlus, FolderOpen, Layers, Clapperboard, Scissors, Images,
} from "lucide-react";
import { useCanvasStore } from "@/stores/canvasStore";
import { resolveAddNodePosition } from "@/lib/canvas/nodePlacement";
import { ensureDirectorStageNodeId, navigateToDirectorStage } from "@/lib/canvas/directorNavigation";
import {
  navigateToVideoEditor,
  selectedComposeNodeId,
  selectedVideoAssetId,
} from "@/lib/canvas/videoEditorNavigation";
import { ADD_NODE_MENU_GLASS_STYLE, AddNodeMenuList } from "./AddNodeMenu";
import { AssetPanel } from "./panels/AssetPanel";
import { GroupLibraryPanel } from "./panels/GroupLibraryPanel";
import { MaterialLibraryPanel } from "./panels/MaterialLibraryPanel";

interface ToolbarItem {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}

export function SideToolbar() {
  const router = useRouter();
  const projectId = useCanvasStore((s) => s.projectId);
  // 订阅选中态，使「剪辑台」tooltip 能反映是否带入当前视频
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectedNodeType = useCanvasStore((s) => {
    const id = s.selectedNodeId;
    if (!id) return null;
    return s.nodes.find((n) => n.id === id)?.type ?? null;
  });
  const [showAddPopup, setShowAddPopup] = useState(false);
  const [showAssetPanel, setShowAssetPanel] = useState(false);
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [showMaterialLibrary, setShowMaterialLibrary] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setShowAddPopup(false), 150);
  }, [cancelHide]);

  const handleAddNode = useCallback((type: string) => {
    const store = useCanvasStore.getState();
    const position = resolveAddNodePosition(type, store.nodes, {
      viewport: store.viewport,
      paneSize: store.flowPaneSize,
      selectedNodeId: store.selectedNodeId,
    });
    // 一键出海 Skill 卡已下线，菜单若仍传入则忽略
    if (type === "overseas_localize") {
      setShowAddPopup(false);
      return;
    }
    store.addNode(type, position);
    if (type === "director_stage" && projectId) {
      const node = useCanvasStore.getState().nodes.filter((n) => n.type === "director_stage").at(-1);
      if (node) {
        void navigateToDirectorStage(projectId, node.id, router.push);
      }
    }
    setShowAddPopup(false);
  }, [projectId, router]);

  const handleDirectorStage = useCallback(() => {
    if (!projectId) return;
    setShowAssetPanel(false);
    setShowPresetPanel(false);
    setShowMaterialLibrary(false);
    const nodeId = ensureDirectorStageNodeId();
    if (nodeId) {
      void navigateToDirectorStage(projectId, nodeId, router.push);
    }
  }, [projectId, router]);

  /** 打开项目级剪辑台；成片节点优先回填 composeMeta，否则带入选中视频素材 */
  const handleOpenVideoEditor = useCallback(() => {
    if (!projectId) return;
    setShowAssetPanel(false);
    setShowPresetPanel(false);
    setShowMaterialLibrary(false);
    const fromNodeId = selectedComposeNodeId();
    const assetId = selectedVideoAssetId();
    void navigateToVideoEditor(projectId, router.push, {
      fromNodeId,
      assetId: fromNodeId ? null : assetId,
    });
  }, [projectId, router]);

  // 选中视频节点时 tooltip 提示将带入该素材（selectedNodeId 驱动重渲染）
  const selectedVideoId =
    selectedNodeId && selectedNodeType === "video_input" ? selectedVideoAssetId() : null;
  const selectedComposeId =
    selectedNodeId && selectedNodeType === "video_input" ? selectedComposeNodeId() : null;
  const editorTooltip = selectedComposeId
    ? "剪辑台（回填成片时间线）"
    : selectedVideoId
      ? "剪辑台（带入当前视频）"
      : "剪辑台";
  const toolbarItems: ToolbarItem[] = [
    {
      icon: <FilePlus className="h-4 w-4" />,
      label: "添加节点",
    },
    {
      icon: <FolderOpen className="h-4 w-4" />,
      label: "资产",
      onClick: () => {
        setShowPresetPanel(false);
        setShowMaterialLibrary(false);
        setShowAssetPanel((v) => !v);
      },
    },
    {
      icon: <Images className="h-4 w-4" />,
      label: "素材库",
      onClick: () => {
        setShowAssetPanel(false);
        setShowPresetPanel(false);
        setShowMaterialLibrary((v) => !v);
      },
    },
    {
      icon: <Layers className="h-4 w-4" />,
      label: "组",
      onClick: () => {
        setShowAssetPanel(false);
        setShowMaterialLibrary(false);
        setShowPresetPanel((v) => !v);
      },
    },
    {
      icon: <Clapperboard className="h-4 w-4" />,
      label: "导演台",
      onClick: handleDirectorStage,
    },
    {
      icon: <Scissors className="h-4 w-4" />,
      // 与节点顶栏「切段」区分：侧栏进入完整多轨剪辑台
      label: editorTooltip,
      onClick: handleOpenVideoEditor,
    },
  ];

  return (
    <>
    <AssetPanel isOpen={showAssetPanel} onClose={() => setShowAssetPanel(false)} />
    <MaterialLibraryPanel isOpen={showMaterialLibrary} onClose={() => setShowMaterialLibrary(false)} />
    <GroupLibraryPanel isOpen={showPresetPanel} onClose={() => setShowPresetPanel(false)} />
    <div
      className="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5"
      style={ADD_NODE_MENU_GLASS_STYLE}
    >
      {toolbarItems.map((item, index) => (
        <div key={index} className="relative">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-colors hover:text-white"
            title={item.label}
            onClick={item.onClick}
            onMouseEnter={() => {
              if (index === 0) {
                cancelHide();
                setShowAddPopup(true);
              }
            }}
            onMouseLeave={() => {
              if (index === 0) {
                scheduleHide();
              }
            }}
          >
            {item.icon}
          </button>

          {index === 0 && showAddPopup && (
            <>
              <div
                className="absolute left-full top-1/2 z-30 ml-2 -translate-y-1/2"
                onMouseEnter={cancelHide}
                onMouseLeave={scheduleHide}
              >
                <div
                  className="absolute left-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rotate-45"
                  style={{ background: "var(--canvas-glass-tint)" }}
                />
                <AddNodeMenuList onSelect={handleAddNode} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
    </>
  );
}
