/**
 * 下载便携 Node（Windows x64 zip）到 runtime/node，用户无需安装系统 Node。
 * 用法: node scripts/ensure-portable-node.mjs
 * 若本机已有 node，也可: node scripts/ensure-portable-node.mjs（仍下载到 runtime）
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const runtimeDir = path.join(root, "runtime");
const nodeHome = path.join(runtimeDir, "node");
const marker = path.join(nodeHome, "node.exe");

/** 固定 LTS，便于分享包可复现 */
const NODE_VERSION = process.env.JUMENG_PORTABLE_NODE_VERSION || "v24.20.0";
const ZIP_NAME = `node-${NODE_VERSION}-win-x64.zip`;
const ZIP_URL = `https://nodejs.org/dist/${NODE_VERSION}/${ZIP_NAME}`;

function log(msg) {
  console.log(`[portable-node] ${msg}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const go = (u, redirects = 0) => {
      https
        .get(u, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirects < 5
          ) {
            res.resume();
            go(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            res.resume();
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
        })
        .on("error", reject);
    };
    go(url);
  });
}

function extractZip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  // Windows tar can extract zip
  execFileSync("tar", ["-xf", zipPath, "-C", outDir], { stdio: "inherit" });
}

function flattenExtracted(outDir) {
  // zip 内是 node-vXX-win-x64/，挪到 runtime/node/
  const entries = fs.readdirSync(outDir);
  const nested = entries.find((n) => n.startsWith("node-") && fs.statSync(path.join(outDir, n)).isDirectory());
  if (!nested) return;
  const nestedPath = path.join(outDir, nested);
  const staging = path.join(runtimeDir, "_node_staging");
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.renameSync(nestedPath, staging);
  if (fs.existsSync(nodeHome)) fs.rmSync(nodeHome, { recursive: true, force: true });
  fs.renameSync(staging, nodeHome);
}

async function main() {
  if (fs.existsSync(marker)) {
    log(`already present: ${marker}`);
    execFileSync(marker, ["-v"], { stdio: "inherit" });
    return;
  }
  if (process.platform !== "win32") {
    throw new Error("便携 Node 打包目前仅支持 Windows x64");
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  const zipPath = path.join(runtimeDir, ZIP_NAME);
  log(`download ${ZIP_URL}`);
  await download(ZIP_URL, zipPath);
  log(`extract ${zipPath}`);
  const extractTo = path.join(runtimeDir, "_extract");
  if (fs.existsSync(extractTo)) fs.rmSync(extractTo, { recursive: true, force: true });
  extractZip(zipPath, extractTo);
  flattenExtracted(extractTo);
  fs.rmSync(extractTo, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  if (!fs.existsSync(marker)) {
    throw new Error("extract failed: node.exe missing");
  }
  log(`ready: ${marker}`);
  execFileSync(marker, ["-v"], { stdio: "inherit" });
  fs.writeFileSync(
    path.join(runtimeDir, "README.txt"),
    "Portable Node.js for Jumeng Open Canvas. Do not install system-wide; launchers use runtime\\node\\node.exe.\n",
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
