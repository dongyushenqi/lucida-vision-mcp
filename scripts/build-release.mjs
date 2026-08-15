/**
 * 发布打包脚本：产出"发布包"（加工好的成品，下载即用）。
 *
 * - 将 server 及其全部运行时依赖 esbuild 打包为单文件 mjs（纯 JS，三平台通用，
 *   不依赖任何原生模块——SQLite 用 Node 内置）；
 * - 组装引导脚本（install/start，Windows .cmd + macOS/Linux .sh）与 MCP Host 配置模板；
 * - 压缩为 zip。
 *
 * 运行：pnpm -r run build && node scripts/build-release.mjs
 */
import { ZipArchive } from "archiver";
import { createWriteStream, copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, bundleServer } from "./lib/bundle-server.mjs";

const root = ROOT;
const serverPkg = JSON.parse(readFileSync(join(root, "packages/server/package.json"), "utf8"));
const version = serverPkg.version;

const releaseDir = join(root, "dist", "release");
const zipPath = join(root, "dist", `lucida-vision-mcp-v${version}.zip`);
const bundleOut = join(releaseDir, "bin", "lucida-vision-mcp.mjs");

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(join(releaseDir, "bin"), { recursive: true });
mkdirSync(join(releaseDir, "config"), { recursive: true });

console.log(`[release] bundling server v${version} → single-file mjs ...`);
await bundleServer(bundleOut);

// LICENSE 在仓库根（对外分发物须带许可证文本，审查 3）
copyFileSync(join(root, "LICENSE"), join(releaseDir, "LICENSE"));
const templates = [
  "install.cmd",
  "start.cmd",
  "install.sh",
  "start.sh",
  "config/claude-desktop.example.json",
  "README.zh.md",
  "README.en.md",
];
for (const t of templates) {
  copyFileSync(join(root, "release-templates", t), join(releaseDir, t));
}

console.log("[release] creating zip ...");
const output = createWriteStream(zipPath);
const archive = new ZipArchive({ zlib: { level: 9 } });
archive.on("warning", (err) => {
  if (err.code === "ENOENT") console.warn("[release] warn:", err.message);
  else throw err;
});
archive.pipe(output);
archive.directory(releaseDir, `lucida-vision-mcp-v${version}`);
await archive.finalize();

console.log(`[release] done: ${zipPath}`);
console.log("[release] 发布包内容：bin/（单文件可执行）+ install/start 引导脚本 + config 模板 + 双语说明");
