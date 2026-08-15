/**
 * IQA —— Image Quality / Feasibility Assessment（规格 Layer 4 职责；三.2 Final Executable）。
 *
 * - Final Executable Capability = Effective Capability ∩ IQA Capability Assessment；
 * - IQA Result Semantics 封口（规格三.2）：IQA 结果默认属于 Execution Metadata /
 *   Capability Assessment，**不得自动进入 Observation Graph**——本模块只产出
 *   评估对象，代码路径上无法触达图谱；
 * - 只陈述技术可行性事实（可解码性、尺寸、约束），无任何建议/决策。
 */
import type { ScopeAndConstraints } from "@mcp-vision/contracts";
import { sniffMimeType } from "./mime.js";

export interface IqaResult {
  /** 是否可解码为受支持图像格式 */
  decodable: boolean;
  format: string;
  width: number;
  height: number;
  /** 技术属性/质量指标（Execution Metadata，默认不进 Observation Graph） */
  metrics: Record<string, unknown>;
  /** 技术可行性判断（当前输入在当前约束下） */
  executable: boolean;
  /** 不可执行的原因（事实陈述） */
  reasons: string[];
}

export interface IqaConfig {
  /** 长边最大像素（V1 默认不限制，由 Provider constraints 决定） */
  maxDimension?: number;
}

/** 解析图像尺寸；未知格式/解析失败返回 0。 */
export function readImageDimensions(
  bytes: Uint8Array,
  format: string,
): { width: number; height: number } {
  const b = bytes;
  switch (format) {
    case "image/png": {
      // IHDR: 宽高在 offset 16/20（大端）
      if (b.length >= 24) {
        return { width: readU32BE(b, 16), height: readU32BE(b, 20) };
      }
      return { width: 0, height: 0 };
    }
    case "image/gif": {
      // 逻辑屏幕描述：offset 6（小端 16 位）
      if (b.length >= 10) {
        return { width: readU16LE(b, 6), height: readU16LE(b, 8) };
      }
      return { width: 0, height: 0 };
    }
    case "image/bmp": {
      // BITMAPINFOHEADER: offset 18/22（小端 32 位）
      if (b.length >= 26) {
        return { width: readU32LE(b, 18), height: Math.abs(readI32LE(b, 22)) };
      }
      return { width: 0, height: 0 };
    }
    case "image/jpeg": {
      // 扫描 SOF0/1/2 段：FF C0/C1/C2，高度/宽度在段内 offset 5/7（大端）
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i += 1;
          continue;
        }
        // while 条件保证 i + 1 < b.length，非空断言安全
        const marker = b[i + 1]!;
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          i += 2;
          continue;
        }
        const len = readU16BE(b, i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          if (i + 9 < b.length) {
            return { width: readU16BE(b, i + 7), height: readU16BE(b, i + 5) };
          }
          return { width: 0, height: 0 };
        }
        i += 2 + len;
      }
      return { width: 0, height: 0 };
    }
    default:
      return { width: 0, height: 0 };
  }
}

/**
 * IQA 评估：可解码性 + 尺寸/字节约束。
 * constraints 来自 Effective Capability（Scope and Constraints 保留原则），
 * 支持 `max_image_size`（字节）与 `max_dimension`（长边像素）。
 */
export function assessImage(
  bytes: Uint8Array,
  declaredMime: string,
  constraints: ScopeAndConstraints | undefined,
  config: IqaConfig = {},
): IqaResult {
  const format = sniffMimeType(bytes);
  const metrics: Record<string, unknown> = { bytes: bytes.byteLength };

  if (!format) {
    return {
      decodable: false,
      format: "unknown",
      width: 0,
      height: 0,
      metrics,
      executable: false,
      reasons: ["undecodable_image_format"],
    };
  }

  const { width, height } = readImageDimensions(bytes, format);
  metrics.format = format;
  metrics.width = width;
  metrics.height = height;

  const reasons: string[] = [];
  const maxBytes = numConstraint(constraints?.["max_image_size"]);
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    reasons.push(`payload_exceeds_max_image_size(${maxBytes})`);
  }
  const maxDimension = config.maxDimension ?? numConstraint(constraints?.["max_dimension"]);
  if (maxDimension !== undefined && Math.max(width, height) > maxDimension) {
    reasons.push(`dimension_exceeds_max_dimension(${maxDimension})`);
  }

  return {
    decodable: true,
    format,
    width,
    height,
    metrics,
    executable: reasons.length === 0,
    reasons,
  };
}

function numConstraint(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function readU16BE(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function readU16LE(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}

function readU32LE(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

function readI32LE(b: Uint8Array, o: number): number {
  return readU32LE(b, o) | 0;
}
