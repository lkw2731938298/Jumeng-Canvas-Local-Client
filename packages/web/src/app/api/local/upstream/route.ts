/**
 * 本机上游代理：浏览器 → Next → 第三方 API（绕过 CORS，与 ComfyUI 侧「本机代发」同理）。
 * 仅本地桌面使用；禁止 file:// / 非 http(s)。
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpstreamBody = {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** 超时毫秒，默认 180s */
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

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as UpstreamBody;
    const urlRaw = String(payload.url || "").trim();
    if (!urlRaw) {
      return NextResponse.json({ ok: false, error: "缺少 url" }, { status: 400 });
    }
    const target = assertSafeUpstreamUrl(urlRaw);
    const method = (payload.method || "POST").toUpperCase();
    const timeoutMs = Math.min(
      Math.max(Number(payload.timeoutMs) || 180_000, 5_000),
      600_000
    );

    const headers: Record<string, string> = {};
    if (payload.headers && typeof payload.headers === "object") {
      for (const [k, v] of Object.entries(payload.headers)) {
        if (!k || v == null) continue;
        const key = String(k);
        // 由 fetch 自动处理
        if (/^(host|content-length|connection)$/i.test(key)) continue;
        headers[key] = String(v);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : payload.body ?? undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const contentType = upstream.headers.get("content-type") || "";
    const buf = Buffer.from(await upstream.arrayBuffer());

    // JSON 明文返回；其它（图片/音视频）一律 base64，避免 UTF-8 损坏
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

    // 非 JSON 且看起来是文本错误页
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
    const message = aborted
      ? "上游请求超时"
      : err instanceof Error
        ? err.message
        : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
