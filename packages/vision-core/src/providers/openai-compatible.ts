/**
 * OpenAICompatibleAdapter —— 通用 OpenAI 兼容形态 Adapter（模型独立性落地）。
 *
 * 覆盖所有提供 OpenAI chat/completions 兼容端点的视觉模型：
 * Agnes（apihub.agnes-ai.com）、通义千问（DashScope compatible-mode）、
 * 豆包（火山方舟 /api/v3）、GPT（api.openai.com）及各类网关——每家 = 一份配置实例。
 *
 * 约束（规格一.1 禁区）：
 * - 5xx 有界重试（免费层瞬时故障），绝不跨 Provider 故障转移/智能路由；
 * - 图片一律内联 data: URI（已过 Fetch Boundary 的本地字节，Adapter 永不自行取图）；
 * - Probe 只验证能力（基础理解 + OCR + JSON bbox），结果仅进 Capability Registry，
 *   严禁自动生成 Observation 注入图谱（规格三.2 副作用边界）；
 * - 取消只认内部 AbortSignal。
 */
import {
  ApplicationErrorCode,
  VisionError,
  type CapabilityId,
  type DeclaredCapability,
  type VerifiedCapability,
} from "@mcp-vision/contracts";
import { genId } from "../ids.js";
import { isTimeoutAbort } from "../cancellation.js";
import type { ProviderExecuteRequest, ProviderExecuteResult, VLMProvider } from "../provider.js";

export interface OpenAiCompatibleProviderConfig {
  /** 供应商标识（Agent 经 provider_id 显式选择；如 "agnes" / "qwen" / "doubao" / "gpt"） */
  providerId: string;
  apiKey: string;
  /** OpenAI 兼容端点根，如 https://api.openai.com/v1 */
  baseUrl?: string;
  /** 视觉模型名，如 agnes-2.5-flash / qwen-vl-max / doubao-1.5-vision-pro / gpt-4o */
  model?: string;
  displayName?: string;
  timeoutMs?: number;
  /** 5xx 有界重试次数（仅 500/502/503） */
  maxRetries?: number;
  temperature?: number;
  /** 可注入 fetch（单测用） */
  fetchImpl?: typeof fetch;
  /** 供应商特有约束（并入 Declared Capability constraints） */
  extraConstraints?: Record<string, unknown>;
}

/** 1x1 透明 PNG（探针测试图，内容无关）。 */
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const JSON_PROBE_INSTRUCTION =
  '图中有一个红色正方形。仅输出 JSON，不要任何其他文字：{"objects":[{"label":"red_square","bbox":[x1,y1,x2,y2]}]}。若无法确定坐标则输出 {"objects":[]}。';

const RETRYABLE_STATUS = new Set([500, 502, 503]);

export class OpenAICompatibleAdapter implements VLMProvider {
  readonly providerId: string;
  /** 主流协议族：OpenAI 兼容生态一律走本类，配置即用 */
  readonly protocolFamily = "openai-compatible" as const;
  readonly adapterVersion = "0.2.0";
  readonly capabilityIds: CapabilityId[] = [
    "image_understanding",
    "ocr",
    "multi_image",
    "structured_detection",
  ];

  private readonly displayName: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly fetchImpl: typeof fetch;
  private readonly extraConstraints: Record<string, unknown>;

  constructor(private readonly config: OpenAiCompatibleProviderConfig) {
    if (!config.providerId || !config.providerId.match(/^[a-z0-9_-]+$/)) {
      throw new Error(`OpenAICompatibleAdapter: providerId 非法（${config.providerId ?? ""}）`);
    }
    this.providerId = config.providerId;
    this.displayName = config.displayName ?? config.providerId;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.model = config.model ?? "";
    this.timeoutMs = config.timeoutMs ?? 180_000;
    this.maxRetries = config.maxRetries ?? 1;
    this.temperature = config.temperature ?? 0.2;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.extraConstraints = config.extraConstraints ?? {};
  }

  /** 声明能力（含 Scope and Constraints）。 */
  declare(): DeclaredCapability {
    return {
      provider: this.providerId,
      capabilities: [...this.capabilityIds],
      constraints: {
        max_image_size: 10 * 1024 * 1024,
        max_images_per_request: 4,
        supported_output_formats: ["text"],
        ...this.extraConstraints,
      },
    };
  }

