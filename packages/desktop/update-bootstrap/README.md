# JumengCanvas-Update（应用内更新引导包）

给 **0.1.19 及更早** 安装包用：它们会静默执行 `latest.json.setupUrl` 指向的 exe（`/S --force-run`）。

本引导包（约 12KB）会：

1. 显示进度窗口（避免用户以为「闪退失败」）
2. 等待「聚梦无限画布」进程退出（最多 90 秒）
3. 从 OSS 下载 **完整** `JumengCanvas-Setup.exe`（URL 写死，不读 setupUrl，防递归）
4. 校验大小与 MZ 头后安装；静默失败则改开可见向导
5. 必要时拉起应用

## 编译

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packages/desktop/update-bootstrap/build.ps1
```

产物：`packages/desktop/update-bootstrap/dist/JumengCanvas-Update.exe`

## 发布

1. 复制到 `ai_read/jumeng_Relay_Station/website/downloads/JumengCanvas-Update.exe`
2. `latest.json` 的 `setupUrl` / `setupName` 指向 Update；`fullSetupUrl` 仍为完整 Setup
3. `python canvas/scripts/deploy/_relay_upload_canvas_update_bootstrap_oss.py`

官网「立即下载」继续用完整 Setup，不要改成 Update。
