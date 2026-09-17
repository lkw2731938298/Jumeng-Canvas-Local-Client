import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAN_ENV_FILE = path.join(ROOT, "config", "lan.env");

const DEFAULT_HOST = "192.168.1.100";
const DEFAULT_PORT = "3000";

function parseLanEnvFile() {
  if (!fs.existsSync(LAN_ENV_FILE)) {
    return {};
  }
  const values = {};
  for (const raw of fs.readFileSync(LAN_ENV_FILE, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

let cachedFileValues = null;
function fileValues() {
  if (!cachedFileValues) cachedFileValues = parseLanEnvFile();
  return cachedFileValues;
}

/** Fixed LAN host from config/lan.env (override with env LAN_HOST). */
export function getLanHost() {
  return process.env.LAN_HOST?.trim() || fileValues().LAN_HOST || DEFAULT_HOST;
}

export function getLanPort() {
  return process.env.LAN_PORT?.trim() || fileValues().LAN_PORT || DEFAULT_PORT;
}

export function getLanBaseUrl() {
  return `http://${getLanHost()}:${getLanPort()}`;
}

export function getLanProjectsUrl() {
  return `${getLanBaseUrl()}/projects`;
}

export function getLanAdminUrl() {
  return `${getLanBaseUrl()}/admin`;
}

if (process.argv[1]?.includes("detect-lan.mjs")) {
  console.log(getLanHost());
}
