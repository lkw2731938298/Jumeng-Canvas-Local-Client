/**
 * 本机资产文件读取（磁盘 → 浏览器）。
 */
import { NextResponse } from "next/server";
import { readAssetFile } from "@/lib/local/serverDiskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || "";
  const file = searchParams.get("file") || "";
  if (!projectId || !file) {
    return NextResponse.json({ error: "missing projectId/file" }, { status: 400 });
  }
  try {
    const buf = readAssetFile(projectId, file);
    if (!buf) return new NextResponse("Not Found", { status: 404 });
    const lower = file.toLowerCase();
    const type = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : lower.endsWith(".webp")
          ? "image/webp"
          : lower.endsWith(".gif")
            ? "image/gif"
            : lower.endsWith(".mp4")
              ? "video/mp4"
              : lower.endsWith(".webm")
                ? "video/webm"
                : lower.endsWith(".mp3")
                  ? "audio/mpeg"
                  : lower.endsWith(".wav")
                    ? "audio/wav"
                    : lower.endsWith(".glb")
                      ? "model/gltf-binary"
                      : "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
