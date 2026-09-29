/**
 * 导演台场景读写（本地版）：直接存本机数据目录
 * projects/{projectId}/director/{nodeId}.json，不再转发到不存在的远端后端。
 */
import { NextRequest } from "next/server";
import { readDirectorSceneFile, writeDirectorSceneFile } from "@/lib/local/serverDiskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") || "";
  const nodeId = url.searchParams.get("nodeId") || "";
  if (!projectId || !nodeId) {
    return Response.json({ error: "缺少 projectId 或 nodeId" }, { status: 400 });
  }
  try {
    const record = readDirectorSceneFile(projectId, nodeId);
    if (!record) return Response.json({ error: "场景不存在" }, { status: 404 });
    return Response.json(record);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "读取场景失败" }, { status: 400 });
  }
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const projectId = (body.projectId as string) || "";
  const nodeId = (body.nodeId as string) || "";
  if (!projectId || !nodeId) {
    return Response.json({ error: "缺少 projectId 或 nodeId" }, { status: 400 });
  }
  if (!body.scene || typeof body.scene !== "object") {
    return Response.json({ error: "缺少 scene" }, { status: 400 });
  }
  try {
    return Response.json(writeDirectorSceneFile(projectId, nodeId, body.scene));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "保存场景失败" }, { status: 400 });
  }
}
