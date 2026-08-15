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
        "通用视觉观察：返回视觉证据 Observation（默认 label=visual_evidence 的证据文本；" +
        "json_mode=true 且 Provider 已验证结构化输出时返回结构化观察）。" +
        "只陈述可观察事实，绝无诊断或建议。",
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
