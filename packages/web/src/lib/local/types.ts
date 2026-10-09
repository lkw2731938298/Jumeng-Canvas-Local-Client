/**
 * 本地桌面：模型 / 供应商 / 项目 / 工具默认模型 类型。
 */

import type { GenerationPresetsConfig } from "@/types/generationPresets";
import type { LocalToolModelsMap } from "./canvasToolDefs";
import type { LocalUserOssConfig } from "./userOssConfig";
import type { LocalGenerationJob, LocalGenerationJobCreate } from "./generationJobs";
import type { JumengDataLocationInfo, SetDataLocationOpts } from "./dataLocation";
import type { ModelCanvasCaps } from "./modelGenerationCaps";

export type { LocalUserOssConfig, LocalUserOssConfigPublic, LocalOssUrlMode } from "./userOssConfig";
export type { JumengDataLocationInfo, SetDataLocationOpts } from "./dataLocation";
export type {
  LocalGenerationJob,
  LocalGenerationJobCreate,
  LocalGenerationJobStatus,
  LocalGenerationJobCategory,
  LocalGenerationJobPatch,
} from "./generationJobs";

/** model3d：3D 模型生成（如 Tripo，经 /v1/videos 异步任务，产出 GLB，供导演台使用） */
export type LocalModelCategory = "text" | "image" | "video" | "audio" | "model3d";

export type LocalEndpointMode = "openai_compatible" | "custom_template";

/** 供应商密钥（可被多个模型引用） */
export interface LocalProvider {
  id: string;
  name: string;
  apiBase: string;
  apiKey: string;
}

/** 用户自配第三方模型（原后台模型目录的用户侧等价物） */
export interface LocalModel {
  id: string;
  name: string;
  displayName: string;
  category: LocalModelCategory;
  mode: LocalEndpointMode;
  /** 引用 LocalProvider.id；也可直接在模型上写 apiKey */
  providerId?: string;
  apiBase?: string;
  apiKey?: string;
  /** OpenAI 兼容：上游 model 字段 */
  upstreamModel?: string;
  /** 自定义模板 */
  method?: "GET" | "POST" | "PUT";
  url?: string;
  headersJson?: string;
  bodyTemplate?: string;
  /** 从 JSON 响应取值的点分路径 */
  responsePath?: string;
  enabled?: boolean;
  sortOrder?: number;
  description?: string;
  /** 画布生成选项（比例/时长等），原后台 generationPresets */
  generationPresets?: GenerationPresetsConfig;
  /**
   * 画布能力声明（清晰度/时长/映射）。有值时优先于规则表；
   * 未设置则运行时按 presets → 规则表 → 安全兜底解析。
   */
  canvasCaps?: ModelCanvasCaps;
}

export interface LocalAppConfig {
  version: 1;
  lastProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalProjectMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  /** 项目封面：本机为 /api/local/asset 地址，localStorage 兜底为 data URL */
  coverUrl?: string | null;
}

/** 本机素材索引（不依赖独立 API 进程） */
export type LocalAssetCategory = "image" | "video" | "audio" | "document" | "model";

export interface LocalAssetMeta {
  id: string;
  fileName: string;
  title: string;
  category: LocalAssetCategory;
  subcategory: string | null;
  fileType: string;
  fileSize: number;
  createdAt: string;
}

