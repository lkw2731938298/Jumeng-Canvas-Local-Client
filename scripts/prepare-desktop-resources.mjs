/**
 * 将 Next standalone + static/public + 便携 Node 整理到 packages/desktop/resources/
 * 供 electron-builder extraResources 打包进安装目录。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webDir = path.join(root, "packages", "web");
const desktopDir = path.join(root, "packages", "desktop");
const resourcesDir = path.join(desktopDir, "resources");
const outWeb = path.join(resourcesDir, "web");
const outNode = path.join(resourcesDir, "node");

function log(msg) {
  console.log(`[prepare-desktop] ${msg}`);
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function findServerJs(standaloneRoot) {
  const candidates = [
    path.join(standaloneRoot, "packages", "web", "server.js"),
    path.join(standaloneRoot, "server.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  const walk = (dir, depth = 0) => {
    if (depth > 4) return null;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && name === "server.js") return full;
      if (st.isDirectory() && name !== "node_modules") {
        const hit = walk(full, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(standaloneRoot);
}

function main() {
  const standaloneRoot = path.join(webDir, ".next", "standalone");
  if (!fs.existsSync(standaloneRoot)) {
    console.error("缺少 packages/web/.next/standalone，请先 JUMENG_DESKTOP_BUILD=1 npm run build -w @jumeng-canvas/web");
    process.exit(1);
  }

  const serverJs = findServerJs(standaloneRoot);
  if (!serverJs) {
    console.error("standalone 内未找到 server.js");
    process.exit(1);
  }
  log(`server.js → ${serverJs}`);

  rmrf(resourcesDir);
  fs.mkdirSync(resourcesDir, { recursive: true });
  copyDir(standaloneRoot, outWeb);

  const serverRel = path.relative(standaloneRoot, serverJs);
  const serverDest = path.join(outWeb, serverRel);
  const serverCwd = path.dirname(serverDest);

  // Next standalone 需旁路静态资源
  const staticSrc = path.join(webDir, ".next", "static");
  if (fs.existsSync(staticSrc)) {
    const staticDest = path.join(serverCwd, ".next", "static");
    copyDir(staticSrc, staticDest);
    log(`copied .next/static → ${staticDest}`);
  }
  const publicSrc = path.join(webDir, "public");
  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(serverCwd, "public");
    copyDir(publicSrc, publicDest);
    log(`copied public → ${publicDest}`);
  }

  // 便携 Node
  const ensure = spawnSync(process.execPath, [path.join(root, "scripts", "ensure-portable-node.mjs")], {
    cwd: root,
    stdio: "inherit",
  });
  if (ensure.status !== 0) {
    console.error("ensure-portable-node 失败");
    process.exit(ensure.status || 1);
  }
  const nodeHome = path.join(root, "runtime", "node");
  if (!fs.existsSync(path.join(nodeHome, "node.exe")) && !fs.existsSync(path.join(nodeHome, "bin", "node"))) {
    console.error("runtime/node 不完整");
    process.exit(1);
  }
  copyDir(nodeHome, outNode);
  log(`copied portable node → ${outNode}`);

  // 便携 ffmpeg（视频切断用，避免依赖系统安装 / 浏览器录制）
  const ensureFfmpeg = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "ensure-portable-ffmpeg.mjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (ensureFfmpeg.status !== 0) {
    console.warn("[prepare-desktop] 便携 ffmpeg 准备失败：安装包仍可运行，切断将尝试首次联网下载");
  } else {
    const ffmpegDir = path.join(resourcesDir, "ffmpeg");
    if (fs.existsSync(path.join(ffmpegDir, "ffmpeg.exe"))) {
      log(`portable ffmpeg ready → ${ffmpegDir}`);
    }
  }

  // 写入启动元数据，供 Electron 主进程定位
  const meta = {
    serverRel: serverRel.replace(/\\/g, "/"),
    version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version,
  };
  fs.writeFileSync(path.join(outWeb, "jumeng-desktop-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  log("done");
}

main();
