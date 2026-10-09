# OpenCut classic 剪辑台（开源本地）

默认剪辑入口 `/{projectId}/editor` 嵌入 [OpenCut classic](https://github.com/opencut-app/opencut-classic)（MIT，已归档），源码在 `vendor/opencut-classic`。

## 启动

需要两套进程：

```bash
# 终端 1：画布
npm run local
# → http://127.0.0.1:3456

# 终端 2：剪辑台（Bun）
npm run editor:install   # 首次：同步到 C:\oc 并 bun install
npm run editor           # → http://127.0.0.1:3100
```

改 classic 源码后若在 `C:\oc` 工作副本上编辑，执行 `npm run editor:sync` 写回 `vendor/`。

## 闭环

1. 侧栏「剪辑台」→ iframe 打开 `:3100/jumeng/jm-{projectId}`
2. 画布把视频/音频资产 URL 经 postMessage 注入 classic 媒体库
3. classic 自带 Export 成片 → 回传 base64 → 本机 `uploadAsset` → 新建视频节点（`toolMode=opencut_compose`）
4. 工程草稿存在 classic IndexedDB，id 固定为 `jm-{projectId}` 或 `jm-{projectId}--{fromNodeId}`，可再开

## 环境变量

- 画布：`NEXT_PUBLIC_OPENCUT_ORIGIN`（默认 `http://127.0.0.1:3100`）
- classic：`NEXT_PUBLIC_JUMENG_MODE=1`、`NEXT_PUBLIC_JUMENG_CANVAS_ORIGIN=http://127.0.0.1:3456`
