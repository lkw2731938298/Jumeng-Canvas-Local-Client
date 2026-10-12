/**
 * 本机组库：详情 / 改名打标 / 删除 / 跨项目复制。
 */
import { NextResponse } from "next/server";
import {
  copyNodeGroupOnDisk,
  deleteNodeGroupOnDisk,
  getNodeGroupOnDisk,
  patchNodeGroupOnDisk,
} from "@/lib/local/nodeGroupsDisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    if (!projectId || !id) {
      return NextResponse.json({ message: "缺少 projectId 或 id" }, { status: 400 });
    }
    const detail = getNodeGroupOnDisk(projectId, id);
    if (!detail) {
      return NextResponse.json({ message: "组不存在" }, { status: 404 });
    }
    return NextResponse.json({ code: "0000", message: "OK", content: detail });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      project_id?: string;
      projectId?: string;
      title?: string;
      tags?: string[];
    };
    const projectId = String(body.projectId || body.project_id || "").trim();
    if (!projectId || !id) {
      return NextResponse.json({ message: "缺少 projectId 或 id" }, { status: 400 });
    }
    const patched = patchNodeGroupOnDisk(projectId, id, {
      title: body.title,
      tags: body.tags,
    });
    if (!patched) {
      return NextResponse.json({ message: "组不存在" }, { status: 404 });
    }
    return NextResponse.json({ code: "0000", message: "OK", content: patched });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    if (!projectId || !id) {
      return NextResponse.json({ message: "缺少 projectId 或 id" }, { status: 400 });
    }
    if (!deleteNodeGroupOnDisk(projectId, id)) {
      return NextResponse.json({ message: "组不存在" }, { status: 404 });
    }
    return NextResponse.json({ code: "0000", message: "OK", content: { ok: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    // 约定：?action=copy-to-project
    const action = String(url.searchParams.get("action") || "").trim();
    if (action !== "copy-to-project") {
      return NextResponse.json({ message: "未知操作" }, { status: 400 });
    }
    const body = (await req.json()) as {
      source_project_id?: string;
      sourceProjectId?: string;
      target_project_id?: string;
      targetProjectId?: string;
      title?: string;
    };
    const sourceProjectId = String(
      body.sourceProjectId || body.source_project_id || ""
    ).trim();
    const targetProjectId = String(
      body.targetProjectId || body.target_project_id || ""
    ).trim();
    if (!sourceProjectId || !targetProjectId || !id) {
      return NextResponse.json({ message: "缺少项目或组 id" }, { status: 400 });
    }
    const created = copyNodeGroupOnDisk({
      groupId: id,
      sourceProjectId,
      targetProjectId,
      title: body.title,
    });
    return NextResponse.json({ code: "0000", message: "OK", content: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}
