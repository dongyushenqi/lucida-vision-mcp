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
  /** retention 保留期（小时；0 = 关闭自动清理；规格二.3 Implementation Decision） */
  retentionHours: { operations: number; artifacts: number };
  /** URI 授权边界：允许的图像来源域名（空 = 仅 SSRF 防护，规格四.1） */
  allowedUriOrigins: string[];
  /** Fetch Boundary URI scheme 白名单（本地取图可显式加 "file"） */
  allowedUriSchemes: string[];
  /** 放行私有/环回地址（本地 HTTP serve 图片场景；默认 false，SSRF 防护保持开启） */
  allowPrivateAddresses: boolean;
  /** 默认观察指令（Agent 未提供 instruction 时使用；缺省为内置校准版） */
  defaultObserveInstruction?: string;
  /** 默认观察档位（缺省 default；deep 仅当用户明确要求时使用） */
  defaultProfile: "default" | "deep";
  /** Fetch Boundary 大小限制（字节） */
  maxInlineBytes: number;
  maxUriBytes: number;
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
    retentionHours: {
      operations: parseNonNegativeInt(env["VISION_RETENTION_OPERATIONS_HOURS"], 168),
      artifacts: parseNonNegativeInt(env["VISION_RETENTION_ARTIFACTS_HOURS"], 24),
    },
    allowedUriOrigins: (env["VISION_ALLOWED_URI_ORIGINS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    allowedUriSchemes: parseSchemes(env["VISION_ALLOW_URI_SCHEMES"]),
    allowPrivateAddresses: env["VISION_ALLOW_PRIVATE_ADDRESSES"] === "true",
    defaultObserveInstruction: trimToUndefined(env["VISION_DEFAULT_INSTRUCTION"]),
    defaultProfile: env["VISION_DEFAULT_PROFILE"] === "deep" ? "deep" : "default",
    maxInlineBytes: parsePositiveInt(env["VISION_MAX_INLINE_BYTES"], 10 * 1024 * 1024),
    maxUriBytes: parsePositiveInt(env["VISION_MAX_URI_BYTES"], 10 * 1024 * 1024),
  };
}

function trimToUndefined(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  return t ? t : undefined;
}

/**
 * 解析 scheme 白名单（逗号分隔；只接受合法 scheme 形态，非法项剔除，全非法则回退默认）。
 * 默认含 file：本地 stdio 单机场景开箱即用；严格环境显式设置（如 http,https）可关闭。
 */
function parseSchemes(raw: string | undefined, fallback = ["http", "https", "file"]): string[] {
  if (!raw) return fallback;
  const out = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z][a-z0-9+.-]*$/.test(s));
  return out.length > 0 ? [...new Set(out)] : fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
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
