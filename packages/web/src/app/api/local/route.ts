/**
 * 本机 Harness RPC：浏览器 ↔ 磁盘存储。
 */
import { NextResponse } from "next/server";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 文件夹选择框可能长时间等待用户操作 */
export const maxDuration = 600;

const OPS = new Set([
  "getDataRoot",
  "getDataLocationInfo",
  "pickDataDirectory",
  "setDataLocation",
  "resetDataLocation",
  "readConfig",
  "writeConfig",
  "listProviders",
  "saveProviders",
  "listModels",
  "saveModels",
  "readToolModels",
  "saveToolModels",
  "listProjects",
  "createProject",
  "getProject",
  "updateProject",
  "deleteProject",
  "readWorkflow",
  "writeWorkflow",
  "writeAsset",
  "readAssetAsDataUrl",
  "listAssets",
  "registerAssetMeta",
  "deleteAsset",
  "readNodeText",
  "writeNodeText",
  "readUserOss",
  "saveUserOss",
  "listGenerationJobs",
  "appendGenerationJob",
  "updateGenerationJob",
  "clearGenerationJobs",
]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { op?: string; args?: unknown[] };
    const op = String(body.op || "");
    if (!OPS.has(op)) {
      return NextResponse.json({ error: `unknown op: ${op}` }, { status: 400 });
    }
    const store = createServerDiskStore() as unknown as Record<
      string,
      (...a: unknown[]) => Promise<unknown>
    >;
    const args = Array.isArray(body.args) ? body.args : [];
    const result = await store[op](...args);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const store = createServerDiskStore();
  const root = await store.getDataRoot();
  return NextResponse.json({ ok: true, dataRoot: root });
}
