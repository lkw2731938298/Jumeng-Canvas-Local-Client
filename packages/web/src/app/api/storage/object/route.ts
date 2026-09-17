import { NextRequest } from "next/server";
import { authorizationFromRequest } from "@/lib/authCookie";

const API_BASE = process.env.API_URL || "http://localhost:8001";

async function redirectToSignedUrl(key: string, authorization: string | null): Promise<Response | null> {
  const url = `${API_BASE}/api/v1/storage/sign-url?key=${encodeURIComponent(key)}`;
  const headers: HeadersInit = {};
  if (authorization) headers.Authorization = authorization;
  try {
    const res = await fetch(url, { cache: "no-store", headers, redirect: "manual" });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: string };
    const target = body.url?.trim();
    if (target?.startsWith("http://") || target?.startsWith("https://")) {
      return Response.redirect(target, 302);
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchFromApi(
  key: string,
  authorization: string | null,
  stream: boolean,
  rangeHeader: string | null
): Promise<Response | null> {
  const params = new URLSearchParams({ key });
  if (stream) params.set("stream", "1");
  const url = `${API_BASE}/api/v1/storage/object?${params.toString()}`;
  const headers: HeadersInit = {};
  if (authorization) headers.Authorization = authorization;
  if (rangeHeader) headers.Range = rangeHeader;
  try {
    const res = await fetch(url, { cache: "no-store", headers, redirect: "manual" });
    if (!stream && (res.status === 301 || res.status === 302)) {
      const location = res.headers.get("Location");
      if (location?.startsWith("http")) {
        return Response.redirect(location, 302);
      }
    }
    if (!res.ok || !res.body) return null;
    const outHeaders: Record<string, string> = {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Range",
    };
    const acceptRanges = res.headers.get("Accept-Ranges");
    const contentRange = res.headers.get("Content-Range");
    const contentLength = res.headers.get("Content-Length");
    if (acceptRanges) outHeaders["Accept-Ranges"] = acceptRanges;
    if (contentRange) outHeaders["Content-Range"] = contentRange;
    if (contentLength) outHeaders["Content-Length"] = contentLength;
    return new Response(res.body, { status: res.status, headers: outHeaders });
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }

  const authorization = authorizationFromRequest(
    request.headers.get("Authorization"),
    request.headers.get("Cookie")
  );

  if (!authorization) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stream = request.nextUrl.searchParams.get("stream") === "1";

  if (!stream) {
    const redirect = await redirectToSignedUrl(key, authorization);
    if (redirect) return redirect;
  }

  const fromApi = await fetchFromApi(
    key,
    authorization,
    stream,
    request.headers.get("Range")
  );
  if (fromApi) return fromApi;

  return Response.json({ error: "Object not found" }, { status: 404 });
}
