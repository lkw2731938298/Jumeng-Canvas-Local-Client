/**
 * 将 vendor/opencut-classic 同步到短路径 C:\\oc 并 bun install。
 * Windows 深路径下 bun link 易失败，故用短路径工作副本。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "opencut-classic");
const work = process.env.OPENCUT_WORK_DIR || "C:\\oc";
const bun = process.env.BUN_PATH || path.join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe");

if (!fs.existsSync(vendor)) {
  console.error("missing vendor/opencut-classic — clone OpenCut classic first");
  process.exit(1);
}

fs.mkdirSync(work, { recursive: true });
const robocopy = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "robocopy.exe");
const rc = spawnSync(
  robocopy,
  [vendor, work, "/E", "/XD", "node_modules", ".git", ".next", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np"],
  { stdio: "inherit", shell: false }
);
// robocopy exit 0-7 = success
const code = rc.status ?? 1;
if (code >= 8) {
  console.error("robocopy failed", code);
  process.exit(1);
}

const bunBin = fs.existsSync(bun) ? bun : "bun";
console.log("bun install in", work);
const install = spawnSync(bunBin, ["install"], { cwd: work, stdio: "inherit", shell: false });
process.exit(install.status ?? 1);
