"use client";

import { useRef, useCallback, useState, useEffect, type RefObject } from "react";
import { useCanvasStore } from "@/stores/canvasStore";
import type { WorkflowNodeData } from "@/types/workflow";
import { toast } from "sonner";
import {
  uploadAsset,
  type Asset,
  type AssetCategory,
  NODE_IMAGE_SUBCATEGORY,
} from "@/lib/api/assets";
import { validateCanvasImageFile } from "@/lib/canvas/imageSizePolicy";
import { ensureHttpsOssUrl, isSignedOssUrl } from "@/lib/signedUrl";

interface MediaUploadOptions {
  urlParamKey: string;
  accept: string;
  category: AssetCategory;
  subcategory?: string | null;
}

export function useMediaUpload(
  { urlParamKey, accept, category, subcategory = null }: MediaUploadOptions,
  nodeId: string,
  updateNodeData: (id: string, data: Partial<WorkflowNodeData>) => void,
  anchorRef: RefObject<HTMLElement | null>
) {
  const projectId = useCanvasStore((s) => s.projectId);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadBtnVisible, setUploadBtnVisible] = useState(false);

  const showUploadButton = useCallback(() => setUploadBtnVisible(true), []);

  useEffect(() => {
    if (selectedNodeId !== nodeId) setUploadBtnVisible(false);
  }, [selectedNodeId, nodeId]);

  useEffect(() => {
    if (!uploadBtnVisible) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const nodeEl = anchorRef.current?.closest(".react-flow__node");
      if (nodeEl?.contains(target)) return;
      setUploadBtnVisible(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [uploadBtnVisible, anchorRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUploadBtnVisible(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyAsset = useCallback(
    (asset: Asset) => {
      const currentParams =
        useCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.data.params || {};

      updateNodeData(nodeId, {
        params: {
          ...currentParams,
          assetId: asset.id,
          ...(isSignedOssUrl(asset.fileUrl)
            ? { [urlParamKey]: ensureHttpsOssUrl(asset.fileUrl) }
            : {}),
        },
      });
      setPickerOpen(false);
      setMenuOpen(false);
      setUploadBtnVisible(false);
    },
    [urlParamKey, nodeId, updateNodeData]
  );

  const handleUpload = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const openSourceMenu = useCallback(() => {
    setMenuOpen(true);
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !projectId) return;

      if (category === "image") {
        const sizeError = validateCanvasImageFile(file);
        if (sizeError) {
          toast.error(sizeError);
          e.target.value = "";
          return;
        }
      }

      setUploading(true);
      try {
        const asset = await uploadAsset({
          file,
          projectId,
          category,
          subcategory: category === "image" ? subcategory ?? NODE_IMAGE_SUBCATEGORY : subcategory,
        });
        applyAsset(asset);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传失败");
      } finally {
        setUploading(false);
        e.target.value = "";
      }
    },
    [projectId, category, subcategory, applyAsset]
  );

  return {
    inputRef,
    handleUpload,
    handleFileChange,
    uploading,
    accept,
    category,
    menuOpen,
    setMenuOpen,
    pickerOpen,
    setPickerOpen,
    openSourceMenu,
    applyAsset,
    uploadBtnVisible,
    showUploadButton,
  };
}
