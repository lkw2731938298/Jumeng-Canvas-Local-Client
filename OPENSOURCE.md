# Open Canvas · local browser harness

Local single-user copy: **WebUI in browser**, data on **local disk** (like a DeepSeek-style harness).  
No cloud API, Docker, admin, login, credits, or Alipay. Electron is optional and not used by default.

## Runtime

```
启动本机画布.bat   (double-click, no console window)
  → Next on http://127.0.0.1:3456
  → open default browser /projects
  → read/write ./data/JumengCanvas/ via /api/local
停止本机画布.bat   (stop the background Next process)
```

Packages: `web` / `shared`.

## Quick start

### A. 完整免安装分享包（推荐给最终用户）
1. 解压后直接双击 `启动本机画布.bat`
2. 包内已含 `runtime\node`（便携 Node）与 `node_modules`，**无需安装系统 Node.js**

### B. 源码包（开发者）
1. 安装 Node.js 20+ LTS，或运行 `node scripts/ensure-portable-node.mjs` 下载便携 Node
2. 双击 `首次安装依赖.bat`
3. 双击 `启动本机画布.bat`
4. To stop: double-click `停止本机画布.bat`

Data directory: `data/JumengCanvas/`  
（可在 **高级设置 → 数据位置** 改为其它绝对路径；指针文件：`data/jumeng-data-location.json`）

## Settings (no vendor presets)

Users configure platforms themselves:

1. **供应商** — API Base / Key（任意 OpenAI 兼容或其它网关）
   - 聚梦 / ComfyUI：按 [Base URL 文档](https://doc.jumengai.com/api/base-url) 填 `https://www.jumengai.com/v1`（**须含 `/v1`**）
   - 实际请求形如 `…/v1/images/generations`、`…/v1/chat/completions`、`…/v1/video/generations`
2. **模型目录** — 按文本/图片/视频/音频自行添加；OpenAI 兼容或自定义 HTTP 模板
3. **工具默认模型** — 各画布工具绑定本地模型内部名

Persisted: `providers.json`, `models.json`, `toolModels.json`.

## 公开仓库注意

- **不要**提交 `data/`、`.env` / `.env.local`、`config/lan.env`（已写入 `.gitignore`）。密钥只存在用户本机数据目录。
- 公开的应是本目录源码；不要把正在使用的桌面运行文件夹（含已填 Key / OSS）整包上传。
- 本副本不预置运营活动与密钥；聚梦为可选公开 API，服务器/数据库/密钥须自行填写，勿把生产环境文件打进包。
- `https://www.jumengai.com` / `https://doc.jumengai.com` 是公开 API 文档，不是内网地址。
