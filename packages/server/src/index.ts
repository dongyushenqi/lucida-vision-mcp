#!/usr/bin/env node
/**
 * mcp-vision-server —— 装配壳（Layer 1）。
 *
 * 环境变量：
 *   AGNES_API_KEY      必填（Agnes 免费视觉 API）
 *   AGNES_BASE_URL     可选（默认 https://apihub.agnes-ai.com/v1）
 *   AGNES_VISION_MODEL 可选（默认 agnes-2.5-flash）
 *   VISION_DB_PATH     可选（默认 :memory:）
 *   VISION_PRINCIPAL / VISION_TENANT  默认 local / default
 *   VISION_PROBE_ON_BOOT  默认 true（启动时执行能力探针，仅更新 Capability Registry）
 */
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  AgnesAdapter,
  DEFAULT_FETCH_BOUNDARY_CONFIG,
  FetchBoundary,
  OpenAICompatibleAdapter,
  SqliteVisionStore,
  VisionCore,
  type VLMProvider,
} from "@mcp-vision/vision-core";
import { createVisionTools, VisionExecutor } from "@mcp-vision/vision-interface";
import { LegacyFamilyServer } from "@mcp-vision/compatibility";
import { loadConfig, type ServerConfig } from "./config.js";

export async function createServer(config: ServerConfig) {
  const store = new SqliteVisionStore(config.dbPath);

  // Provider 装配（模型独立，不预设默认模型）：
  // - VISION_PROVIDERS_JSON 为用户显式配置，按配置顺序注册（首位即 provider_id 缺省选择）；
  // - AGNES_API_KEY（AGNES_* env）仅为向后兼容的快捷配置，追加在用户配置之后，无任何优先地位；
  // - 模型用谁、用什么，完全取决于用户接入；本系统绝不设定默认模型。
  const providers: VLMProvider[] = config.providers.map(
    (p) =>
      new OpenAICompatibleAdapter({
        providerId: p.providerId,
        displayName: p.displayName,
        apiKey: p.apiKey,
        baseUrl: p.baseUrl,
        model: p.model,
      }),
  );
  if (config.agnes.apiKey && !providers.some((p) => p.providerId === "agnes")) {
    providers.push(
      new AgnesAdapter({
        apiKey: config.agnes.apiKey,
        baseUrl: config.agnes.baseUrl,
        model: config.agnes.model,
      }),
    );
  }

  const core = new VisionCore({
    store,
    fetchBoundary: new FetchBoundary({
      ...DEFAULT_FETCH_BOUNDARY_CONFIG,
      ...(config.allowedUriOrigins.length > 0
        ? { uriPolicy: { allowedOrigins: config.allowedUriOrigins } }
        : {}),
    }),
    providers,
  });
  for (const provider of providers) {
    core.capabilities.register(provider.declare());
  }

  if (config.probeOnBoot) {
    for (const provider of providers) {
      // Probe 副作用边界：结果仅更新 Capability Registry，绝不产生 Observation（规格三.2）
      try {
        const verified = await provider.probe(AbortSignal.timeout(config.probeTimeoutMs));
        core.capabilities.verify(verified);
        process.stderr.write(
          `[mcp-vision] probe ok: provider=${provider.providerId} verified=${verified.capabilities.join(",") || "(none)"}\n`,
        );
      } catch {
        process.stderr.write(
          `[mcp-vision] probe failed: provider=${provider.providerId}（保持未验证，工具将如实报告不可执行）\n`,
        );
      }
    }
  }
  if (providers.length === 0) {
    process.stderr.write(
      "[mcp-vision] WARN: 未配置任何 Provider（AGNES_API_KEY 或 VISION_PROVIDERS_JSON）；视觉工具将报告 provider 不可执行\n",
    );
  }

  const executor = new VisionExecutor(core);
  const legacy = new LegacyFamilyServer({
    executor,
    core,
    tools: createVisionTools(),
    identity: config.identity,
  });

  return { core, executor, legacy, store };
}

export async function main(config: ServerConfig = loadConfig()): Promise<void> {
  const { legacy } = await createServer(config);
  await legacy.connect(new StdioServerTransport());

  const shutdown = () => {
    legacy.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// 直接执行入口（bin）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`[mcp-vision] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
