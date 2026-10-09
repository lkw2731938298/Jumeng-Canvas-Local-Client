/**
 * electron-builder afterPack：在不启用 winCodeSign 解压的前提下，
 * 用 rcedit 把 brand/logo 生成的 icon.ico 写入 .exe（安装目录/快捷方式图标）。
 */
const path = require("path");
const fs = require("fs");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] 未找到 exe: ${exePath}`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] 未找到图标: ${iconPath}`);
    return;
  }

  // monorepo：rcedit 装在仓库根 node_modules
  let rcedit;
  try {
    rcedit = require("rcedit");
  } catch {
    const rootRcedit = path.join(__dirname, "..", "..", "..", "node_modules", "rcedit");
    rcedit = require(rootRcedit);
  }

  await rcedit(exePath, { icon: iconPath });
  console.log(`[afterPack] 已写入应用图标 → ${exeName}`);
};
