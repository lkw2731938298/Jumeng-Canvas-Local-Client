/**
 * 本机爆款/分镜拉片切镜：ffmpeg 场景检测 → 关键帧 JPEG + ≤12s 参考片段，注册本地素材。
 * 对齐商业站 POST /api/v1/viral-remake/extract-shots（本地无 Worker，同步一次返回）。
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import { resolveActiveDataRoot } from "@/lib/local/dataLocation";
import {
  makeShotWorkDir,
  MAX_REF_VIDEO_CLIP_SEC,
  splitVideoToShotSegments,
} from "@/lib/local/ffmpegShotDetect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function durationLabel(durationSec: number): string {
  // 分镜表展示/成片报价：最低 4s
  const labelSec = Math.max(4.0, durationSec);
  if (labelSec >= 10 && Math.abs(labelSec - Math.round(labelSec)) < 0.05) {
    return `${Math.round(labelSec)}s`;
  }
  if (labelSec >= 1) {
    return `${Number(labelSec.toFixed(1)).toString().replace(/\.0$/, "")}s`;
  }
  return "4s";
}

function localAssetUrl(projectId: string, fileName: string): string {
  return `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(fileName)}`;
}

export async function POST(req: Request) {
  let workDir: string | null = null;
  try {
    const body = (await req.json()) as {
      projectId?: string;
      videoAssetId?: string;
      stripAudio?: boolean;
    };
    const projectId = String(body.projectId || "").trim();
    const videoAssetId = String(body.videoAssetId || "").trim();
    const stripAudio = Boolean(body.stripAudio);

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
      return NextResponse.json({ message: "参考视频素材不存在" }, { status: 404 });
    }
    if (meta.category !== "video") {
      return NextResponse.json(
        { message: "请上传视频素材作为参考" },
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

    workDir = makeShotWorkDir();
    const segments = await splitVideoToShotSegments({
      videoPath: inputPath,
      workDir,
      stripAudio,
    });

    const shots: Array<Record<string, unknown>> = [];
    for (const seg of segments) {
      const frameId = randomUUID().replace(/-/g, "");
      const clipId = randomUUID().replace(/-/g, "");
      const frameName = `${frameId}.jpg`;
      const clipName = `${clipId}.mp4`;
      const frameDest = path.join(assetsDir, frameName);
      const clipDest = path.join(assetsDir, clipName);

      fs.copyFileSync(seg.jpegPath, frameDest);
      fs.copyFileSync(seg.clipPath, clipDest);

      const title = `拉片镜头${seg.index}`;
      const frameUrl = localAssetUrl(projectId, frameName);
      const clipUrl = localAssetUrl(projectId, clipName);

      await store.registerAssetMeta(projectId, {
        id: frameId,
        fileName: frameName,
        title,
        category: "image",
        subcategory: "拉片关键帧",
        fileType: "image/jpeg",
        fileSize: seg.jpegBytes,
        createdAt: new Date().toISOString(),
      });
      await store.registerAssetMeta(projectId, {
        id: clipId,
        fileName: clipName,
        title: `${title}参考片段`,
        category: "video",
        subcategory: "拉片参考片段",
        fileType: "video/mp4",
        fileSize: seg.clipBytes,
        createdAt: new Date().toISOString(),
      });

      shots.push({
        index: seg.index,
        startSec: Number(seg.startSec.toFixed(3)),
        endSec: Number(seg.endSec.toFixed(3)),
        durationSec: Number(seg.durationSec.toFixed(3)),
        durationLabel: durationLabel(seg.durationSec),
        assetId: frameId,
        fileUrl: frameUrl,
        thumbnailUrl: frameUrl,
        title,
        clipAssetId: clipId,
        clipFileUrl: clipUrl,
      });
    }

    return NextResponse.json({
      code: "0000",
      message: "OK",
      content: {
        status: "succeeded",
        taskId: "",
        videoAssetId: meta.id,
        shotCount: shots.length,
        shots,
        result: {
          videoAssetId: meta.id,
          shotCount: shots.length,
          shots,
          maxRefClipSec: MAX_REF_VIDEO_CLIP_SEC,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  } finally {
    if (workDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}
