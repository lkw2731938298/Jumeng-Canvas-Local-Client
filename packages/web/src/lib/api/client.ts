// Default to same-origin BFF proxy so LAN clients work without hardcoded localhost.
import { isAuthRelaxed } from "@/lib/authConfig";
import { resolveErrorMessage } from "@/lib/errors/errorCodes";
import { withBasePath, stripBasePath } from "@/lib/basePath";
import { performLogout } from "@/lib/auth/session";
import { useAuthStore } from "@/stores/authStore";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || withBasePath("/api/proxy");

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function convertKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (obj !== null && typeof obj === "object" && !(obj instanceof Date)) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [snakeToCamel(k), convertKeys(v)])
    );
  }
  return obj;
}

function unwrapApiPayload<T>(raw: unknown): T {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const code = record.code != null ? String(record.code) : null;
    if ((code === "0000" || code === "OK") && record.content !== undefined) {
      return record.content as T;
    }
  }
  return raw as T;
}

function handleUnauthorized() {
  if (typeof window === "undefined" || isAuthRelaxed) return;
  performLogout();
  // 开源本地版：鉴权失败不跳转登录页
  const path = stripBasePath(window.location.pathname || "/");
  if (path === "/projects" || path.startsWith("/projects") || path === "/settings") {
    return;
  }
  window.location.href = withBasePath("/projects");
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const isFormData =
    typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;
  const headers: Record<string, string> = {
    // FormData 由浏览器自动带 multipart boundary，勿强制 JSON
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };
  if (isFormData) {
    delete headers["Content-Type"];
  }

  if (!skipAuth) {
    const token = typeof window !== "undefined"
      ? localStorage.getItem("jm_canvas_session_token")
      : null;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...fetchOptions, headers });

  if (!res.ok) {
    if (res.status === 401 && !skipAuth) {
      handleUnauthorized();
    }
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const record = body as {
      code?: string;
      message?: string;
      content?: unknown;
      detail?: unknown;
      error?: string;
    };

    let code = record.code ? String(record.code) : null;
    let message = record.message || record.error || res.statusText;
    let detail: unknown = record.content;

    if (!code && record.detail !== undefined) {
      const legacyDetail = record.detail;
      if (typeof legacyDetail === "object" && legacyDetail !== null && !Array.isArray(legacyDetail)) {
        const legacyRec = legacyDetail as Record<string, unknown>;
        if (legacyRec.code != null) code = String(legacyRec.code);
        message = resolveErrorMessage(legacyDetail, message);
        detail = legacyRec;
      } else if (typeof legacyDetail === "string") {
        message = resolveErrorMessage(legacyDetail, legacyDetail);
        detail = legacyDetail;
      } else if (Array.isArray(legacyDetail)) {
        detail = legacyDetail;
      }
    } else if (detail !== undefined) {
      message = resolveErrorMessage({ code, message, ...(typeof detail === "object" && detail ? detail as object : {}) }, message);
    }

    if (res.status === 502 && message.includes("无法连接")) {
      message = "无法连接本机接口，请确认画布已启动后再试。";
    }
    throw new ApiError(
      res.status,
      message,
      convertKeys(detail),
      code,
      convertKeys(detail)
    );
  }

  const text = await res.text();
  if (!text) return undefined as T;
  return unwrapApiPayload<T>(convertKeys(JSON.parse(text)));
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
    public code: string | null = null,
    public content?: unknown
  ) {
    super(message);
    this.name = "ApiError";
    if (detail !== undefined && content === undefined) {
      this.content = detail;
    }
  }
}
