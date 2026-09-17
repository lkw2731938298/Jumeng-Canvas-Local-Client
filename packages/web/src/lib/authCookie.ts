/** Session cookie so <img>/<video> requests to BFF routes can authenticate. */

import { withBasePath } from "@/lib/basePath";

export const SESSION_COOKIE_NAME = "jm_canvas_session_token";
const MAX_AGE_S = 60 * 60 * 24 * 7;

function cookiePath(): string {
  const scoped = withBasePath("/");
  return scoped === "/" ? "/" : scoped.replace(/\/$/, "") || "/";
}

export function setSessionCookie(token: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=${cookiePath()}; Max-Age=${MAX_AGE_S}; SameSite=Lax${secure}`;
}

export function clearSessionCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${SESSION_COOKIE_NAME}=; Path=${cookiePath()}; Max-Age=0; SameSite=Lax`;
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      const raw = rest.join("=");
      if (!raw) return null;
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

export function authorizationFromRequest(
  authorizationHeader: string | null,
  cookieHeader: string | null
): string | null {
  if (authorizationHeader?.startsWith("Bearer ")) return authorizationHeader;
  const token = readSessionCookie(cookieHeader);
  return token ? `Bearer ${token}` : null;
}
