/**
 * 本机检查更新：GET 比对 GitHub 版本号；POST 下载覆盖（依赖变化时后台重启）。
 */
import { NextResponse } from "next/server";
import { applyUpdate, checkForUpdate } from "@/lib/local/appUpdate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 下载 GitHub zip 在国内可能较慢 */
export const maxDuration = 600;

/** 自定义头触发 CORS 预检，防止外部网页跨站 POST 触发更新 */
const UPDATE_HEADER = "x-jumeng-update";

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, result: await checkForUpdate() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (req.headers.get(UPDATE_HEADER) !== "1") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, result: await applyUpdate() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: errorMessage(err) }, { status: 500 });
  }
}
