/**
 * Windows NSIS 安装包一键构建：
 * 1) Next standalone 生产构建
 * 2) 整理 resources（web + 便携 Node）
 * 3) electron-builder --win
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const desktopDir = path.join(root, "packages", "desktop");

function run(cmd, args, env = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}\n`);
  // Windows：仅 npm.cmd 需要 shell；node.exe 若开 shell 会把「Program Files」路径拆坏
  const useShell =
    process.platform === "win32" &&
    (/\.cmd$/i.test(cmd) || /\.bat$/i.test(cmd));
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: useShell,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function syncDesktopVersion() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const deskPath = path.join(desktopDir, "package.json");
  const desk = JSON.parse(fs.readFileSync(deskPath, "utf8"));
  desk.version = rootPkg.version;
  desk.productName = desk.productName || "聚梦无限画布";
  fs.writeFileSync(deskPath, `${JSON.stringify(desk, null, 2)}\n`, "utf8");
  console.log(`[dist-win] desktop version → ${desk.version}`);
}

/** 避免 electron-builder 在 workspace 包内再跑 npm install --production 拆掉根 node_modules */
function ensureDesktopNodeModulesStub() {
  const deskNm = path.join(desktopDir, "node_modules");
  fs.mkdirSync(deskNm, { recursive: true });
  fs.writeFileSync(path.join(deskNm, ".keep"), "", "utf8");
  const rootElectron = path.join(root, "node_modules", "electron");
  const linkElectron = path.join(deskNm, "electron");
  if (fs.existsSync(rootElectron) && !fs.existsSync(linkElectron)) {
    try {
      fs.symlinkSync(rootElectron, linkElectron, "junction");
      console.log("[dist-win] junction electron → packages/desktop/node_modules/electron");
    } catch (e) {
      console.warn("[dist-win] electron junction 失败（可忽略）:", e && e.message ? e.message : e);
    }
  }
}

function main() {
  syncDesktopVersion();
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["run", "build", "-w", "@jumeng-canvas/web"], {
    JUMENG_DESKTOP_BUILD: "1",
    NEXT_PUBLIC_STORAGE_URL_MODE: "proxy",
    NEXT_PUBLIC_LOCAL_DESKTOP: "1",
    NEXT_PUBLIC_ADMIN_AUTH_DISABLED: "true",
    NODE_ENV: "production",
  });
  run(process.execPath, [path.join(root, "scripts", "prepare-desktop-resources.mjs")]);
  ensureDesktopNodeModulesStub();
  // 直接调 CLI，避免 workspace lifecycle 再触发奇怪的 install
  const ebCli = path.join(root, "node_modules", "electron-builder", "cli.js");
  if (!fs.existsSync(ebCli)) {
    console.error("缺少 electron-builder，请先在仓库根目录执行: npm install");
    process.exit(1);
  }
  process.chdir(desktopDir);
  run(process.execPath, [ebCli, "--win", "--x64"], {
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  });
  console.log("\n[dist-win] 完成。安装包在 packages/desktop/dist/（含 JumengCanvas-Setup-*.exe）");
}

main();
