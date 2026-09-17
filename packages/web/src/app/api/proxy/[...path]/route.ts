import { NextRequest, NextResponse } from "next/server";
import { stripBasePathFromPathname } from "@/lib/server/basePath";

/** Allow long-running sync generation requests through the BFF proxy. */
export const maxDuration = 900;

const API_BASE = process.env.API_URL || "http://localhost:8001";

/** Headers that must not be forwarded — body is re-read and length may change. */
const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-connection",
]);

async function proxy(req: NextRequest) {
  const pathname = stripBasePathFromPathname(req.nextUrl.pathname);
  const path = pathname.replace(/^\/api\/proxy/, "") || "/";
  const url = `${API_BASE}${path}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });

    const resHeaders = new Headers();
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "transfer-encoding") {
        resHeaders.set(key, value);
      }
    });

    return new NextResponse(res.body, { status: res.status, headers: resHeaders });
  } catch {
    return NextResponse.json(
      { message: "无法连接本机接口，请确认画布已启动后再试。" },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxy(req);
}
export async function POST(req: NextRequest) {
  return proxy(req);
}
export async function PUT(req: NextRequest) {
  return proxy(req);
}
export async function PATCH(req: NextRequest) {
  return proxy(req);
}
export async function DELETE(req: NextRequest) {
  return proxy(req);
}
