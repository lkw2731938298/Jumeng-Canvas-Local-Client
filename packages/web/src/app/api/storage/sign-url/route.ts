import { NextRequest } from "next/server";
import { backendUrl } from "@/lib/api/backendProxy";
import { authorizationFromRequest } from "@/lib/authCookie";

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return Response.json({ error: "Invalid key" }, { status: 400 });
  }

  const auth = authorizationFromRequest(
    request.headers.get("Authorization"),
    request.headers.get("Cookie")
  );
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const target = backendUrl(`/api/v1/storage/sign-url?key=${encodeURIComponent(key)}`);
  const res = await fetch(target, {
    cache: "no-store",
    headers: { Authorization: auth },
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
