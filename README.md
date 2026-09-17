# 聚梦画布 · 本地版（Juming Canvas Local Client）

一个**完全跑在自己电脑上**的 AI 创作画布。浏览器打开、数据存本地磁盘，没有云端账号、没有服务器、没有积分扣费。

你自己填写模型平台的 API Base 和 Key，画布只是把请求转发出去；生成的图片、视频、文本和工程文件全部落在本机目录里。

| | |
|---|---|
| 运行方式 | 本机 Next.js 服务 `http://127.0.0.1:3456` + 系统默认浏览器 |
| 数据位置 | `data/JumengCanvas/`（可在设置里改成任意绝对路径） |
| 依赖服务 | 无。不需要数据库、Docker、登录、联网鉴权 |
| 模型来源 | 任意 OpenAI 兼容网关（聚梦、ComfyUI 及其它）由你自行配置 |
| 许可证 | Apache-2.0 |

## 交流群

**开源无限画布交流 QQ 群：870365376**

使用问题、功能建议、二次开发讨论都欢迎进群。

<img src="docs/qq-group-870365376.png" alt="开源无限画布交流 QQ 群 870365376" width="260">

---

## 快速开始

### 方式 A：免安装完整包（推荐给最终用户）

发布页下载的完整包内已含便携 Node 和全部依赖，**无需安装 Node.js**：

1. 解压到任意目录（路径别带特殊符号）
2. 双击 `启动本机画布.bat`
3. 浏览器自动打开 `http://127.0.0.1:3456/projects`
4. 关闭时双击 `停止本机画布.bat`

### 方式 B：源码运行（开发者）

本仓库即源码，不含 `node_modules` 与便携 Node：

```bash
# 1. 准备 Node.js 20+ LTS（或让脚本下载便携版）
node scripts/ensure-portable-node.mjs

# 2. 安装依赖（Windows 也可双击 首次安装依赖.bat）
npm install

# 3. 启动（Windows 也可双击 启动本机画布.bat）
npm run dev
```

启动后访问 `http://127.0.0.1:3456`。

---

## 目录与文件说明

### 根目录

| 文件 / 目录 | 说明 |
|---|---|
| `启动本机画布.bat` | **主入口**。无窗口启动 Next 服务并打开浏览器；优先用 `runtime\node` 便携 Node，没有则回退系统 Node |
| `停止本机画布.bat` | 按端口查找并结束后台 Next 进程 |
| `首次安装依赖.bat` | 源码包首次使用时安装依赖；必要时自动下载便携 Node |
| `package.json` | monorepo 根配置，声明 `packages/*` 工作区与 `dev` / `build` / `start` 脚本 |
| `package-lock.json` | 依赖锁定，保证各机器装出同一套版本 |
| `config/` | 配置模板目录。仅含 `lan.example.env`（局域网访问示例），真实配置写 `lan.env` 且已被忽略 |
| `scripts/` | 启动与环境准备脚本，见下表 |
| `packages/` | 源码，见下表 |
| `OPENSOURCE.md` | 早期英文说明，保留作历史参考 |
| `.gitignore` | 已排除 `node_modules/`、`data/`、`runtime/node/`、所有 `.env*` 与 `*.pem` / `*.key` |

运行后会自动生成、且**不在仓库里**的目录：

| 目录 | 内容 |
|---|---|
| `data/` | 你的项目、素材、模型配置、API Key，**全部本机私有** |
| `node_modules/` | 依赖 |
| `runtime/node/` | 便携 Node（完整包自带） |
| `packages/web/.next/` | Next 构建缓存 |

### `scripts/` 启动脚本

| 文件 | 职责 |
|---|---|
| `start-browser.mjs` | 核心启动器：清理僵死进程与损坏缓存 → 拉起 `next dev` → 探活 → 打开浏览器 |
| `ensure-portable-node.mjs` | 下载解压便携 Node 到 `runtime/node`，免装系统 Node |
| `detect-lan.mjs` | 探测局域网 IP，供手机 / 平板同网访问 |
| `print-dev-url.mjs` | 打印当前访问地址 |
| `start-desktop-hidden.vbs` | 无控制台窗口启动 bat 的包装 |
| `desktop-alert.vbs` | 启动失败时弹窗提示，指向 `data\desktop-start.log` |

### `packages/` 源码

| 包 | 说明 |
|---|---|
| `packages/web` | **主应用**。Next.js 16 + React 19 + TypeScript + Tailwind 4 |
| `packages/shared` | 跨包共享的类型与常量 |
| `packages/desktop` | 可选 Electron 外壳（`main.js` / `preload.js`），默认不启用，日常走浏览器 |

#### `packages/web/src` 布局

| 目录 | 内容 |
|---|---|
| `app/(app)/` | 页面路由：`projects` 项目列表、`[id]` 画布主界面、`canvas` 画布壳、`jobs` 生成任务记录、`settings` 本地设置 |
| `app/api/local/` | **本机专用接口**，浏览器受限的活都在这里做（见下） |
| `app/api/` 其它 | `assets` 素材、`projects` 项目、`node-text` 节点文本、`storage` 存储、`workflow-presets` 工作流预设、`director-scene` 分镜场景、`proxy` 通用代理 |
| `components/` | UI 组件：`canvas` 画布与节点、`settings` 设置面板、`projects`、`ui` 基础控件等 |
| `lib/local/` | 本地核心逻辑：模型调用、生成编排、任务记录、磁盘存储 |
| `lib/canvas/` | 画布状态、节点连线、生成预设、分镜批处理 |
| `lib/api/` | 前端请求封装与错误码处理 |
| `stores/` | Zustand 状态 |
| `hooks/` `types/` `styles/` | 通用 Hook、类型、样式 |

