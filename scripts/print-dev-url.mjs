import { getLanAdminUrl, getLanHost, getLanPort, getLanProjectsUrl } from "./detect-lan.mjs";

console.log("");
console.log("  固定局域网访问地址 (config/lan.env):");
console.log(`    ${getLanProjectsUrl()}`);
console.log(`    ${getLanAdminUrl()}`);
console.log(`    IP: ${getLanHost()}  端口: ${getLanPort()}`);
console.log("");
console.log("  修改 IP 请编辑 config/lan.env 后重启 npm run dev");
console.log("  若其他设备打不开，请以管理员运行: npm run lan:firewall");
console.log("");
