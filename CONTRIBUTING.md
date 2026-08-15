# 贡献指南（Contributing）

感谢你对 lucida-vision-mcp 的兴趣。请遵守以下约定。

## 架构铁律（最高优先级）

本系统遵循《MCP Vision Server 架构与接口规格说明书》V3.7（契约已冻结）：

1. **眼睛不是大脑**：绝不输出领域诊断、行动建议或工作流编排；
   任何"智能路由 / 视觉推理引擎 / 领域知识引擎"类概念禁止进入 Vision Core；
2. **四层物理隔离**：`vision-core` 禁止 import 任何 MCP 协议包；
3. **能力不撒谎**：能力探针（Declared ∩ Verified）未验证的能力如实报告"不可执行"；
4. **取消与提交边界**：取消绝不销毁已 committed 证据；状态机无 `partially_completed`；
5. **错误码隔离**：应用级错误走 `error.data.application_error_code`（`VISION_*` 等命名空间），
   不覆盖 JSON-RPC `code` 语义；错误响应无 `suggested_action`。

## 变更分类（必须二选一归档到 docs/DECISIONS.md）

| 类别 | 含义 |
|---|---|
| Bug | 实现偏离规格说明书 |
| Implementation Decision | 规格允许范围内的技术选型/参数 |
| Protocol Adapter Issue | Compatibility Layer 的 Host 兼容性微调 |
| Contract Clarification | 契约边缘情况的解释（不引入新实体） |
| Protocol Compliance Issue | 与正式 MCP 规范冲突的纠正（受 Freeze Precedence 约束） |

Frozen Contract 不可变更；"优化"不得作为重启架构设计的理由。

## 开发流程

```bash
pnpm install
pnpm -r run build
pnpm -r run test        # 无 key 时真实 API 用例自动跳过
```

- 新功能必须有配套单测（当前基线 154+ 测试）；
- 涉及真实 Provider 的验证：`AGNES_API_KEY=<key> node packages/server/e2e-real.mjs`；
- 提交前跑通 build + test。

## 密钥纪律

- 任何真实密钥严禁进入代码/测试/文档/提交信息；
- 测试用假密钥统一使用 `sk-test`。
