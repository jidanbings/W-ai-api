# W-ai-api 架构文档

## 项目概述

**W-ai-api** 是一个基于 Cloudflare Workers + Pages 的 AI API 代理服务，将 Cloudflare Workers AI 网关转换为 **OpenAI 兼容** 和 **Anthropic Messages 兼容** 的 API 接口。支持多账号负载均衡、用量统计、API Key 鉴权、2FA 双因素认证、WebSocket 流式传输等功能。

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Cloudflare Workers (ES Module) |
| 静态托管 | Cloudflare Pages (ASSETS) |
| 持久化存储 | Cloudflare KV + D1 (绑定名: `KV` + `DB`) |
| 前端 | 单页应用 (Vanilla JS + Chart.js) |
| 部署方式 | Cloudflare Pages 部署 (含 `_worker.js`) |

---

## 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ADMIN_PASSWORD` | 是 | 管理员登录密码，未配置时所有请求被拦截 |
| `KV` | 是 | KV 命名空间绑定（仅用于 Session 和 2FA 临时数据） |
| `DB` | 是 | D1 数据库绑定（用于配置、密钥用量、限流、缓存等持久化数据） |

---

## 路由表

### 0. 请求预处理

所有请求进入 `_worker.js` 的 `fetch()` 入口后的处理顺序：

1. **静态资源放行** — 扩展名为 `.css` `.js` `.png` `.jpg` `.svg` `.ico` `.woff2` 的直接返回 `env.ASSETS.fetch(request)`
2. **KV 检查** — 未绑定 KV 时返回 500 错误页面
3. **D1 检查** — 未绑定 D1 时返回 500 错误页面
4. **ADMIN_PASSWORD 检查** — 未配置时返回 500 错误页面
5. **CORS 预检** — `OPTIONS *` 返回 CORS 头
6. 按路径前缀匹配以下路由

### 1. OpenAI 兼容代理接口 (`/v1/`)

| 方法 | 路径 | 认证 | 说明 | 处理函数 |
|------|------|------|------|----------|
| `GET` | `/v1/models` | API Key | 获取可用模型列表 | `handleV1Proxy` → `getCustomModelMap` |
| `POST` | `/v1/chat/completions` | API Key | 对话补全 (OpenAI 格式) | `handleV1Proxy` → `handleCompletions` |
| `POST` | `/v1/completions` | API Key | 文本补全 | `handleV1Proxy` → `handleCompletions` |
| `POST` | `/v1/messages` | API Key | Anthropic Messages API | `handleV1Proxy` → `handleMessages` |
| `POST` | `/v1/embeddings` | API Key | 向量嵌入 | `handleV1Proxy` → `handleEmbeddings` |
| `WebSocket` | `/v1/` (Upgrade) | API Key(query) | WebSocket 流式对话 | `handleV1Proxy` → `handleWebSocketRequest` |

**认证方式**（按优先级）：
- `x-api-key` 请求头
- `Authorization: Bearer <key>` 请求头
- 未配置任何 API Key 时跳过认证（公开）

### 2. 后台管理 API (`/api/`)

#### 2.1 认证接口（无需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/auth/status` | 查询初始化状态（始终返回已初始化） | `handleDashboardApi` |
| `POST` | `/api/auth/setup` | 设置管理员密码（已废弃，返回错误） | `handleDashboardApi` |
| `POST` | `/api/auth/login` | 登录（含 IP 限流 + 2FA 两步验证） | `handleDashboardApi` |
| `POST` | `/api/auth/logout` | 退出登录（清除 session + Cookie） | `handleDashboardApi` |
| `GET` | `/api/auth/2fa/status` | 查询 2FA 启用状态（需登录） | `handleDashboardApi` |
| `POST` | `/api/auth/2fa/setup` | 生成 TOTP 密钥和 `otpauth://` URI（需登录） | `handleDashboardApi` |
| `POST` | `/api/auth/2fa/verify-setup` | 验证 TOTP 码后正式启用 2FA（需登录） | `handleDashboardApi` |
| `POST` | `/api/auth/2fa/disable` | 验证 TOTP 码后禁用 2FA（需登录） | `handleDashboardApi` |

#### 2.2 公开用量接口（无需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/usage/summary` | 获取用量汇总（缓存 5 分钟） | `handleDashboardApi` |
| `POST` | `/api/usage/summary` | 强制刷新用量汇总 | `handleDashboardApi` |

#### 2.3 账号管理（需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/accounts` | 获取所有 Cloudflare 账号列表（Token 脱敏） | `handleDashboardApi` |
| `POST` | `/api/accounts` | 新增/编辑 Cloudflare 账号 | `handleDashboardApi` |
| `DELETE` | `/api/accounts` | 删除 Cloudflare 账号 | `handleDashboardApi` |
| `POST` | `/api/accounts/test` | 测试账号连接（验证 3 个 API 权限） | `handleDashboardApi` |
| `GET` | `/api/accounts/usage` | 获取各账号详细用量（含 7 天历史） | `handleDashboardApi` |

