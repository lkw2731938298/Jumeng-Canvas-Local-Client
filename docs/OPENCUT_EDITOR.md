# 剪辑台（可选 · 外挂 OpenCut classic）

本仓库**不包含** OpenCut 源码。画布侧栏「剪辑台」通过 iframe 连接本机上的 OpenCut classic（默认 `http://127.0.0.1:3100`）。

## 使用方式

1. 自行克隆并启动 [opencut-classic](https://github.com/opencut-app/opencut-classic)（或兼容分支），监听 `3100`。
2. 启动本画布：`npm run local` → `http://127.0.0.1:3456`。
3. 在项目中打开「剪辑台」；画布经 postMessage 注入素材，导出成片后回写为视频节点。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_OPENCUT_ORIGIN` | `http://127.0.0.1:3100` | 剪辑台 Origin |

未启动剪辑台时，画布其余功能不受影响；打开剪辑页会提示连接失败。
