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
import { build } from "esbuild";
import { ZipArchive } from "archiver";
import { createWriteStream, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPkg = JSON.parse(readFileSync(join(root, "packages/server/package.json"), "utf8"));
const version = serverPkg.version;

const releaseDir = join(root, "dist", "release");
const zipPath = join(root, "dist", `mcp-vision-server-v${version}.zip`);
const bundleOut = join(releaseDir, "bin", "mcp-vision-server.mjs");

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(join(releaseDir, "bin"), { recursive: true });
mkdirSync(join(releaseDir, "config"), { recursive: true });

console.log(`[release] bundling server v${version} → single-file mjs ...`);
await build({
  entryPoints: [join(root, "packages/server/lib/index.js")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: bundleOut,
  minify: true,
  sourcemap: false,
  // platform=node 自动将 node: 内置模块 external；zod/MCP SDK/工作区包全部打进单文件
  // 入口 lib/index.js 自带 shebang（tsc 保留自 src/index.ts），esbuild 自动置顶
});

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
archive.directory(releaseDir, `mcp-vision-server-v${version}`);
await archive.finalize();

console.log(`[release] done: ${zipPath}`);
console.log("[release] 发布包内容：bin/（单文件可执行）+ install/start 引导脚本 + config 模板 + 双语说明");