#### 2.4 外部服务商管理（需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/external-providers` | 获取所有外部服务商列表 | `handleDashboardApi` |
| `POST` | `/api/external-providers` | 新增/编辑外部服务商 | `handleDashboardApi` |
| `DELETE` | `/api/external-providers` | 删除外部服务商（单个映射行不可删除） | `handleDashboardApi` |
| `PATCH` | `/api/external-providers` | 部分更新外部服务商（如切换状态） | `handleDashboardApi` |
| `POST` | `/api/external-providers/test` | 测试服务商连接 | `handleDashboardApi` |

#### 2.5 API 密钥管理（需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/keys` | 获取所有 API 密钥 | `handleDashboardApi` |
| `POST` | `/api/keys` | 生成新的 API 密钥 | `handleDashboardApi` |
| `DELETE` | `/api/keys` | 删除 API 密钥 | `handleDashboardApi` |
| `PATCH` | `/api/keys` | 部分更新密钥（如切换状态、重置限额） | `handleDashboardApi` |
| `GET` | `/api/keys/usage` | 获取每个密钥的用量统计（永久保留，含已删除密钥） | `handleDashboardApi` |

#### 2.6 用量明细查询（需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/usage/request-logs` | 请求日志查询（按 key_id + 日期分页） | `handleDashboardApi` |
| `GET` | `/api/usage/account-usage` | 账号级用量查询（按日期范围） | `handleDashboardApi` |
| `GET` | `/api/usage/model-stats` | 模型性能统计（多维度图表数据） | `handleDashboardApi` |

#### 2.7 模型映射设置（需登录）

| 方法 | 路径 | 说明 | 处理函数 |
|------|------|------|----------|
| `GET` | `/api/settings` | 获取自定义模型映射 + 模型备注 + 禁用映射 | `handleDashboardApi` |
| `POST` | `/api/settings` | 保存自定义模型映射 + 模型备注 + 禁用映射 | `handleDashboardApi` |
| `GET` | `/api/models` | 获取完整模型列表（预设 + 自定义 + 服务商模型） | `handleDashboardApi` |

### 3. 页面路由

| 路径 | 认证 | 说明 | 处理函数 |
|------|------|------|----------|
| `/` | 否 | 首页/登录页，返回 `index.html` | `handleLandingPage` |
| `/index.html` | 否 | 同上 | `handleLandingPage` |
| `/admin` | 需 Cookie 登录 | 管理后台页面，返回 `admin.html` | `handleAdminPage` |
| `/admin/` | 需 Cookie 登录 | 同上 | `handleAdminPage` |
| `/admin.html` | 需 Cookie 登录 | 同上（未登录时 302 跳转到 `/`） | `handleAdminPage` |
| `/robots.txt` | 否 | 返回 `User-agent: * Disallow: /` | 内联返回 |

### 4. 兜底路由

| 条件 | 行为 |
|------|------|
| 其他路径，ASSETS 中有匹配 | 返回静态资源（加 `Cache-Control: max-age=3600`） |
| 其他路径，ASSETS 中无匹配 | 返回 `404 Not Found` |

---

## 数据流

### 1. API 代理请求流

```
客户端 (OpenAI SDK / Anthropic SDK)
  │
  ▼
/v1/chat/completions 或 /v1/messages 或 /v1/embeddings
  │
  ├─ 1. 路由分发 (handleV1Proxy)
  │     ├─ /v1/models → 返回模型列表（预设 + 自定义 + 服务商）
  │     ├─ /v1/chat/completions → handleCompletions
  │     ├─ /v1/completions → handleCompletions
  │     ├─ /v1/messages → handleMessages (格式转换)
  │     ├─ /v1/embeddings → handleEmbeddings
  │     └─ WebSocket → handleWebSocketRequest
  │
  ├─ 2. 鉴权 (checkProxyAuth) → x-api-key / Bearer 与 D1 中的 API Key
  │     └─ 未配置密钥时跳过认证（公开模式）
  │
  ├─ 3. 每日限额检查 (checkKeyDailyNeuronLimit)
  │     ├─ 未超限 → 继续
  │     └─ 超限 → 返回 429 { insufficient_quota }
  │
  ├─ 4. 模型名解析 (resolveModelName)
  │     ├─ @cf/ 开头 → 直接透传
  │     ├─ 自定义映射查找 → 预设映射查找 → 默认值兜底
  │     └─ 检查 disabled_mappings（禁用映射被阻止）
  │
  ├─ 5. 格式转换 (Anthropic ↔ OpenAI，仅 /v1/messages)
  │     ├─ 请求：Anthropic Messages → OpenAI Chat Completions
  │     └─ 响应：OpenAI → Anthropic（含 SSE 流式实时转换）
  │
  ├─ 6. 多后端负载均衡 (callOpenAICompatibleAPI)
  │     ├─ 收集可用后端：
  │     │    ├─ AI Binding (env.AI，优先级可配)
  │     │    ├─ Cloudflare 账号 (active 状态)
  │     │    └─ 外部服务商 (active + 未超限 + 有模型映射)
  │     ├─ 若密钥有 providerIds 白名单 → 只保留匹配后端
  │     ├─ 按 priority 升序分组，同优先级随机打乱
  │     ├─ 依次请求，成功则返回
  │     └─ 全部失败 → 502 错误
  │
  └─ 7. ctx.waitUntil(logApiUsage) — 异步记录用量
        ├─ 更新 key_usage_logs（密钥级每日汇总）
        ├─ 更新 account_usage（账号级每日汇总）
        ├─ 更新 model_stats（模型级性能统计）
        └─ 更新 request_logs（含 100 条时间序列）
```

