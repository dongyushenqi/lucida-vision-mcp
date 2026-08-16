/**
 * 从 CHANGELOG.md 提取指定版本的说明节（含标题行），供 GitHub Release body 使用。
 * 用法：node scripts/release-notes.mjs <tag> [changelogPath]
 * 例：  node scripts/release-notes.mjs v0.4.0
 */
import { readFileSync } from "node:fs";

const tag = process.argv[2];
const path = process.argv[3] ?? "CHANGELOG.md";
if (!tag) {
  process.stderr.write("[release-notes] 用法: node scripts/release-notes.mjs <tag> [changelogPath]\n");
  process.exit(2);
}

const lines = readFileSync(path, "utf8").split("\n");
let start = -1;
for (let i = 0; i < lines.length; i += 1) {
  if (lines[i] === `## ${tag}` || lines[i].startsWith(`## ${tag} `)) {
    start = i;
    break;
  }
}
if (start === -1) {
  process.stderr.write(`[release-notes] 未在 ${path} 中找到版本节: ${tag}\n`);
  process.exit(1);
}
let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (lines[i].startsWith("## ")) {
    end = i;
    break;
  }
}
process.stdout.write(lines.slice(start, end).join("\n").trim() + "\n");
