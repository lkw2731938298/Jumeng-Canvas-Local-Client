import { NextRequest } from "next/server";
import { proxyForm } from "@/lib/api/backendProxy";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return proxyForm(request, `/api/v1/projects/${id}/cover`);
}
