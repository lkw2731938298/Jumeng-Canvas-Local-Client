/**
 * 本机视频切断：ffmpeg 流复制优先 → 直写素材目录（不走 base64）。
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import { resolveActiveDataRoot } from "@/lib/local/dataLocation";
import { pickOutExt, trimVideoFileToPath } from "@/lib/local/ffmpegTrim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      projectId?: string;
      videoAssetId?: string;
      inSec?: number;
      outSec?: number;
      title?: string;
    };
    const projectId = String(body.projectId || "").trim();
    const videoAssetId = String(body.videoAssetId || "").trim();
    const inSec = Number(body.inSec);
    const outSec = Number(body.outSec);
    const title = String(body.title || "").trim() || "切段";

    if (!projectId || !videoAssetId) {
      return NextResponse.json(
        { message: "缺少 projectId 或 videoAssetId" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(inSec) || !Number.isFinite(outSec)) {
      return NextResponse.json({ message: "入点/出点无效" }, { status: 400 });
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
      return NextResponse.json({ message: "仅支持对视频素材进行剪辑" }, { status: 400 });
    }

    const dataRoot = resolveActiveDataRoot();
    const inputPath = path.join(dataRoot, "projects", projectId, "assets", meta.fileName);
    if (!fs.existsSync(inputPath)) {
      return NextResponse.json({ message: "源视频文件不存在" }, { status: 404 });
    }

    const clipId = randomUUID().replace(/-/g, "");
    const { ext } = pickOutExt(inputPath);
    // 优先同后缀流复制；失败重编码时仍写此路径（内部会转 mp4 内容或改扩展）
    const fileName = `${clipId}${ext === ".webm" ? ".webm" : ".mp4"}`;
    const assetsDir = path.join(dataRoot, "projects", projectId, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const outputPath = path.join(assetsDir, fileName);

    const result = await trimVideoFileToPath({
      inputPath,
      outputPath,
      inSec,
      outSec,
    });

    // 重编码统一为 mp4 文件名
    let finalName = fileName;
    let finalPath = outputPath;
    let fileType = result.fileType;
    if (result.mode === "reencode" && !finalName.endsWith(".mp4")) {
      finalName = `${clipId}.mp4`;
      finalPath = path.join(assetsDir, finalName);
      if (finalPath !== outputPath) {
        try {
          fs.renameSync(outputPath, finalPath);
        } catch {
          fs.copyFileSync(outputPath, finalPath);
          fs.unlinkSync(outputPath);
        }
      }
      fileType = "video/mp4";
    }

    await store.registerAssetMeta(projectId, {
      id: clipId,
      fileName: finalName,
      title,
      category: "video",
      subcategory: "剪辑",
      fileType,
      fileSize: result.bytes,
      createdAt: new Date().toISOString(),
    });

    const fileUrl = `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(finalName)}`;
    const asset = {
      id: clipId,
      projectId,
      title,
      category: "video",
      subcategory: "剪辑",
      ossKey: finalName,
      fileUrl,
      thumbnailUrl: fileUrl,
      fileType,
      fileSize: result.bytes,
      createdAt: new Date().toISOString(),
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
