# W-ai-api

> Cloudflare Workers AI API 网关 — 将 Cloudflare Workers AI 转换为 OpenAI / Anthropic 兼容的 API 接口

[![Deploy to Cloudflare](https://img.shields.io/badge/Deploy-Cloudflare-F38020?logo=cloudflare)](https://dash.cloudflare.com)
[![Live Demo](https://img.shields.io/badge/%F0%9F%9A%80%20%E4%BD%93%E9%AA%8C%E7%AB%99%E7%82%B9-api.markbl.de5.net-2ea44f)](https://api.markbl.de5.net)

## 简介

**W-ai-api** 是一个基于 **Cloudflare Workers + Pages** 的 AI API 代理网关。它把 Cloudflare Workers AI 托管的开源模型（`@cf/*`）封装成标准的 **OpenAI 兼容** 和 **Anthropic Messages 兼容** 的 REST API，让任何兼容 OpenAI SDK 的客户端都能直接使用。

无需自建服务器，零成本部署，自动全球加速。

### 在线体验

项目已部署在 Cloudflare Pages 上，可通过以下地址直接体验：

> **https://api.markbl.de5.net**

你也可以部署自己的实例，Cloudflare Pages 会免费提供一个 `你的项目名.pages.dev` 域名，**无需自行购买域名**。

## 功能特性

### 核心亮点：三端聚合 + 智能负载均衡

**W-ai-api** 最核心的能力是聚合多种 AI 后端，实现统一的 API 出口：

| 后端类型 | 说明 | 适用场景 |
|----------|------|----------|
| **AI Binding** 🎯 | Cloudflare Workers 内建 AI 绑定（`env.AI`） | 零额外延迟，作为兜底或主力后端 |
| **多个 Cloudflare 账号** 🔁 | 通过 REST API 调用多个 CF 账号的 Workers AI | 突破单账号配额限制，扩容神经元用量 |
| **外部 OpenAI 兼容服务商** 🔗 | 任意 OpenAI 兼容 API 端点（自定义 Base URL） | 混合使用多家 AI 服务商 |

三种后端按 **优先级（priority）** 分组，同优先级随机打乱，智能故障切换 —— 一个后端失败自动切换到下一个，最大化可用性。

### 其他功能

- **OpenAI 兼容** — `/v1/chat/completions`、`/v1/completions`、`/v1/embeddings`、`/v1/models`
- **Anthropic 兼容** — `/v1/messages` 完整支持，含格式自动转换和 SSE 流式转换
- **API Key 鉴权** — 支持模型白名单、每日神经元限额、服务商过滤
- **管理后台** — Web 界面管理账号、密钥、用量统计、模型映射
- **2FA 双因素认证** — 基于 TOTP 的管理员登录保护
- **用量追踪** — 密钥级、账号级、模型级每日用量统计
- **WebSocket 流式对话** — 实时 SSE 推送
- **神经元估算** — 精准估算每次调用的消耗

## 快速开始

这是一个 **Cloudflare Pages 项目**，有两种部署方式：

### 方式一：直接上传（最简单，推荐）

无需 Git，无需命令行，只需 3 步：

1. [下载本项目压缩包](https://github.com/jidanbings/W-ai-api/archive/refs/heads/main.zip) 并解压
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Pages** → **Create a Pages project**
3. 选择 **Direct Upload**（直接上传），将解压后的 **`pages-project` 文件夹** 拖拽上传

Cloudflare 会自动部署，完成后提供一个 `你的项目名.pages.dev` 的免费域名。

### 方式二：Git 导入（适合持续集成）

1. Fork 本仓库到你的 GitHub 账号
2. 在 Cloudflare Pages 选择 **Git 导入**，连接你的仓库
3. 构建设置：**框架预设选 None**，**构建命令留空**，**输出目录留空**，直接保存
4. Cloudflare 自动部署，后续每次推送代码自动更新

> **无需自行购买域名**，Cloudflare 提供的 `.pages.dev` 域名即可使用。也支持绑定自定义域名。

### 配置环境变量和绑定

部署完成后，进入项目 **Settings** → **Functions** → 添加以下配置：

| 绑定类型 | 变量名 | 必填 | 说明 |
|----------|--------|------|------|
| 环境变量 | `ADMIN_PASSWORD` | **是** | 管理员登录密码，未配置时所有请求被拦截 |
| KV 命名空间 | `KV` | **是** | Session 和 2FA 临时数据（需 TTL 自动过期） |
| D1 数据库 | `DB` | **是** | 配置、密钥用量、限流、缓存等持久化数据 |
| AI Binding | `AI` | 否 | 内建推理后端（可选，作为负载均衡兜底） |

### 初始化 D1 数据库表

在 Cloudflare D1 控制台或通过 `wrangler` 执行以下 SQL 创建表：

```sql
CREATE TABLE IF NOT EXISTS config_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    ip TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS usage_cache (
    cache_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

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

## API 使用

### 聊天补全 (OpenAI 格式)

```bash
curl https://api.markbl.de5.net/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-wa-xxxx" \
  -d '{
    "model": "gpt-oss-120b",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Anthropic Messages 格式

```bash
curl https://api.markbl.de5.net/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-wa-xxxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "gpt-oss-120b",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 向量嵌入

```bash
curl https://api.markbl.de5.net/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-wa-xxxx" \
  -d '{
    "model": "bge-m3",
    "input": "要生成向量的文本"
  }'
```

更多 API 细节见 [API 使用指南](https://api.markbl.de5.net/docs/api-guide.html)。

## 预设模型

| 分类 | 模型别名 | 实际路径 |
|------|----------|----------|
| 🌟 便宜好用 | `glm-4.7-flash` | `@cf/zai-org/glm-4.7-flash` |
| | `llama-3.2-3b` | `@cf/meta/llama-3.2-3b-instruct` |
| | `phi-3-mini` | `@cf/microsoft/phi-3-mini-4k-instruct` |
| 🌟 中等价位 | `gemma-4-26b-a4b-it` | `@cf/google/gemma-4-26b-a4b-it` |
| | `gpt-oss-20b` | `@cf/openai/gpt-oss-20b` |
| | `gemma-3-12b-it` | `@cf/google/gemma-3-12b-it` |
| | `gpt-oss-120b` | `@cf/openai/gpt-oss-120b` |
| | `llama-3.3-70b-fp8-fast` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| 🌟 高级 | `qwq-32b` | `@cf/qwen/qwq-32b` |
| | `kimi-k2.7-code` | `@cf/moonshotai/kimi-k2.7-code` |
| 📐 嵌入 | `bge-m3` | `@cf/baai/bge-m3` |
| | `embeddinggemma-300m` | `@cf/google/embeddinggemma-300m` |
| | `qwen3-embedding-0.6b` | `@cf/qwen/qwen3-embedding-0.6b` |
| 🎨 多媒体 | `flux-1-schnell` | `@cf/black-forest-labs/flux-1-schnell` |
| | `whisper` | `@cf/openai/whisper` |

支持在管理后台添加自定义模型映射。

## 项目结构

```
├── pages-project/          # Cloudflare Pages 部署目录
│   ├── _worker.js          # 主线 Worker（所有后端逻辑，约 4500 行）
│   ├── _routes.json        # Pages 路由规则
│   ├── index.html          # 首页/登录页
│   ├── admin.html          # 管理后台单页应用
│   ├── docs/               # 文档页面
│   └── ...
├── docs/
│   └── architecture.md     # 详细架构文档
├── README.md
├── .gitignore
└── .gitattributes
```

## 技术栈

- **运行时**: Cloudflare Workers (JavaScript ES Module)
- **静态托管**: Cloudflare Pages (ASSETS)
- **存储**: Cloudflare KV (Session/2FA) + D1 (配置/用量/日志)
- **前端**: 纯 Vanilla JS + Chart.js (CDN)
- **2FA**: TOTP (HMAC-SHA1), QRCode.js (CDN)

## 架构概览

```
客户端 (OpenAI SDK / Anthropic SDK)
  │
  ▼
/v1/chat/completions 或 /v1/messages
  │
  ├─ 鉴权 → 模型解析 → 限额检查
  │
  ├─ 格式转换 (Anthropic ↔ OpenAI，仅 /v1/messages)
  │
  └─ 三端聚合负载均衡
       ├─ 🎯 AI Binding (env.AI)           ← 零延迟内建推理
       ├─ 🔁 多个 Cloudflare 账号 (REST)    ← 突破配额限制
       └─ 🔗 外部 OpenAI 兼容服务商         ← 混合多家 AI 服务
            │
            └─ 按优先级 → 随机打乱 → 故障切换
```

三种后端类型均支持配置独立 **优先级（priority）**，数字越小越优先。同一优先级内随机打乱实现负载均衡，请求失败自动切换到下一可用后端，最大化整体可用性。

详细架构说明见 [架构文档](docs/architecture.md)。

## 安全

- 管理员密码通过 `ADMIN_PASSWORD` 环境变量配置
- Session 基于 HttpOnly/Secure/SameSite=Strict Cookie
- 支持 TOTP 双因素认证 (2FA)
- 同一 IP 5 分钟内最多 5 次登录尝试
- API Key 支持模型白名单和每日限额
- CF Token 在管理后台遮盖显示，仅存于内存变量

## License

[MIT](LICENSE)

---

> 如果你觉得这个项目有帮助，欢迎 Star ⭐
