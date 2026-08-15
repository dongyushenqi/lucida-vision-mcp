// 发布包验证脚本：对 dist/release bundle 做真实 MCP 握手冒烟（Windows 本地实测用）
// 运行：cd packages/server && node e2e/verify-release.mjs
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// e2e/ → server → packages → root → dist/release/bin
const bundle = new URL("../../../dist/release/bin/mcp-vision-server.mjs", import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, VISION_PROBE_ON_BOOT: "false" },
});
const client = new Client({ name: "verify-release", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log(`bundle tools: ${tools.tools.length}`);
if (tools.tools.length !== 8) {
  console.error("FAIL: 工具数不对");
  process.exit(1);
}
const created = await client.callTool({ name: "vision.session.create", arguments: {} });
console.log(`bundle session: ${created.structuredContent?.vision_session_id ?? "FAIL"}`);
if (!created.structuredContent?.vision_session_id) {
  console.error("FAIL: session.create 失败");
  process.exit(1);
}
await client.close();
console.log("RELEASE BUNDLE VERIFY OK");
process.exit(0);
