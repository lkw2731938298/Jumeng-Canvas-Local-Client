/**
 * 本机音频分段：ffmpeg 切段 → 直写素材目录。
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import { resolveActiveDataRoot } from "@/lib/local/dataLocation";
import { pickAudioOutExt, trimAudioFileToPath } from "@/lib/local/ffmpegAudioTrim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      projectId?: string;
      audioAssetId?: string;
      inSec?: number;
      outSec?: number;
      title?: string;
    };
    const projectId = String(body.projectId || "").trim();
    const audioAssetId = String(body.audioAssetId || "").trim();
    const inSec = Number(body.inSec);
    const outSec = Number(body.outSec);
    const title = String(body.title || "").trim() || "分段";

    if (!projectId || !audioAssetId) {
      return NextResponse.json(
        { message: "缺少 projectId 或 audioAssetId" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec)) {
      return NextResponse.json({ message: "入点/出点无效" }, { status: 400 });
    }

    const store = createServerDiskStore();
    const list = await store.listAssets(projectId);
    const meta =
      list.find((a) => a.id === audioAssetId || a.fileName === audioAssetId) ||
      list.find((a) => a.fileName.replace(/\.[^.]+$/, "") === audioAssetId);
    if (!meta) {
      return NextResponse.json({ message: "源音频素材不存在" }, { status: 404 });
    }
    if (meta.category !== "audio") {
      return NextResponse.json(
        { message: "仅支持对音频素材进行分段" },
        { status: 400 }
      );
    }

    const dataRoot = resolveActiveDataRoot();
    const inputPath = path.join(dataRoot, "projects", projectId, "assets", meta.fileName);
    if (!fs.existsSync(inputPath)) {
      return NextResponse.json({ message: "源音频文件不存在" }, { status: 404 });
    }

    const clipId = randomUUID().replace(/-/g, "");
    const { ext } = pickAudioOutExt(inputPath);
    const fileName = `${clipId}${ext === ".mp3" ? ".mp3" : ".m4a"}`;
    const assetsDir = path.join(dataRoot, "projects", projectId, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const outputPath = path.join(assetsDir, fileName);

    const result = await trimAudioFileToPath({
      inputPath,
      outputPath,
      inSec,
      outSec,
    });

    // 重编码可能实际写了 m4a 内容但扩展名已在上面定为 .m4a/.mp3
    let finalName = fileName;
    let finalPath = outputPath;
    let fileType = result.fileType;
    if (result.mode === "reencode" && !finalName.endsWith(".m4a") && !finalName.endsWith(".mp3")) {
      finalName = `${clipId}.m4a`;
      finalPath = path.join(assetsDir, finalName);
      if (finalPath !== outputPath) {
        try {
          fs.renameSync(outputPath, finalPath);
        } catch {
          fs.copyFileSync(outputPath, finalPath);
          fs.unlinkSync(outputPath);
        }
      }
      fileType = "audio/mp4";
    }

    const createdAt = new Date().toISOString();
    await store.registerAssetMeta(projectId, {
      id: clipId,
      fileName: finalName,
      title,
      category: "audio",
      subcategory: "分段",
      fileType,
      fileSize: result.bytes,
      createdAt,
    });

    const fileUrl = `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(finalName)}`;
    const asset = {
      id: clipId,
      projectId,
      title,
      category: "audio",
      subcategory: "分段",
      ossKey: finalName,
      fileUrl,
      thumbnailUrl: fileUrl,
      fileType,
      fileSize: result.bytes,
      createdAt,
    };

    return NextResponse.json({
      code: "0000",
      message: "OK",
      content: {
        asset,
        inSec,
        outSec,
        durationSec: result.durationSec,
        sourceAssetId: meta.id,
        trimMode: result.mode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}
