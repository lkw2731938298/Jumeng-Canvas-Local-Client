/**
 * 本地存储入口：
 * 1) Electron IPC（可选）
 * 2) 本机 Next /api/local → 磁盘 data/JumengCanvas（Harness 默认）
 * 3) localStorage 兜底
 */

import type {
  LocalAppConfig,
  LocalAssetMeta,
  LocalDesktopApi,
  LocalModel,
  LocalProjectMeta,
  LocalProvider,
  LocalUserOssConfig,
  LocalGenerationJob,
  LocalGenerationJobCreate,
  JumengDataLocationInfo,
} from "./types";
import { getDesktopApi } from "./types";
import { emptyToolModelsMap, normalizeToolModelsMap } from "./canvasToolDefs";
import type { LocalToolModelsMap } from "./canvasToolDefs";
import { defaultUserOssConfig } from "./userOssConfig";
import { promptPreview, trimJobs } from "./generationJobs";

const LS = {
  config: "jm_local_config",
  providers: "jm_local_providers",
  models: "jm_local_models",
  toolModels: "jm_local_tool_models",
  userOss: "jm_local_user_oss",
  generationJobs: "jm_local_generation_jobs",
  projects: "jm_local_projects",
  workflow: (id: string) => `jm_local_workflow_${id}`,
};

function nowIso() {
  return new Date().toISOString();
}

function defaultConfig(): LocalAppConfig {
  const t = nowIso();
  return { version: 1, lastProjectId: null, createdAt: t, updatedAt: t };
}

async function rpc<T>(op: string, args: unknown[] = []): Promise<T> {
  const res = await fetch("/api/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, args }),
  });
  const data = (await res.json()) as { ok?: boolean; result?: T; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `local rpc failed: ${op}`);
  }
  return data.result as T;
}

function httpDiskApi(): LocalDesktopApi {
  return {
    getDataRoot: () => rpc<string>("getDataRoot"),
    getDataLocationInfo: () => rpc<JumengDataLocationInfo>("getDataLocationInfo"),
    pickDataDirectory: (initialDir) =>
      rpc<string | null>("pickDataDirectory", [initialDir]),
    setDataLocation: (rawPath, opts) =>
      rpc<JumengDataLocationInfo>("setDataLocation", [rawPath, opts]),
    resetDataLocation: (opts) =>
      rpc<JumengDataLocationInfo>("resetDataLocation", [opts]),
    readConfig: () => rpc<LocalAppConfig>("readConfig"),
    writeConfig: (cfg) => rpc<void>("writeConfig", [cfg]),
    listProviders: () => rpc<LocalProvider[]>("listProviders"),
    saveProviders: (items) => rpc<void>("saveProviders", [items]),
    listModels: () => rpc<LocalModel[]>("listModels"),
    saveModels: (items) => rpc<void>("saveModels", [items]),
    readToolModels: () => rpc<LocalToolModelsMap>("readToolModels"),
    saveToolModels: (map) => rpc<void>("saveToolModels", [map]),
    listProjects: () => rpc<LocalProjectMeta[]>("listProjects"),
    createProject: (title) => rpc<LocalProjectMeta>("createProject", [title]),
    getProject: (id) => rpc<LocalProjectMeta | null>("getProject", [id]),
    updateProject: (id, patch) =>
      rpc<LocalProjectMeta>("updateProject", [id, patch]),
    deleteProject: (id) => rpc<void>("deleteProject", [id]),
    readWorkflow: (projectId) => rpc<unknown | null>("readWorkflow", [projectId]),
    writeWorkflow: (projectId, flow) =>
      rpc<void>("writeWorkflow", [projectId, flow]),
    writeAsset: (projectId, fileName, base64) =>
      rpc<{ path: string; fileUrl: string }>("writeAsset", [
        projectId,
        fileName,
        base64,
      ]),
    readAssetAsDataUrl: (projectId, fileName) =>
      rpc<string | null>("readAssetAsDataUrl", [projectId, fileName]),
    listAssets: (projectId) => rpc<LocalAssetMeta[]>("listAssets", [projectId]),
    registerAssetMeta: (projectId, meta) =>
      rpc<void>("registerAssetMeta", [projectId, meta]),
    deleteAsset: (projectId, assetId) =>
      rpc<void>("deleteAsset", [projectId, assetId]),
    readNodeText: (projectId, nodeId) =>
      rpc<string | null>("readNodeText", [projectId, nodeId]),
    writeNodeText: (projectId, nodeId, content, model) =>
      rpc<void>("writeNodeText", [projectId, nodeId, content, model]),
    readUserOss: () => rpc<LocalUserOssConfig>("readUserOss"),
    saveUserOss: (cfg) => rpc<void>("saveUserOss", [cfg]),
    listGenerationJobs: () => rpc<LocalGenerationJob[]>("listGenerationJobs"),
    appendGenerationJob: (input) =>
      rpc<LocalGenerationJob>("appendGenerationJob", [input]),
    updateGenerationJob: (id, patch) =>
      rpc<LocalGenerationJob | null>("updateGenerationJob", [id, patch]),
    clearGenerationJobs: () => rpc<void>("clearGenerationJobs"),
  };
}

