"use client";

import { useEffect } from "react";

const RELOAD_FLAG = "jm_chunk_reload_v1";

function isChunkLoadFailure(reason: unknown, filename?: string): boolean {
  if (reason && typeof reason === "object" && "name" in reason && reason.name === "ChunkLoadError") {
    return true;
  }
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  if (/ChunkLoadError|Loading chunk|Failed to load chunk/i.test(message)) return true;
  return Boolean(filename?.includes("/_next/static/chunks/") && !filename.includes("turbopack"));
}

/** After `next build`, stale tabs may request old chunk hashes — reload once to pick up the new bundle. */
export function ChunkReloadRecovery() {
  useEffect(() => {
    const reloadOnce = () => {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    };

    const onError = (event: Event) => {
      const errorEvent = event as ErrorEvent;
      const script = event.target;
      const scriptSrc =
        script instanceof HTMLScriptElement ? script.src : errorEvent.filename;
      if (!isChunkLoadFailure(errorEvent.error ?? errorEvent.message, scriptSrc)) return;
      reloadOnce();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isChunkLoadFailure(event.reason)) return;
      reloadOnce();
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