#### `app/api/local/` 各接口用途

| 路由 | 用途 |
|---|---|
| `upstream` | 向模型平台代发 JSON 请求，绕开浏览器跨域限制 |
| `upstream-multipart` | 代发 multipart 文件上传（参考素材直传） |
| `fetch-media` | 服务端拉取跨域媒体，规避 CORS |
| `ref-preview` | 预览实际提交给上游的参考图（不带页面 Referer） |
| `asset` | 读写本机素材文件 |
| `oss-upload` / `oss-test` | 可选的「参考图 OSS」上传与连通性测试 |
| `temp-public-url` | 为本机文件生成临时可访问地址 |

#### `lib/local/` 关键模块

| 文件 | 职责 |
|---|---|
| `generate.ts` | 生成主链路：构造请求体、处理参考素材、调用上游、轮询异步任务、错误归因 |
| `generationJobs.ts` | 本机任务记录的数据结构与读写 |
| `withLocalGenerationJob.ts` | 生成任务的统一包装，成功失败都落盘便于排查 |
| `modelGenerationCaps.ts` | 各模型支持的清晰度、比例、尺寸提交方式 |
| `serverDiskStore.ts` | 磁盘存储实现（项目、素材、配置） |
| `endpointHelpers.ts` | API Base 拼接与平台识别 |

---

## 配置说明

所有配置都在 **设置** 页完成，不预置任何厂商密钥。

### 1. 供应商

填 API Base 与 Key。任意 OpenAI 兼容网关均可。

以聚梦为例，按所在地区选站点注册取 Key：

| 站点 | 地址 | Base 填写 |
|---|---|---|
| 国内站 | https://www.jumengai.com/ | `https://www.jumengai.com/v1` |
| 海外站 | https://www.jumai.ai/ | `https://www.jumai.ai/v1` |

**Base 必须带 `/v1`**，实际请求会变成 `…/v1/images/generations`、`…/v1/chat/completions`、`…/v1/video/generations`。参见 [Base URL 文档](https://doc.jumengai.com/api/base-url)。

两个站点的账号与额度相互独立，Key 不通用。

### 2. 模型目录

按文本 / 图片 / 视频 / 音频分别添加模型，绑定到某个供应商。支持 OpenAI 兼容格式，也支持自定义 HTTP 模板。

### 3. 工具默认模型

把画布上各个工具（扩图、抠图、分镜等）绑定到已配置的模型。

配置分别持久化为 `providers.json`、`models.json`、`toolModels.json`，存在你的数据目录里。

### 4. 参考图 OSS（可选但强烈建议）

图生图、图生视频需要把本机图片变成**公网可访问的直链**才能交给模型平台。三种途径按优先级：

1. **已配置参考图 OSS** → 上传拿永久直链，最稳
2. **聚梦官方文件上传** → 免配置，自动换 1 小时有效直链（需账号已实名认证）
3. **base64 内联** → 兜底，但不少通道明确拒收

配置自己的阿里云 OSS（公共读）后，所有平台的参考素材都不再受限。

---

## 常见问题

**启动失败，弹窗让我看 `data\desktop-start.log`**
打开该日志看 Next 的真实退出原因。多数是端口 3456 被占用，或依赖不完整（跑一次 `首次安装依赖.bat`）。

**提示「参考图 URL 必须以 http:// 或 https:// 开头」**
该模型通道只收公网直链、拒绝 base64。按上面第 4 点配置参考图 OSS，或完成平台实名认证以启用官方文件上传。

**提示「聚梦账号未实名认证」**
官方文件上传接口要求实名。去平台控制台完成实名，或改用自己的 OSS。

**提示「上游请求超时」**
请求已发出但上游超时未返回。错误信息里会带上端点、请求体大小和参考来源：若显示 `base64(约 xMB)` 说明参考没转成直链拖慢了上传；若显示某个 OSS 域名则是模型本身慢。可到**生成任务**页点「同步」手动取回结果，或开启「自动轮询」等待。

**换了电脑，数据怎么迁移**
整个 `data/` 目录拷过去即可，里面就是全部项目和配置。

---

## 隐私与安全

- API Key、项目、素材**只存在你本机的数据目录**，本程序不会上传到任何第三方
- 仓库已通过 `.gitignore` 排除 `data/`、`.env*`、`config/lan.env`、`*.pem`、`*.key`
- 若要二次分发，请勿把**正在使用的**运行目录整包打出去——里面有你填好的 Key 和 OSS 配置
- 局域网访问会让同网段设备都能打开你的画布，在不可信网络下慎用

---

## 技术栈

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Zustand · React Flow (@xyflow) · Three.js · TanStack Query

## 相关链接

| | |
|---|---|
| 交流 QQ 群 | 870365376 |
| 聚梦 API 国内站 | https://www.jumengai.com/ |
| 聚梦 API 海外站 | https://www.jumai.ai/ |
| 聚梦 API 文档 | https://doc.jumengai.com/api/base-url |

## 许可证

[Apache License 2.0](LICENSE)