function browserLocalStorageApi(): LocalDesktopApi {
  const readJson = <T,>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  const writeJson = (key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  return {
    async getDataRoot() {
      return "browser://localStorage";
    },
    async getDataLocationInfo() {
      return {
        dataRoot: "browser://localStorage",
        defaultDataRoot: "browser://localStorage",
        bootstrapPath: "",
        isCustom: false,
        envOverride: null,
      };
    },
    async pickDataDirectory() {
      throw new Error("浏览器 localStorage 模式不支持选择磁盘目录，请使用本机 Harness");
    },
    async setDataLocation() {
      throw new Error("浏览器 localStorage 模式不支持修改磁盘保存位置，请使用本机 Harness（启动本机画布）");
    },
    async resetDataLocation() {
      throw new Error("浏览器 localStorage 模式不支持修改磁盘保存位置");
    },
    async readConfig() {
      return readJson(LS.config, defaultConfig());
    },
    async writeConfig(cfg) {
      writeJson(LS.config, { ...cfg, updatedAt: nowIso() });
    },
    async listProviders() {
      return readJson<LocalProvider[]>(LS.providers, []);
    },
    async saveProviders(items) {
      writeJson(LS.providers, items);
    },
    async listModels() {
      return readJson<LocalModel[]>(LS.models, []);
    },
    async saveModels(items) {
      writeJson(LS.models, items);
    },
    async readToolModels() {
      return normalizeToolModelsMap(readJson(LS.toolModels, emptyToolModelsMap()));
    },
    async saveToolModels(map) {
      writeJson(LS.toolModels, { version: 1, tools: normalizeToolModelsMap(map) });
    },
    async listProjects() {
      return readJson<LocalProjectMeta[]>(LS.projects, []).filter((p) => !p.deletedAt);
    },
    async createProject(title) {
      const all = readJson<LocalProjectMeta[]>(LS.projects, []);
      const t = nowIso();
      const meta: LocalProjectMeta = {
        id: crypto.randomUUID(),
        title: title || "未命名项目",
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      };
      all.unshift(meta);
      writeJson(LS.projects, all);
      writeJson(LS.workflow(meta.id), {
        id: crypto.randomUUID(),
        projectId: meta.id,
        revision: 1,
        flowJson: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      });
      const cfg = readJson(LS.config, defaultConfig());
      writeJson(LS.config, { ...cfg, lastProjectId: meta.id, updatedAt: t });
      return meta;
    },
    async getProject(id) {
      return readJson<LocalProjectMeta[]>(LS.projects, []).find((p) => p.id === id) ?? null;
    },
    async updateProject(id, patch) {
      const all = readJson<LocalProjectMeta[]>(LS.projects, []);
      const idx = all.findIndex((p) => p.id === id);
      if (idx < 0) throw new Error("项目不存在");
      all[idx] = { ...all[idx], ...patch, updatedAt: nowIso() };
      writeJson(LS.projects, all);
      return all[idx];
    },
    async deleteProject(id) {
      const all = readJson<LocalProjectMeta[]>(LS.projects, []);
      const idx = all.findIndex((p) => p.id === id);
      if (idx >= 0) {
        all[idx] = { ...all[idx], deletedAt: nowIso(), updatedAt: nowIso() };
        writeJson(LS.projects, all);
      }
      localStorage.removeItem(LS.workflow(id));
    },
    async readWorkflow(projectId) {
      return readJson(LS.workflow(projectId), null);
    },
    async writeWorkflow(projectId, flow) {
      writeJson(LS.workflow(projectId), flow);
      const all = readJson<LocalProjectMeta[]>(LS.projects, []);
      const idx = all.findIndex((p) => p.id === projectId);
      if (idx >= 0) {
        all[idx] = { ...all[idx], updatedAt: nowIso() };
        writeJson(LS.projects, all);
      }
    },
    async writeAsset(projectId, fileName, base64) {
      const key = `jm_local_asset_${projectId}_${fileName}`;
      localStorage.setItem(key, base64);
      return {
        path: key,
        fileUrl: `data:application/octet-stream;base64,${base64}`,
      };
    },
    async readAssetAsDataUrl(projectId, fileName) {
      const key = `jm_local_asset_${projectId}_${fileName}`;
      const b64 = localStorage.getItem(key);
      if (!b64) return null;
      return `data:application/octet-stream;base64,${b64}`;
    },
    async listAssets(projectId) {
      const indexKey = `jm_local_assets_index_${projectId}`;
      const indexed = readJson<LocalAssetMeta[]>(indexKey, []);
      const byFile = new Map(indexed.map((a) => [a.fileName, a]));
      const prefix = `jm_local_asset_${projectId}_`;
      const out: LocalAssetMeta[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(prefix)) continue;
        const fileName = k.slice(prefix.length);
        if (!fileName) continue;
        seen.add(fileName);
        const existing = byFile.get(fileName);
        if (existing) {
          out.push(existing);
          continue;
        }
        const stem = fileName.replace(/\.[^.]+$/, "") || fileName;
        const b64 = localStorage.getItem(k) || "";
        out.push({
          id: stem,
          fileName,
          title: stem,
          category: "image",
          subcategory: null,
          fileType: "application/octet-stream",
          fileSize: Math.floor((b64.length * 3) / 4),
          createdAt: nowIso(),
        });
      }
      for (const meta of indexed) {
        if (!seen.has(meta.fileName)) out.push(meta);
      }
      return out;
    },
    async registerAssetMeta(projectId, meta) {
      const indexKey = `jm_local_assets_index_${projectId}`;
      const list = readJson<LocalAssetMeta[]>(indexKey, []);
      const idx = list.findIndex((a) => a.id === meta.id || a.fileName === meta.fileName);
      if (idx >= 0) list[idx] = { ...list[idx], ...meta };
      else list.unshift(meta);
      writeJson(indexKey, list);
    },
    async deleteAsset(projectId, assetId) {
      const indexKey = `jm_local_assets_index_${projectId}`;
      const list = readJson<LocalAssetMeta[]>(indexKey, []);
      const hit = list.find((a) => a.id === assetId || a.fileName === assetId);
      const fileName = hit?.fileName || assetId;
      localStorage.removeItem(`jm_local_asset_${projectId}_${fileName}`);
      writeJson(
        indexKey,
        list.filter((a) => a.id !== assetId && a.fileName !== fileName)
      );
    },
    async readNodeText(projectId, nodeId) {
      const key = `jm_local_text_${projectId}_${nodeId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { content?: string };
        return typeof parsed.content === "string" ? parsed.content : raw;
      } catch {
        return raw;
      }
    },
    async writeNodeText(projectId, nodeId, content, model) {
      const key = `jm_local_text_${projectId}_${nodeId}`;
      writeJson(key, { content, model, updatedAt: nowIso() });
    },
    async readUserOss() {
      return {
        ...defaultUserOssConfig(),
        ...readJson<Partial<LocalUserOssConfig>>(LS.userOss, {}),
      };
    },
    async saveUserOss(cfg) {
      writeJson(LS.userOss, { ...cfg, updatedAt: nowIso() });
    },
    async listGenerationJobs() {
      return trimJobs(readJson<LocalGenerationJob[]>(LS.generationJobs, []));
    },
    async appendGenerationJob(input: LocalGenerationJobCreate) {
      const t = nowIso();
      const job: LocalGenerationJob = {
        id: crypto.randomUUID(),
        createdAt: t,
        updatedAt: t,
        status: "running",
        category: input.category,
        modelId: input.modelId,
        modelLabel: input.modelLabel,
        upstreamModel: input.upstreamModel,
        projectId: input.projectId,
        nodeId: input.nodeId,
        promptPreview: promptPreview(input.prompt),
        referenceCount: input.referenceCount ?? 0,
      };
      const list = trimJobs([
        job,
        ...readJson<LocalGenerationJob[]>(LS.generationJobs, []),
      ]);
      writeJson(LS.generationJobs, list);
      return job;
    },
    async updateGenerationJob(id, patch) {
      const list = readJson<LocalGenerationJob[]>(LS.generationJobs, []);
      const idx = list.findIndex((j) => j.id === id);
      if (idx < 0) return null;
      list[idx] = { ...list[idx], ...patch, updatedAt: nowIso() };
      writeJson(LS.generationJobs, trimJobs(list));
      return list[idx];
    },
    async clearGenerationJobs() {
      writeJson(LS.generationJobs, []);
    },
  };
}

/** 统一入口：IPC（需已含 OSS / 任务列表 API）> 本机磁盘 API > localStorage */
export function localStore(): LocalDesktopApi {
  const desktop = getDesktopApi();
  // Electron 旧 preload 可能没有新 API，回退到 /api/local 磁盘实现
  if (
    desktop &&
    typeof desktop.readUserOss === "function" &&
    typeof desktop.listGenerationJobs === "function" &&
    typeof desktop.listAssets === "function"
  ) {
    return desktop;
  }
  if (typeof window !== "undefined") return httpDiskApi();
  return browserLocalStorageApi();
}
