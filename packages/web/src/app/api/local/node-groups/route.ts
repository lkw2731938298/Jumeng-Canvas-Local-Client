/**
 * 本机组库列表 / 新建（不走云端 :8001）。
 */
import { NextResponse } from "next/server";
import type { GroupSnapshot } from "@/lib/canvas/nodeGroup";
import {
  createNodeGroupOnDisk,
  listNodeGroupsOnDisk,
} from "@/lib/local/nodeGroupsDisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    if (!projectId) {
      return NextResponse.json({ message: "缺少 projectId" }, { status: 400 });
    }
    const list = listNodeGroupsOnDisk(projectId, {
      q: url.searchParams.get("q") || undefined,
      tag: url.searchParams.get("tag") || undefined,
      sort: url.searchParams.get("sort") || undefined,
      order: (url.searchParams.get("order") as "asc" | "desc") || undefined,
    });
    return NextResponse.json({ code: "0000", message: "OK", content: list });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      projectId?: string;
      title?: string;
      snapshot?: GroupSnapshot;
      coverAssetId?: string | null;
      cover_asset_id?: string | null;
      tags?: string[];
    };
    const projectId = String(body.projectId || "").trim();
    if (!projectId) {
      return NextResponse.json({ message: "缺少 projectId" }, { status: 400 });
    }
    if (!body.snapshot) {
      return NextResponse.json({ message: "缺少 snapshot" }, { status: 400 });
    }
    const created = createNodeGroupOnDisk({
      projectId,
      title: String(body.title || "未命名组"),
      snapshot: body.snapshot,
      coverAssetId: body.coverAssetId ?? body.cover_asset_id ?? null,
      tags: body.tags,
    });
    return NextResponse.json({ code: "0000", message: "OK", content: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ message }, { status: 500 });
  }
}
