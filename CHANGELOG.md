# Changelog / 版本说明

从 v0.4.0 起，每版在此用中英双语简短记录：**改了什么、怎么用**。

---

## v0.4.0 (2026-08-17)

**改了什么 / What changed**

- 新增 `vision.session.audit`（第 10 个工具，专业模块）：Session 审计汇总，**按需调用**——仅当用户明确要求审计/记录/汇总/导出时使用，绝不主动输出；默认返回操作级汇总，`include_observations: true` 附全量观察元数据（label/location/confidence/limitations/source，location 即区域对应）。
- 性能优化（质量底线不变）：① Provider 能力探针三并发并行——启动探针耗时约 3× → 1×；② 新增 `VISION_PROBE_ASYNC=true` 后台探针开关——服务器立即就绪，探针完成自动开放能力（未验证期间工具如实报"不可执行"）；③ summarize 批量解析有界并发 4——并发抓取的瞬时缓冲降为 1/4（图片字节仍需全部驻留以转发 Provider）；④ 新增 `VISION_PROBE_TIMEOUT_MS` 探针超时配置（默认 60000）；⑤ 启动复用持久化验证结果（TTL 内跳过重探，不再每次重启等完整探针）。
- 审查修复：⑥ 多图契约对齐——Provider 如实声明 `max_images_per_request`（默认 16，单图模型可配 1），summarize 超限被能力门禁提前拦截（不再向单图 Provider 发多图）；⑦ 批量解析失败即停（任一图失败中止其余在飞请求，不等无谓等待）；⑧ 429 限流纳入有界重试（防并行探针下免费模型限流雪崩）。
- 测试 209 个全绿（三平台 CI）。

**怎么用 / How to use**

- 审计：`vision.session.audit { vision_session_id, include_observations? }`
- 后台探针：宿主配置 env 加 `VISION_PROBE_ASYNC=true`（启动更快）
- 探针超时：env 加 `VISION_PROBE_TIMEOUT_MS=30000`（毫秒）

## 历史版本 / Previous versions

- **v0.3.0** 声明式结构化观察：`observe` 新增 `observation_schema`（声明维度 → 逐字段 value / unknown+reason）
- **v0.2.1** 观察档位：`profile: "default" | "deep"`（深入指令包，仅明确要求时使用）
- **v0.2.0** `vision.summarize`：1~16 张图批量散文式综合概述
- **v0.1.3** 默认观察指令校准（主体聚焦 / 水印默认忽略 / 主观评价三档）
- **v0.1.2** `file://` 本地取图默认开启
- **v0.1.1** 本地取图通道修复（scheme 白名单 / 私有地址开关）
- **v0.1.0** 首次发布
