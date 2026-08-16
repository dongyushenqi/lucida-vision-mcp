#!/usr/bin/env node
/**
 * lucida-vision-mcp —— 装配壳（Layer 1）。
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
  // 重复 providerId 校验必须在开库之前（审查：避免异常路径留下文件句柄/锁）
  const seenProviderIds = new Set<string>();
  for (const p of config.providers) {
    if (seenProviderIds.has(p.providerId)) {
      throw new Error(`VISION_PROVIDERS_JSON: 重复的 providerId "${p.providerId}"`);
    }
    seenProviderIds.add(p.providerId);
  }

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
        // Declared 约束与两个 Fetch 上限对齐（审查：取两者最小值，
        // 否则 URI 上限小于 inline 时声明偏大，反之 IQA 提前拒绝本可允许的 URI 图）
        maxImageSize: Math.min(config.maxInlineBytes, config.maxUriBytes),
        // 单图模型显式配 1（maxImagesPerRequest）→ summarize 超限被门禁如实拦截
        ...(p.maxImagesPerRequest !== undefined ? { maxImagesPerRequest: p.maxImagesPerRequest } : {}),
      }),
  );
  if (config.agnes.apiKey && !providers.some((p) => p.providerId === "agnes")) {
    providers.push(
      new AgnesAdapter({
        apiKey: config.agnes.apiKey,
        baseUrl: config.agnes.baseUrl,
        model: config.agnes.model,
        maxImageSize: Math.min(config.maxInlineBytes, config.maxUriBytes),
      }),
    );
  }

  const core = new VisionCore({
    store,
    fetchBoundary: new FetchBoundary({
      ...DEFAULT_FETCH_BOUNDARY_CONFIG,
      maxInlineBytes: config.maxInlineBytes,
      maxUriBytes: config.maxUriBytes,
      allowedSchemes: config.allowedUriSchemes,
      allowPrivateAddresses: config.allowPrivateAddresses,
      ...(config.allowedUriOrigins.length > 0
        ? { uriPolicy: { allowedOrigins: config.allowedUriOrigins } }
        : {}),
    }),
    providers,
  });
  for (const provider of providers) {
    core.capabilities.register(provider.declare());
  }

  // 启动探针：并行执行（审查 #8：慢 Provider 不再串行拖累其他 Provider 与启动）。
  // Probe 副作用边界：结果仅更新 Capability Registry，绝不产生 Observation（规格三.2）。
  // probeAsync=true：后台执行，服务器立即就绪，探针完成后自动开放能力（未验证期间工具如实报不可执行）。
  const runProbes = (targets: VLMProvider[], phase: "boot" | "refresh") =>
    Promise.all(
      targets.map(async (provider) => {
        try {
          const verified = await provider.probe(AbortSignal.timeout(config.probeTimeoutMs));
          core.capabilities.verify(verified);
          process.stderr.write(
            `[mcp-vision] probe ${phase}: provider=${provider.providerId} verified=${verified.capabilities.join(",") || "(none)"}\n`,
          );
        } catch {
          process.stderr.write(
            phase === "boot"
              ? `[mcp-vision] probe failed: provider=${provider.providerId}（保持未验证，工具将如实报告不可执行）\n`
              : `[mcp-vision] probe refresh failed: provider=${provider.providerId}（保留旧能力结论）\n`,
          );
        }
      }),
    );
  if (config.probeOnBoot) {
    // 复用持久化验证结果：Registry 已落盘，TTL 内（probeIntervalHours，0=永久）不重复探针，
    // 避免每次重启都等完整探针；过期才重探。probeAsync 仍是显式逃生口。
    const pending = providers.filter((provider) => {
      const verified = core.capabilities.get(provider.providerId)?.verified;
      if (!verified?.verified_at) return true;
      const ageHours = (Date.now() - new Date(verified.verified_at).getTime()) / 3600_000;
      if (config.probeIntervalHours === 0 || ageHours < config.probeIntervalHours) {
        process.stderr.write(
          `[mcp-vision] probe reused: provider=${provider.providerId} verified_at=${verified.verified_at}（TTL 内，跳过重探）\n`,
        );
        return false;
      }
      return true;
    });
    if (pending.length > 0) {
      if (config.probeAsync) {
        void runProbes(pending, "boot");
      } else {
        await runProbes(pending, "boot");
      }
    }
  }
  // 能力 TTL 刷新（审查 #8）：按 VISION_PROBE_INTERVAL_HOURS（默认 24h，0=关闭）定时重探，
  // unref() 不阻塞进程退出；结果只进 Registry。
  if (config.probeOnBoot && config.probeIntervalHours > 0) {
    let refreshing = false;
    const timer = setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      runProbes(providers, "refresh").finally(() => {
        refreshing = false;
      });
    }, config.probeIntervalHours * 3600_000);
    timer.unref();
  }

  // retention 自动清理（规格二.3 Implementation Decision）：
  // 整条删除过期记录，绝不修改仍被保留数据的身份字段；0 = 关闭。
  if (config.retentionHours.operations > 0 || config.retentionHours.artifacts > 0) {
    const retentionTimer = setInterval(() => {
      try {
        if (config.retentionHours.operations > 0) {
          const n = store.deleteOperationsOlderThan(config.retentionHours.operations);
          if (n > 0) process.stderr.write(`[mcp-vision] retention: 清理 Operation ${n} 条\n`);
        }
        if (config.retentionHours.artifacts > 0) {
          const n = store.deleteArtifactsOlderThan(config.retentionHours.artifacts);
          if (n > 0) process.stderr.write(`[mcp-vision] retention: 清理 Artifact ${n} 条\n`);
        }
      } catch (err) {
        process.stderr.write(
          `[mcp-vision] retention failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }, 3600_000); // 每小时
    retentionTimer.unref();
  }

  if (providers.length === 0) {
    process.stderr.write(
      "[mcp-vision] WARN: 未配置任何 Provider（AGNES_API_KEY 或 VISION_PROVIDERS_JSON）；视觉工具将报告 provider 不可执行\n",
    );
  }

  const executor = new VisionExecutor(core, {
    defaultInstruction: config.defaultObserveInstruction,
    defaultProfile: config.defaultProfile,
  });
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
