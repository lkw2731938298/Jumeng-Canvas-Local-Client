/**
 * 开源本地版：用户自配阿里云 OSS（纯 Node crypto，无 oss2 依赖）。
 * 仅用于「生成参考素材」上传，普通素材库仍走本机磁盘。
 *
 * 契约：返回的 URL 必须能被上游云端匿名 GET 拉到（聚梦 Gemini 等会由网关去拉，
 * 不能用 localhost / data: / 拉不通的签名链）。
 */

import crypto from "node:crypto";
import {
  assertPublicOssEndpoint,
  defaultUserOssConfig,
  isUserOssReady,
  normalizeOssBucket,
  toPublicOssConfig,
  type LocalOssUrlMode,
  type LocalUserOssConfig,
  type LocalUserOssConfigPublic,
} from "./userOssConfig";

export type { LocalOssUrlMode, LocalUserOssConfig, LocalUserOssConfigPublic };
export {
  assertPublicOssEndpoint,
  defaultUserOssConfig,
  isUserOssReady,
  normalizeOssBucket,
  toPublicOssConfig,
};

export type UploadRefResult = {
  url: string;
  kind: "public" | "signed";
  objectKey: string;
};

function gmtDate(d = new Date()): string {
  return d.toUTCString();
}

function hmacSha1Base64(secret: string, content: string): string {
  return crypto.createHmac("sha1", secret).update(content, "utf8").digest("base64");
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function objectUrl(endpoint: string, bucket: string, objectKey: string): string {
  const ep = assertPublicOssEndpoint(endpoint);
  const b = normalizeOssBucket(bucket);
  return `https://${b}.${ep}/${encodeObjectKey(objectKey)}`;
}

function creds(cfg: LocalUserOssConfig) {
  const endpoint = assertPublicOssEndpoint(cfg.endpoint);
  const bucket = normalizeOssBucket(cfg.bucket);
  const ak = (cfg.accessKeyId || "").trim();
  const sk = (cfg.accessKeySecret || "").trim();
  if (!bucket) throw new Error("请填写 Bucket 名称");
  if (!ak || !sk) throw new Error("请填写 AccessKeyId / AccessKeySecret");
  return { endpoint, bucket, ak, sk };
}

/** PutObject：上传字节到用户 Bucket */
export async function ossPutObject(params: {
  cfg: LocalUserOssConfig;
  objectKey: string;
  body: Buffer;
  contentType: string;
  publicRead?: boolean;
}): Promise<void> {
  const { endpoint, bucket, ak, sk } = creds(params.cfg);
  const date = gmtDate();
  const contentType = params.contentType || "application/octet-stream";
  const aclHeader = params.publicRead ? "public-read" : "";
  // 仅 x-oss-* 进签名；Content-Disposition 作普通头（inline 便于预览，Bucket 强制下载仍可能覆盖）
  const disposition = `inline; filename="${params.objectKey.split("/").pop() || "ref.bin"}"`;
  const canonicalHeaders = aclHeader ? `x-oss-object-acl:${aclHeader}\n` : "";
  const resource = `/${bucket}/${params.objectKey}`;
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalHeaders}${resource}`;
  const signature = hmacSha1Base64(sk, stringToSign);

  const url = objectUrl(endpoint, bucket, params.objectKey);
  const headers: Record<string, string> = {
    Date: date,
    "Content-Type": contentType,
    "Content-Disposition": disposition,
    Authorization: `OSS ${ak}:${signature}`,
  };
  if (aclHeader) headers["x-oss-object-acl"] = aclHeader;

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: new Uint8Array(params.body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OSS 上传失败 HTTP ${res.status}：${text.slice(0, 240) || res.statusText}`
    );
  }
}

/** 生成 GET 预签名 URL（上游云端可拉取） */
export function ossSignGetUrl(params: {
  cfg: LocalUserOssConfig;
  objectKey: string;
  expiresSec?: number;
}): string {
  const { endpoint, bucket, ak, sk } = creds(params.cfg);
  const ttl = Math.max(
    60,
    Math.min(7 * 24 * 3600, params.expiresSec ?? params.cfg.signedTtlSec ?? 21600)
  );
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const resource = `/${bucket}/${params.objectKey}`;
  const stringToSign = `GET\n\n\n${expires}\n${resource}`;
  const signature = hmacSha1Base64(sk, stringToSign);
  const q =
    `OSSAccessKeyId=${encodeURIComponent(ak)}` +
    `&Expires=${expires}` +
    `&Signature=${encodeURIComponent(signature)}`;
  return `${objectUrl(endpoint, bucket, params.objectKey)}?${q}`;
}

/**
 * 匿名 GET：模拟上游网关拉图（不带 OSS 鉴权头）。
 * 上传成功但这里失败 = 聚梦也读不到参考。
 */
