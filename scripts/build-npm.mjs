/**
 * npm 发布包构建脚本：产出可发布到 npm registry 的包结构并 `npm pack`。
 *
 * 产物：dist/npm/（包结构）+ dist/lucida-vision-mcp-<version>.tgz（可安装压缩包）。
 * 包名：lucida-vision-mcp（品牌 lucida + 约定俗成归类后缀 vision-mcp；registry 已确认可用）。
 *
 * 用法（安装途径之一）：
 *   npm install -g lucida-vision-mcp        # 全局安装后命令行 `lucida-vision-mcp` 直接可用
 *   npx -y lucida-vision-mcp                # 免安装直接运行（stdio）
 *   离线：npm install <tgz 文件>
 *
 * 运行：pnpm -r run build && node scripts/build-npm.mjs
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, bundleServer } from "./lib/bundle-server.mjs";

const serverPkg = JSON.parse(readFileSync(join(ROOT, "packages/server/package.json"), "utf8"));
const version = serverPkg.version;
const npmDir = join(ROOT, "dist", "npm");
const binOut = join(npmDir, "bin", "lucida-vision-mcp.mjs");

rmSync(npmDir, { recursive: true, force: true });
mkdirSync(join(npmDir, "bin"), { recursive: true });

console.log(`[npm] bundling lucida-vision-mcp v${version} ...`);
await bundleServer(binOut);

const pkgJson = {
  name: "lucida-vision-mcp",
  version,
  description:
    "lucida-vision-mcp (eyes, not brain): a standard-MCP visual perception organ that states verifiable visual facts, never diagnoses. 通用视觉感知 MCP 服务器（眼睛不是大脑）",
  type: "module",
  bin: { "lucida-vision-mcp": "./bin/lucida-vision-mcp.mjs" },
  engines: { node: ">=24.0.0" },
  files: ["bin"],
  keywords: ["mcp", "vision", "vlm", "visual", "model-context-protocol", "server", "ocr", "detect"],
  license: "MIT",
  repository: { type: "git", url: "https://github.com/<your-org>/lucida-vision-mcp.git" },
  publishConfig: { access: "public" },
};
writeFileSync(join(npmDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");

console.log("[npm] npm pack ...");
const packOut = execSync("npm pack --pack-destination ../", { cwd: npmDir, encoding: "utf8" });
console.log(`[npm] done: ${packOut.trim()}`);
console.log("[npm] 安装方式：npm install -g <tgz> 或发布后 npm install -g lucida-vision-mcp");
