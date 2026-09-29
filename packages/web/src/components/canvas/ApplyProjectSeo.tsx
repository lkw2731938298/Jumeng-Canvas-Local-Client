"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useCanvasStore } from "@/stores/canvasStore";
import { projectCanvasSeo, projectSeoNumber } from "@/lib/pageSeo";

function upsertMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertProperty(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

/** 画布项目页：用数字编号同步 title / keywords / description */
export function ApplyProjectSeo() {
  const params = useParams<{ id: string }>();
  const projectId = useCanvasStore((s) => s.projectId) || params.id || "";
  const projectNo = useCanvasStore((s) => s.projectNo);

  useEffect(() => {
    const no = projectSeoNumber(projectNo, projectId);
    if (!no) return;
    const seo = projectCanvasSeo(no);
    const title = typeof seo.title === "string" ? seo.title : `${no}-聚梦画布`;
    document.title = title;
    upsertMeta("keywords", no);
    upsertMeta("description", no);
    upsertProperty("og:title", title);
    upsertProperty("og:description", no);
  }, [projectId, projectNo]);

  return null;
}