export async function assertAnonymousGetWorks(url: string): Promise<void> {
  const href = (url || "").trim();
  if (!href.startsWith("https://") && !href.startsWith("http://")) {
    throw new Error("参考 URL 必须是 http(s)，上游无法读取");
  }
  let res: Response;
  try {
    // Range：大视频不必整文件下载；也能暴露签名/防盗链错误
    res = await fetch(href, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "*/*", Range: "bytes=0-255" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `参考 URL 匿名拉取失败（网络）：${msg}。请确认 Endpoint 为公网、本机可访问该 Bucket`
    );
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const peek = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `参考 URL 匿名 GET HTTP ${res.status}，上游同样拉不到。` +
        (peek ? ` 详情：${peek.slice(0, 180)}` : "") +
        `。若 Bucket 开启了「阻止公共访问」，请改用预签名偏好，或为前缀放行公共读。`
    );
  }
  if (/xml|html/.test(ct) && /AccessDenied|SignatureDoesNotMatch|Error>|Code>/i.test(peek)) {
    throw new Error(
      `参考 URL 返回了 OSS 错误页，上游读不到图。${peek.slice(0, 160)}`
    );
  }
  const forceDl =
    (res.headers.get("x-oss-force-download") || "").toLowerCase() === "true" ||
    /attachment/i.test(res.headers.get("content-disposition") || "");
  if (forceDl) {
    // 不硬失败：图生图已改走 data:image；视频仍可能可用。提示用户关闭 Bucket 强制下载更稳
    console.warn(
      "[aliyunOss] 对象带强制下载头，部分上游拉图可能失败。建议关闭 Bucket「强制下载文件」：",
      href.slice(0, 120)
    );
  }
}

async function putAndVerify(params: {
  cfg: LocalUserOssConfig;
  objectKey: string;
  body: Buffer;
  contentType: string;
  publicRead: boolean;
}): Promise<UploadRefResult> {
  await ossPutObject({
    cfg: params.cfg,
    objectKey: params.objectKey,
    body: params.body,
    contentType: params.contentType,
    publicRead: params.publicRead,
  });
  const url = params.publicRead
    ? objectUrl(params.cfg.endpoint, params.cfg.bucket, params.objectKey)
    : ossSignGetUrl({ cfg: params.cfg, objectKey: params.objectKey });
  await assertAnonymousGetWorks(url);
  return {
    url,
    kind: params.publicRead ? "public" : "signed",
    objectKey: params.objectKey,
  };
}

/** 上传参考素材并返回上游可拉取的 https URL（已匿名 GET 验通） */
export async function uploadReferenceToUserOss(params: {
  cfg: LocalUserOssConfig;
  body: Buffer;
  contentType: string;
  fileExt: string;
  prefer?: LocalOssUrlMode;
  /** 生成参考：必须干净公网直链（无签名 query）。聚梦等上游常读不了预签名。 */
  requirePublic?: boolean;
}): Promise<string> {
  const out = await uploadReferenceToUserOssDetailed(params);
  return out.url;
}

export async function uploadReferenceToUserOssDetailed(params: {
  cfg: LocalUserOssConfig;
  body: Buffer;
  contentType: string;
  fileExt: string;
  prefer?: LocalOssUrlMode;
  /** true：只接受公共读直链；失败时给出阿里云改法，不回退签名 */
  requirePublic?: boolean;
}): Promise<UploadRefResult> {
  const prefix = (params.cfg.objectPrefix || "jumeng-refs").replace(/^\/+|\/+$/g, "");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(8).toString("hex");
  const ext = (params.fileExt || "bin").replace(/^\./, "").toLowerCase() || "bin";
  const objectKey = `${prefix}/${stamp}/${rand}.${ext}`;
  // 给上游模型：一律优先公共读；requirePublic 时禁止回退签名
  const requirePublic = Boolean(params.requirePublic);
  const prefer: LocalOssUrlMode = requirePublic
    ? "public"
    : params.prefer || (params.cfg.urlMode === "signed" ? "signed" : "public");

  const tryPublic = async () =>
    putAndVerify({
      cfg: params.cfg,
      objectKey,
      body: params.body,
      contentType: params.contentType,
      publicRead: true,
    });
  const trySigned = async () =>
    putAndVerify({
      cfg: params.cfg,
      objectKey,
      body: params.body,
      contentType: params.contentType,
      publicRead: false,
    });

  if (requirePublic) {
    try {
      return await tryPublic();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `无法生成上游可读的公网直链（需要形如 https://桶名.oss-cn-hangzhou.aliyuncs.com/${prefix}/日期/xxx.jpg，无签名参数）。\n` +
          `原因：${msg}\n` +
          `请到阿里云控制台改 Bucket「${normalizeOssBucket(params.cfg.bucket)}」：\n` +
          `1) 关闭「阻止公共访问」（Block Public Access）；\n` +
          `2) 读写权限允许对对象设 public-read，或给前缀 ${prefix}/ 加 Bucket 策略允许匿名 GetObject；\n` +
          `3) 防盗链不要拦空 Referer（上游拉图通常不带 Referer）；\n` +
          `4) RAM 子账号要有 oss:PutObject、oss:PutObjectAcl、oss:GetObject；\n` +
          `5) 本地设置里 URL 偏好选「公共读直链」，保存后再点「测试上传」。\n` +
          `预签名 URL 本机可能能开，但聚梦等模型商经常拉不到，故生成参考禁止回退签名。`
      );
    }
  }

  const first = prefer === "signed" ? trySigned : tryPublic;
  const second = prefer === "signed" ? tryPublic : trySigned;
  try {
    return await first();
  } catch (err1) {
    try {
      return await second();
    } catch (err2) {
      const a = err1 instanceof Error ? err1.message : String(err1);
      const b = err2 instanceof Error ? err2.message : String(err2);
      throw new Error(
        `参考已上传，但匿名 GET 不通，上游模型读不到。` +
          `公共读：${a}；预签名：${b}。` +
          `请到阿里云：1) Endpoint 用公网（不要 -internal）；` +
          `2) 关闭该 Bucket「阻止公共访问」或给前缀 ${prefix}/ 放行 GetObject；` +
          `3) RAM 子账号具备 oss:PutObject / oss:GetObject / oss:PutObjectAcl。`
      );
    }
  }
}
