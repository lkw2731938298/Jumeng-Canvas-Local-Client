/**
 * 本机代拉远端参考素材（图片 / 视频）。
 * 浏览器直连第三方 OSS 会被 CORS / 防盗链拦成 "Failed to fetch"；
 * 由本机服务端拉取后把原始字节转回前端，前端再压缩或转 base64。
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单个参考素材上限，与聚梦官方文件上传的视频上限一致 */
const MAX_BYTES = 100 * 1024 * 1024;

/** 内网 / 回环地址：禁止代拉，避免把本机服务当跳板（SSRF） */
function isPrivateOrLocalHostname(host: string): boolean {
  const h = (host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

export async function GET(req: Request) {
  const target = (new URL(req.url).searchParams.get("url") || "").trim();
  if (!target) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "参考素材地址格式不正确" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "仅支持 http/https 参考素材" }, { status: 400 });
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return NextResponse.json({ error: "不允许代拉内网地址" }, { status: 403 });
  }

  try {
    // 不带浏览器 Referer，避开 OSS 防盗链
    const upstream = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "image/*,video/*,*/*" },
    });
    if (!upstream.ok) {
      const peek = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error: `拉取参考素材 HTTP ${upstream.status}`,
          detail: peek.slice(0, 200),
        },
        { status: 502 }
      );
    }

    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `参考素材约 ${(declared / (1024 * 1024)).toFixed(1)}MB，超过 ${Math.round(
            MAX_BYTES / (1024 * 1024)
          )}MB 上限`,
        },
        { status: 413 }
      );
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `参考素材约 ${(buf.byteLength / (1024 * 1024)).toFixed(1)}MB，超过 ${Math.round(
            MAX_BYTES / (1024 * 1024)
          )}MB 上限`,
        },
        { status: 413 }
      );
    }

    const type = (upstream.headers.get("content-type") || "").split(";")[0].trim();
    // OSS 拒绝匿名访问时会返回 XML 错误页，直接透出原因而不是把错误页当图片
    if (/xml|html/i.test(type) && /AccessDenied|NoSuchKey|Error>/i.test(buf.toString("utf8").slice(0, 400))) {
      return NextResponse.json(
        { error: "远端返回访问被拒错误页（链接可能已过期或不允许匿名读取）" },
        { status: 502 }
      );
    }

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": type || "application/octet-stream",
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `本机拉取参考素材失败：${message}` }, { status: 502 });
  }
}
