/**
 * 浏览器冒烟：导演台静态资源与页面编译
 */
import { chromium } from "playwright";

const BASE = process.env.DIRECTOR_TEST_BASE ?? "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  try {
    const glbResp = await page.request.get(`${BASE}/director/models/mannequin.glb`);
    const glbBody = await glbResp.body();
    results.push({
      name: "mannequin.glb",
      ok: glbResp.ok() && glbBody.byteLength > 100_000,
      detail: `status=${glbResp.status()} bytes=${glbBody.byteLength}`,
    });

    const projects = await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
    results.push({
      name: "projects page",
      ok: projects?.status() === 200,
      detail: `status=${projects?.status()}`,
    });

    const title = await page.title();
    const body = await page.locator("body").innerText();
    results.push({
      name: "projects renders",
      ok: body.length > 20,
      detail: `title=${title}`,
    });

    // 触发 director 相关 chunk 编译（无 API 时会 loadError，但路由应可编译）
    const directorUrl = `${BASE}/00000000-0000-0000-0000-000000000001/director/test-node`;
    const director = await page.goto(directorUrl, { waitUntil: "networkidle", timeout: 60000 });
    const directorText = await page.locator("body").innerText();
    const compiled =
      director?.status() === 200 &&
      (directorText.includes("导演台") ||
        directorText.includes("加载") ||
        directorText.includes("项目") ||
        directorText.includes("重试"));
    results.push({
      name: "director route compiles",
      ok: compiled,
      detail: `status=${director?.status()} snippet=${directorText.slice(0, 80).replace(/\s+/g, " ")}`,
    });
  } finally {
    await browser.close();
  }

  console.log("\n=== Director smoke test ===");
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed += 1;
    console.log(`${mark}  ${r.name}  (${r.detail})`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
