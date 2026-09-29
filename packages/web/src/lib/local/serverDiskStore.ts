/**
 * 本机磁盘存储（Harness 模式）：Next 服务端读写 data/JumengCanvas。
 * 浏览器通过 /api/local 调用，不依赖 Electron。
 * 实际根目录可由用户在设置里改（引导文件 jumeng-data-location.json）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
} from "./types";
import { emptyToolModelsMap, normalizeToolModelsMap } from "./canvasToolDefs";
import type { LocalToolModelsMap } from "./canvasToolDefs";
import { defaultUserOssConfig } from "./userOssConfig";
import { promptPreview, trimJobs } from "./generationJobs";
import {
  getDataLocationInfo,
  pickDirectoryDialog,
  resetDataRootToDefault,
  resolveActiveDataRoot,
  setActiveDataRoot,
} from "./dataLocation";

function nowIso() {
  return new Date().toISOString();
}

function defaultConfig(): LocalAppConfig {
  const t = nowIso();
  return { version: 1, lastProjectId: null, createdAt: t, updatedAt: t };
}

function resolveDataRoot() {
  return resolveActiveDataRoot();
}

function readJson<T>(fp: string, fallback: T): T {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(fp: string, value: unknown) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(value, null, 2), "utf8");
}

function safeName(name: string) {
  const base = path.basename(name);
  if (!base || base === "." || base === "..") throw new Error("非法文件名");
  return base;
}

function guessCategory(fileName: string): LocalAssetMeta["category"] {
  const lower = fileName.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(lower)) return "image";
  if (/\.(mp4|webm|mov|mkv)$/.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(lower)) return "audio";
  if (/\.(glb|gltf)$/.test(lower)) return "model";
  return "document";
}

function guessFileType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  return "application/octet-stream";
}

function assetIndexPath(fp: (...parts: string[]) => string, projectId: string) {
  return fp("projects", projectId, "assets", "index.json");
}

function readAssetIndex(fp: (...parts: string[]) => string, projectId: string): LocalAssetMeta[] {
  return readJson<LocalAssetMeta[]>(assetIndexPath(fp, projectId), []);
}

function writeAssetIndex(
  fp: (...parts: string[]) => string,
  projectId: string,
  items: LocalAssetMeta[]
) {
  writeJson(assetIndexPath(fp, projectId), items);
}

/** 扫描磁盘素材并与 index.json 合并（生成结果可能只有文件无索引） */
function listAssetsOnDisk(fp: (...parts: string[]) => string, projectId: string): LocalAssetMeta[] {
  const dir = fp("projects", projectId, "assets");
  const indexed = readAssetIndex(fp, projectId);
  const byFile = new Map(indexed.map((a) => [a.fileName, a]));
  if (!fs.existsSync(dir)) return indexed;
  const out: LocalAssetMeta[] = [];
  const seen = new Set<string>();
  for (const name of fs.readdirSync(dir)) {
    if (name === "index.json" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    seen.add(name);
    const existing = byFile.get(name);
    if (existing) {
      out.push({ ...existing, fileSize: existing.fileSize || st.size });
      continue;
    }
    const stem = name.replace(/\.[^.]+$/, "") || name;
    out.push({
      id: stem,
      fileName: name,
      title: stem,
      category: guessCategory(name),
      subcategory: null,
      fileType: guessFileType(name),
      fileSize: st.size,
      createdAt: st.mtime.toISOString(),
    });
  }
  // 索引里有但文件已丢的条目仍返回，便于前端发现坏链
  for (const meta of indexed) {
    if (!seen.has(meta.fileName)) out.push(meta);
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

/** 服务端磁盘实现，与 LocalDesktopApi 对齐 */
export function createServerDiskStore(): LocalDesktopApi {
  const root = () => resolveDataRoot();
  const fp = (...parts: string[]) => path.join(root(), ...parts);

  return {
    async getDataRoot() {
      return root();
    },
    async getDataLocationInfo() {
      return getDataLocationInfo();
    },
    async pickDataDirectory(initialDir) {
      return pickDirectoryDialog(initialDir);
    },
    async setDataLocation(rawPath, opts) {
      return setActiveDataRoot(rawPath, opts);
    },
    async resetDataLocation(opts) {
      return resetDataRootToDefault(opts);
    },
    async readConfig() {
      return readJson(fp("config.json"), defaultConfig());
    },
    async writeConfig(cfg) {
      writeJson(fp("config.json"), { ...cfg, updatedAt: nowIso() });
    },
    async listProviders() {
      return readJson<LocalProvider[]>(fp("providers.json"), []);
    },
    async saveProviders(items) {
      writeJson(fp("providers.json"), items || []);
    },
    async listModels() {
      return readJson<LocalModel[]>(fp("models.json"), []);
    },
    async saveModels(items) {
      writeJson(fp("models.json"), items || []);
    },
    async readToolModels() {
      return normalizeToolModelsMap(readJson(fp("toolModels.json"), emptyToolModelsMap()));
    },
    async saveToolModels(map: LocalToolModelsMap) {
      writeJson(fp("toolModels.json"), {
        version: 1,
        tools: normalizeToolModelsMap(map),
      });
    },
    async listProjects() {
      const projectsDir = fp("projects");
      if (!fs.existsSync(projectsDir)) return [];
      const out: LocalProjectMeta[] = [];
      for (const name of fs.readdirSync(projectsDir)) {
        const meta = readJson<LocalProjectMeta | null>(
          path.join(projectsDir, name, "project.json"),
          null
        );
        if (meta && !meta.deletedAt) out.push(meta);
      }
      out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return out;
    },
    async createProject(title) {
      const id = randomUUID();
      const t = nowIso();
      const meta: LocalProjectMeta = {
        id,
        title: title || "未命名项目",
        createdAt: t,
        updatedAt: t,
        deletedAt: null,
      };
      const dir = fp("projects", id);
      fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
      writeJson(path.join(dir, "project.json"), meta);
      writeJson(path.join(dir, "workflow.json"), {
        id: randomUUID(),
        projectId: id,
        revision: 1,
        flowJson: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      });
      const cfg = readJson(fp("config.json"), defaultConfig());
      writeJson(fp("config.json"), { ...cfg, lastProjectId: id, updatedAt: t });
      return meta;
    },
    async getProject(id) {
      return readJson(fp("projects", id, "project.json"), null);
    },
    async updateProject(id, patch) {
      const file = fp("projects", id, "project.json");
      const cur = readJson<LocalProjectMeta | null>(file, null);
      if (!cur) throw new Error("项目不存在");
      const next = { ...cur, ...patch, updatedAt: nowIso() };
      writeJson(file, next);
      return next;
    },
    async deleteProject(id) {
      const file = fp("projects", id, "project.json");
      const cur = readJson<LocalProjectMeta | null>(file, null);
      if (!cur) return;
      writeJson(file, { ...cur, deletedAt: nowIso(), updatedAt: nowIso() });
    },
    async readWorkflow(projectId) {
      return readJson(fp("projects", projectId, "workflow.json"), null);
    },
    async writeWorkflow(projectId, flow) {
      writeJson(fp("projects", projectId, "workflow.json"), flow);
      const file = fp("projects", projectId, "project.json");
      const cur = readJson<LocalProjectMeta | null>(file, null);
      if (cur) writeJson(file, { ...cur, updatedAt: nowIso() });
    },
    async writeAsset(projectId, fileName, base64) {
      const name = safeName(fileName);
      const dir = fp("projects", projectId, "assets");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.from(base64, "base64"));
      return {
        path: file,
        fileUrl: `/api/local/asset?projectId=${encodeURIComponent(projectId)}&file=${encodeURIComponent(name)}`,
      };
    },
    async readAssetAsDataUrl(projectId, fileName) {
      const name = safeName(fileName);
      const file = fp("projects", projectId, "assets", name);
      if (!fs.existsSync(file)) return null;
      const buf = fs.readFileSync(file);
      return `data:application/octet-stream;base64,${buf.toString("base64")}`;
    },
    async listAssets(projectId) {
      return listAssetsOnDisk(fp, projectId);
    },
    async registerAssetMeta(projectId, meta) {
      const name = safeName(meta.fileName);
      const list = readAssetIndex(fp, projectId);
      const next: LocalAssetMeta = {
        id: String(meta.id || name.replace(/\.[^.]+$/, "") || name),
        fileName: name,
        title: String(meta.title || name),
        category: meta.category || guessCategory(name),
        subcategory: meta.subcategory ?? null,
        fileType: String(meta.fileType || guessFileType(name)),
        fileSize: Number(meta.fileSize || 0),
        createdAt: String(meta.createdAt || nowIso()),
      };
      const idx = list.findIndex((a) => a.id === next.id || a.fileName === next.fileName);
      if (idx >= 0) list[idx] = { ...list[idx], ...next };
      else list.unshift(next);
      writeAssetIndex(fp, projectId, list);
    },
    async deleteAsset(projectId, assetId) {
      const key = String(assetId || "").trim();
      if (!key) return;
      const list = readAssetIndex(fp, projectId);
      const hit =
        list.find((a) => a.id === key || a.fileName === key) ||
        list.find((a) => a.fileName === safeName(key));
      const fileName = hit?.fileName || safeName(key);
      const file = fp("projects", projectId, "assets", fileName);
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          /* 忽略删除失败，仍清索引 */
        }
      }
      writeAssetIndex(
        fp,
        projectId,
        list.filter((a) => a.id !== key && a.fileName !== fileName)
      );
    },
    async readNodeText(projectId, nodeId) {
      const raw = readJson<{ content?: string } | null>(
        fp("projects", projectId, "text", `${safeName(nodeId)}.json`),
        null
      );
      if (!raw) return null;
      return typeof raw.content === "string" ? raw.content : null;
    },
    async writeNodeText(projectId, nodeId, content, model) {
      const dir = fp("projects", projectId, "text");
      fs.mkdirSync(dir, { recursive: true });
      writeJson(path.join(dir, `${safeName(nodeId)}.json`), {
        content: String(content ?? ""),
        model: String(model ?? ""),
        updatedAt: nowIso(),
      });
    },
    async readUserOss() {
      const raw = readJson<Partial<LocalUserOssConfig> | null>(fp("user-oss.json"), null);
      return { ...defaultUserOssConfig(), ...(raw || {}) };
    },
    async saveUserOss(cfg) {
      const prev = readJson<Partial<LocalUserOssConfig> | null>(fp("user-oss.json"), null);
      const incomingSecret = (cfg.accessKeySecret || "").trim();
      const next: LocalUserOssConfig = {
        ...defaultUserOssConfig(),
        ...(prev || {}),
        ...cfg,
        // 表单留空 Secret 时保留磁盘里已有的，避免保存把密钥冲掉
        accessKeySecret: incomingSecret || (prev?.accessKeySecret || ""),
        updatedAt: nowIso(),
      };
      writeJson(fp("user-oss.json"), next);
    },
    async listGenerationJobs() {
      return trimJobs(readJson<LocalGenerationJob[]>(fp("generation-jobs.json"), []));
    },
    async appendGenerationJob(input: LocalGenerationJobCreate) {
      const t = nowIso();
      const job: LocalGenerationJob = {
        id: randomUUID(),
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
      const list = trimJobs([job, ...readJson<LocalGenerationJob[]>(fp("generation-jobs.json"), [])]);
      writeJson(fp("generation-jobs.json"), list);
      return job;
    },
    async updateGenerationJob(id, patch) {
      const list = readJson<LocalGenerationJob[]>(fp("generation-jobs.json"), []);
      const idx = list.findIndex((j) => j.id === id);
      if (idx < 0) return null;
      const next: LocalGenerationJob = {
        ...list[idx],
        ...patch,
        updatedAt: nowIso(),
      };
      list[idx] = next;
      writeJson(fp("generation-jobs.json"), trimJobs(list));
      return next;
    },
    async clearGenerationJobs() {
      writeJson(fp("generation-jobs.json"), []);
    },
    // 本地 Agent 会话：存项目目录下，随项目一起迁移/删除
    async readAgentSession(projectId: string) {
      return readJson<unknown | null>(
        fp("projects", safeName(projectId), "agent-session.json"),
        null
      );
    },
    async writeAgentSession(projectId: string, session: unknown) {
      writeJson(fp("projects", safeName(projectId), "agent-session.json"), session ?? null);
    },
    /**
     * 扫描 dataRoot/agent-skills + ~/.codex/skills
     */
    async listAgentSkills() {
      const { listDiskAgentSkills, ensureAgentSkillsDir } = await import(
        "@/lib/local/agent/skills/disk"
      );
      ensureAgentSkillsDir(resolveDataRoot());
      return listDiskAgentSkills(resolveDataRoot()).map(({ dir: _d, ...m }) => m);
    },
    async readAgentSkill(slug: string) {
      const { readDiskAgentSkill } = await import("@/lib/local/agent/skills/disk");
      const disk = readDiskAgentSkill(resolveDataRoot(), slug);
      if (!disk) return null;
      return {
        slug: disk.slug,
        name: disk.name,
        description: disk.description,
        body: disk.body,
        references: disk.references,
        source: disk.source,
      };
    },
    async getAgentSkillsInfo() {
      const { agentSkillsDir, codexSkillsDir, ensureAgentSkillsDir } = await import(
        "@/lib/local/agent/skills/disk"
      );
      const dataRoot = resolveDataRoot();
      const localDir = ensureAgentSkillsDir(dataRoot);
      const codexDir = codexSkillsDir();
      return {
        localDir,
        codexDir,
        codexExists: fs.existsSync(codexDir),
      };
    },
    async openAgentSkillsDir() {
      const { ensureAgentSkillsDir, openDirectoryInOs } = await import(
        "@/lib/local/agent/skills/disk"
      );
      const dir = ensureAgentSkillsDir(resolveDataRoot());
      openDirectoryInOs(dir);
      return { ok: true as const, dir };
    },
    async listCodexSkills() {
      const { listCodexSkillsOnly } = await import("@/lib/local/agent/skills/disk");
      return listCodexSkillsOnly().map(({ dir: _d, ...m }) => m);
    },
    async importCodexSkills(slugs: string[]) {
      const { importCodexSkillsToLocal } = await import("@/lib/local/agent/skills/disk");
      const list = Array.isArray(slugs) ? slugs.map(String) : [];
      return importCodexSkillsToLocal(resolveDataRoot(), list);
    },
  };
}

export function readAssetFile(projectId: string, fileName: string): Buffer | null {
  const name = safeName(fileName);
  const file = path.join(resolveDataRoot(), "projects", projectId, "assets", name);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/** 导演台场景记录（本地版存磁盘：projects/{projectId}/director/{nodeId}.json） */
export type LocalDirectorSceneRecord = {
  projectId: string;
  nodeId: string;
  scene: unknown;
  /** 与线上版字段对齐（节点参数 sceneStateKey 引用），本地为相对路径 */
  ossKey: string;
  updatedAt: string;
};

function directorSceneFile(projectId: string, nodeId: string) {
  return path.join(resolveDataRoot(), "projects", safeName(projectId), "director", `${safeName(nodeId)}.json`);
}

export function readDirectorSceneFile(projectId: string, nodeId: string): LocalDirectorSceneRecord | null {
  return readJson<LocalDirectorSceneRecord | null>(directorSceneFile(projectId, nodeId), null);
}

export function writeDirectorSceneFile(projectId: string, nodeId: string, scene: unknown): LocalDirectorSceneRecord {
  const record: LocalDirectorSceneRecord = {
    projectId,
    nodeId,
    scene,
    ossKey: `projects/${safeName(projectId)}/director/${safeName(nodeId)}.json`,
    updatedAt: new Date().toISOString(),
  };
  writeJson(directorSceneFile(projectId, nodeId), record);
  return record;
}
