/**
 * 真实 Agnes API 全链路 E2E（验收脚本，非单测）。
 *
 * 运行：cd packages/server && AGNES_API_KEY=<key> node e2e-real.mjs
 * 安全约定：key 只经环境变量注入，绝不写盘/入库；无 key 时脚本直接退出。
 * 免费层注意：probe(3 次) + 各工具执行 ≈ 7 次 API 调用，请控制频率。
 */
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeDetectImage } from "./e2e/png-utils.mjs";

const key = process.env.AGNES_API_KEY;
if (!key) {
  console.error("[e2e-real] 需要 AGNES_API_KEY 环境变量（仅测试用，不落盘）");
  process.exit(2);
}

let failed = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log(`  PASS: ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${msg}`);
  }
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["lib/index.js"],
  env: { ...process.env }, // 透传（含 AGNES_API_KEY）；启动时真实能力探针
});
const client = new Client({ name: "e2e-real", version: "0.0.1" });
await client.connect(transport);

// 1. 工具注册
const tools = await client.listTools();
assert(tools.tools.length === 8, `tools/list 注册 ${tools.tools.length} 个工具`);

// 2. Session
const created = await client.callTool({ name: "vision.session.create", arguments: {} });
const sessionId = created.structuredContent?.vision_session_id;
assert(Boolean(sessionId), "session.create 返回 vision_session_id");

// 3. observe（inline 测试图 → 真实证据文本）
const detectImg = makeDetectImage();
const inline = {
  type: "inline",
  inline: { mime_type: "image/png", blob: detectImg.toString("base64") },
};
const obs = await client.callTool({
  name: "vision.observe",
  arguments: { vision_session_id: sessionId, image_input: inline },
});
assert(!obs.isError, "observe 无错误");
const observations = obs.structuredContent?.observations ?? [];
assert(observations.length >= 1, `observe 返回 ${observations.length} 个 Observation`);
assert(observations[0]?.label === "visual_evidence", "observe label=visual_evidence");
console.log(`  证据文本: ${(observations[0]?.text ?? "").slice(0, 160)}`);

// 4. observe json_mode（依赖 structured_detection 是否被真实探针验证）
const obsJson = await client.callTool({
  name: "vision.observe",
  arguments: { vision_session_id: sessionId, image_input: inline, json_mode: true },
});
const scJson = obsJson.structuredContent ?? {};
if (scJson.executability?.executable === false) {
  console.log(`  INFO: json_mode 不可执行（能力未验证）: ${scJson.executability.reasons.join("; ")}`);
} else {
  const jsonObs = scJson.observations ?? [];
  assert(jsonObs.length >= 1, `json_mode 返回 ${jsonObs.length} 个结构化 Observation`);
  console.log(`  结构化: ${JSON.stringify(jsonObs.map((o) => ({ label: o.label, location: o.location })))}`);
}

// 5. ocr（测试图无文字 → 应为"无文字"类事实文本）
const ocr = await client.callTool({
  name: "vision.ocr",
  arguments: { vision_session_id: sessionId, image_input: inline },
});
assert(!ocr.isError, "ocr 无错误");
const ocrObs = ocr.structuredContent?.observations ?? [];
assert(ocrObs.length >= 1 && ocrObs[0]?.label === "text_block", "ocr → text_block Observation");
console.log(`  ocr 文本: ${(ocrObs[0]?.text ?? "").slice(0, 120)}`);

// 6. detect（色块图：red_square / blue_square）
const det = await client.callTool({
  name: "vision.detect",
  arguments: {
    vision_session_id: sessionId,
    image_input: inline,
    labels: ["red_square", "blue_square"],
  },
});
const detSc = det.structuredContent ?? {};
if (detSc.executability?.executable === false) {
  console.log(`  INFO: detect 不可执行（能力未验证）: ${detSc.executability.reasons.join("; ")}`);
} else {
  const detObs = detSc.observations ?? [];
  assert(detObs.length >= 1, `detect 返回 ${detObs.length} 个对象`);
  console.log(`  detect 对象: ${JSON.stringify(detObs.map((o) => ({ label: o.label, location: o.location })))}`);
}

// 7. 幂等去重（同 operation_id + 同参数 → 不重复执行）
const dedupArgs = { vision_session_id: sessionId, image_input: inline, operation_id: "e2e_real_dedup" };
await client.callTool({ name: "vision.observe", arguments: dedupArgs });
const again = await client.callTool({ name: "vision.observe", arguments: dedupArgs });
assert(again.structuredContent?.deduplicated === true, "幂等去重：二次调用返回既有结果");

// 8. 冲突（同 operation_id + 参数变化 → OPERATION_ID_CONFLICT）
const conflict = await client.callTool({
  name: "vision.observe",
  arguments: { ...dedupArgs, instruction: "完全不同的指令" },
});
assert(
  conflict.isError &&
    conflict.structuredContent?.error?.application_error_code === "OPERATION_ID_CONFLICT",
  "OPERATION_ID_CONFLICT 应用级错误码",
);

// 9. operation.get 生命周期
const opGet = await client.callTool({
  name: "vision.operation.get",
  arguments: { vision_session_id: sessionId, operation_id: "e2e_real_dedup" },
});
assert(
  opGet.structuredContent?.operation?.status === "completed",
  "operation.get 状态 completed",
);

await client.close();
console.log(failed === 0 ? "\nE2E REAL: ALL PASS" : `\nE2E REAL: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
