/**
 * 本机代拉公开网页文本摘要，供本地 AI 助手 web_fetch_page 使用。
 * 浏览器直连外站常被 CORS 拦；由 Node 侧拉取后抽 title / description / 正文文本。
 * 禁止内网/回环（防 SSRF）；仅 http(s)；正文截断，不做完整站点镜像。
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 25_000;

/** 内网 / 回环：禁止代拉 */
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

function metaContent(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    );
    const m = re.exec(html);
    if (m?.[1]) return decodeHtmlEntities(m[1].trim());
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`,
      "i"
    );
    const m2 = re2.exec(html);
    if (m2?.[1]) return decodeHtmlEntities(m2[1].trim());
  }
  return "";
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16) || 0));
}

/** 粗抽可读文本：去 script/style/noscript，剥标签 */
function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeHtmlEntities(s);
  return s.replace(/\s+/g, " ").trim();
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
    return NextResponse.json({ error: "网址格式不正确" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "仅支持 http/https 公开网址" }, { status: 400 });
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return NextResponse.json({ error: "不允许代拉内网地址" }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": "JumengCanvasLocalAgent/1.0 (+local desktop; page summary)",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!upstream.ok) {
      const peek = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error: `拉取网页 HTTP ${upstream.status}`,
          detail: peek.slice(0, 200),
        },
        { status: 502 }
      );
    }

    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `页面约 ${(declared / (1024 * 1024)).toFixed(1)}MB，超过摘要上限`,
        },
        { status: 413 }
      );
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "页面体积过大，无法摘要" }, { status: 413 });
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim();
    const finalUrl = upstream.url || parsed.toString();
    const raw = buf.toString("utf8");

    // 纯文本直接返回
    if (/^text\/plain/i.test(contentType) || (!/<html/i.test(raw) && !/<!doctype/i.test(raw))) {
      const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);
      return NextResponse.json({
        ok: true,
        url: finalUrl,
        contentType: contentType || "text/plain",
        title: "",
        description: "",
        text,
        truncated: raw.length > MAX_TEXT_CHARS,
      });
    }

    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
    const title = decodeHtmlEntities((titleMatch?.[1] || "").replace(/\s+/g, " ").trim());
    const description =
      metaContent(raw, ["description", "og:description", "twitter:description"]) ||
      metaContent(raw, ["og:title"]);
    const siteName = metaContent(raw, ["og:site_name", "application-name"]);
    const fullText = htmlToText(raw);
    const text = fullText.slice(0, MAX_TEXT_CHARS);

    return NextResponse.json({
      ok: true,
      url: finalUrl,
      contentType: contentType || "text/html",
      title,
      description,
      siteName,
      text,
      truncated: fullText.length > MAX_TEXT_CHARS,
      charCount: fullText.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted = /aborted|timeout/i.test(message);
    return NextResponse.json(
      { error: aborted ? "拉取网页超时，请稍后重试或换可公开访问的地址" : `本机拉取网页失败：${message}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
