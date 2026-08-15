/**
 * Agnes Adapter —— 首个 Provider（用户指定：免费 Agnes agnes-2.5-flash）。
 *
 * - OpenAI 兼容端点：POST {baseUrl}/chat/completions（默认 https://apihub.agnes-ai.com/v1）
 * - 鉴权：Authorization: Bearer <apiKey>
 * - 图片一律内联 data: URI 传入（已过 Fetch Boundary 的本地字节；Adapter 永不自行取图）
 * - 5xx 有界重试一次（免费层瞬时故障）；401/403 → PROVIDER_AUTH_FAILED；
 *   结构异常 → PROVIDER_INVALID_RESPONSE；其余网络失败 → PROVIDER_UNAVAILABLE
 * - 严禁跨 Provider 故障转移/智能路由（规格一.1 禁区）
 * - Probe 只验证能力（基础理解 + JSON bbox 结构化输出），绝不产生 Observation（规格三.2）
 */
import { ApplicationErrorCode, VisionError, type CapabilityId, type DeclaredCapability, type VerifiedCapability } from "@mcp-vision/contracts";
import { genId } from "../ids.js";
import type { ProviderExecuteRequest, ProviderExecuteResult, VLMProvider } from "../provider.js";

export interface AgnesAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** 5xx 有界重试次数（仅 500/502/503） */
  maxRetries?: number;
  temperature?: number;
  /** 可注入 fetch（单测用） */
  fetchImpl?: typeof fetch;
}

export const AGNES_DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1";
export const AGNES_DEFAULT_MODEL = "agnes-2.5-flash";

/** 1x1 透明 PNG（探针测试图，内容无关）。 */
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const JSON_PROBE_INSTRUCTION =
  '图中有一个红色正方形。仅输出 JSON，不要任何其他文字：{"objects":[{"label":"red_square","bbox":[x1,y1,x2,y2]}]}。若无法确定坐标则输出 {"objects":[]}。';

const RETRYABLE_STATUS = new Set([500, 502, 503]);

export class AgnesAdapter implements VLMProvider {
  readonly providerId = "agnes";
  readonly adapterVersion = "0.1.0";
  readonly capabilityIds: CapabilityId[] = [
    "image_understanding",
    "ocr",
    "multi_image",
    "structured_detection",
  ];

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AgnesAdapterConfig) {
    this.baseUrl = (config.baseUrl ?? AGNES_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = config.model ?? AGNES_DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? 180_000;
    this.maxRetries = config.maxRetries ?? 1;
    this.temperature = config.temperature ?? 0.2;
    this.fetchImpl = config.fetchImpl ?? fetch;
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
        confidence_supported: false,
        json_mode_supported: true,
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
      throw new VisionError(ApplicationErrorCode.PROVIDER_AUTH_FAILED, "Agnes apiKey 未配置", {
        recovery: { env_var: "AGNES_API_KEY" },
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
    };
    const url = `${this.baseUrl}/chat/completions`;

    let lastError: unknown;
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
          throw new VisionError(ApplicationErrorCode.PROVIDER_AUTH_FAILED, "Agnes 鉴权失败", {
            http_status: res.status,
          });
        }
        if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
          await delay(500 * (attempt + 1));
          continue;
        }
        if (!res.ok) {
          throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, `Agnes HTTP ${res.status}`, {
            http_status: res.status,
          });
        }
        const data: unknown = await res.json();
        const text = extractContent(data);
        if (typeof text !== "string") {
          throw new VisionError(ApplicationErrorCode.PROVIDER_INVALID_RESPONSE, "Agnes 返回结构异常");
        }
        return {
          text,
          providerMeta: {
            provider: this.providerId,
            model: this.model,
            // Contract Clarification：Agnes 无官方版本号，记录实际模型标识（永不漂移）
            model_version: this.model,
            execution_timestamp: new Date().toISOString(),
          },
        };
      } catch (err) {
        if (err instanceof VisionError || (err instanceof Error && err.name === "AbortError")) {
          throw err;
        }
        lastError = err;
        if (attempt < this.maxRetries) {
          await delay(500 * (attempt + 1));
          continue;
        }
        throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, "Agnes 请求失败", {
          cause: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw lastError;
  }
}

function extractContent(data: unknown): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  const choices = obj["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.["message"] as Record<string, unknown> | undefined;
  return message?.["content"];
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
