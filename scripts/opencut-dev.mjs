/**
 * 启动 OpenCut classic 剪辑台（默认 http://127.0.0.1:3100）。
 * 优先使用短路径工作副本 C:\\oc。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work =
  process.env.OPENCUT_WORK_DIR ||
  (fs.existsSync("C:\\oc\\apps\\web\\package.json")
    ? "C:\\oc"
    : path.join(root, "vendor", "opencut-classic"));
const bun = process.env.BUN_PATH || path.join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe");
const bunBin = fs.existsSync(bun) ? bun : "bun";
const port = process.env.OPENCUT_PORT || "3100";
const webDir = path.join(work, "apps", "web");

if (!fs.existsSync(path.join(webDir, "package.json"))) {
  console.error("OpenCut web not found at", webDir);
  console.error("Run: npm run editor:install");
  process.exit(1);
}

const envLocal = path.join(webDir, ".env.local");
if (!fs.existsSync(envLocal)) {
  fs.writeFileSync(
    envLocal,
    [
      "NODE_ENV=development",
      "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100",
      "NEXT_PUBLIC_MARBLE_API_URL=https://api.marblecms.com",
      "NEXT_PUBLIC_JUMENG_MODE=1",
      "NEXT_PUBLIC_JUMENG_CANVAS_ORIGIN=http://127.0.0.1:3456",
      "DATABASE_URL=postgresql://opencut:opencut@127.0.0.1:5432/opencut",
      "BETTER_AUTH_SECRET=jumeng-local-opencut-dev-secret",
      "UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079",
      "UPSTASH_REDIS_REST_TOKEN=example_token",
      "MARBLE_WORKSPACE_KEY=local-dev",
      "FREESOUND_CLIENT_ID=local-dev",
      "FREESOUND_API_KEY=local-dev",
      "",
    ].join("\n"),
    "utf8"
  );
  console.log("wrote", envLocal);
}

console.log("OpenCut classic → http://127.0.0.1:" + port, "cwd=", webDir);
const child = spawn(
  bunBin,
  ["run", "dev", "--", "--port", port, "--hostname", "127.0.0.1"],
  { cwd: webDir, stdio: "inherit", shell: false, env: process.env }
);
child.on("exit", (code) => process.exit(code ?? 0));
