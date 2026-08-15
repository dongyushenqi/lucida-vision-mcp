/**
 * 共享打包逻辑：把 server 及其全部运行时依赖 esbuild 打包为单文件 mjs。
 * （纯 JS，三平台通用，不依赖原生模块——SQLite 用 Node 内置）
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 入口 lib/index.js 自带 shebang（tsc 保留自 src/index.ts），esbuild 自动置顶。 */
export async function bundleServer(outfile) {
  await build({
    entryPoints: [join(ROOT, "packages/server/lib/index.js")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    minify: true,
    sourcemap: false,
  });
  return outfile;
}
