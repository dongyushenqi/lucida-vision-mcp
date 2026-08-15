# Provider 接入指南（两类分法）

> 规则（用户定义）：**凡是能走主流协议的 AI，归一类，不点名具体厂商；
> 不能走主流协议的 AI，单独设置。**

## 第一类：主流协议（OpenAI 兼容）—— 配置即用，零代码

只要 AI 提供 **OpenAI 兼容的 chat/completions 接口**（绝大多数视觉模型都是：
千问 DashScope、豆包火山方舟、GPT、Agnes、各类网关……），接入 = 填一份配置：

```bash
VISION_PROVIDERS_JSON='[
  {"providerId":"qwen","apiKey":"<key>","baseUrl":"https://dashscope.aliyuncs.com/compatible-mode/v1","model":"qwen-vl-max","displayName":"通义千问"},
  {"providerId":"doubao","apiKey":"<key>","baseUrl":"https://ark.cn-beijing.volces.com/api/v3","model":"doubao-1.5-vision-pro","displayName":"豆包"},
  {"providerId":"gpt","apiKey":"<key>","baseUrl":"https://api.openai.com/v1","model":"gpt-4o","displayName":"GPT"}
]' node lib/index.js
```

字段含义：

| 字段 | 说明 |
|---|---|
| `providerId` | 内部标识（小写字母/数字/下划线），Agent 用它在工具参数里点名选谁执行 |
| `apiKey` | 该厂商的密钥（只经环境变量注入，**绝不写入代码/仓库**） |
| `baseUrl` | 该厂商的 OpenAI 兼容端点根地址（厂商文档里找 "base url"） |
| `model` | 视觉模型名（厂商文档里找，如 `qwen-vl-max`） |
| `displayName` | 给 Agent/日志看的显示名（可选） |

启动后系统会对**每家**自动跑能力探针（理解/OCR/结构化检测各一次），
每家"声称能干"和"实际能干"分开记录——没通过探针的能力，工具会如实报告不可执行，绝不假装能干。

## 第二类：非主流协议 —— 写一个适配器类

协议形态不兼容 OpenAI 的 AI（如 Anthropic 原生 Messages、Gemini 原生 generateContent），
按 `VLMProvider` 接口单独实现一个类，四个方法：

```ts
class AnthropicAdapter implements VLMProvider {
  readonly providerId = "claude";
  readonly protocolFamily = "native";        // 第二类
  readonly adapterVersion = "0.1.0";
  readonly capabilityIds = ["image_understanding", "ocr", "structured_detection"];

  declare() { /* 声明能力与约束（大小限制/输出格式等） */ }
  probe(signal) { /* 用小测试图验证能力；结果只进能力注册表 */ }
  execute(req, signal) { /* 把 req.images 的字节转成该厂商的图片格式发请求 */ }
}
```

硬性约束（新适配器必须遵守，防止破坏"眼睛不是大脑"边界）：

1. **绝不自己联网取图**——只接收已通过 Fetch Boundary 的本地字节（图片一律内联传给厂商）；
2. **取消只认内部 AbortSignal**，不依赖 MCP 取消机制；
3. **probe 结果绝不产生 Observation**（只更新能力注册表）；
4. 5xx 只能有界重试，**绝不做跨厂商自动切换**（选谁执行是 Agent 的事）；
5. 返回文本证据 + 完整 provenance（provider/model/model_version/时间戳），不输出任何建议。

写完后把它加进 `packages/server/src/index.ts` 的 providers 数组即可，其余架构不动。

## 验证

- 第一类：改配置重启即生效，`pnpm -r run test` 的通用适配器用例覆盖多厂商行为；
- 第二类：新适配器需要自己的单测（mock 厂商响应）+ 有条件时用真实 key 跑 `e2e-real.mjs`。
