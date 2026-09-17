/**
 * 本机预览实际上游参考 URL。
 * 浏览器直接打开 OSS 常被防盗链 / CORS 拦成空白；由本机代拉，不带页面 Referer。
 */
import { NextResponse } from "next/server";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import { normalizeOssBucket, normalizeOssEndpoint } from "@/lib/local/userOssConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedOssUrl(raw: string, bucket: string, endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  const b = normalizeOssBucket(bucket).toLowerCase();
  const ep = normalizeOssEndpoint(endpoint).toLowerCase();
  if (b && ep && host === `${b}.${ep}`) return true;
  // 加速域名 / 自定义绑定时至少限制在阿里云 OSS
  if (b && host.startsWith(`${b}.`) && host.endsWith(".aliyuncs.com")) return true;
  return false;
}

/**
 * 该 URL 是否为本机某条生成任务实际提交过的参考。
 * 参考直链可能来自用户 OSS，也可能是聚梦 files/upload 的 1 小时签名直链，
 * 域名无法穷举；以「我们自己记下的提交记录」为准最贴切，也不会放大可拉取范围。
 */
async function wasSubmittedAsReference(
  store: ReturnType<typeof createServerDiskStore>,
  target: string
): Promise<boolean> {
  try {
    const jobs = await store.listGenerationJobs();
    return jobs.some((j) => j.submittedRefUrls?.some((u) => u === target));
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = (searchParams.get("url") || "").trim();
  if (!target) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  const store = createServerDiskStore();
  const cfg = await store.readUserOss();
  // 白名单两条：① 本机任务确实提交过的参考 URL（含聚梦 files/upload 临时直链）；
  // ② 用户自配 OSS Bucket（兼容没记 submittedRefUrls 的旧任务）
  const submitted = await wasSubmittedAsReference(store, target);
  if (!submitted && !isAllowedOssUrl(target, cfg.bucket || "", cfg.endpoint || "")) {
    return NextResponse.json(
      { error: "仅允许预览本机任务提交过的参考，或已配置 OSS Bucket 上的对象" },
      { status: 403 }
    );
  }

  try {
    const upstream = await fetch(target, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "image/*,*/*" },
    });
    if (!upstream.ok) {
      const peek = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          error: `OSS 匿名拉取 HTTP ${upstream.status}（上游控制台同样可能无法显示）`,
          detail: peek.slice(0, 240),
        },
        { status: 502 }
      );
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get("content-type") || "image/jpeg";
    if (/xml|html/i.test(type) && /AccessDenied|Error>/i.test(buf.toString("utf8").slice(0, 400))) {
      return NextResponse.json(
        { error: "OSS 返回错误页，参考图无法查看。请检查阻止公共访问 / 防盗链是否拦截空 Referer。" },
        { status: 502 }
      );
    }
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": type.split(";")[0] || "image/jpeg",
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