### 2. 管理后台请求流（含 2FA）

```
浏览器 → 登录页 (/)
  │
  ├─ POST /api/auth/login { password }
  │    ├─ 2FA 未启用 → 创建 Session → 设置 Cookie → 跳转 /admin
  │    └─ 2FA 已启用 → 返回 { needs2fa: true, tempToken }
  │         │
  │         └─ POST /api/auth/login { tempToken, totpCode }
  │              ├─ TOTP 验证通过 → 创建 Session（verified2fa=true）→ 跳转 /admin
  │              └─ TOTP 验证失败 → 返回 401
  │
  └─ 登录成功 → /admin (管理后台)
       │
       ├─ 所有 /api/ 请求通过 Cookie 中的 admin_token 鉴权
       │    ├─ Session 无 verified2fa 标记 + 2FA 已启用 → 自动失效
       │    └─ Session 有效 → 处理请求
       │
       ├─ 2FA 管理 → 设置/禁用 2FA（需验证当前 TOTP 码）
       ├─ 账号管理 → CRUD 操作 D1 config_store 中的 accounts（Token 脱敏）
       ├─ 外部服务商管理 → CRUD 操作 D1 config_store 中的 external_providers
       ├─ API 密钥管理 → CRUD 操作 D1 config_store 中的 api_keys
       ├─ 请求日志查询 → 读取 D1 request_logs 表（分页）
       ├─ 密钥用量统计 → 读取 D1 key_usage_logs 汇总（含已删除密钥）
       ├─ 账号用量统计 → 通过 Cloudflare GraphQL API + D1 account_usage
       ├─ 模型性能统计 → 读取 D1 model_stats（多维度图表）
       ├─ 模型映射 → CRUD 操作 D1 config_store 中的 custom_model_map / model_notes / disabled_mappings
       └─ 完整模型列表 → 合并 DEFAULT_MODEL_MAP + 自定义映射 + 外部服务商 modelMap
```

### 3. 用量统计刷新流

```
定时/手动触发刷新
  │
  ▼
POST /api/usage/summary 或 GET /api/accounts/usage
  │
  ├─ 读取 D1 usage_cache 中缓存的用量明细 (cache_usage_details)
  │
  ├─ 按更新时间排序，找出最久未更新的 20 个账号
  │
  ├─ 并行调用 Cloudflare GraphQL API 查询每个账号的：
  │     ├─ 今日用量 (当日 00:00 UTC 起)
  │     └─ 近 7 天历史用量
  │
  ├─ 更新缓存到 D1 usage_cache
  │
  └─ 返回聚合后的用量数据
```

---

## 存储结构

### 数据分布策略

| 存储服务 | 用途 | 绑定名 |
|----------|------|--------|
| **Cloudflare KV** | Session 会话 + 2FA 临时数据（需要 TTL 自动过期） | `KV` |
| **Cloudflare D1** | 应用配置（`config_store` 表）、密钥用量日志、请求日志、限流计数、用量统计缓存 | `DB` |

---

### KV 存储（仅 Session 和 2FA）

#### 1. Session 键

| Key 模式 | 说明 | 值结构 | TTL |
|----------|------|--------|-----|
| `session:{token}` | 管理员登录会话 | `{ adminHash, createdAt, lastAccessed, verified2fa }` | 24 小时 |
| `2fa_temp:{token}` | 2FA 两步验证临时身份 token | `{ adminHash, createdAt }` | 5 分钟 |

#### 2. 2FA 密钥键

| Key | 说明 | TTL |
|-----|------|-----|
| `2fa_enabled` | `"true"` 或 `"false"`，标识 2FA 是否启用 | 永久 |
| `2fa_secret` | TOTP 密钥（Base32 编码） | 永久 |
| `2fa_pending_secret` | 设置过程中的暂存密钥，验证通过后转正 | 10 分钟 |

---

### D1 数据库表结构

> 手动在 Cloudflare D1 控制台或通过 `wrangler d1 execute` 执行以下 SQL：

#### 1. `config_store` 表 — 应用配置（按 key 独立存取）

```sql
CREATE TABLE IF NOT EXISTS config_store (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
```

