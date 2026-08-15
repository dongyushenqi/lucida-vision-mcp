/**
 * 真实 Agnes API 全链路 E2E（验收脚本，非单测）。
 *
 * 运行：cd packages/server && AGNES_API_KEY=<key> node e2e-real.mjs
 * 选项：--skip-probe 跳过启动探针（省 3 次调用；免费层频率保护）。
 *   注意：无探针时无已验证能力，本模式只验证"能力门禁如实报告"路径
 *   （executable:false + 理由），完整执行链路断言需要探针开启（默认）；
 *   该模式不调用 Provider API，允许无 AGNES_API_KEY 运行（服务端注入假 key 仅用于装配）。
 * 安全约定：key 只经环境变量注入，绝不写盘/入库；完整执行模式无 key 时脚本直接退出。
 * 免费层注意：默认每次运行 ≈ 7 次 API 调用（probe 3 + 执行 4），请控制频率。
 */
import { fileURLToPath } from "node:url";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeDetectImage } from "./e2e/png-utils.mjs";

const skipProbe = process.argv.includes("--skip-probe");
const key = process.env.AGNES_API_KEY;
if (!skipProbe && !key) {
  console.error("[e2e-real] 完整执行模式需要 AGNES_API_KEY 环境变量（仅测试用，不落盘）");
  process.exit(2);
}

// 绝对路径（审查 #3）：不依赖调用方 cwd
const serverEntry = fileURLToPath(new URL("./lib/index.js", import.meta.url));

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
  args: [serverEntry],
  env: {
    ...process.env,
    VISION_PROBE_ON_BOOT: skipProbe ? "false" : "true",
    ...(skipProbe && !key ? { AGNES_API_KEY: "sk-test" } : {}),
  },
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
// 注意：--skip-probe 时无已验证能力，observe 走"能力门禁如实报告"路径（executable:false，
// 无 Observation）——这是预期的诚实行为，断言分支验证；完整链路断言仅在探针开启时执行。
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
if (skipProbe) {
  const sc = obs.structuredContent ?? {};
  assert(
    sc.executability?.executable === false &&
      Array.isArray(sc.executability?.reasons) &&
      sc.executability.reasons.length > 0,
    "skip-probe：能力门禁如实报告不可执行（含理由，无 Observation）",
  );
  assert(!Array.isArray(sc.observations) || sc.observations.length === 0, "skip-probe：无 Observation 伪造");
  console.log(`  能力门禁理由: ${sc.executability.reasons.join("; ")}`);
} else {
  const observations = obs.structuredContent?.observations ?? [];
  assert(observations.length >= 1, `observe 返回 ${observations.length} 个 Observation`);
  assert(observations[0]?.label === "visual_evidence", "observe label=visual_evidence");
  console.log(`  证据文本: ${(observations[0]?.text ?? "").slice(0, 160)}`);
}

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

// 5. ocr（探针开启：测试图无文字 → "无文字"类事实文本；skip-probe：能力门禁如实报告）
const ocr = await client.callTool({
  name: "vision.ocr",
  arguments: { vision_session_id: sessionId, image_input: inline },
});
assert(!ocr.isError, "ocr 无错误");
const ocrSc = ocr.structuredContent ?? {};
if (skipProbe) {
  assert(
    ocrSc.executability?.executable === false && Array.isArray(ocrSc.executability?.reasons),
    "skip-probe：ocr 能力门禁如实报告不可执行",
  );
  console.log(`  ocr 门禁理由: ${ocrSc.executability.reasons.join("; ")}`);
} else {
  const ocrObs = ocrSc.observations ?? [];
  assert(ocrObs.length >= 1 && ocrObs[0]?.label === "text_block", "ocr → text_block Observation");
  console.log(`  ocr 文本: ${(ocrObs[0]?.text ?? "").slice(0, 120)}`);
}

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
