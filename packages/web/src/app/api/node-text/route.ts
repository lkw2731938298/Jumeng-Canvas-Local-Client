import { NextRequest } from "next/server";
import { backendUrl } from "@/lib/api/backendProxy";
import { authorizationFromRequest } from "@/lib/authCookie";

function authHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const auth = authorizationFromRequest(
    request.headers.get("Authorization"),
    request.headers.get("Cookie")
  );
  if (auth) headers.Authorization = auth;
  return headers;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  const nodeId = url.searchParams.get("nodeId") || "";
  if (!projectId || !nodeId) {
    return Response.json({ error: "缺少 projectId 或 nodeId" }, { status: 400 });
  }
  const target = backendUrl(`/api/v1/node-texts/projects/${projectId}/nodes/${nodeId}`);
  const res = await fetch(target, {
    cache: "no-store",
    headers: authHeaders(request),
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const projectId = (body.projectId as string) || "";
  const nodeId = (body.nodeId as string) || "";
  if (!projectId || !nodeId) {
    return Response.json({ error: "缺少 projectId 或 nodeId" }, { status: 400 });
  }
  const target = backendUrl(`/api/v1/node-texts/projects/${projectId}/nodes/${nodeId}`);
  const res = await fetch(target, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(request) },
    body: JSON.stringify({ content: body.content, model: body.model }),
    cache: "no-store",
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