  /**
   * 能力探针（受控验证，可能产生 API 成本；频率受 Server 策略限制）。
   * 结果仅用于更新 Capability Registry，严禁自动生成 Observation 注入图谱。
   */
  async probe(signal: AbortSignal): Promise<VerifiedCapability> {
    const testImage = { bytes: Buffer.from(TEST_PNG_BASE64, "base64"), mimeType: "image/png" };
    const verified: CapabilityId[] = [];

    // Probe A：基础图像理解 —— 期望非空文本
    try {
      const r = await this.execute(
        { images: [testImage], instruction: "描述这张图片", jsonMode: false },
        signal,
      );
      if (r.text.trim().length > 0) {
        verified.push("image_understanding");
      }
    } catch {
      // 探针失败只影响 Verified 集合，不抛错
    }

    // Probe B：OCR 指令预设 —— 期望非空文本（测试图无文字，模型应返回"无文字"类事实）
    try {
      const r = await this.execute(
        { images: [testImage], instruction: "提取图中所有文字内容，若无文字请说明", jsonMode: false },
        signal,
      );
      if (r.text.trim().length > 0) {
        verified.push("ocr");
      }
    } catch {
      // 同上
    }

    // Probe C：结构化检测（JSON bbox）—— 期望可解析坐标
    try {
      const r = await this.execute(
        { images: [testImage], instruction: JSON_PROBE_INSTRUCTION, jsonMode: true },
        signal,
      );
      if (isBboxJson(r.text)) {
        verified.push("structured_detection");
      }
    } catch {
      // 同上
    }

    return {
      provider: this.providerId,
      capabilities: verified,
      probe_id: genId("probe"),
      verified_at: new Date().toISOString(),
    };
  }

  /** 执行感知：字节进、文本证据出。 */
  async execute(req: ProviderExecuteRequest, signal: AbortSignal): Promise<ProviderExecuteResult> {
    if (!this.config.apiKey) {
      // 无 key 时优雅降级：事实化报错（含恢复属性），服务器照常启动
      throw new VisionError(ApplicationErrorCode.PROVIDER_AUTH_FAILED, `${this.providerId} apiKey 未配置`, {
        recovery: { env_var: `${this.providerId.toUpperCase()}_API_KEY` },
      });
    }
    if (!this.model) {
      throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, `${this.providerId} model 未配置`, {
        provider: this.providerId,
      });
    }
    const content: unknown[] = [{ type: "text", text: req.instruction }];
    for (const img of req.images) {
      const b64 = Buffer.from(img.bytes).toString("base64");
      content.push({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${b64}` },
      });
    }
    const payload = {
      model: this.model,
      messages: [{ role: "user", content }],
      temperature: this.temperature,
      ...(req.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    };
    const url = `${this.baseUrl}/chat/completions`;

    let lastError: unknown;
    let formatDowngraded = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const combined = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: combined,
        });

        if (res.status === 401 || res.status === 403) {
          throw new VisionError(ApplicationErrorCode.PROVIDER_AUTH_FAILED, `${this.providerId} 鉴权失败`, {
            http_status: res.status,
          });
        }
        // response_format 兼容降级（审查 #7）：部分兼容端点不支持 json_object → 去掉后重试一次
        if (
          res.status === 400 &&
          req.jsonMode &&
          !formatDowngraded &&
          payload["response_format"] !== undefined
        ) {
          formatDowngraded = true;
          delete payload["response_format"];
          continue;
        }
        if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
          await delay(500 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, `${this.providerId} HTTP ${res.status}`, {
            http_status: res.status,
          });
        }
        const data: unknown = await res.json();
        const text = extractContent(data);
        if (typeof text !== "string") {
          throw new VisionError(ApplicationErrorCode.PROVIDER_INVALID_RESPONSE, `${this.providerId} 返回结构异常`);
        }
        return {
          text,
          providerMeta: {
            provider: this.providerId,
            model: this.model,
            // Contract Clarification：多数供应商无官方版本号，记录实际模型标识（永不漂移）
            model_version: this.model,
            execution_timestamp: new Date().toISOString(),
          },
        };
      } catch (err) {
        if (err instanceof VisionError) {
          throw err;
        }
        // 取消/超时区分（审查 #2）：用户取消原样上抛；超时 → PROVIDER_TIMEOUT
        if (isTimeoutAbort(err) || (err instanceof Error && err.name === "AbortError" && isTimeoutAbort(combined.reason))) {
          throw new VisionError(ApplicationErrorCode.PROVIDER_TIMEOUT, `${this.providerId} 请求超时`, {
            timeout_ms: this.timeoutMs,
          });
        }
        if (err instanceof Error && err.name === "AbortError") {
          throw err;
        }
        lastError = err;
        if (attempt < this.maxRetries) {
          await delay(500 * (attempt + 1));
          continue;
        }
        throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, `${this.providerId} 请求失败`, {
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError;
  }
}

/** 兼容多种返回形态（审查 #7）：content 为字符串或 content block 数组。 */
function extractContent(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  const choices = obj["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.["message"] as Record<string, unknown> | undefined;
  const content = message?.["content"];
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "object" && block !== null) {
        const b = block as Record<string, unknown>;
        if (b["type"] === "text" && typeof b["text"] === "string") {
          parts.push(b["text"]);
        }
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

function isBboxJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { objects?: unknown };
    if (!Array.isArray(parsed.objects)) return false;
    return parsed.objects.some(
      (o) =>
        typeof o === "object" &&
        o !== null &&
        Array.isArray((o as Record<string, unknown>)["bbox"]) &&
        ((o as Record<string, unknown>)["bbox"] as unknown[]).length === 4,
    );
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
