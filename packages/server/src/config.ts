/**
 * Server 配置（环境变量驱动；Implementation Decision 集中于此）。
 */
/** OpenAI 兼容 Provider 配置（VISION_PROVIDERS_JSON 数组元素）。 */
export interface ProviderConfig {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  displayName?: string;
}

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
  /** 额外 OpenAI 兼容 Provider（千问/豆包/GPT 等；AGNES_* 单独兼容） */
  providers: ProviderConfig[];
  /** 启动时执行能力探针（受控验证，可能产生 API 成本） */
  probeOnBoot: boolean;
  /** 探针总超时（ms） */
  probeTimeoutMs: number;
  /** 能力探针 TTL 刷新间隔（小时；0 = 关闭定时刷新，审查 #8） */
  probeIntervalHours: number;
  /** URI 授权边界：允许的图像来源域名（空 = 仅 SSRF 防护，规格四.1） */
  allowedUriOrigins: string[];
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
    providers: parseProviders(env["VISION_PROVIDERS_JSON"]),
    probeOnBoot: env["VISION_PROBE_ON_BOOT"] !== "false",
    probeTimeoutMs: 60_000,
    probeIntervalHours: parseNonNegativeInt(env["VISION_PROBE_INTERVAL_HOURS"], 24),
    allowedUriOrigins: (env["VISION_ALLOWED_URI_ORIGINS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

/**
 * 解析 VISION_PROVIDERS_JSON（数组）：[{providerId, apiKey, baseUrl?, model?, displayName?}]。
 * 非法项跳过；整个 JSON 非法则返回空数组（记入 stderr 由调用方提示）。
 */
export function parseProviders(raw: string | undefined): ProviderConfig[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ProviderConfig[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec["providerId"] !== "string" || typeof rec["apiKey"] !== "string") continue;
      if (!rec["providerId"].match(/^[a-z0-9_-]+$/)) continue;
      out.push({
        providerId: rec["providerId"],
        apiKey: rec["apiKey"],
        baseUrl: typeof rec["baseUrl"] === "string" ? rec["baseUrl"] : undefined,
        model: typeof rec["model"] === "string" ? rec["model"] : undefined,
        displayName: typeof rec["displayName"] === "string" ? rec["displayName"] : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
