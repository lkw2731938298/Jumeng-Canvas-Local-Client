import { NextRequest } from "next/server";
import { proxyForm, proxyJson } from "@/lib/api/backendProxy";

export async function GET(request: NextRequest) {
  return proxyJson(request, "/api/v1/assets");
}

export async function POST(request: NextRequest) {
  return proxyForm(request, "/api/v1/assets");
}
