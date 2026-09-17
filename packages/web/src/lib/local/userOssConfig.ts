/**
 * 用户自配 OSS 的配置形状与校验（无 Node crypto，可在浏览器引用）。
 * 实际上传 / 签名只放在 aliyunOss.ts，由本机 API 调用。
 */

export type LocalOssUrlMode = "signed" | "public";

export type LocalUserOssConfig = {
  /** 是否启用：启用后生成参考会上传到此 Bucket */
  enabled: boolean;
  /** 公网 Endpoint，如 oss-cn-hangzhou.aliyuncs.com（禁止 -internal） */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 对象前缀，默认 jumeng-refs */
  objectPrefix?: string;
  /**
   * 仅作偏好：实际上传后必须能匿名 GET。
   * public=优先对象公共读；signed=私有对象 + 预签名（Bucket 开了「阻止公共访问」时用）。
   */
  urlMode?: LocalOssUrlMode;
  /** 预签名有效期秒，默认 21600（6h） */
  signedTtlSec?: number;
  updatedAt?: string;
};

/** 对外返回时脱敏（不回传 Secret） */
export type LocalUserOssConfigPublic = Omit<LocalUserOssConfig, "accessKeySecret"> & {
  accessKeySecret?: string;
  hasSecret: boolean;
  secretHint?: string;
};

export function defaultUserOssConfig(): LocalUserOssConfig {
  return {
    enabled: false,
    endpoint: "oss-cn-hangzhou.aliyuncs.com",
    bucket: "",
    accessKeyId: "",
    accessKeySecret: "",
    objectPrefix: "jumeng-refs",
    urlMode: "public",
    signedTtlSec: 21600,
  };
}

export function normalizeOssEndpoint(raw: string): string {
  return (raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** 用户常把「Bucket.地域域名」整段贴进 Bucket，须拆开 */
export function normalizeOssBucket(raw: string): string {
  let b = (raw || "").trim();
  b = b.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const m = b.match(/^([^./]+)\.(oss-[a-z0-9-]+(?:-internal)?\.aliyuncs\.com)$/i);
  if (m) return m[1];
  if (b.includes("/")) b = b.split("/")[0] || b;
  return b;
}

export function assertPublicOssEndpoint(endpoint: string): string {
  const ep = normalizeOssEndpoint(endpoint);
  if (!ep) throw new Error("请填写 OSS Endpoint");
  if (/-internal(\.|$)/i.test(ep)) {
    throw new Error(
      "请填写公网 Endpoint（不要带 -internal）。上游模型无法访问内网 Endpoint"
    );
  }
  return ep;
}

export function toPublicOssConfig(cfg: LocalUserOssConfig): LocalUserOssConfigPublic {
  const secret = (cfg.accessKeySecret || "").trim();
  const hint = secret.length >= 4 ? secret.slice(-4) : secret ? "****" : "";
  return {
    enabled: Boolean(cfg.enabled),
    endpoint: cfg.endpoint || "",
    bucket: cfg.bucket || "",
    accessKeyId: cfg.accessKeyId || "",
    objectPrefix: cfg.objectPrefix || "jumeng-refs",
    urlMode: cfg.urlMode === "signed" ? "signed" : "public",
    signedTtlSec: cfg.signedTtlSec ?? 21600,
    updatedAt: cfg.updatedAt,
    hasSecret: Boolean(secret),
    secretHint: hint,
    accessKeySecret: "",
  };
}

export function isUserOssReady(cfg: LocalUserOssConfig | null | undefined): boolean {
  if (!cfg?.enabled) return false;
  try {
    assertPublicOssEndpoint(cfg.endpoint);
  } catch {
    return false;
  }
  return Boolean(
    normalizeOssBucket(cfg.bucket || "") &&
      (cfg.accessKeyId || "").trim() &&
      (cfg.accessKeySecret || "").trim()
  );
}
