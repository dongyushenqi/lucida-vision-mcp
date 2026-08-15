/**
 * Server 配置（环境变量驱动；Implementation Decision 集中于此）。
 */
export interface ServerConfig {
  /** SQLite 路径（":memory:" 为内存库） */
  dbPath: string;
  /** Legacy Family 无协议级身份时的默认 Principal/Tenant */
  identity: { principalId: string; tenantId: string };
  agnes: {
    apiKey: string;
    baseUrl?: string;
    model?: string;
  };
  /** 启动时执行能力探针（受控验证，可能产生 API 成本） */
  probeOnBoot: boolean;
  /** 探针总超时（ms） */
  probeTimeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    dbPath: env["VISION_DB_PATH"] ?? ":memory:",
    identity: {
      principalId: env["VISION_PRINCIPAL"] ?? "local",
      tenantId: env["VISION_TENANT"] ?? "default",
    },
    agnes: {
      apiKey: env["AGNES_API_KEY"] ?? "",
      baseUrl: env["AGNES_BASE_URL"] || undefined,
      model: env["AGNES_VISION_MODEL"] || undefined,
    },
    probeOnBoot: env["VISION_PROBE_ON_BOOT"] !== "false",
    probeTimeoutMs: 60_000,
  };
}
