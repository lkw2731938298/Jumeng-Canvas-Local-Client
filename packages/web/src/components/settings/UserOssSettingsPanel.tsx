"use client";

/**
 * 开源本地版：用户自配公网 OSS（仅生成参考素材上传，普通素材仍本机）。
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, Save } from "lucide-react";
import { localStore } from "@/lib/local/store";
import {
  defaultUserOssConfig,
  type LocalUserOssConfig,
} from "@/lib/local/userOssConfig";

const inputCls =
  "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";
const labelCls = "text-xs text-muted-foreground";

export function UserOssSettingsPanel() {
  const [cfg, setCfg] = useState<LocalUserOssConfig>(defaultUserOssConfig());
  const [secretDraft, setSecretDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const raw = await localStore().readUserOss();
        setCfg({ ...defaultUserOssConfig(), ...raw });
        setSecretDraft("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "读取 OSS 配置失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next: LocalUserOssConfig = {
        ...cfg,
        endpoint: (cfg.endpoint || "").trim(),
        bucket: (cfg.bucket || "").trim(),
        accessKeyId: (cfg.accessKeyId || "").trim(),
        accessKeySecret: secretDraft.trim() || cfg.accessKeySecret || "",
        objectPrefix: (cfg.objectPrefix || "jumeng-refs").trim() || "jumeng-refs",
        urlMode: "public",
        signedTtlSec: Math.max(3600, Number(cfg.signedTtlSec) || 21600),
      };
      await localStore().saveUserOss(next);
      setCfg(next);
      setSecretDraft("");
      toast.success(
        next.enabled
          ? "已保存。请点「测试上传」：必须得到无 Signature 的直链，上游才能读到参考。"
          : "已保存（未启用）：带参考生成时上游读不到本机图"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/local/oss-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cfg,
          accessKeySecret: secretDraft.trim() || cfg.accessKeySecret || "",
          enabled: true,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        url?: string;
        kind?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `测试失败 HTTP ${res.status}`);
      }
      toast.success(data.message || "连通成功");
      if (data.url) {
        toast.message(`${data.kind === "signed" ? "预签名" : "直链"}：${data.url.slice(0, 96)}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="mt-8 text-sm text-muted-foreground">加载 OSS 配置…</p>;
  }

  const hasSavedSecret = Boolean((cfg.accessKeySecret || "").trim());

  return (
    <section className="mt-8 space-y-4">
      <div>
        <h3 className="inline-flex items-center gap-2 text-base font-medium">
          <Cloud className="h-4 w-4" />
          参考图 / 参考视频 · 公网 OSS
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          部分网关图生图<strong className="font-medium text-foreground">只接受 http(s)</strong>
          ，本机图必须先上传到你的公网 OSS。上传后须得到类似{" "}
          <code className="rounded bg-muted px-1 text-[11px]">
            https://桶名.oss-cn-hangzhou.aliyuncs.com/jumeng-refs/日期/xxx.jpg
          </code>
          （无 <code className="mx-0.5 rounded bg-muted px-1 text-[11px]">?Signature=</code>
          ）。请关闭 Bucket「阻止公共访问」与「强制下载」。
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(cfg.enabled)}
          onChange={(e) => setCfg((c) => ({ ...c, enabled: e.target.checked }))}
        />
        启用：生成时自动把参考上传到此 OSS
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={labelCls}>公网 Endpoint（不要 -internal）</span>
          <input
            className={inputCls}
            value={cfg.endpoint}
            onChange={(e) => setCfg((c) => ({ ...c, endpoint: e.target.value }))}
            placeholder="oss-cn-hangzhou.aliyuncs.com"
          />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>Bucket 名（不要带 .oss-… 域名）</span>
          <input
            className={inputCls}
            value={cfg.bucket}
            onChange={(e) => setCfg((c) => ({ ...c, bucket: e.target.value }))}
            placeholder="your-bucket"
          />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>AccessKeyId</span>
          <input
            className={inputCls}
            value={cfg.accessKeyId}
            onChange={(e) => setCfg((c) => ({ ...c, accessKeyId: e.target.value }))}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>
            AccessKeySecret
            {hasSavedSecret && !secretDraft ? "（已保存，留空则不改）" : ""}
          </span>
          <input
            className={inputCls}
            type="password"
            value={secretDraft}
            onChange={(e) => setSecretDraft(e.target.value)}
            placeholder={hasSavedSecret ? "••••••••" : ""}
            autoComplete="new-password"
          />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>对象前缀（建议单独前缀，不要用整库业务目录）</span>
          <input
            className={inputCls}
            value={cfg.objectPrefix || "jumeng-refs"}
            onChange={(e) => setCfg((c) => ({ ...c, objectPrefix: e.target.value }))}
          />
        </label>
        <label className="block text-sm">
          <span className={labelCls}>URL 偏好（失败会自动改另一种并验 GET）</span>
          <select
            className={inputCls}
            value={cfg.urlMode === "signed" ? "signed" : "public"}
            onChange={(e) =>
              setCfg((c) => ({
                ...c,
                urlMode: e.target.value === "signed" ? "signed" : "public",
              }))
            }
          >
            <option value="public">公共读直链（必须；上游模型商才能拉）</option>
            <option value="signed" disabled>
              预签名（已禁用：模型商常读不到）
            </option>
          </select>
        </label>
      </div>

      <ul className="max-w-2xl list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          关闭 Bucket「阻止公共访问」，允许对象 ACL=public-read（或给前缀{" "}
          <code className="rounded bg-muted px-1">jumeng-refs/</code> 策略允许匿名 GetObject）。
        </li>
        <li>防盗链：不要拦空 Referer；上游拉图通常不带 Referer。</li>
        <li>
          「测试上传」通过标准：返回的 URL{" "}
          <strong className="text-foreground">不能</strong> 带{" "}
          <code className="rounded bg-muted px-1">?OSSAccessKeyId=</code>。
        </li>
        <li>密钥只写在本机 user-oss.json，请用仅该 Bucket 权限的 RAM 子账号。</li>
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={testing}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-60"
          onClick={() => void test()}
        >
          {testing ? "测试中…" : "测试上传（含匿名拉取）"}
        </button>
        <button
          type="button"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
          onClick={() => void save()}
        >
          <Save className="h-4 w-4" />
          {saving ? "保存中…" : "保存 OSS 配置"}
        </button>
      </div>
    </section>
  );
}
