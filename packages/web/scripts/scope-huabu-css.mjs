// 一次性代码生成脚本：把 huabu 参考项目的 App.css 作用域化到 .huabu-scope 下，
// 输出到本仓库 src/components/huabu/huabuTheme.css。生成物为普通 CSS，运行时不依赖 ai_read。
// 用法：node scripts/scope-huabu-css.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(
  __dirname,
  "../../../../ai_read/huabu/huabu/src/App.css"
);
const OUT = resolve(__dirname, "../src/components/huabu/huabuTheme.css");

const raw = readFileSync(SRC, "utf8");

// 逐条 token 处理：保留 @import/@keyframes/@media/@font-face 等，把普通选择器前缀 .huabu-scope
function scopeSelector(selectorList) {
  return selectorList
    .split(",")
    .map((sel) => {
      const s = sel.trim();
      if (!s) return s;
      // :root / html / body 映射为作用域根
      if (s === ":root" || s === "html" || s === "body") return ".huabu-scope";
      if (s.startsWith(":root")) return ".huabu-scope" + s.slice(":root".length);
      if (s === "*") return ".huabu-scope *";
      if (s.startsWith("*")) return ".huabu-scope " + s;
      // 已经在作用域内的（keyframes 内的 from/to/百分比）交由调用方处理
      return ".huabu-scope " + s;
    })
    .join(", ");
}

let out = "";
let i = 0;
const n = raw.length;

function readBlockBody(startIdx) {
  // startIdx 指向 '{'，返回 [body, endIdxAfterBrace]
  let depth = 0;
  let j = startIdx;
  for (; j < n; j++) {
    const ch = raw[j];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return [raw.slice(startIdx + 1, j), j + 1];
    }
  }
  return [raw.slice(startIdx + 1), n];
}

while (i < n) {
  // 先原样输出前导空白，保证 @keyframes/@media 等 at 规则能被正确识别
  const wsMatch = /^\s+/.exec(raw.slice(i));
  if (wsMatch) {
    out += wsMatch[0];
    i += wsMatch[0].length;
    if (i >= n) break;
  }
  const rest = raw.slice(i);
  // 注释
  if (rest.startsWith("/*")) {
    const end = raw.indexOf("*/", i + 2);
    const stop = end === -1 ? n : end + 2;
    out += raw.slice(i, stop);
    i = stop;
    continue;
  }
  // @import / @charset 等以分号结束的 at 规则：分号可能出现在 url(...) 内，
  // 需扫描到括号外的第一个分号。
  if (rest.startsWith("@import") || rest.startsWith("@charset")) {
    let paren = 0;
    let j = i;
    for (; j < n; j++) {
      const ch = raw[j];
      if (ch === "(") paren++;
      else if (ch === ")") paren--;
      else if (ch === ";" && paren === 0) break;
    }
    const stop = j < n ? j + 1 : n;
    const rule = raw.slice(i, stop);
    // 禁止把 Google Fonts @import 写进产物（国内 fonts.gstatic.com 极慢）
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(rule)) {
      i = stop;
      continue;
    }
    out += rule;
    i = stop;
    continue;
  }
  // @keyframes：整体保留（内部 from/to/百分比不加作用域）
  if (rest.startsWith("@keyframes") || rest.startsWith("@-webkit-keyframes")) {
    const brace = raw.indexOf("{", i);
    const [body, end] = readBlockBody(brace);
    out += raw.slice(i, brace + 1) + body + "}";
    i = end;
    continue;
  }
  // @media / @supports：前缀内部选择器
  if (rest.startsWith("@media") || rest.startsWith("@supports")) {
    const brace = raw.indexOf("{", i);
    const header = raw.slice(i, brace + 1);
    const [body, end] = readBlockBody(brace);
    out += header + scopeChunk(body) + "}";
    i = end;
    continue;
  }
  // @font-face 等：整体保留
  if (rest.startsWith("@font-face")) {
    const brace = raw.indexOf("{", i);
    const [body, end] = readBlockBody(brace);
    out += raw.slice(i, brace + 1) + body + "}";
    i = end;
    continue;
  }
  // 普通规则：selector { body }
  const brace = raw.indexOf("{", i);
  if (brace === -1) {
    out += raw.slice(i);
    break;
  }
  const selector = raw.slice(i, brace);
  const [body, end] = readBlockBody(brace);
  out += scopeSelector(selector) + " {" + body + "}";
  i = end;
}

function scopeChunk(chunk) {
  // 递归处理 @media 内部的规则
  let res = "";
  let k = 0;
  const m = chunk.length;
  while (k < m) {
    const rest = chunk.slice(k);
    if (/^\s+$/.test(rest)) {
      res += rest;
      break;
    }
    if (rest.startsWith("/*")) {
      const end = chunk.indexOf("*/", k + 2);
      const stop = end === -1 ? m : end + 2;
      res += chunk.slice(k, stop);
      k = stop;
      continue;
    }
    const brace = chunk.indexOf("{", k);
    if (brace === -1) {
      res += chunk.slice(k);
      break;
    }
    const selector = chunk.slice(k, brace);
    let depth = 0;
    let j = brace;
    for (; j < m; j++) {
      if (chunk[j] === "{") depth++;
      else if (chunk[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = chunk.slice(brace + 1, j);
    res += scopeSelector(selector) + " {" + body + "}";
    k = j + 1;
  }
  return res;
}

const banner = "/* 自动生成：scripts/scope-huabu-css.mjs，请勿手改。源自 huabu 参考项目 App.css，作用域限定在 .huabu-scope。 */\n";
out = out.replaceAll(
  "'Noto Sans SC'",
  "'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei'"
);
writeFileSync(OUT, banner + out, "utf8");
console.log("scoped css written:", OUT, out.length, "bytes");
