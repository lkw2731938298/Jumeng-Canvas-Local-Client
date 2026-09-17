/**
 * 将本机参考素材上传到用户自配公网 OSS，返回上游可拉取的 https URL。
 * 普通素材库上传不走此接口。
 */
import { NextResponse } from "next/server";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import {
  isUserOssReady,
  toPublicOssConfig,
  uploadReferenceToUserOssDetailed,
} from "@/lib/local/aliyunOss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guessExt(contentType: string, filename?: string): string {
  const fromName = filename?.match(/\.([a-z0-9]+)$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  return "bin";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      base64?: string;
      contentType?: string;
      filename?: string;
    };
    const rawB64 = String(body.base64 || "").trim();
    if (!rawB64) {
      return NextResponse.json({ ok: false, error: "缺少 base64" }, { status: 400 });
    }
    const contentType = String(body.contentType || "application/octet-stream").trim();
    const pure = rawB64.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(pure, "base64");
    if (!buf.length) {
      return NextResponse.json({ ok: false, error: "base64 解码为空" }, { status: 400 });
    }
    // 单文件上限 80MB（视频参考）；过大时提示压缩
    if (buf.length > 80 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "参考文件超过 80MB，请压缩后再试" },
        { status: 413 }
      );
    }

    const store = createServerDiskStore();
    const cfg = await store.readUserOss();
    if (!isUserOssReady(cfg)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "未配置可用的公网 OSS。请到「本地设置 → 参考图 OSS」填写 Bucket / 公网 Endpoint / AccessKey 并启用",
          oss: toPublicOssConfig(cfg),
        },
        { status: 400 }
      );
    }

    const uploaded = await uploadReferenceToUserOssDetailed({
      cfg,
      body: buf,
      contentType,
      fileExt: guessExt(contentType, body.filename),
      // 生成参考必须公网直链：聚梦等模型商常拉不了带 Signature 的 URL
      requirePublic: true,
    });
    if (/\?/.test(uploaded.url) || uploaded.kind !== "public") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "参考 URL 仍带签名参数，上游模型商可能读不到。请关闭 Bucket「阻止公共访问」并允许对象 public-read 后重试。",
          url: uploaded.url,
          kind: uploaded.kind,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      url: uploaded.url,
      kind: uploaded.kind,
      bytes: buf.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const store = createServerDiskStore();
  const cfg = await store.readUserOss();
  return NextResponse.json({
    ok: true,
    ready: isUserOssReady(cfg),
    oss: toPublicOssConfig(cfg),
  });
}
