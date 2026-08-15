# 安全策略（Security）

## 密钥安全（最重要）

- 所有 Provider 密钥（`AGNES_API_KEY` 等）**只经环境变量注入**（本地 shell / GitHub Secret），
  源码、测试、文档、git 历史中**严禁出现真实密钥**；
- 本系统不存储、不读取、不写入任何密钥文件；
- CI 与发布流程不接触任何密钥（npm 发布经 GitHub Secret `NPM_TOKEN` 注入，不落盘）。

## 服务端取图安全（统一 Fetch Boundary）

- `type=uri` 的图像获取**必须**经统一 Fetch Boundary：
  - SSRF 防护矩阵（私有/保留/链路本地/多播地址阻断，DNS 重绑定防护）；
  - 重定向校验（仅 http/https、≤5 跳，重定向目标同样过授权策略）；
  - 大小限制（解码前后双重校验）与 MIME sniff（声明与实际不符即拒绝）；
- **SSRF 防护 ≠ 资源授权**：URI 来源策略（`VISION_ALLOWED_URI_ORIGINS`）与授权钩子
  独立判定资源可否获取；401/403 如实报告 `SECURITY_URI_DENIED`。

## 会话与授权

- Vision Session 绑定创建者 Principal/Tenant，任何访问都做归属校验；
- Session ID 不得单独作为授权凭证（不可预测性 ≠ 授权）；
- 关闭的 Session 拒绝新执行，保留证据只读。

## 报告漏洞

发现安全问题时，请**不要公开披露**，直接联系维护者（GitHub Issues 中标注 security，
或邮件维护者）。修复前不公开细节。
