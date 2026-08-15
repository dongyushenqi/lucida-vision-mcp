// stdio 传输 E2E 冒烟（验收脚本，非单测）：真实子进程 + 真实 stdio 传输
// 运行：cd packages/server && node stdio-smoke.mjs
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["lib/index.js"],
  env: { ...process.env, AGNES_API_KEY: "", VISION_PROBE_ON_BOOT: "false" },
});
const client = new Client({ name: "stdio-smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools count:", tools.tools.length);

const created = await client.callTool({ name: "vision.session.create", arguments: {} });
const sessionId = created.structuredContent?.vision_session_id;
console.log("session id:", sessionId);

const obs = await client.callTool({
  name: "vision.observe",
  arguments: {
    vision_session_id: sessionId,
    image_input: { type: "inline", inline: { mime_type: "image/png", blob: PNG_1PX } },
  },
});
console.log("observe isError:", obs.isError);
console.log("observe executability:", JSON.stringify(obs.structuredContent?.executability));
console.log("observe operation status:", obs.structuredContent?.operation?.status);

await client.close();
console.log("STDIO SMOKE OK");
process.exit(0);
