import { describe, expect, it } from "vitest";
import {
  APPLICATION_ERROR_NAMESPACES,
  ApplicationErrorCode,
  VisionError,
} from "../src/errors.js";

describe("错误码命名空间隔离（规格五.3）", () => {
  it("所有应用错误码都以声明的前缀开头", () => {
    for (const code of Object.values(ApplicationErrorCode)) {
      expect(
        APPLICATION_ERROR_NAMESPACES.some((ns) => code.startsWith(`${ns}_`)),
        `错误码 ${code} 未归属声明的前缀`,
      ).toBe(true);
    }
  });

  it("不存在重复值", () => {
    const values = Object.values(ApplicationErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });

  it("VisionError 生成 error.data 承载结构", () => {
    const err = new VisionError(ApplicationErrorCode.OPERATION_ID_CONFLICT, "参数已变化");
    expect(err.toApplicationErrorData()).toEqual({
      application_error_code: "OPERATION_ID_CONFLICT",
      message: "参数已变化",
    });
  });

  it("携带 details 且不含任何建议字段", () => {
    const err = new VisionError(ApplicationErrorCode.SECURITY_SSRF_BLOCKED, "私有地址", {
      address: "10.0.0.1",
    });
    const data = err.toApplicationErrorData();
    expect(data.details).toEqual({ address: "10.0.0.1" });
    expect(data).not.toHaveProperty("suggested_action");
  });
});
