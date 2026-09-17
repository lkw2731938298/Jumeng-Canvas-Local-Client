/**
 * 本机上游 multipart 代理：浏览器 → Next → 第三方（绕过 CORS）。
 * 用于视频参考图：聚梦要求可拉取的媒体；本地无 OSS 时用文件字段直传，避免 data: / localhost。
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MultipartFile = {
  field: string;
  filename?: string;
  contentType?: string;
  /** 纯 base64 或 data URL */
  base64: string;
};

type Body = {
  url?: string;
  headers?: Record<string, string>;
  /** 普通文本字段 */
  fields?: Record<string, string>;
  files?: MultipartFile[];
  timeoutMs?: number;
};

function assertSafeUpstreamUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`无效的上游 URL：${raw.slice(0, 120)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`仅支持 http(s) 上游，收到：${u.protocol}`);
  }
  return u;
}

function decodeBase64(raw: string): Buffer {
  const m = /^data:[^;]+;base64,(.+)$/i.exec(raw.trim());
  const b64 = m ? m[1] : raw.trim();
  return Buffer.from(b64, "base64");
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as Body;
    const urlRaw = String(payload.url || "").trim();
    if (!urlRaw) {
      return NextResponse.json({ ok: false, error: "缺少 url" }, { status: 400 });
    }
    const target = assertSafeUpstreamUrl(urlRaw);
    const timeoutMs = Math.min(
      Math.max(Number(payload.timeoutMs) || 180_000, 5_000),
      600_000
    );

    const form = new FormData();
    if (payload.fields && typeof payload.fields === "object") {
      for (const [k, v] of Object.entries(payload.fields)) {
        if (!k || v == null) continue;
        form.append(String(k), String(v));
      }
    }
    for (const f of payload.files || []) {
      const field = String(f.field || "").trim();
      const b64 = String(f.base64 || "").trim();
      if (!field || !b64) continue;
      const bytes = decodeBase64(b64);
      if (!bytes.length) continue;
      // 聚梦官方文件上传上限：图片 10MB、视频 100MB，这里按上限留余量
      if (bytes.length > 110 * 1024 * 1024) {
        return NextResponse.json(
          { ok: false, error: `文件过大：${field}（${(bytes.length / (1024 * 1024)).toFixed(1)}MB）` },
          { status: 413 }
        );
      }
      const contentType = String(f.contentType || "image/jpeg").trim();
      const filename = String(f.filename || `upload-${Date.now()}.jpg`).trim();
      form.append(field, new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
    }

    const headers: Record<string, string> = {};
    if (payload.headers && typeof payload.headers === "object") {
      for (const [k, v] of Object.entries(payload.headers)) {
        if (!k || v == null) continue;
        const key = String(k);
        // multipart 边界由 fetch 自动带 Content-Type
        if (/^(host|content-length|connection|content-type)$/i.test(key)) continue;
        headers[key] = String(v);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const contentType = upstream.headers.get("content-type") || "";
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (/application\/json/i.test(contentType)) {
      const text = buf.toString("utf8");
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return NextResponse.json({
        ok: true,
        status: upstream.status,
        contentType,
        text: json == null ? text : undefined,
        json: json ?? undefined,
      });
    }
    if (/^text\//i.test(contentType) || /xml|html|javascript/i.test(contentType)) {
      return NextResponse.json({
        ok: true,
        status: upstream.status,
        contentType,
        text: buf.toString("utf8"),
      });
    }
    return NextResponse.json({
      ok: true,
      status: upstream.status,
      contentType,
      base64: buf.toString("base64"),
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      {
        ok: false,
        error: aborted
          ? "上游请求超时"
          : err instanceof Error
            ? err.message
            : String(err),
      },
      { status: 502 }
    );
  }
}
