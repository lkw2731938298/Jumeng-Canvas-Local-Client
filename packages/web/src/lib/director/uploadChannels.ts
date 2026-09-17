import { NODE_IMAGE_SUBCATEGORY, uploadAsset } from "@/lib/api/assets";
import type { DirectorCaptureResult } from "@/lib/director/multiChannelCapture";

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], filename, { type: "image/png" });
}

export interface UploadedDirectorChannels {
  rgb: { fileUrl: string; id: string };
  depth: { fileUrl: string; id: string };
  normal: { fileUrl: string; id: string };
  segmentation: { fileUrl: string; id: string };
  openpose: { fileUrl: string; id: string };
}

export async function uploadDirectorChannels(params: {
  projectId: string;
  nodeId: string;
  label: string;
  suffix?: string;
  channels: DirectorCaptureResult;
}): Promise<UploadedDirectorChannels> {
  const { projectId, nodeId, label, suffix = "", channels } = params;
  const base = `${label}${suffix}`;

  const files = await Promise.all([
    dataUrlToFile(channels.rgb, `director-${nodeId}-rgb.png`),
    dataUrlToFile(channels.depth, `director-${nodeId}-depth.png`),
    dataUrlToFile(channels.normal, `director-${nodeId}-normal.png`),
    dataUrlToFile(channels.segmentation, `director-${nodeId}-seg.png`),
    dataUrlToFile(channels.openpose, `director-${nodeId}-pose.png`),
  ]);

  const [rgb, depth, normal, segmentation, openpose] = await Promise.all([
    uploadAsset({ file: files[0]!, projectId, category: "image", subcategory: NODE_IMAGE_SUBCATEGORY, title: `${base} RGB` }),
    uploadAsset({ file: files[1]!, projectId, category: "image", subcategory: NODE_IMAGE_SUBCATEGORY, title: `${base} 深度` }),
    uploadAsset({ file: files[2]!, projectId, category: "image", subcategory: NODE_IMAGE_SUBCATEGORY, title: `${base} 法线` }),
    uploadAsset({ file: files[3]!, projectId, category: "image", subcategory: NODE_IMAGE_SUBCATEGORY, title: `${base} 语义` }),
    uploadAsset({ file: files[4]!, projectId, category: "image", subcategory: NODE_IMAGE_SUBCATEGORY, title: `${base} 骨架` }),
  ]);

  return {
    rgb: { fileUrl: rgb.fileUrl, id: rgb.id },
    depth: { fileUrl: depth.fileUrl, id: depth.id },
    normal: { fileUrl: normal.fileUrl, id: normal.id },
    segmentation: { fileUrl: segmentation.fileUrl, id: segmentation.id },
    openpose: { fileUrl: openpose.fileUrl, id: openpose.id },
  };
}

export function applyChannelsToNodeParams(
  updateNodeParam: (id: string, key: string, value: unknown) => void,
  nodeId: string,
  uploaded: UploadedDirectorChannels
) {
  updateNodeParam(nodeId, "imageUrl", uploaded.rgb.fileUrl);
  updateNodeParam(nodeId, "assetId", uploaded.rgb.id);
  updateNodeParam(nodeId, "depthUrl", uploaded.depth.fileUrl);
  updateNodeParam(nodeId, "depthAssetId", uploaded.depth.id);
  updateNodeParam(nodeId, "normalUrl", uploaded.normal.fileUrl);
  updateNodeParam(nodeId, "normalAssetId", uploaded.normal.id);
  updateNodeParam(nodeId, "segmentationUrl", uploaded.segmentation.fileUrl);
  updateNodeParam(nodeId, "segmentationAssetId", uploaded.segmentation.id);
  updateNodeParam(nodeId, "openposeUrl", uploaded.openpose.fileUrl);
  updateNodeParam(nodeId, "openposeAssetId", uploaded.openpose.id);
}
