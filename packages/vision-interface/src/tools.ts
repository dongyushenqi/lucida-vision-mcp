/**
 * V1 工具清单（7 个）。inputSchema 供 Compatibility Layer 注册为 MCP Tool。
 */
import type { z } from "zod";
import {
  DetectArgs,
  ObserveArgs,
  OcrArgs,
  OperationCancelArgs,
  OperationGetArgs,
  SessionCreateArgs,
  SessionDeleteArgs,
  SessionGetArgs,
} from "./args.js";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

export const VISION_TOOL_NAMES = [
  "vision.session.create",
  "vision.session.get",
  "vision.session.delete",
  "vision.observe",
  "vision.detect",
  "vision.ocr",
  "vision.operation.get",
  "vision.operation.cancel",
] as const;

export function createVisionTools(): ToolSpec[] {
  return [
    {
      name: "vision.session.create",
      description: "创建新的 Vision Session（绑定当前 Principal/Tenant）。返回 vision_session_id。",
      inputSchema: SessionCreateArgs,
    },
    {
      name: "vision.session.get",
      description: "查询 Vision Session 状态（须归属当前 Principal/Tenant）。",
      inputSchema: SessionGetArgs,
    },
    {
      name: "vision.session.delete",
      description: "关闭 Vision Session（已提交证据按 retention 保留）。",
      inputSchema: SessionDeleteArgs,
    },
    {
      name: "vision.observe",
      description:
        "通用视觉观察：返回可观察的视觉事实（默认聚焦图片主体，不转录水印等细小文字）。" +
        "默认不主动输出主观评价；用户明确要求时，基于可观察特征参考普遍审美标准给出，并说明依据。" +
        "文字转录请用 vision.ocr。只陈述事实，不推断诊断。",
      inputSchema: ObserveArgs,
    },
    {
      name: "vision.detect",
      description:
        "按 Agent 声明的视觉类别做结构化检测（JSON bbox）。" +
        "仅当 Provider 已验证 structured_detection 能力时方可执行，否则返回可行性评估事实。",
      inputSchema: DetectArgs,
    },
    {
      name: "vision.ocr",
      description: "提取图中文字，返回 text_block Observation。",
      inputSchema: OcrArgs,
    },
    {
      name: "vision.operation.get",
      description: "查询 Operation 生命周期状态（completed / cancelled / failed / running）。",
      inputSchema: OperationGetArgs,
    },
    {
      name: "vision.operation.cancel",
      description: "取消 Operation。已 committed 的 Observation/Artifact 保留（取消不是错误）。",
      inputSchema: OperationCancelArgs,
    },
  ];
}