| key | value 类型 | 说明 |
|-----|-----------|------|
| `accounts` | JSON Array | Cloudflare 账号列表 `[{id, name, apiToken, accountId, status, priority}]` |
| `api_keys` | JSON Array | API 密钥列表 `[{id, key, name, allowedModels, providerIds, dailyNeuronLimit, status, createdAt, lastUsedAt}]` |
| `external_providers` | JSON Array | 外部服务商列表 `[{id, name, baseUrl, apiKey, modelMap, status, priority, dailyNeuronLimit}]` |
| `custom_model_map` | JSON Object | 自定义模型映射 `{ alias: '@cf/...' }` |
| `model_notes` | JSON Object | 模型备注 `{ alias: '备注文本' }` |
| `disabled_mappings` | JSON Object | 禁用的模型映射 `{ alias: true }` |
| `ai_binding` | JSON Object | AI Binding 配置 `{ enabled, priority }` |

各 key 独立读写，互不干扰，避免竞态条件。

#### 2. `rate_limits` 表 — 登录限流

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
	ip TEXT PRIMARY KEY,
	count INTEGER NOT NULL DEFAULT 1,
	window_start INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
```

| 列名 | 类型 | 说明 |
|------|------|------|
| `ip` | TEXT | 主键，客户端 IP |
| `count` | INTEGER | 窗口内失败次数 |
| `window_start` | INTEGER | 窗口起始时间戳 |
| `updated_at` | INTEGER | 更新时间戳 |

#### 3. `key_usage_logs` 表 — 密钥用量日志

```sql
CREATE TABLE IF NOT EXISTS key_usage_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	log_date TEXT NOT NULL,
	key_id TEXT NOT NULL,
	key_name TEXT NOT NULL DEFAULT '',
	requests INTEGER NOT NULL DEFAULT 0,
	neurons REAL NOT NULL DEFAULT 0,
	prompt_tokens INTEGER NOT NULL DEFAULT 0,
	completion_tokens INTEGER NOT NULL DEFAULT 0,
	models TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_key_usage_logs_date ON key_usage_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_key_usage_logs_key_id ON key_usage_logs(key_id);
