const API_BASE = process.env.API_URL || "http://localhost:8001";

import { authorizationFromRequest } from "@/lib/authCookie";
import { resolveErrorMessage } from "@/lib/errors/errorCodes";

export function backendUrl(path: string, search = ""): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}${search}`;
}

export async function proxyJson(request: Request, path: string) {
  const url = new URL(request.url);
  const target = backendUrl(path, url.search);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const auth = authorizationFromRequest(
    request.headers.get("Authorization"),
    request.headers.get("Cookie")
  );
  if (auth) headers.Authorization = auth;
  let res: Response;
  try {
    res = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "无法连接本机接口，请确认画布已启动后再试。" }, { status: 502 });
  }
  const text = await res.text();
  if (!res.ok && request.method === "GET") {
    return Response.json([], { status: 200 });
  }
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}

export async function proxyForm(request: Request, path: string) {
  const formData = await request.formData();
  const headers: Record<string, string> = {};
  const auth = authorizationFromRequest(
    request.headers.get("Authorization"),
    request.headers.get("Cookie")
  );
  if (auth) headers.Authorization = auth;
  let res: Response;
  try {
    res = await fetch(backendUrl(path), { method: "POST", body: formData, headers, cache: "no-store" });
  } catch {
    return Response.json({ error: "无法连接本机接口，请确认画布已启动后再试。" }, { status: 502 });
  }
  const text = await res.text();
  if (!res.ok) {
    let message = "上传失败";
    try {
      const body = JSON.parse(text) as {
        detail?: string | { msg?: string }[];
        error?: string;
        message?: string;
        code?: string;
      };
      message = resolveErrorMessage(body, message);
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
      if (res.status === 404) {
        message = "接口不存在，请重启本机画布后再试";
      }
    } catch { /* keep default */ }
    return Response.json({ error: message, message }, { status: res.status });
  }
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
  });
}
