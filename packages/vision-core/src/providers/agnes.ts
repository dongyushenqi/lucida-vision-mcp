/**
 * Agnes 便捷配置形态 —— OpenAICompatibleAdapter 的一个配置实例。
 *
 * Agnes 是免费视觉 API（OpenAI 兼容端点），作为开发期实测 Provider
 * （`AGNES_*` env 快捷配置，**非默认模型**——本系统不预设默认模型，
 * 用哪个模型完全由用户接入决定）。
 * 千问 / 豆包 / GPT 等 OpenAI 兼容厂商各自只需一份配置实例，无需新 Adapter 类；
 * 协议形态不兼容的厂商（Anthropic 原生 / Gemini 原生）才需按 VLMProvider 接口新增 Adapter。
 */
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

export const AGNES_DEFAULT_BASE_URL = "https://apihub.agnes-ai.com/v1";
export const AGNES_DEFAULT_MODEL = "agnes-2.5-flash";

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
  /** 单图最大字节数（Declared constraints；应与 Server Fetch 上限一致） */
  maxImageSize?: number;
}

export class AgnesAdapter extends OpenAICompatibleAdapter {
  constructor(config: AgnesAdapterConfig) {
    super({
      providerId: "agnes",
      displayName: "Agnes (free vision API)",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? AGNES_DEFAULT_BASE_URL,
      model: config.model ?? AGNES_DEFAULT_MODEL,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      temperature: config.temperature,
      fetchImpl: config.fetchImpl,
      maxImageSize: config.maxImageSize,
      extraConstraints: {
        confidence_supported: false,
        json_mode_supported: true,
      },
    });
  }
}
