/**
 * 本机音视频分离：ffmpeg 抽出音频 + 无声视频 → 直写素材目录。
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import { resolveActiveDataRoot } from "@/lib/local/dataLocation";
import { splitVideoAvToPaths } from "@/lib/local/ffmpegAvSplit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      projectId?: string;
      videoAssetId?: string;
      audioTitle?: string;
      videoTitle?: string;
    };
    const projectId = String(body.projectId || "").trim();
    const videoAssetId = String(body.videoAssetId || "").trim();
    const audioTitle = String(body.audioTitle || "").trim() || "分离音频";
    const videoTitle = String(body.videoTitle || "").trim() || "无声视频";

    if (!projectId || !videoAssetId) {
      return NextResponse.json(
        { message: "缺少 projectId 或 videoAssetId" },
        { status: 400 }
      );
    }

    const store = createServerDiskStore();
    const list = await store.listAssets(projectId);
    const meta =
      list.find((a) => a.id === videoAssetId || a.fileName === videoAssetId) ||
      list.find((a) => a.fileName.replace(/\.[^.]+$/, "") === videoAssetId);
    if (!meta) {
      return NextResponse.json({ message: "源视频素材不存在" }, { status: 404 });
    }
    if (meta.category !== "video") {
      return NextResponse.json(
        { message: "仅支持对视频素材进行音视频分离" },
        { status: 400 }
      );
    }

    const dataRoot = resolveActiveDataRoot();
    const inputPath = path.join(dataRoot, "projects", projectId, "assets", meta.fileName);
    if (!fs.existsSync(inputPath)) {
      return NextResponse.json({ message: "源视频文件不存在" }, { status: 404 });
    }

    const assetsDir = path.join(dataRoot, "projects", projectId, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });

    const audioId = randomUUID().replace(/-/g, "");
    const silentId = randomUUID().replace(/-/g, "");
    const audioName = `${audioId}.m4a`;
    const silentName = `${silentId}.mp4`;
    const audioPath = path.join(assetsDir, audioName);
    const silentPath = path.join(assetsDir, silentName);

    const result = await splitVideoAvToPaths({
      inputPath,
      audioPath,
      silentVideoPath: silentPath,
    });

    const createdAt = new Date().toISOString();
    await store.registerAssetMeta(projectId, {
      id: audioId,
      fileName: audioName,
      title: audioTitle,
      category: "audio",
      subcategory: "音视频分离",
      fileType: "audio/mp4",
      fileSize: result.audioBytes,
      createdAt,
    });
    await store.registerAssetMeta(projectId, {
      id: silentId,
      fileName: silentName,
      title: videoTitle,
      category: "video",
      subcategory: "无声视频",
      fileType: "video/mp4",
      fileSize: result.videoBytes,
      createdAt,
    });

    const audioFileUrl = `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(audioName)}`;
    const videoFileUrl = `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(silentName)}`;

    return NextResponse.json({
      code: "0000",
      message: "OK",
      content: {
        audioAsset: {
          id: audioId,
          projectId,
          title: audioTitle,
          category: "audio",
          subcategory: "音视频分离",
          ossKey: audioName,
          fileUrl: audioFileUrl,
          thumbnailUrl: audioFileUrl,
          fileType: "audio/mp4",
          fileSize: result.audioBytes,
          createdAt,
        },
        videoAsset: {
          id: silentId,
          projectId,
          title: videoTitle,
          category: "video",
          subcategory: "无声视频",
          ossKey: silentName,
          fileUrl: videoFileUrl,
          thumbnailUrl: videoFileUrl,
          fileType: "video/mp4",
          fileSize: result.videoBytes,
          createdAt,
        },
        sourceAssetId: meta.id,
        silentMode: result.silentMode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}
