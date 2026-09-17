/**
 * 测试用户自配 OSS：上传一小段探测对象并返回可访问 URL。
 */
import { NextResponse } from "next/server";
import { createServerDiskStore } from "@/lib/local/serverDiskStore";
import {
  assertPublicOssEndpoint,
  defaultUserOssConfig,
  isUserOssReady,
  toPublicOssConfig,
  uploadReferenceToUserOssDetailed,
  type LocalUserOssConfig,
} from "@/lib/local/aliyunOss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<LocalUserOssConfig> | null;
    const store = createServerDiskStore();
    const saved = await store.readUserOss();
    const merged: LocalUserOssConfig = {
      ...defaultUserOssConfig(),
      ...saved,
      ...(body || {}),
      // 表单留空 Secret 时沿用已保存的
      accessKeySecret:
        (body?.accessKeySecret || "").trim() || saved.accessKeySecret || "",
      enabled: true,
    };
    assertPublicOssEndpoint(merged.endpoint);
    if (!isUserOssReady({ ...merged, enabled: true })) {
      return NextResponse.json(
        { ok: false, error: "请完整填写 Endpoint / Bucket / AccessKeyId / AccessKeySecret" },
        { status: 400 }
      );
    }

    const probe = Buffer.from(`jumeng-canvas-oss-probe ${new Date().toISOString()}`, "utf8");
    const uploaded = await uploadReferenceToUserOssDetailed({
      cfg: merged,
      body: probe,
      contentType: "text/plain",
      fileExt: "txt",
      // 测试也按生成标准：必须公网直链，才能确认上游可读
      requirePublic: true,
    });
    const clean = !/\?/.test(uploaded.url) && uploaded.kind === "public";
    if (!clean) {
      return NextResponse.json(
        {
          ok: false,
          url: uploaded.url,
          kind: uploaded.kind,
          error:
            "测试未通过：需要无 Signature 的直链。请关闭 Bucket「阻止公共访问」并允许 public-read 后再测。",
          oss: toPublicOssConfig(merged),
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      url: uploaded.url,
      kind: uploaded.kind,
      message: `成功：公网直链可用 → ${uploaded.url}`,
      oss: toPublicOssConfig(merged),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
