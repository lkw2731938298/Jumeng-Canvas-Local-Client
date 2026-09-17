import type { DirectorSceneState } from "@/types/director-scene";
import { withBasePath } from "@/lib/basePath";

export interface DirectorSceneRecord {
  projectId: string;
  nodeId: string;
  scene: DirectorSceneState;
  ossKey: string;
  updatedAt: string;
}

function authHeaders(): Record<string, string> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("jm_canvas_session_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDirectorScene(
  projectId: string,
  nodeId: string
): Promise<DirectorSceneRecord | null> {
  const url = new URL(withBasePath("/api/director-scene"), window.location.origin);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("nodeId", nodeId);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("加载导演台场景失败");
  return res.json();
}

export async function saveDirectorScene(
  projectId: string,
  nodeId: string,
  scene: DirectorSceneState
): Promise<DirectorSceneRecord> {
  const res = await fetch(withBasePath("/api/director-scene"), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ projectId, nodeId, scene }),
  });
  if (!res.ok) throw new Error("保存导演台场景失败");
  return res.json();
}
