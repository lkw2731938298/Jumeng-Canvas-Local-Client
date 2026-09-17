import { NextRequest } from "next/server";
import { proxyJson } from "@/lib/api/backendProxy";

export async function GET(request: NextRequest) {
  return proxyJson(request, "/api/v1/assets/batch");
}
