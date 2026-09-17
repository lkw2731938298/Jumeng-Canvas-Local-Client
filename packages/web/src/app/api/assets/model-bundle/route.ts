import { NextRequest } from "next/server";
import { proxyForm } from "@/lib/api/backendProxy";

export async function POST(request: NextRequest) {
  return proxyForm(request, "/api/v1/assets/model-bundle");
}