export interface LocalDesktopApi {
  getDataRoot: () => Promise<string>;
  /** 数据/素材保存位置详情 */
  getDataLocationInfo: () => Promise<JumengDataLocationInfo>;
  /** 系统文件夹选择框；取消返回 null */
  pickDataDirectory: (initialDir?: string) => Promise<string | null>;
  /** 迁移到新数据根；默认迁移后删除旧目录 */
  setDataLocation: (
    rawPath: string,
    opts?: SetDataLocationOpts
  ) => Promise<JumengDataLocationInfo>;
  /** 恢复默认 data/JumengCanvas（默认迁回并删旧目录） */
  resetDataLocation: (opts?: SetDataLocationOpts) => Promise<JumengDataLocationInfo>;
  readConfig: () => Promise<LocalAppConfig>;
  writeConfig: (cfg: LocalAppConfig) => Promise<void>;
  listProviders: () => Promise<LocalProvider[]>;
  saveProviders: (items: LocalProvider[]) => Promise<void>;
  listModels: () => Promise<LocalModel[]>;
  saveModels: (items: LocalModel[]) => Promise<void>;
  /** 画布各工具主/副模型（原后台模型开关） */
  readToolModels: () => Promise<LocalToolModelsMap>;
  saveToolModels: (map: LocalToolModelsMap) => Promise<void>;
  listProjects: () => Promise<LocalProjectMeta[]>;
  createProject: (title: string) => Promise<LocalProjectMeta>;
  getProject: (id: string) => Promise<LocalProjectMeta | null>;
  updateProject: (id: string, patch: Partial<LocalProjectMeta>) => Promise<LocalProjectMeta>;
  deleteProject: (id: string) => Promise<void>;
  readWorkflow: (projectId: string) => Promise<unknown | null>;
  writeWorkflow: (projectId: string, flow: unknown) => Promise<void>;
  writeAsset: (
    projectId: string,
    fileName: string,
    base64: string
  ) => Promise<{ path: string; fileUrl: string }>;
  readAssetAsDataUrl: (projectId: string, fileName: string) => Promise<string | null>;
  /** 列出项目素材（index.json + 磁盘孤儿文件） */
  listAssets: (projectId: string) => Promise<LocalAssetMeta[]>;
  /** 写入/更新素材元数据（上传后登记标题、分类等） */
  registerAssetMeta: (projectId: string, meta: LocalAssetMeta) => Promise<void>;
  /** 按 assetId 或 fileName 删除文件与索引 */
  deleteAsset: (projectId: string, assetId: string) => Promise<void>;
  readNodeText: (projectId: string, nodeId: string) => Promise<string | null>;
  writeNodeText: (
    projectId: string,
    nodeId: string,
    content: string,
    model: string
  ) => Promise<void>;
  /** 用户自配公网 OSS（仅生成参考用） */
  readUserOss: () => Promise<LocalUserOssConfig>;
  saveUserOss: (cfg: LocalUserOssConfig) => Promise<void>;
  /** 本机生成任务列表 */
  listGenerationJobs: () => Promise<LocalGenerationJob[]>;
  appendGenerationJob: (input: LocalGenerationJobCreate) => Promise<LocalGenerationJob>;
  updateGenerationJob: (
    id: string,
    patch: Partial<
      Pick<
        LocalGenerationJob,
        | "status"
        | "error"
        | "resultUrlPreview"
        | "upstreamModel"
        | "modelLabel"
        | "referenceCount"
        | "providerTaskId"
        | "submittedReferenceCount"
        | "submittedRefHostPreview"
        | "submittedRefUrls"
      >
    >
  ) => Promise<LocalGenerationJob | null>;
  clearGenerationJobs: () => Promise<void>;
  /** 本地 Agent 会话（按项目持久化，结构由前端 localAgent/session.ts 定义）；Electron 旧 preload 可能缺失 */
  readAgentSession?: (projectId: string) => Promise<unknown | null>;
  writeAgentSession?: (projectId: string, session: unknown) => Promise<void>;
  /** Agent 技能目录（Codex 式 SKILL.md）；可选 */
  listAgentSkills?: () => Promise<
    Array<{ slug: string; name: string; description: string; source?: string }>
  >;
  readAgentSkill?: (slug: string) => Promise<{
    slug: string;
    name: string;
    description: string;
    body: string;
    references?: Record<string, string>;
    source?: string;
  } | null>;
  /** 技能目录路径信息 */
  getAgentSkillsInfo?: () => Promise<{
    localDir: string;
    codexDir: string;
    codexExists: boolean;
  }>;
  /** 在系统文件管理器中打开画布技能目录 */
  openAgentSkillsDir?: () => Promise<{ ok: boolean; dir: string }>;
  /** 列出 ~/.codex/skills（仅供导入勾选） */
  listCodexSkills?: () => Promise<
    Array<{ slug: string; name: string; description: string; source?: string }>
  >;
  /** 把选中的 Codex 技能拷到本机 agent-skills */
  importCodexSkills?: (
    slugs: string[]
  ) => Promise<{
    imported: string[];
    skipped: string[];
    errors: Array<{ slug: string; error: string }>;
  }>;
}

/** Electron 安装包更新（Gitee Releases Setup.exe） */
export type DesktopUpdateCheckResult = {
  localVersion: string;
  remoteVersion: string;
  hasUpdate: boolean;
  canApply: boolean;
  blockedReason?: string;
  repoUrl: string;
  setupName?: string | null;
  setupUrl?: string | null;
  channel?: string;
};

export type DesktopUpdateApplyResult = {
  updated: boolean;
  fromVersion?: string;
  toVersion?: string;
  restarting?: boolean;
  localVersion?: string;
  remoteVersion?: string;
};

export type JumengDesktopBridge = LocalDesktopApi & {
  isPackaged?: () => Promise<boolean>;
  getAppVersion?: () => Promise<string>;
  checkDesktopUpdate?: () => Promise<DesktopUpdateCheckResult>;
  applyDesktopUpdate?: () => Promise<DesktopUpdateApplyResult>;
};

declare global {
  interface Window {
    jumengDesktop?: JumengDesktopBridge;
  }
}

export function getDesktopApi(): JumengDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.jumengDesktop ?? null;
}
