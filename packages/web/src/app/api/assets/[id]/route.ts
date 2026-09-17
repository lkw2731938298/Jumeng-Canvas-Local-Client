import { NextRequest } from "next/server";
import { backendUrl } from "@/lib/api/backendProxy";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  const target = backendUrl(`/api/v1/assets/${id}`, `?projectId=${encodeURIComponent(projectId)}`);
  const headers: Record<string, string> = {};
  const auth = request.headers.get("Authorization");
  if (auth) headers.Authorization = auth;
  const res = await fetch(target, { cache: "no-store", headers });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  const target = backendUrl(`/api/v1/assets/${id}`, `?projectId=${encodeURIComponent(projectId)}`);
  const headers: Record<string, string> = {};
  const auth = request.headers.get("Authorization");
  if (auth) headers.Authorization = auth;
  const res = await fetch(target, { method: "DELETE", cache: "no-store", headers });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
