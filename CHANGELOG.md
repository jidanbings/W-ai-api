# 更新日志

## [1.0.0] - 2026-07-27

### 安全修复：添加响应安全头和 CSP 策略

所有响应（包括错误页面）统一添加安全响应头，防止常见 Web 攻击。

- `X-Content-Type-Options: nosniff` — 防止 MIME 类型嗅探
- `X-Frame-Options: DENY` — 禁止页面被嵌入 iframe，防止点击劫持
- `Referrer-Policy: no-referrer` — 禁止在请求头中发送 Referer 信息
- `Content-Security-Policy` — 限制资源加载来源，仅允许同源和可信 CDN（cdnjs.cloudflare.com）

### 安全修复：CDN 脚本添加子资源完整性 (SRI)

管理后台 `admin.html` 中引用的 Chart.js 和 QRCode.js 添加 `integrity` 和 `crossorigin="anonymous"` 属性，防止 CDN 被篡改后执行恶意代码。

- `Chart.js 4.4.1` — `sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD`
- `QRCode.js 1.0.0` — `sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU`

### 安全修复：WebSocket 认证加固

`handleWebSocketRequest` 中 API Key 仅从 `x-api-key` 请求头获取，不再支持 URL 参数传递，避免 API Key 出现在服务器日志、浏览器历史记录和 Referer 头中。

### 安全修复：管理后台 CF Token 保护

CF Token 不再嵌入 HTML `onclick` 属性，仅存于 JS 内存变量 `window.__accounts`，防止通过查看页面源码泄露 Token。

### 安全修复：API Key 格式校验

`checkProxyAuth` 中新增 `isValidApiKeyFormat` 校验，密钥必须以 `sk-wa-` 开头且长度至少 20 字符，格式不合法直接拒绝，减少无效认证请求开销。

### 功能修复：登录限流原子化

`recordFailedAttempt` 使用 `INSERT ... ON CONFLICT` 原子操作替代先查后改，避免并发登录请求绕过限流检查。

### 功能修复：GraphQL 超时控制

Cloudflare 账号用量查询（GraphQL API）添加 `AbortController` 30 秒超时，避免某个账号响应慢导致整个请求卡死。

### 功能修复：代理接口请求频率限制

`handleV1Proxy` 中新增基于 IP 的请求频率限制，每分钟最多 60 次请求，超限返回 HTTP 429 `rate_limit_exceeded`，防止滥用。

### 功能修复：CSRF 防护

`/api/auth/login` 登录接口验证 `Origin` 或 `Referer` 是否与请求自身的 `Host` 头匹配（同源校验），而非硬编码域名白名单，确保自定义域名也能正常使用。无 Origin/Referer 时放行（兼容 curl 等非浏览器客户端）。

### 功能修复：登录审计日志

新增 `login_audit_logs` 数据库表和 `logLoginAudit` 函数，每次登录尝试（成功/失败）均记录 IP、状态、User-Agent 和时间戳，便于安全审计。

> **部署注意**：需要在 D1 数据库中执行以下 SQL 创建新表：
> ```sql
> CREATE TABLE IF NOT EXISTS login_audit_logs (
>     id INTEGER PRIMARY KEY AUTOINCREMENT,
>     ip TEXT NOT NULL,
>     status TEXT NOT NULL,
>     user_agent TEXT DEFAULT '',
>     created_at INTEGER NOT NULL
> );
> CREATE INDEX IF NOT EXISTS idx_login_audit_logs_created_at ON login_audit_logs(created_at);
> CREATE INDEX IF NOT EXISTS idx_login_audit_logs_ip ON login_audit_logs(ip);
> ```

### 技术优化：流式响应 CPU 优化

`wrapStreamWithUsageTracking` 中仅解析包含 `usage` 字段的 SSE 数据块，对 ~99% 的文本 delta 块直接透传（跳过 JSON.parse/stringify），1000 块响应从 ~25ms 降至 ~1.5ms。

### 技术优化：配置缓存 TTL 调整

`CONFIG_CACHE_TTL` 从 60 秒降至 30 秒，配置变更后更快生效，减少管理后台操作后的等待时间。

### 技术优化：Fetch 超时

`callOpenAICompatibleAPI` 中后端请求统一设置 `FETCH_TIMEOUT_MS = 60000` 超时，避免某个后端卡死导致整个请求失败。

### 文档：更新架构文档

`docs/architecture.md` 全面更新安全机制章节，新增安全头、SRI、CSRF 防护、登录审计日志、代理接口限流等说明，以及 `login_audit_logs` 表结构定义。

### 文档：更新 README

README.md 更新安全章节、项目结构、初始化 SQL 表定义（新增 `login_audit_logs` 表），架构概览图补充请求频率限制步骤。

### 文档：清理演示域名和 API Key

移除所有演示域名引用，替换为 `你的项目名.pages.dev` 通用占位符。