```

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 自增主键 |
| `log_date` | TEXT | 日志日期（YYYY-MM-DD） |
| `key_id` | TEXT | 密钥 ID |
| `key_name` | TEXT | 密钥名称 |
| `requests` | INTEGER | 请求次数 |
| `neurons` | REAL | 消耗神经元数 |
| `prompt_tokens` | INTEGER | 输入 Token 数 |
| `completion_tokens` | INTEGER | 输出 Token 数 |
| `models` | TEXT | 使用的模型列表（JSON 数组） |

索引：`idx_key_usage_logs_date`、`idx_key_usage_logs_key_id`

#### 4. `usage_cache` 表 — 用量统计缓存

```sql
CREATE TABLE IF NOT EXISTS usage_cache (
	cache_key TEXT PRIMARY KEY,
	data TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
```

#### 5. `request_logs` 表 — 请求日志（按 key_id + 日期汇总，保留 31 天）

```sql
CREATE TABLE IF NOT EXISTS request_logs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	log_date TEXT NOT NULL,
	key_id TEXT NOT NULL,
	key_name TEXT DEFAULT '',
	requests INTEGER DEFAULT 0,
	success_count INTEGER DEFAULT 0,
	fail_count INTEGER DEFAULT 0,
	total_neurons REAL DEFAULT 0,
	total_prompt_tokens INTEGER DEFAULT 0,
	total_completion_tokens INTEGER DEFAULT 0,
	total_duration_ms INTEGER DEFAULT 0,
	models TEXT DEFAULT '[]',
	endpoints TEXT DEFAULT '[]',
	error_types TEXT DEFAULT '[]',
	request_times TEXT DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_request_logs_date ON request_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_request_logs_key_id ON request_logs(key_id);
```

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 自增主键 |
| `log_date` | TEXT | 日期 (YYYY-MM-DD) |
| `key_id` | TEXT | API Key ID |
| `key_name` | TEXT | API Key 名称 |
| `requests` | INTEGER | 总请求数 |
| `success_count` | INTEGER | 成功请求数 |
| `fail_count` | INTEGER | 失败请求数 |
| `total_neurons` | REAL | 总神经元消耗 |
| `total_prompt_tokens` | INTEGER | 总输入 Token |
| `total_completion_tokens` | INTEGER | 总输出 Token |
| `total_duration_ms` | INTEGER | 总耗时(ms) |
| `models` | TEXT | 使用的模型列表 (JSON array) |
| `endpoints` | TEXT | 请求的接口列表 (JSON array) |
| `error_types` | TEXT | 错误类型列表 (JSON array) |
| `request_times` | TEXT | 请求记录列表 (JSON array, `[{time, account, neurons, prompt_tokens, completion_tokens, duration_ms, error_type}, ...]`, 最多保留最近 100 条) |

**写入方式**：每次请求调用 `logApiUsage` 时，按 key_id + log_date 查找已有记录，存在则累加更新并追加时间戳，不存在则创建新行。时间戳最多保留 100 条，超出时丢弃最早的。相比逐条写入，数据量减少 99% 以上。

#### 6. `account_usage` 表 — 账号级每日用量汇总

```sql
CREATE TABLE IF NOT EXISTS account_usage (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	log_date TEXT NOT NULL,
	account_id TEXT NOT NULL,
	account_name TEXT DEFAULT '',
	requests INTEGER NOT NULL DEFAULT 0,
	neurons REAL NOT NULL DEFAULT 0,
	prompt_tokens INTEGER NOT NULL DEFAULT 0,
	completion_tokens INTEGER NOT NULL DEFAULT 0,
	models TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_usage_date_id ON account_usage(log_date, account_id);
```

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 自增主键 |
| `log_date` | TEXT | 日志日期（YYYY-MM-DD） |
| `account_id` | TEXT | CF 账号 ID |
| `account_name` | TEXT | 账号名称 |
| `requests` | INTEGER | 总请求次数 |
| `neurons` | REAL | 总消耗神经元数 |
| `prompt_tokens` | INTEGER | 总输入 Token 数 |
| `completion_tokens` | INTEGER | 总输出 Token 数 |
| `models` | TEXT | 使用的模型列表（JSON 数组） |

唯一索引：`idx_account_usage_date_id`（log_date + account_id）

#### 7. `model_stats` 表 — 模型性能统计

```sql
CREATE TABLE IF NOT EXISTS model_stats (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	log_date TEXT NOT NULL,
	model TEXT NOT NULL,
	requests INTEGER NOT NULL DEFAULT 0,
	success_count INTEGER NOT NULL DEFAULT 0,
	error_count INTEGER NOT NULL DEFAULT 0,
	avg_duration_ms REAL DEFAULT 0,
	total_neurons REAL DEFAULT 0,
	total_prompt_tokens INTEGER DEFAULT 0,
	total_completion_tokens INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_stats_date_model ON model_stats(log_date, model);
```

| 列名 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 自增主键 |
| `log_date` | TEXT | 日志日期（YYYY-MM-DD） |
| `model` | TEXT | 模型名 |
| `requests` | INTEGER | 总调用次数 |
| `success_count` | INTEGER | 成功次数 |
| `error_count` | INTEGER | 失败次数 |
| `avg_duration_ms` | REAL | 平均响应耗时(ms) |
| `total_neurons` | REAL | 总消耗神经元数 |
| `total_prompt_tokens` | INTEGER | 总输入 Token 数 |
| `total_completion_tokens` | INTEGER | 总输出 Token 数 |

唯一索引：`idx_model_stats_date_model`（log_date + model）

### 密钥用量追踪流

```
用户请求 → /v1/chat/completions 或 /v1/completions
  │
  ├─ checkProxyAuth 返回匹配的密钥信息 { keyId, keyName }
  │
  ├─ 非流式响应：从响应 JSON 中提取 usage.prompt_tokens / completion_tokens
  │    └─ ctx.waitUntil(logApiUsage(...))
  │
  └─ 流式响应：wrapStreamWithUsageTracking 包装 SSE 流
       ├─ 捕获流中最后一个包含 usage 的数据块
       └─ 流结束时调用 logApiUsage(...)
            │
            └─ logApiUsage 流程（D1）：
                 ├─ 写入 request_logs（按 key_id + log_date 汇总）
                 ├─ 更新 key_usage_logs（按 key_id + log_date 汇总）
                 ├─ 更新 account_usage（按 account_id + log_date 汇总）
                 └─ 更新 model_stats（按 model + log_date 汇总）
                      └─ 管理后台查询 /api/keys/usage：
                           ├─ 触发 cleanupOldLogs 清理 request_logs 中 31 天前的旧数据
                           └─ 汇总查询返回
```

### 内存缓存

Worker 启动后内存中维护以下缓存：

| 缓存 | 说明 | TTL |
|------|------|-----|
| `configCache` (key: `cfg_{section}`) | `config_store` 各 key 的值独立缓存，每 key 单独失效 | 1 分钟 |
| `memoryCache.modelStats` | 模型性能统计查询结果 (key: `modelStats_${查询参数}`) | 5 分钟 |
| `memoryCache.modelList` | 模型列表 (`/api/models` 接口结果，含外部服务商模型) | 5 分钟 |
| `memoryCache.externalModels` | 外部服务商 `/api/models` 端点动态获取的模型列表 | 5 分钟 |
| `memoryCache.cachedSummary` | 用量汇总缓存 (仅作为 D1 `usage_cache` 的补充) | 30 分钟 |

---

## 安全机制

### 1. 管理员认证

- **密码**：通过 `ADMIN_PASSWORD` 环境变量配置，SHA-256 哈希后存入 Session
- **Session**：登录后创建随机 UUID Token，通过 `HttpOnly; Secure; SameSite=Strict` Cookie 下发
- **Session 加固**：2FA 启用后，Session 必须携带 `verified2fa: true` 标记才有效，否则 `validateSession` 自动删除该 Session
- **2FA (TOTP)**：基于 HMAC-SHA1 算法，支持 ±30 秒偏差（前后各 1 个时间窗口）
  - 设置：生成 20 字节随机密钥 → Base32 编码 → 暂存 → 验证 TOTP 码 → 正式启用
  - 登录：密码验证通过 → 需要 2FA → 返回临时 token（5 分钟有效）→ 验证 TOTP 码 → 创建正式 Session
  - 禁用：需输入当前 TOTP 码确认
- **登录限流**：同一 IP 5 分钟内最多 5 次失败尝试
- **退出**：清除 Session 并设置 Cookie Max-Age=0

### 2. API 代理认证

- 支持 `x-api-key` 和 `Authorization: Bearer` 两种方式
- 空密钥列表时跳过认证（公开模式）
- 认证失败时，`/v1/messages` 返回 Anthropic 格式错误，其他路径返回 OpenAI 格式错误

### 3. 跨域 (CORS)

- `Access-Control-Allow-Origin: *`
- 允许方法：`GET, POST, OPTIONS, DELETE`
- 允许头：`Content-Type, Authorization, x-api-key`

### 4. CF Token 保护

- **API 响应**：`/api/accounts` GET 返回 Token 遮盖后四位（`abc****efgh`）
- **前端存储**：Token 不再嵌入 HTML `onclick` 属性，仅存于 JS 内存变量 `window.__accounts`
- **编辑弹窗**：默认显示 `********`，用户需主动修改才提交新 Token

---

## 模型映射机制

模型映射（Model Mapping）将用户请求中的模型别名（如 `gpt-3.5-turbo`）映射到 Cloudflare Workers AI 的实际模型路径（如 `@cf/meta/llama-3.1-8b-instruct`）。

**数据结构**：
- `customModelMap` — `{ alias: '@cf/...' }` 键值对，存储在 `config_store` 表 `custom_model_map` key 中
- `modelNotes` — `{ alias: '备注文本' }` 键值对，存储在 `config_store` 表 `model_notes` key 中，仅管理员可见，不参与模型解析

### 默认模型映射（共 15 个预设映射，按用途分组）

```javascript
const DEFAULT_MODEL_MAP = {
  // 🌟 便宜好用（每天放开用）
  'glm-4.7-flash':       '@cf/zai-org/glm-4.7-flash',       // 30B MoE, 200K ctx, FC/R
  'llama-3.2-3b':        '@cf/meta/llama-3.2-3b-instruct',  // 3B, 80K ctx
  'phi-3-mini':          '@cf/microsoft/phi-3-mini-4k-instruct', // 3.8B, 4K ctx

  // 🌟 中等价位（兼顾质量与价格）
  'gemma-4-26b-a4b-it':  '@cf/google/gemma-4-26b-a4b-it',   // 26B MoE, 256K ctx
  'gpt-oss-20b':         '@cf/openai/gpt-oss-20b',           // 20B, 128K ctx
  'gemma-3-12b-it':      '@cf/google/gemma-3-12b-it',        // 12B, 128K ctx
  'gpt-oss-120b':        '@cf/openai/gpt-oss-120b',          // 120B, 128K ctx
  'llama-3.3-70b-fp8-fast': '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // 70B

  // 🌟 昂贵高级（高质量，精打细算）
  'qwq-32b':             '@cf/qwen/qwq-32b',                 // 32B, 推理专用
  'kimi-k2.7-code':      '@cf/moonshotai/kimi-k2.7-code',    // 1T MoE, 256K ctx

  // 📐 向量嵌入模型
  'bge-m3':              '@cf/baai/bge-m3',                  // 60K ctx, RAG 首选
  'embeddinggemma-300m': '@cf/google/embeddinggemma-300m',   // 300M, 100+ 语言
  'qwen3-embedding-0.6b':'@cf/qwen/qwen3-embedding-0.6b',   // 0.6B, 中文 RAG

  // 🎨 多媒体模型
  'flux-1-schnell':      '@cf/black-forest-labs/flux-1-schnell', // 文生图
  'whisper':             '@cf/openai/whisper'                // 语音识别
};
```

### 解析规则

1. 如果请求模型以 `@cf/` 开头，直接透传（不参与映射）
2. 否则在 `{ DEFAULT_MODEL_MAP, ...customModelMap }` 中查找
3. 未找到时使用默认值 `@cf/zai-org/glm-4.7-flash`

### 模型备注

管理员可在管理后台的模型映射页面为每个映射添加文本备注（如"速度快适合闲聊"、"精度高但贵"），备注仅管理员可见，不影响模型解析逻辑。备注存储在 `config_store` 表 `model_notes` key 中，与模型映射独立管理。

---

## 多后端负载均衡

项目支持**三种后端类型**，按优先级数字升序排列，同优先级下随机打乱顺序：

| 后端类型 | 来源 | 标识 `_type` | 说明 |
|----------|------|-------------|------|
| **AI Binding** | `env.AI` (Cloudflare Workers 内建绑定) | `ai-binding` | 零网络延迟，优先级最低作为兜底，通过配置启用/禁用 |
| **Cloudflare 账号** | `config_store.accounts` | `cloudflare` | 通过 REST API 调用，每个账号独立配置 API Token 和 Account ID |
| **外部服务商** | `config_store.external_providers` | `external` | 任意 OpenAI 兼容的 API 端点，支持模型映射和每日限额 |

### 策略

1. 从 `config_store` 中读取 **accounts**（状态为 active）和 **external_providers**（活跃且未超限）
2. 读取 **AI Binding** 配置，若 `enabled !== false` 则加入后端列表
3. 若 API 密钥指定了 `providerIds` 白名单，则只保留匹配的后端
4. 按 `priority` 升序分组（数字越小越优先），同一组内 Fisher-Yates 随机打乱
5. 按优先级顺序遍历所有后端，请求成功则返回
6. 全部失败时返回 502 错误

**示例**：优先级分布
```
优先级 1: CF Account A (priority=1), CF Account B (priority=1)       ← 最优先
优先级 2: External Provider X (priority=2)                            ← 次优先
优先级 10: AI Binding (priority=10)                                    ← 兜底
```

### 账号测试（3 项权限验证）

| 测试项 | API 端点 | 说明 |
|--------|----------|------|
| Workers AI > Read | `GET /accounts/{id}/ai/models/search?limit=1` | 验证模型列表读取权限 |
| Workers AI > Edit | `POST /accounts/{id}/ai/run/@cf/google/embeddinggemma-300m` | 验证模型调用权限 |
| Account Analytics > Read | GraphQL 查询 `aiInferenceAdaptiveGroups` | 验证用量统计权限 |

### 外部服务商每日限额

外部服务商可配置 `dailyNeuronLimit`（每日神经元限额），通过 `filterActiveProvidersByLimit` 函数动态过滤：
- 查询 D1 `key_usage_logs` 中当日的累积神经元消耗
- 同一 `modelLookupKey` (模型映射键) 下的所有密钥累计
- 超出限额的服务商自动排除，不参与负载均衡

---

## 格式转换

### Anthropic → OpenAI (请求方向)

| Anthropic 字段 | OpenAI 字段 |
|----------------|-------------|
| `system` (string 或 array) | `messages[0].role = "system"` |
| `messages[].role = "user"`, `content` 含 `tool_result` | `messages[].role = "tool"` |
| `messages[].role = "user"`, `content` 含 `image` | `messages[].content[].type = "image_url"` |
| `messages[].role = "assistant"`, `content` 含 `tool_use` | `assistant_message.tool_calls[]` |
| `tools[]` (name + input_schema) | `tools[].type = "function"` |
| `tool_choice.type = "tool"` | `tool_choice = { type: "function", function: { name } }` |

### OpenAI → Anthropic (响应方向)

| OpenAI 字段 | Anthropic 字段 |
|-------------|----------------|
| `choices[0].message.content` | `content[0].type = "text"` |
| `choices[0].message.tool_calls[]` | `content[].type = "tool_use"` |
| `choices[0].finish_reason = "stop"` | `stop_reason = "end_turn"` |
| `choices[0].finish_reason = "tool_calls"` | `stop_reason = "tool_use"` |

### SSE 流式转换

Anthropic 流式格式 (`/v1/messages`) 要求将 OpenAI SSE chunk 实时转换为以下事件序列：

```
event: message_start
event: content_block_start (text 或 tool_use)
event: content_block_delta (text_delta 或 input_json_delta)
event: content_block_stop
event: message_delta
event: message_stop
```

---

## 神经元消耗估算 (NEURON_RATES)

每次 API 调用后，通过 `estimateNeurons(cfModel, promptTokens, completionTokens)` 估算神经元消耗：

```javascript
neurons = promptTokens × in_rate + completionTokens × out_rate
```

各模型的消耗率（单位：神经元/token）：

| 模型路径 | in_rate | out_rate | 说明 |
|----------|---------|----------|------|
| `@cf/zai-org/glm-4.7-flash` | 0.005455 | 0.036364 | 便宜好用 |
| `@cf/moonshotai/kimi-k2.7-code` | 0.086364 | 0.363636 | 高级模型 |
| `@cf/google/gemma-4-26b-a4b-it` | 0.009091 | 0.027273 | 性价比之王 |
| `@cf/openai/gpt-oss-20b` | 0.018182 | 0.027273 | 低延迟 |
| `@cf/google/gemma-3-12b-it` | 0.031371 | 0.050560 | 综合能力强 |
| `@cf/openai/gpt-oss-120b` | 0.031818 | 0.068182 | 生产级推理 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 0.026364 | 0.204545 | 接近 GPT-4 |
| `@cf/meta/llama-3.2-3b-instruct` | 0.004625 | 0.030475 | 轻量模型 |
| `@cf/qwen/qwq-32b` | 0.060000 | 0.090909 | 推理专用 |
| `@cf/microsoft/phi-3-mini-4k-instruct` | 0.001 | 0.005 | 极低消耗 |
| `@cf/baai/bge-m3` | 0.001 | 0.001 | 嵌入模型 |
| `@cf/google/embeddinggemma-300m` | 0.001 | 0.001 | 嵌入模型 |
| `@cf/qwen/qwen3-embedding-0.6b` | 0.001 | 0.001 | 嵌入模型 |
| `@cf/black-forest-labs/flux-1-schnell` | 0 | 53000 | 文生图（按图片计） |
| `@cf/openai/whisper` | 0 | 450 | 语音识别（每分钟） |
| `@cf/myshell/melotts` | 0 | 200 | 语音合成（每分钟） |
| `default` (未知模型) | 0.010 | 0.030 | 兜底默认值 |

---

## WebSocket 支持

- 端点：`/v1/` 带 `Upgrade: websocket` 请求头
- 认证：URL 参数 `api_key` 或 `key`，或 `x-api-key` 请求头
- 数据格式：JSON，需包含 `model` 和 `messages` 字段
- 响应：实时推送 OpenAI SSE 格式的 JSON 消息
- 结束：推送 `{"type": "end"}` 后关闭连接

---

## 前端架构

### 页面结构

| 页面 | 文件 | 说明 |
|------|------|------|
| 首页/登录页 | `index.html` + `index-E0ZoCtyL.css` + `index-hb39J5A8.js` | 单页应用，包含登录功能 |
| 管理后台 | `admin.html` | 含所有管理功能的完整单页应用 |

### 管理后台功能模块 (admin.html)

| 标签页 | 说明 |
|--------|------|
| 数据看板 (Overview) | 用量统计、7 日趋势图、模型占比饼图、账号用量明细 |
| 账号管理 (Accounts) | CRUD Cloudflare 账号，含连接测试功能（Token 脱敏显示） |
| 外部服务商 (Providers) | CRUD 外部 OpenAI 兼容服务商，含连接测试和模型映射管理 |
| API 密钥 (Keys) | CRUD API 密钥，显示接入地址 |
| 密钥用量 (Key Usage) | 每个密钥的请求次数、神经元消耗、Token 用量、使用模型，含已删除密钥 |
| 请求日志 (Request Logs) | 按密钥、日期过滤的请求级日志（含成功/失败、耗时、错误类型） |
| 模型映射 (Settings) | 自定义模型映射管理，支持预设映射恢复和禁用映射 |
| 安全设置 (2FA) | 双因素认证管理，含二维码扫描设置和禁用功能 |

### 前端依赖

- **Chart.js 4.4.1** (CDN) — 图表渲染
- **QRCode.js 1.0.0** (CDN) — 2FA 设置二维码生成
- **Vanilla JS** — 无框架，纯原生 JavaScript
- **CSS 变量** — 实现暗色/亮色主题切换
- **localStorage** — 缓存用量数据、主题偏好

### 安全守卫

- **Session 自检**：admin.html 加载后立即调用 `fetch('/api/auth/2fa/status')` 验证 Session，非 200 响应时自动跳转首页
- **API 拦截**：`apiFetch()` 封装函数拦截 401 响应，自动跳转登录页
- **登录限流**：前端显示 429 限流提示

---

## 错误处理

### KV 未绑定

- API 请求 (`/v1/` 或 `/api/`)：返回 JSON 500 错误
- 页面请求：返回美观的 HTML 错误提示页

### ADMIN_PASSWORD 未配置

- API 请求：返回 JSON 500 错误
- 页面请求：返回美观的 HTML 错误提示页

### 代理接口错误

- 无效 JSON 请求体：400 错误
- 缺少必要字段：400 错误
- 所有 Cloudflare 账号均失败：502 错误
- 内部异常：500 错误

---

## 部署配置

### `_routes.json`

```json
{
  "version": 1,
  "include": ["/*"],
  "exclude": [
    "/landing.css",
    "/landing.js",
    "/robots.txt",
    "/web.ico",
    "/docs/*"
  ]
}
```

所有请求都由 `_worker.js` 处理，排除项直接由 Pages 静态托管返回（含 `/docs/*` 文档页面）。

### 所需绑定

| 绑定类型 | 变量名 | 必填 | 说明 |
|----------|--------|------|------|
| KV 命名空间 | `KV` | 是 | Session 和 2FA 临时数据存储（需要 TTL 自动过期） |
| D1 数据库 | `DB` | 是 | 应用配置、密钥用量日志、限流计数、用量统计缓存 |
| AI Binding | `AI` | 否 | 内建推理后端，作为负载均衡的兜底选项 |
| 环境变量 | `ADMIN_PASSWORD` | 是 | 管理员登录密码，未配置时所有请求被拦截 |