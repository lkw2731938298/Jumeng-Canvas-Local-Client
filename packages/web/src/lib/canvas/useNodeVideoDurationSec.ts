"use client";

import { useEffect, useState } from "react";
import { getVideoNodeRef } from "@/lib/canvas/videoNodeRegistry";
import { probeVideoDurationSec } from "@/lib/canvas/videoFrameEdit";
import { mediaDurationToBillSeconds } from "@/lib/canvas/canvasVideoToolBilling";

/**
 * 读取当前视频节点的真实片长（秒）。
 * 优先画布上已挂载的 `<video>.duration`，读不到再探测 URL 元数据。
 * 不使用节点 params.duration（那是生成档位，常把 3s 片误当成 15s）。
 */
export function useNodeVideoDurationSec(
  nodeId: string | null | undefined,
  videoUrl?: string | null,
  enabled = true
): { durationSec: number | null; isReady: boolean } {
  const [durationSec, setDurationSec] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !nodeId) {
      setDurationSec(null);
      return;
    }

    setDurationSec(null);

    let cancelled = false;
    const apply = (raw: number | null | undefined): boolean => {
      const sec = mediaDurationToBillSeconds(raw);
      if (sec == null) return false;
      if (!cancelled) setDurationSec(sec);
      return true;
    };

    const readMounted = (): boolean => apply(getVideoNodeRef(nodeId)?.duration);

    if (readMounted()) return;

    const el = getVideoNodeRef(nodeId);
    const onMeta = () => {
      readMounted();
    };
    el?.addEventListener("loadedmetadata", onMeta);
    el?.addEventListener("durationchange", onMeta);

    const poll = window.setInterval(() => {
      if (readMounted()) window.clearInterval(poll);
    }, 250);

    const probeTimer = window.setTimeout(() => {
      if (cancelled || readMounted()) return;
      const url = String(videoUrl || "").trim();
      if (!url) return;
      void probeVideoDurationSec(url).then((probed) => {
        if (!cancelled && !readMounted()) apply(probed);
      });
    }, 400);

    return () => {
      cancelled = true;
      el?.removeEventListener("loadedmetadata", onMeta);
      el?.removeEventListener("durationchange", onMeta);
      window.clearInterval(poll);
      window.clearTimeout(probeTimer);
    };
  }, [enabled, nodeId, videoUrl]);

  return { durationSec, isReady: durationSec != null };
}
