/**
 * 本机画板草稿：对齐商业站 /api/v1/drawing-drafts，落盘 projects/{id}/drawings/。
 */
import { NextResponse } from "next/server";
import {
  deleteDrawingDraftFile,
  readDrawingDraftFile,
  writeDrawingDraftFile,
} from "@/lib/local/serverDiskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string; nodeId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { projectId, nodeId } = await ctx.params;
    const pid = String(projectId || "").trim();
    const nid = String(nodeId || "").trim();
    if (!pid || !nid) {
      return NextResponse.json({ message: "缺少 projectId 或 nodeId" }, { status: 400 });
    }
    const record = readDrawingDraftFile(pid, nid);
    return NextResponse.json({ code: "0000", message: "OK", content: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { projectId, nodeId } = await ctx.params;
    const pid = String(projectId || "").trim();
    const nid = String(nodeId || "").trim();
    if (!pid || !nid) {
      return NextResponse.json({ message: "缺少 projectId 或 nodeId" }, { status: 400 });
    }
    const body = (await req.json()) as {
      document?: Record<string, unknown>;
      expectedRevision?: number | null;
    };
    const document =
      body.document && typeof body.document === "object" ? body.document : {};
    const expected =
      body.expectedRevision == null || body.expectedRevision === undefined
        ? null
        : Number(body.expectedRevision);
    try {
      const record = writeDrawingDraftFile(
        pid,
        nid,
        document,
        Number.isFinite(expected as number) ? (expected as number) : null
      );
      return NextResponse.json({ code: "0000", message: "OK", content: record });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "REVISION_CONFLICT" || (err instanceof Error && err.message === "REVISION_CONFLICT")) {
        return NextResponse.json(
          { code: "REVISION_CONFLICT", message: "草稿版本冲突，请刷新后重试" },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { projectId, nodeId } = await ctx.params;
    const pid = String(projectId || "").trim();
    const nid = String(nodeId || "").trim();
    if (!pid || !nid) {
      return NextResponse.json({ message: "缺少 projectId 或 nodeId" }, { status: 400 });
    }
    deleteDrawingDraftFile(pid, nid);
    return NextResponse.json({ code: "0000", message: "OK", content: { ok: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}
