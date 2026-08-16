import { describe, expect, it } from "vitest";
import {
  canonicalize,
  extractOperationParameters,
  operationParameterIdentity,
} from "../src/canonical.js";

describe("JCS 规范化（RFC 8785 子集）", () => {
  it("与对象键顺序无关", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("确定性输出", () => {
    expect(canonicalize({ a: [1, true, null, "x"], b: { c: 1 } })).toBe(
      '{"a":[1,true,null,"x"],"b":{"c":1}}',
    );
  });

  it("字符串按 JSON 转义", () => {
    expect(canonicalize({ s: 'a"b\\c\n' })).toBe('{"s":"a\\"b\\\\c\\n"}');
  });

  it("拒绝非有限数值", () => {
    expect(() => canonicalize({ a: NaN })).toThrow();
    expect(() => canonicalize({ a: Infinity })).toThrow();
  });
});

describe("operationParameterIdentity（规格五.2）", () => {
  const base = {
    image_input: { type: "uri", uri: "https://example.com/a.png" },
    instruction: "描述图中可见的缺陷",
  };

  it("语义等价参数（键顺序不同）解析为相同身份", () => {
    const reordered = {
      instruction: "描述图中可见的缺陷",
      image_input: { uri: "https://example.com/a.png", type: "uri" },
    };
    expect(operationParameterIdentity("vision.observe", base)).toBe(
      operationParameterIdentity("vision.observe", reordered),
    );
  });

  it("URI 语义等价（审查 #9 最小归一化）：路径点段/host 大小写归一", () => {
    const a = {
      image_input: { type: "uri", uri: "HTTPS://EXAMPLE.com/a.png" },
      instruction: "x",
    };
    const b = {
      image_input: { type: "uri", uri: "https://example.com/./a.png" },
      instruction: "x",
    };
    expect(operationParameterIdentity("vision.observe", a)).toBe(
      operationParameterIdentity("vision.observe", b),
    );
  });

  it("inline MIME 大小写/参数归一（审查 #9 最小归一化）", () => {
    const a = {
      image_input: { type: "inline", inline: { mime_type: "image/PNG", blob: "AA==" } },
      instruction: "x",
    };
    const b = {
      image_input: { type: "inline", inline: { mime_type: "image/png; charset=utf-8", blob: "AA==" } },
      instruction: "x",
    };
    expect(operationParameterIdentity("vision.observe", a)).toBe(
      operationParameterIdentity("vision.observe", b),
    );
  });

  it("image_inputs 数组（summarize）：逐元素归一化，元素等价 → 相同身份", () => {
    const a = {
      image_inputs: [
        { type: "uri", uri: "HTTPS://EXAMPLE.com/./a.png" },
        { type: "inline", inline: { mime_type: "image/PNG", blob: "AA==" } },
      ],
      instruction: "x",
    };
    const b = {
      image_inputs: [
        { type: "uri", uri: "https://example.com/a.png" },
        { type: "inline", inline: { mime_type: "image/png; charset=utf-8", blob: "AA==" } },
      ],
      instruction: "x",
    };
    expect(operationParameterIdentity("vision.summarize", a)).toBe(
      operationParameterIdentity("vision.summarize", b),
    );

    // 元素不同（图不同）→ 身份不同（去重语义：参数不同即新操作）
    const c = {
      image_inputs: [
        { type: "uri", uri: "https://example.com/a.png" },
        { type: "uri", uri: "https://example.com/b.png" },
      ],
      instruction: "x",
    };
    expect(operationParameterIdentity("vision.summarize", a)).not.toBe(
      operationParameterIdentity("vision.summarize", c),
    );
  });

  it("忽略协议/追踪/认证元数据与 operation_id（请求身份非操作参数）", () => {
    const withTrace = {
      ...base,
      trace_id: "t-1",
      mcp_session_id: "s-1",
      authorization: "Bearer x",
      operation_id: "op-1",
    };
    const otherTrace = {
      ...base,
      trace_id: "t-2",
      mcp_session_id: "s-2",
      authorization: "Bearer y",
      operation_id: "op-2",
    };
    expect(operationParameterIdentity("vision.observe", withTrace)).toBe(
      operationParameterIdentity("vision.observe", otherTrace),
    );
  });

  it("语义参数变化则身份变化", () => {
    const other = { ...base, instruction: "不同指令" };
    expect(operationParameterIdentity("vision.observe", base)).not.toBe(
      operationParameterIdentity("vision.observe", other),
    );
  });

  it("返回 sha256 前缀的 64 位十六进制", () => {
    expect(operationParameterIdentity("vision.observe", base)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("extractOperationParameters 剔除传输元数据键", () => {
    const out = extractOperationParameters({ ...base, trace_id: "t" });
    expect(out).not.toHaveProperty("trace_id");
    expect(out).toHaveProperty("image_input");
  });
});
