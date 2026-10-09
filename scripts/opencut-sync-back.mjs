/**
 * 把 C:\\oc 上的源码改动同步回 vendor/opencut-classic（排除 node_modules/.next）。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor", "opencut-classic");
const work = process.env.OPENCUT_WORK_DIR || "C:\\oc";

if (!fs.existsSync(path.join(work, "apps", "web"))) {
  console.error("work dir missing", work);
  process.exit(1);
}

const robocopy = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "robocopy.exe");
const rc = spawnSync(
  robocopy,
  [
    work,
    vendor,
    "/E",
    "/XD",
    "node_modules",
    ".git",
    ".next",
    "/XF",
    ".env.local",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/nc",
    "/ns",
    "/np",
  ],
  { stdio: "inherit", shell: false }
);
const code = rc.status ?? 1;
if (code >= 8) process.exit(1);
console.log("synced", work, "→", vendor);
