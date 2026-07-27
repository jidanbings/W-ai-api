const DEFAULT_MODEL_MAP = {
	// 🌟 便宜好用（每天放开用）
	'glm-4.7-flash': '@cf/zai-org/glm-4.7-flash',       // 30B MoE, 200K ctx, FC/R
	'llama-3.2-3b': '@cf/meta/llama-3.2-3b-instruct',    // 3B, 80K ctx
	'phi-3-mini': '@cf/microsoft/phi-3-mini-4k-instruct',// 3.8B, 4K ctx, 极低消耗

	// 🌟 中等价位（兼顾质量与价格）
	'gemma-4-26b-a4b-it': '@cf/google/gemma-4-26b-a4b-it', // 26B MoE, 256K ctx, FC/R/V, 性价比之王
	'gpt-oss-20b': '@cf/openai/gpt-oss-20b',                 // 20B, 128K ctx, FC/R, 低延迟
	'gemma-3-12b-it': '@cf/google/gemma-3-12b-it',           // 12B, 128K ctx, 综合能力强
	'gpt-oss-120b': '@cf/openai/gpt-oss-120b',               // 120B, 128K ctx, FC/R, 生产级推理
	'llama-3.3-70b-fp8-fast': '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // 70B fp8, 24K ctx, 接近GPT-4

	// 🌟 昂贵高级（高质量，精打细算）
	'qwq-32b': '@cf/qwen/qwq-32b',                   // 32B, 推理专用
	'kimi-k2.7-code': '@cf/moonshotai/kimi-k2.7-code', // 1T MoE, 256K ctx, FC/R/V

	// 📐 向量嵌入模型
	'bge-m3': '@cf/baai/bge-m3',                     // 60K ctx, RAG 首选
	'embeddinggemma-300m': '@cf/google/embeddinggemma-300m', // 300M, 100+ 语言
	'qwen3-embedding-0.6b': '@cf/qwen/qwen3-embedding-0.6b', // 0.6B, 中文 RAG

	// 🎨 多媒体模型
	'flux-1-schnell': '@cf/black-forest-labs/flux-1-schnell', // 文生图
	'whisper': '@cf/openai/whisper'                    // 语音识别
};

export default {
	async fetch(request, env, ctx) {
		try {
			// 0. 静态资源直接放行，不参与鉴权检查
			const _url = new URL(request.url);
			const _ext = _url.pathname.split('.').pop();
			if (['css', 'js', 'png', 'jpg', 'svg', 'ico', 'woff2'].includes(_ext)) {
				return env.ASSETS.fetch(request);
			}
			// 1. 检查是否绑定了 KV 存储（仅 Session / 2FA 用）
			if (!env.KV) {
				return handleKVError(request);
			}

			// 2. 检查是否绑定了 D1 数据库（配置 / 密钥用量 / 限流 / 缓存用）
			if (!env.DB) {
				return handleDBError(request);
			}

			// 3. 检查是否配置了 ADMIN_PASSWORD 环境变量
			if (!env.ADMIN_PASSWORD) {
				return handlePasswordError(request);
			}

			// 处理跨域预检请求（OPTIONS）
			if (request.method === 'OPTIONS') {
				const optResp = new Response(null, {
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
						'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key'
					}
				});
				addSecurityHeaders(optResp);
				return optResp;
			}

			const url = new URL(request.url);

			// 2. OpenAI 兼容的代理接口（/v1/ 开头）
			if (url.pathname.startsWith('/v1/')) {
				const response = await handleV1Proxy(request, env, ctx);
				return addCORSHeaders(response);
			}

			// 3. 后台管理面板的 API 接口（/api/ 开头）
			if (url.pathname.startsWith('/api/')) {
				const response = await handleDashboardApi(request, env, ctx);
				return addCORSHeaders(response);
			}

			// 4. 后台管理面板页面（/admin 和 /admin.html 均需登录）
			if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
				const isLoggedIn = await verifyAdminCookie(request, env);
				if (isLoggedIn) {
					return handleAdminPage(request, env, ctx);
				} else {
					// 未登录则跳转到首页（登录页）
					return new Response(null, {
						status: 302,
						headers: { 'Location': '/' }
					});
				}
			}

			// 5. 首页 / 登录页
			if (url.pathname === '/' || url.pathname === '/index.html') {
				return handleLandingPage(request, env, ctx);
			}

			// robots.txt 支持，用于屏蔽搜索引擎爬虫
			if (url.pathname === '/robots.txt') {
				return new Response('User-agent: *\nDisallow: /', {
					headers: { 'Content-Type': 'text/plain; charset=utf-8' }
				});
			}

			// 7. 文档页面（/docs/ 开头）
			if (url.pathname.startsWith('/docs/')) {
				if (url.pathname === '/docs/' || url.pathname === '/docs') {
					url.pathname = '/docs/index.html';
				}
				const docResponse = await env.ASSETS.fetch(new Request(url, request));
				if (docResponse.status !== 404) {
					return new Response(docResponse.body, {
						status: docResponse.status,
						headers: new Headers(docResponse.headers)
					});
				}
			}

			// 6. 兜底：尝试从静态资源（static/ 等）中获取
			const staticResponse = await env.ASSETS.fetch(request);
			if (staticResponse.status !== 404) {
				// 给静态资源加浏览器缓存头
				const cacheHeaders = new Headers(staticResponse.headers);
				cacheHeaders.set('Cache-Control', 'public, max-age=3600');
				return new Response(staticResponse.body, {
					status: staticResponse.status,
					statusText: staticResponse.statusText,
					headers: cacheHeaders
				});
			}

			// 7. 仍是 404
			return new Response('404 Not Found', { status: 404 });
		} catch (e) {
			console.error('Server error:', e);
			return new Response(JSON.stringify({
				error: {
					message: "Internal server error",
					type: "server_error"
				}
			}), { status: 500, headers: { 'Content-Type': 'application/json' } });
		}
	}
};

// 工具函数：给响应加上跨域（CORS）响应头和安全头
function addCORSHeaders(response) {
	const newResponse = new Response(response.body, response);
	newResponse.headers.set('Access-Control-Allow-Origin', '*');
	newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
	newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
	// 安全响应头
	addSecurityHeaders(newResponse);
	return newResponse;
}

// 添加安全响应头
function addSecurityHeaders(response) {
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'no-referrer');
	// CSP: 只允许加载同源资源和可信 CDN
	response.headers.set('Content-Security-Policy',
		"default-src 'self'; " +
		"script-src 'self' https://cdnjs.cloudflare.com; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data:; " +
		"connect-src 'self'; " +
		"font-src 'self'; " +
		"base-uri 'self'; " +
		"form-action 'self'"
	);
}

// 工具函数：计算字符串的 SHA-256 哈希值
async function sha256(message) {
	const msgBuffer = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ----------------------------------------------------
// 配置存储（config_store 表，按 key 独立存取，避免竞态条件）
// ----------------------------------------------------
const CONFIG_CACHE_TTL = 30000; // 30 秒，配置变更后快速生效
const configCache = {};

async function getConfigValue(env, key, defaultVal) {
	const now = Date.now();
	const cacheKey = 'cfg_' + key;
	if (configCache[cacheKey] && now < configCache[cacheKey].expiry) {
		return configCache[cacheKey].value;
	}
	const row = await env.DB.prepare('SELECT value FROM config_store WHERE key = ?').bind(key).first();
	let value = defaultVal;
	if (row && row.value) {
		try { value = JSON.parse(row.value); } catch (e) { }
	}
	configCache[cacheKey] = { value, expiry: now + CONFIG_CACHE_TTL };
	return value;
}

async function setConfigValue(env, key, value) {
	await env.DB.prepare('INSERT OR REPLACE INTO config_store (key, value, updated_at) VALUES (?, ?, ?)')
		.bind(key, JSON.stringify(value), Date.now()).run();
	configCache['cfg_' + key] = { value, expiry: Date.now() + CONFIG_CACHE_TTL };
}

// ---- 各模块的便捷存取函数 ----

async function getAccounts(env) {
	return getConfigValue(env, 'accounts', []);
}
async function saveAccounts(env, accounts) {
	await setConfigValue(env, 'accounts', accounts);
	await env.DB.prepare('DELETE FROM usage_cache WHERE cache_key = ?').bind('cache_usage_summary').run();
}

async function getApiKeys(env) {
	return getConfigValue(env, 'api_keys', []);
}
async function saveApiKeys(env, keys) {
	await setConfigValue(env, 'api_keys', keys);
}

async function getExternalProviders(env) {
	return getConfigValue(env, 'external_providers', []);
}
async function saveExternalProviders(env, providers) {
	await setConfigValue(env, 'external_providers', providers);
}

// 过滤外部服务商：仅返回活跃且未超每日限额的服务商
// 同时返回今日用量映射供外部使用
async function filterActiveProvidersByLimit(externalProviders, modelLookupKey, env) {
	const today = new Date().toISOString().split('T')[0];

	// 收集有每日限额的服务商，批量查询今日用量
	const providersWithLimits = externalProviders.filter(p => (p.dailyNeuronLimit || 0) > 0);
	let usageMap = {};
	if (providersWithLimits.length > 0) {
		const ids = providersWithLimits.map(p => p.id);
		const placeholders = ids.map(() => '?').join(',');
		const usageRows = await env.DB.prepare(
			`SELECT account_id, COALESCE(SUM(neurons), 0) as total_neurons FROM account_usage WHERE account_id IN (${placeholders}) AND log_date = ? GROUP BY account_id`
		).bind(...ids, today).all();
		for (const row of usageRows.results || []) {
			usageMap[row.account_id] = row.total_neurons;
		}
	}

	const activeProviders = (externalProviders.filter(p => {
		if (p.status !== 'active') return false;
		if (!p.modelMap || !p.modelMap[modelLookupKey]) return false;
		if ((p.dailyNeuronLimit || 0) > 0) {
			const todayUsed = usageMap[p.id] || 0;
			if (todayUsed >= p.dailyNeuronLimit) return false;
		}
		return true;
	}) || []).map(p => ({
		_type: 'external',
		id: p.id,
		name: p.name,
		baseUrl: p.baseUrl,
		apiKey: p.apiKey,
		priority: p.priority || 0,
		mappedModel: p.modelMap[modelLookupKey]
	}));

	return { activeProviders, usageMap };
}

async function getCustomModelMap(env) {
	return getConfigValue(env, 'custom_model_map', {});
}
async function saveCustomModelMap(env, map) {
	await setConfigValue(env, 'custom_model_map', map);
}

async function getModelNotes(env) {
	return getConfigValue(env, 'model_notes', {});
}
async function saveModelNotes(env, notes) {
	await setConfigValue(env, 'model_notes', notes);
}

async function getDisabledMappings(env) {
	return getConfigValue(env, 'disabled_mappings', {});
}
async function saveDisabledMappings(env, mappings) {
	await setConfigValue(env, 'disabled_mappings', mappings);
}

// AI Binding 配置（使用统一缓存，避免重复 D1 查询）
const DEFAULT_BINDING_CONFIG = { enabled: true, priority: 0 };
async function getBindingConfig(env) {
	try {
		const config = await getConfigValue(env, 'ai_binding', null);
		if (config) {
			return { ...DEFAULT_BINDING_CONFIG, ...config };
		}
	} catch (e) { }
	return { ...DEFAULT_BINDING_CONFIG };
}
async function saveBindingConfig(env, bindingConfig) {
	await setConfigValue(env, 'ai_binding', bindingConfig);
}

// 模型统计和列表的独立缓存（与配置缓存分离）
const memoryCache = { modelStats: {}, modelList: null };

// ----------------------------------------------------
// Session 管理（登录后下发随机 Token，过期自动清理）
// ----------------------------------------------------
const SESSION_TTL_SECONDS = 86400; // session 有效期 24 小时

async function createSession(env, adminHash, verified2fa) {
	const token = crypto.randomUUID();
	const now = Date.now();
	await env.KV.put(
		`session:${token}`,
		JSON.stringify({ adminHash, createdAt: now, lastAccessed: now, verified2fa: !!verified2fa }),
		{ expirationTtl: SESSION_TTL_SECONDS }
	);
	return token;
}

async function getSession(env, token) {
	if (!token) return null;
	const raw = await env.KV.get(`session:${token}`);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function deleteSession(env, token) {
	if (!token) return;
	await env.KV.delete(`session:${token}`);
}

async function validateSession(token, env) {
	if (!token) return false;
	const session = await getSession(env, token);
	if (!session) return false;
	const expectedPassword = env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD.trim() : '';
	if (!expectedPassword) return false;
	const expectedHash = await sha256(expectedPassword);
	if (session.adminHash !== expectedHash) {
		// 密码已变更 → 旧 session 全部失效
		await deleteSession(env, token);
		return false;
	}
	// 如果 2FA 已启用，Session 必须经过 2FA 验证
	const twoFAEnabled = await is2FAEnabled(env);
	if (twoFAEnabled && !session.verified2fa) {
		await deleteSession(env, token);
		return false;
	}
	return true;
}

// ----------------------------------------------------
// TOTP / 2FA 工具函数
// ----------------------------------------------------
// RFC 4648 base32 编码表
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
	let bits = 0;
	let value = 0;
	let output = '';
	for (let i = 0; i < bytes.length; i++) {
		value = (value << 8) | bytes[i];
		bits += 8;
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) {
		output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
	}
	// padding
	while (output.length % 8 !== 0) output += '=';
	return output;
}

function base32Decode(str) {
	str = str.replace(/=+$/, '').toUpperCase();
	const bytes = [];
	let bits = 0;
	let value = 0;
	for (let i = 0; i < str.length; i++) {
		const idx = BASE32_ALPHABET.indexOf(str[i]);
		if (idx === -1) continue;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return new Uint8Array(bytes);
}

async function generateTOTPSecret() {
	const bytes = new Uint8Array(20);
	crypto.getRandomValues(bytes);
	return base32Encode(bytes);
}

async function computeTOTP(secret, timeStep) {
	const decoded = base32Decode(secret);
	const counter = new ArrayBuffer(8);
	const view = new DataView(counter);
	view.setBigUint64(0, BigInt(timeStep), false);

	const key = await crypto.subtle.importKey(
		'raw', decoded,
		{ name: 'HMAC', hash: 'SHA-1' },
		false, ['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, counter);
	const sigArray = new Uint8Array(signature);
	const offset = sigArray[sigArray.length - 1] & 0xf;
	const code = ((sigArray[offset] & 0x7f) << 24) |
		((sigArray[offset + 1] & 0xff) << 16) |
		((sigArray[offset + 2] & 0xff) << 8) |
		(sigArray[offset + 3] & 0xff);
	return String(code % 1000000).padStart(6, '0');
}

async function verifyTOTP(secret, code) {
	const now = Math.floor(Date.now() / 1000);
	const timeStep = Math.floor(now / 30);
	// 允许前后各 1 个时间窗口（共 3 个窗口，允许 ±30 秒偏差）
	for (let i = -1; i <= 1; i++) {
		const computed = await computeTOTP(secret, timeStep + i);
		if (computed === code) return true;
	}
	return false;
}

const TOTP_TEMP_TTL = 300; // 2FA 临时 token 有效期 5 分钟

async function createTemp2FAToken(env, adminHash) {
	const token = crypto.randomUUID();
	await env.KV.put(
		`2fa_temp:${token}`,
		JSON.stringify({ adminHash, createdAt: Date.now() }),
		{ expirationTtl: TOTP_TEMP_TTL }
	);
	return token;
}

async function getTemp2FAToken(env, token) {
	if (!token) return null;
	const raw = await env.KV.get(`2fa_temp:${token}`);
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function deleteTemp2FAToken(env, token) {
	if (!token) return;
	await env.KV.delete(`2fa_temp:${token}`);
}

async function is2FAEnabled(env) {
	const val = await env.KV.get('2fa_enabled');
	return val === 'true';
}

async function get2FASecret(env) {
	return await env.KV.get('2fa_secret');
}

async function set2FASecret(env, secret) {
	await env.KV.put('2fa_secret', secret);
}

async function set2FAEnabled(env, enabled) {
	await env.KV.put('2fa_enabled', enabled ? 'true' : 'false');
}

// ----------------------------------------------------
// 登录限流（基于客户端 IP）
// ----------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 分钟窗口
const RATE_LIMIT_MAX = 5;                     // 窗口内最多 5 次失败

async function checkRateLimit(env, ip) {
	const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE ip = ?').bind(ip).first();
	if (!row) return { allowed: true, remaining: RATE_LIMIT_MAX };

	try {
		const elapsed = Date.now() - row.window_start;
		if (elapsed > RATE_LIMIT_WINDOW_MS) {
			return { allowed: true, remaining: RATE_LIMIT_MAX };
		}
		if (row.count >= RATE_LIMIT_MAX) {
			const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
			return { allowed: false, remaining: 0, retryAfter };
		}
		return { allowed: true, remaining: RATE_LIMIT_MAX - row.count };
	} catch {
		return { allowed: true, remaining: RATE_LIMIT_MAX };
	}
}

async function recordFailedAttempt(env, ip) {
	const now = Date.now();
	// 原子化操作：使用 INSERT ... ON CONFLICT 避免竞态条件
	// 窗口内已有记录时累加，否则新建记录
	await env.DB.prepare(`
		INSERT INTO rate_limits (ip, count, window_start, updated_at)
		VALUES (?, 1, ?, ?)
		ON CONFLICT(ip) DO UPDATE SET
			count = CASE
				WHEN ? - window_start <= ? THEN count + 1
				ELSE 1
			END,
			window_start = CASE
				WHEN ? - window_start <= ? THEN window_start
				ELSE ?
			END,
			updated_at = ?
	`).bind(ip, now, now, now, RATE_LIMIT_WINDOW_MS, now, RATE_LIMIT_WINDOW_MS, now, now).run();
}

// ----------------------------------------------------
// 登录审计日志
// ----------------------------------------------------
async function logLoginAudit(env, ip, status, userAgent) {
	try {
		await env.DB.prepare(
			'INSERT INTO login_audit_logs (ip, status, user_agent, created_at) VALUES (?, ?, ?, ?)'
		).bind(ip, status, userAgent || '', Date.now()).run();
	} catch (e) {
		// 审计日志写入失败不应影响主流程
		console.error('logLoginAudit error:', e);
	}
}

// ----------------------------------------------------
// 管理员身份验证（同时支持 Cookie 和 Authorization 请求头）
// ----------------------------------------------------
async function checkAdminAuth(request, env) {
	// 1. 先从 Cookie 里取 session token（浏览器访问时走这里）
	const cookies = request.headers.get('Cookie') || '';
	const cookieMatch = cookies.match(/admin_token=([^;]+)/);
	let token = cookieMatch ? cookieMatch[1] : null;

	// 2. Cookie 里没有的话，再从 Authorization 请求头里取（API 工具调用时走这里）
	if (!token) {
		const authHeader = request.headers.get('Authorization');
		if (authHeader && authHeader.startsWith('Bearer ')) {
			token = authHeader.substring(7);
		}
	}

	if (!token) return false;

	return await validateSession(token, env);
}

// 校验管理员的登录 Cookie（用于页面访问的权限判断）
async function verifyAdminCookie(request, env) {
	const cookies = request.headers.get('Cookie') || '';
	const cookieMatch = cookies.match(/admin_token=([^;]+)/);
	if (!cookieMatch) return false;

	const token = cookieMatch[1];
	if (!token) return false;

	return await validateSession(token, env);
}

// ----------------------------------------------------
// 代理接口的鉴权工具函数 — 返回匹配的密钥对象或 null
// ----------------------------------------------------
// API Key 格式校验：密钥必须以 "sk-wa-" 开头，长度至少 20 字符
const API_KEY_PREFIX = 'sk-wa-';
const API_KEY_MIN_LENGTH = 20;

function isValidApiKeyFormat(key) {
	return typeof key === 'string' && key.startsWith(API_KEY_PREFIX) && key.length >= API_KEY_MIN_LENGTH;
}

async function checkProxyAuth(request, env) {
	const apiKeys = await getApiKeys(env);
	if (apiKeys.length === 0) {
		return { key: null, keyId: null, keyName: null, allowedModels: null }; // 没配置密钥 = 不校验
	}

	// 注意：lastUsedAt 更新已移到 logApiUsage 中异步执行，避免主请求路径的 D1 写入

	// 先检查 x-api-key 头
	const xApiKey = request.headers.get('x-api-key');
	if (xApiKey) {
		if (!isValidApiKeyFormat(xApiKey)) {
			return null; // 格式不合法，直接拒绝
		}
		const matched = apiKeys.find(k => k.key === xApiKey && k.status !== 'inactive');
		if (matched) {
			return { key: matched.key, keyId: matched.id, keyName: matched.name, allowedModels: matched.allowedModels || null, providerIds: matched.providerIds && matched.providerIds.length > 0 ? matched.providerIds : null, dailyNeuronLimit: matched.dailyNeuronLimit || 1000000 };
		}
	}

	// 再检查 Authorization: Bearer 头
	const authHeader = request.headers.get('Authorization');
	if (authHeader && authHeader.startsWith('Bearer ')) {
		const token = authHeader.substring(7);
		if (!isValidApiKeyFormat(token)) {
			return null; // 格式不合法，直接拒绝
		}
		const matched = apiKeys.find(k => k.key === token && k.status !== 'inactive');
		if (matched) {
			return { key: matched.key, keyId: matched.id, keyName: matched.name, allowedModels: matched.allowedModels || null, providerIds: matched.providerIds && matched.providerIds.length > 0 ? matched.providerIds : null, dailyNeuronLimit: matched.dailyNeuronLimit || 1000000 };
		}
	}

	return null;
}

// 检查请求的模型是否被 API 密钥的模型白名单允许
// 返回 null 表示允许，返回 Response 表示拒绝
function checkModelAllowed(model, authInfo) {
	if (!authInfo || !authInfo.allowedModels || !Array.isArray(authInfo.allowedModels) || authInfo.allowedModels.length === 0) {
		return null; // 未设置限制 = 允许所有
	}
	if (authInfo.allowedModels.includes(model)) {
		return null; // 模型在白名单中
	}
	// 拒绝
	return new Response(JSON.stringify({
		error: {
			message: `Model "${model}" is not allowed for this API key. Allowed models: ${authInfo.allowedModels.join(', ')}`,
			type: "invalid_request_error",
			code: "model_not_allowed"
		}
	}), { status: 403, headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------
// 用量统计的缓存工具函数（D1）
// ----------------------------------------------------
async function getCachedSummary(env) {
	const row = await env.DB.prepare('SELECT data, updated_at FROM usage_cache WHERE cache_key = ?').bind('cache_usage_summary').first();
	if (row && row.data) {
		try {
			const data = JSON.parse(row.data);
			if (Date.now() - data.timestamp < 1800000) { // 缓存有效期 30 分钟（公开页面，无需实时）
				return data;
			}
		} catch (e) { }
	}
	return null;
}

async function setCachedSummary(env, summaryData) {
	const data = {
		...summaryData,
		timestamp: Date.now()
	};
	await env.DB.prepare('INSERT OR REPLACE INTO usage_cache (cache_key, data, updated_at) VALUES (?, ?, ?)')
		.bind('cache_usage_summary', JSON.stringify(data), Date.now()).run();
}

async function refreshAccountsUsage(env, accounts, limit = 20) {
	const row = await env.DB.prepare('SELECT data, updated_at FROM usage_cache WHERE cache_key = ?').bind('cache_usage_details').first();
	let cacheMap = {};
	if (row && row.data) {
		try {
			cacheMap = JSON.parse(row.data) || {};
		} catch (e) {
			cacheMap = {};
		}
	}

	// 按最后更新的时间戳升序排序（时间戳为 0 或不存在的最先更新）
	const sortedAccounts = [...accounts].sort((a, b) => {
		const tA = cacheMap[a.id]?.timestamp || 0;
		const tB = cacheMap[b.id]?.timestamp || 0;
		return tA - tB;
	});

	const accountsToUpdate = sortedAccounts.slice(0, limit);

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	sevenDaysAgo.setUTCHours(0, 0, 0, 0);
	const startSevenDays = sevenDaysAgo.toISOString().split('.')[0] + 'Z';

	const todayUTC = new Date();
	todayUTC.setUTCHours(0, 0, 0, 0);
	const startToday = todayUTC.toISOString().split('.')[0] + 'Z';

	const promises = accountsToUpdate.map(async (account) => {
		try {
			const [todayGroups, historyGroups] = await Promise.all([
				queryGraphQL(account.accountId, account.apiToken, startToday),
				queryGraphQL(account.accountId, account.apiToken, startSevenDays)
			]);
			const todayParsed = processAnalytics(todayGroups);
			const historyParsed = processAnalytics(historyGroups);

			cacheMap[account.id] = {
				status: 'active',
				error: null,
				usageToday: todayParsed.todayTotalNeurons,
				modelsToday: todayParsed.todayModels,
				history: historyParsed.history,
				timestamp: Date.now()
			};
		} catch (e) {
			console.error(`Error querying GraphQL for ${account.name}:`, e);
			cacheMap[account.id] = {
				status: 'error',
				error: e.message,
				usageToday: cacheMap[account.id]?.usageToday || 0,
				modelsToday: cacheMap[account.id]?.modelsToday || [],
				history: cacheMap[account.id]?.history || [],
				timestamp: Date.now() // 即使出错也更新时间戳，以便其他账号轮转刷新
			};
		}
	});

	await Promise.all(promises);
	await env.DB.prepare('INSERT OR REPLACE INTO usage_cache (cache_key, data, updated_at) VALUES (?, ?, ?)')
		.bind('cache_usage_details', JSON.stringify(cacheMap), Date.now()).run();
	return cacheMap;
}

// ----------------------------------------------------
// Cloudflare GraphQL 用量分析查询
// ----------------------------------------------------
async function queryGraphQL(accountId, apiToken, startDateTime) {
	const query = `
		query GetAIUsage($accountId: String!, $start: String!) {
			viewer {
				accounts(filter: { accountTag: $accountId }) {
					aiInferenceAdaptiveGroups(
						filter: { datetime_geq: $start }
						limit: 1000
					) {
						count
						sum {
							totalNeurons
						}
						dimensions {
							date
							modelId
						}
					}
				}
			}
		}
	`;
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 秒超时
	try {
		const response = await fetch(`https://api.cloudflare.com/client/v4/graphql`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				query,
				variables: {
					accountId,
					start: startDateTime
				}
			}),
			signal: controller.signal
		});
		clearTimeout(timeoutId);
		if (!response.ok) {
			throw new Error(`GraphQL API error: ${response.statusText}`);
		}

		const result = await response.json();
		if (result.errors && result.errors.length > 0) {
			throw new Error(result.errors[0].message);
		}

		return result?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups || [];
	} finally {
		clearTimeout(timeoutId);
	}
}

function processAnalytics(groups) {
	const todayStr = new Date().toISOString().split('T')[0];

	let todayTotalNeurons = 0;
	const todayModelsMap = {};
	const historyMap = {};

	// 先把最近 7 天的历史数据全部初始化为 0
	for (let i = 6; i >= 0; i--) {
		const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
		const dStr = d.toISOString().split('T')[0];
		historyMap[dStr] = 0;
	}

	for (const group of groups) {
		const date = group.dimensions.date;
		const model = group.dimensions.modelId;
		const neurons = group.sum.totalNeurons || 0;
		const count = group.count || 0;

		if (date === todayStr) {
			todayTotalNeurons += neurons;
			if (!todayModelsMap[model]) {
				todayModelsMap[model] = { model, neurons: 0, requests: 0 };
			}
			todayModelsMap[model].neurons += neurons;
			todayModelsMap[model].requests += count;
		}

		if (historyMap[date] !== undefined) {
			historyMap[date] += neurons;
		}
	}

	const todayModels = Object.values(todayModelsMap).sort((a, b) => b.neurons - a.neurons);
	const history = Object.keys(historyMap)
		.sort()
		.map(date => ({ date, neurons: historyMap[date] }));

	return {
		todayTotalNeurons,
		todayModels,
		history
	};
}

// ----------------------------------------------------
// 密钥用量追踪（数据永久保留）
// 记录每个 API 密钥的请求日志，永久保留
// 即使密钥被删除，历史数据仍然保留
// ----------------------------------------------------

// 模型神经元估算表（每 token 消耗的神经元数）
// 数据来源：Cloudflare 定价页面
const NEURON_RATES = {
	'@cf/zai-org/glm-4.7-flash': { in: 0.005455, out: 0.036364 },
	'@cf/moonshotai/kimi-k2.7-code': { in: 0.086364, out: 0.363636 },
	'@cf/google/gemma-4-26b-a4b-it': { in: 0.009091, out: 0.027273 },
	'@cf/nvidia/nemotron-3-120b-a12b': { in: 0.045455, out: 0.136364 },
	'@cf/openai/gpt-oss-20b': { in: 0.018182, out: 0.027273 },
	'@cf/openai/gpt-oss-120b': { in: 0.031818, out: 0.068182 },
	'@cf/meta/llama-4-scout-17b-16e-instruct': { in: 0.024545, out: 0.077273 },
	'@cf/meta/llama-3.2-3b-instruct': { in: 0.004625, out: 0.030475 },
	'@cf/meta/llama-3.2-11b-vision-instruct': { in: 0.004410, out: 0.061493 },
	'@cf/meta/llama-3.1-8b-instruct-fp8-fast': { in: 0.004119, out: 0.034868 },
	'@cf/google/gemma-3-12b-it': { in: 0.031371, out: 0.050560 },
	'@cf/qwen/qwq-32b': { in: 0.060000, out: 0.090909 },
	'@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 0.031876, out: 0.050488 },
	'@cf/microsoft/phi-3-mini-4k-instruct': { in: 0.001, out: 0.005 },
	'@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 0.026364, out: 0.204545 },
	'@cf/baai/bge-m3': { in: 0.001, out: 0.001 },
	'@cf/google/embeddinggemma-300m': { in: 0.001, out: 0.001 },
	'@cf/qwen/qwen3-embedding-0.6b': { in: 0.001, out: 0.001 },
	'@cf/black-forest-labs/flux-1-schnell': { in: 0, out: 53000 }, // 按图片算
	'@cf/openai/whisper': { in: 0, out: 450 }, // 每分钟音频
	'@cf/myshell/melotts': { in: 0, out: 200 }, // 每分钟音频
	'@cf/moonshotai/kimi-k2.6': { in: 0.086364, out: 0.363636 },
	'@cf/mistral/mistral-7b-instruct-v0.1': { in: 0.010000, out: 0.017300 },
	'@cf/mistral/mistral-7b-instruct-v0.2': { in: 0.010000, out: 0.017300 },
	'@cf/qwen/qwen1.5-14b-chat-awq': { in: 0.005, out: 0.015 },
	'default': { in: 0.010, out: 0.030 } // 未知模型默认值
};

function estimateNeurons(cfModel, promptTokens, completionTokens) {
	const rates = NEURON_RATES[cfModel] || NEURON_RATES['default'];
	return Math.round((promptTokens * rates.in) + (completionTokens * rates.out));
}

// 统一记录 API 请求的完整日志信息
async function logApiUsage(env, options) {
	const {
		keyId, keyName, model, cfModel, promptTokens, completionTokens,
		accountId, accountName, endpoint, statusCode, durationMs, success, errorType
	} = options;
	try {
		const estimatedNeurons = estimateNeurons(cfModel, promptTokens, completionTokens);
		const now = new Date();
		const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
		const requestTime = now.getTime();

		// ====== 第1步：并行读取所有 SELECT 查询 ======
		const selectStmts = [
			env.DB.prepare('SELECT id, requests, success_count, fail_count, total_neurons, total_prompt_tokens, total_completion_tokens, total_duration_ms, models, endpoints, error_types, request_times FROM request_logs WHERE log_date = ? AND key_id = ?').bind(dateStr, keyId),
			env.DB.prepare('SELECT id, requests, neurons, prompt_tokens, completion_tokens, models FROM key_usage_logs WHERE log_date = ? AND key_id = ?').bind(dateStr, keyId),
		];
		if (accountId) {
			selectStmts.push(env.DB.prepare('SELECT id, requests, neurons, prompt_tokens, completion_tokens, models FROM account_usage WHERE log_date = ? AND account_id = ?').bind(dateStr, accountId));
		}
		selectStmts.push(env.DB.prepare('SELECT id, requests, success_count, avg_duration_ms FROM model_stats WHERE log_date = ? AND model = ?').bind(dateStr, model));

		const selectResults = await env.DB.batch(selectStmts);

		let idx = 0;
		const reqExisting = selectResults[idx++].results[0] || null;
		const keyExisting = selectResults[idx++].results[0] || null;
		const accExisting = accountId ? (selectResults[idx++].results[0] || null) : null;
		const modelExisting = selectResults[idx].results[0] || null;

		// ====== 第2步：构建所有写入语句 ======
		const writeStmts = [];

		// 1. request_logs
		if (reqExisting) {
			const models = JSON.parse(reqExisting.models);
			if (!models.includes(model)) models.push(model);
			const endpoints = JSON.parse(reqExisting.endpoints);
			if (!endpoints.includes(endpoint)) endpoints.push(endpoint);
			const errorTypes = JSON.parse(reqExisting.error_types);
			if (!success && errorType && !errorTypes.includes(errorType)) errorTypes.push(errorType);
			let requestTimes = JSON.parse(reqExisting.request_times || '[]');
			requestTimes.push({time: requestTime, account: accountName || accountId || '', neurons: estimatedNeurons, prompt_tokens: promptTokens, completion_tokens: completionTokens, duration_ms: durationMs || 0, error_type: success ? '' : (errorType || '')});
			if (requestTimes.length > 100) requestTimes = requestTimes.slice(-100);
			writeStmts.push(env.DB.prepare(
				'UPDATE request_logs SET requests = ?, success_count = ?, fail_count = ?, total_neurons = ?, total_prompt_tokens = ?, total_completion_tokens = ?, total_duration_ms = ?, key_name = ?, models = ?, endpoints = ?, error_types = ?, request_times = ? WHERE id = ?'
			).bind(
				reqExisting.requests + 1,
				reqExisting.success_count + (success ? 1 : 0),
				reqExisting.fail_count + (success ? 0 : 1),
				reqExisting.total_neurons + estimatedNeurons,
				reqExisting.total_prompt_tokens + promptTokens,
				reqExisting.total_completion_tokens + completionTokens,
				reqExisting.total_duration_ms + (durationMs || 0),
				keyName || '',
				JSON.stringify(models),
				JSON.stringify(endpoints),
				JSON.stringify(errorTypes),
				JSON.stringify(requestTimes),
				reqExisting.id
			));
		} else {
			writeStmts.push(env.DB.prepare(
				'INSERT INTO request_logs (log_date, key_id, key_name, requests, success_count, fail_count, total_neurons, total_prompt_tokens, total_completion_tokens, total_duration_ms, models, endpoints, error_types, request_times) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			).bind(
				dateStr, keyId, keyName || '',
				success ? 1 : 0, success ? 0 : 1,
				estimatedNeurons, promptTokens, completionTokens, durationMs || 0,
				JSON.stringify([model]), JSON.stringify([endpoint]),
				JSON.stringify(success ? [] : (errorType ? [errorType] : [])),
				JSON.stringify([{time: requestTime, account: accountName || accountId || '', neurons: estimatedNeurons, prompt_tokens: promptTokens, completion_tokens: completionTokens, duration_ms: durationMs || 0, error_type: success ? '' : (errorType || '')}])
			));
		}

		// 2. key_usage_logs
		if (keyExisting) {
			const models = JSON.parse(keyExisting.models);
			if (!models.includes(model)) models.push(model);
			writeStmts.push(env.DB.prepare(
				'UPDATE key_usage_logs SET requests = ?, neurons = ?, prompt_tokens = ?, completion_tokens = ?, models = ?, key_name = ? WHERE id = ?'
			).bind(
				keyExisting.requests + 1,
				keyExisting.neurons + estimatedNeurons,
				keyExisting.prompt_tokens + promptTokens,
				keyExisting.completion_tokens + completionTokens,
				JSON.stringify(models),
				keyName || '',
				keyExisting.id
			));
		} else {
			writeStmts.push(env.DB.prepare(
				'INSERT INTO key_usage_logs (log_date, key_id, key_name, requests, neurons, prompt_tokens, completion_tokens, models) VALUES (?, ?, ?, 1, ?, ?, ?, ?)'
			).bind(dateStr, keyId, keyName || '', estimatedNeurons, promptTokens, completionTokens, JSON.stringify([model])));
		}

		// 3. account_usage
		if (accountId) {
			if (accExisting) {
				const accModels = JSON.parse(accExisting.models);
				if (!accModels.includes(model)) accModels.push(model);
				writeStmts.push(env.DB.prepare(
					'UPDATE account_usage SET requests = ?, neurons = ?, prompt_tokens = ?, completion_tokens = ?, models = ? WHERE id = ?'
				).bind(
					accExisting.requests + 1,
					accExisting.neurons + estimatedNeurons,
					accExisting.prompt_tokens + promptTokens,
					accExisting.completion_tokens + completionTokens,
					JSON.stringify(accModels),
					accExisting.id
				));
			} else {
				writeStmts.push(env.DB.prepare(
					'INSERT INTO account_usage (log_date, account_id, account_name, requests, neurons, prompt_tokens, completion_tokens, models) VALUES (?, ?, ?, 1, ?, ?, ?, ?)'
				).bind(dateStr, accountId, accountName || '', estimatedNeurons, promptTokens, completionTokens, JSON.stringify([model])));
			}
		}

		// 4. model_stats
		if (modelExisting) {
			const newTotal = modelExisting.requests + 1;
			const newSuccess = modelExisting.success_count + (success ? 1 : 0);
			const newError = newTotal - newSuccess;
			const newAvg = ((modelExisting.avg_duration_ms || 0) * modelExisting.requests + (durationMs || 0)) / newTotal;
			writeStmts.push(env.DB.prepare(
				'UPDATE model_stats SET requests = ?, success_count = ?, error_count = ?, avg_duration_ms = ?, total_neurons = total_neurons + ?, total_prompt_tokens = total_prompt_tokens + ?, total_completion_tokens = total_completion_tokens + ? WHERE id = ?'
			).bind(newTotal, newSuccess, newError, newAvg, estimatedNeurons, promptTokens, completionTokens, modelExisting.id));
		} else {
			writeStmts.push(env.DB.prepare(
				'INSERT INTO model_stats (log_date, model, requests, success_count, error_count, avg_duration_ms, total_neurons, total_prompt_tokens, total_completion_tokens) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)'
			).bind(dateStr, model, success ? 1 : 0, success ? 0 : 1, durationMs || 0, estimatedNeurons, promptTokens, completionTokens));
		}

		// ====== 第3步：批量写入所有 D1 操作 ======
		if (writeStmts.length > 0) {
			await env.DB.batch(writeStmts);
		}

		// ====== 第4步：检查外部服务商每日限额，超限则自动禁用 ======
		if (accountId) {
			try {
				const providers = await getExternalProviders(env);
				const provider = providers.find(p => p.id === accountId);
				if (provider && (provider.dailyNeuronLimit || 0) > 0) {
					const accRow = await env.DB.prepare(
						'SELECT COALESCE(SUM(neurons), 0) as total_neurons FROM account_usage WHERE account_id = ? AND log_date = ?'
					).bind(accountId, dateStr).first();
					const todayNeurons = accRow?.total_neurons || 0;
					if (todayNeurons >= provider.dailyNeuronLimit) {
						provider.status = 'inactive';
						await saveExternalProviders(env, providers);
					}
				}
			} catch (e) {
				console.error('Auto-disable provider check failed:', e);
			}
		}

		// ====== 第5步：异步更新密钥的 lastUsedAt（仅成功请求时） ======
		if (keyId && success) {
			try {
				const apiKeys = await getApiKeys(env);
				const matched = apiKeys.find(k => k.id === keyId);
				if (matched) {
					matched.lastUsedAt = new Date().toISOString();
					await saveApiKeys(env, apiKeys);
				}
			} catch (e) {
				// 静默失败
			}
		}
	} catch (e) {
		console.error('logApiUsage error:', e);
		// 静默失败，不影响主流程
	}
}

// 读取密钥用量历史（最近 N 天）
async function getKeyUsageHistory(env, days = 14) {
	try {
		const cutoffDate = new Date(Date.now() - days * 86400000);
		const cutoffStr = cutoffDate.toISOString().split('T')[0];

		const rows = await env.DB.prepare(
			'SELECT log_date, key_id, key_name, requests, neurons, prompt_tokens, completion_tokens, models FROM key_usage_logs WHERE log_date >= ? ORDER BY log_date DESC'
		).bind(cutoffStr).all();

		const result = {};
		for (const row of rows.results || []) {
			if (!result[row.key_id]) {
				result[row.key_id] = {
					keyId: row.key_id,
					keyName: row.key_name,
					requests: 0,
					neurons: 0,
					promptTokens: 0,
					completionTokens: 0,
					models: [],
					daily: []
				};
			}
			const r = result[row.key_id];
			r.keyName = row.key_name;
			r.requests += row.requests;
			r.neurons += row.neurons;
			r.promptTokens += row.prompt_tokens;
			r.completionTokens += row.completion_tokens;
			const models = JSON.parse(row.models || '[]');
			for (const m of models) {
				if (!r.models.includes(m)) r.models.push(m);
			}
			r.daily.push({
				date: row.log_date,
				requests: row.requests,
				neurons: row.neurons
			});
		}

		// 按神经元总数降序排列
		return Object.values(result).sort((a, b) => b.neurons - a.neurons);
	} catch (e) {
		console.error('getKeyUsageHistory error:', e);
		return [];
	}
}

// 清理超过保留期的旧日志（仅清理 request_logs，账户及用量数据永久保留）
async function cleanupOldLogs(env) {
	try {
		const now = Date.now();
		const cutoff31d = new Date(now - 31 * 86400000).toISOString().split('T')[0]; // request_logs 保留 31 天

		await env.DB.prepare('DELETE FROM request_logs WHERE log_date < ?').bind(cutoff31d).run();
	} catch (e) {
		console.error('cleanupOldLogs error:', e);
	}
}

// ----------------------------------------------------
// OpenAI 兼容代理接口（/v1/）的处理函数
// ----------------------------------------------------
async function handleV1Proxy(request, env, ctx) {
	const url = new URL(request.url);

	// 0. WebSocket 请求处理
	if (request.headers.get('Upgrade') === 'websocket') {
		return await handleWebSocketRequest(request, env);
	}

	// 1. 校验调用密钥（API Key）
	const authInfo = await checkProxyAuth(request, env);
	if (!authInfo) {
		// /v1/messages 返回 Anthropic 格式错误，其他路径返回 OpenAI 格式
		if (url.pathname === '/v1/messages') {
			return new Response(JSON.stringify({
				type: 'error',
				error: {
					type: 'authentication_error',
					message: 'Invalid x-api-key or Authorization header.'
				}
			}), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}
		return new Response(JSON.stringify({
			error: {
				message: "Incorrect or missing API key. Configure keys in the dashboard.",
				type: "invalid_request_error",
				param: null,
				code: "invalid_api_key"
			}
		}), { status: 401, headers: { 'Content-Type': 'application/json' } });
	}

	// 1.3 代理接口请求频率限制（基于 IP）
	const PROXY_RATE_LIMIT_WINDOW = 60000; // 1 分钟窗口
	const PROXY_RATE_LIMIT_MAX = 60;       // 每分钟最多 60 次请求
	const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
	const proxyRateKey = `proxy_rate:${clientIp}:${Math.floor(Date.now() / PROXY_RATE_LIMIT_WINDOW)}`;
	const proxyRateRow = await env.DB.prepare('SELECT value FROM config_store WHERE key = ?').bind(proxyRateKey).first();
	if (proxyRateRow) {
		const count = parseInt(proxyRateRow.value, 10);
		if (count >= PROXY_RATE_LIMIT_MAX) {
			return new Response(JSON.stringify({
				error: { message: "Too many requests. Please try again later.", type: "rate_limit_error", code: "rate_limit_exceeded" }
			}), { status: 429, headers: { 'Content-Type': 'application/json' } });
		}
		await env.DB.prepare('UPDATE config_store SET value = ?, updated_at = ? WHERE key = ?').bind(String(count + 1), Date.now(), proxyRateKey).run();
	} else {
		await env.DB.prepare('INSERT INTO config_store (key, value, updated_at) VALUES (?, ?, ?)').bind(proxyRateKey, '1', Date.now()).run();
	}

	// 1.5 检查 API 密钥的每日神经元消耗限制
	// 先解析请求体估算神经元，再检查是否超限（仅对写入类请求）
	if (authInfo && authInfo.keyId && (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/completions' || url.pathname === '/v1/messages' || url.pathname === '/v1/embeddings')) {
		const limitCheck = await checkKeyDailyNeuronLimit(env, authInfo.keyId, authInfo.dailyNeuronLimit);
		if (limitCheck) return limitCheck;
	}

	// 2. 获取模型列表接口（/v1/models）
	if (url.pathname === '/v1/models' && request.method === 'GET') {
		const customMap = await getCustomModelMap(env);
		const disabledMappings = await getDisabledMappings(env);
		const combinedMap = { ...DEFAULT_MODEL_MAP, ...customMap };

		const modelsData = Object.keys(combinedMap).filter(id => !disabledMappings[id]).map(id => {
			const isEmbedding = id.includes('embedding');
			return {
				id,
				object: 'model',
				created: 1686935000,
				owned_by: isEmbedding ? 'openai' : 'meta'
			};
		});


		return new Response(JSON.stringify({
			object: 'list',
			data: modelsData
		}), { headers: { 'Content-Type': 'application/json' } });
	}

	// 3. 对话补全 / 文本补全 接口
	if ((url.pathname === '/v1/chat/completions' || url.pathname === '/v1/completions') && request.method === 'POST') {
		return handleCompletions(request, env, ctx, url.pathname, authInfo);
	}

	// 4. Anthropic Messages API 接口（/v1/messages）
	if (url.pathname === '/v1/messages' && request.method === 'POST') {
		return handleMessages(request, env, ctx, authInfo);
	}

	// 向量嵌入接口
	if (url.pathname === '/v1/embeddings' && request.method === 'POST') {
		return handleEmbeddings(request, env, ctx, authInfo);
	}

	return new Response(JSON.stringify({
		error: { message: `Path not found: ${url.pathname}`, type: "invalid_request_error" }
	}), { status: 404, headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------
// 检查 API 密钥的每日神经元消耗是否超过限制
// 返回 null 表示允许继续，返回 Response 表示已被限流
// ----------------------------------------------------
async function checkKeyDailyNeuronLimit(env, keyId, dailyNeuronLimit) {
	if (!keyId || dailyNeuronLimit <= 0) return null; // 无限制
	const todayUTC = new Date();
	todayUTC.setUTCHours(0, 0, 0, 0);
	const dateStr = todayUTC.toISOString().split('T')[0];

	try {
		const row = await env.DB.prepare(
			'SELECT neurons FROM key_usage_logs WHERE log_date = ? AND key_id = ?'
		).bind(dateStr, keyId).first();

		const todayNeurons = row ? (row.neurons || 0) : 0;
		if (todayNeurons >= dailyNeuronLimit) {
			return new Response(JSON.stringify({
				error: {
					message: `Daily neuron limit exceeded. Today: ${todayNeurons.toLocaleString()}, Limit: ${dailyNeuronLimit.toLocaleString()}. Please wait until tomorrow or upgrade your key.`,
					type: "insufficient_quota",
					code: "daily_neuron_limit_exceeded"
				}
			}), { status: 429, headers: { 'Content-Type': 'application/json' } });
		}
		return null; // 未超限
	} catch (e) {
		console.error('checkKeyDailyNeuronLimit error:', e);
		return null; // 查询失败时放行，避免阻塞正常请求
	}
}

// ----------------------------------------------------
// 可复用的核心 API 调用函数
// 将 OpenAI Chat Completions 格式的请求发送到 Cloudflare AI 网关，
// 支持多账号负载均衡和故障自动切换。
// 返回格式：{ success: true, data: cfJson } 或 { success: false, error: "..." }
// ----------------------------------------------------
async function callOpenAICompatibleAPI(cfPayload, env, stream, originalModel, providerIdsFilter) {
	const FETCH_TIMEOUT_MS = 60000;
	let lastError = null;
	const cfModel = cfPayload.model;
	const modelLookupKey = originalModel || cfModel; // 模型映射用用户原始模型名查

	// 获取 Cloudflare 账号
	let accounts;
	try {
		accounts = await getAccounts(env);
	} catch (e) {
		return { success: false, error: `Failed to get accounts: ${e.message}` };
	}
	if (!accounts || !Array.isArray(accounts)) {
		return { success: false, error: "Accounts data is invalid" };
	}
	const activeAccounts = (accounts.filter(a => a.status === 'active') || []).map(a => ({
		...a,
		_type: 'cloudflare'
	}));

	// 获取外部服务商
	let externalProviders;
	try {
		externalProviders = await getExternalProviders(env);
	} catch (e) {
		externalProviders = [];
	}
	// 只保留有当前模型映射的活跃服务商（含每日限额检查）
	const { activeProviders } = await filterActiveProvidersByLimit(externalProviders, modelLookupKey, env);

	// AI Binding 作为内建后端（读取配置中的启用状态和优先级）
	let bindingBackend = [];
	if (env.AI) {
		const bindingConfig = await getBindingConfig(env);
		if (bindingConfig.enabled !== false) {
			bindingBackend = [{
				_type: 'ai-binding',
				id: 'ai-binding',
				name: 'AI Binding',
				priority: bindingConfig.priority || 0
			}];
		}
	}

	let allBackends = [...bindingBackend, ...activeAccounts, ...activeProviders];

	// 如果密钥指定了服务商，只保留匹配的后端
	if (providerIdsFilter && providerIdsFilter.length > 0) {
		allBackends = allBackends.filter(b => providerIdsFilter.includes(b.id));
	}

	if (allBackends.length === 0) {
		return { success: false, error: "No active backend available (no AI Binding, no Cloudflare accounts or external providers configured for this model)." };
	}

	// 按优先级升序排列（数字越小越优先），同优先级下随机打乱
	const samePriorityGroups = {};
	for (const backend of allBackends) {
		const p = backend.priority || 0;
		if (!samePriorityGroups[p]) samePriorityGroups[p] = [];
		samePriorityGroups[p].push(backend);
	}
	const shuffledBackends = Object.keys(samePriorityGroups)
		.sort((a, b) => a - b)
		.flatMap(p => samePriorityGroups[p].sort(() => Math.random() - 0.5));

	for (const backend of shuffledBackends) {
		if (backend._type === 'cloudflare') {
			// ======== Cloudflare 账号 ========
			// 某些模型默认 max_tokens 较低，客户端未设置时给一个合理值
			if (cfPayload.max_tokens === undefined) {
				cfPayload.max_tokens = 4096;
			}
			try {
				const t0 = Date.now();
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
				const cfResponse = await fetch(
					`https://api.cloudflare.com/client/v4/accounts/${backend.accountId}/ai/v1/chat/completions`,
					{
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${backend.apiToken}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(cfPayload),
						signal: controller.signal,
					}
				);
				clearTimeout(timeoutId);

				if (cfResponse.ok) {
					if (stream) {
						return { success: true, stream: cfResponse.body, accountId: backend.accountId, accountName: backend.name || backend.accountId, durationMs: Date.now() - t0 };
					} else {
						const cfJson = await cfResponse.json();
						// 检查响应体中是否有错误信息（Cloudflare 有时返回 200 但 body 含 error）
						if (cfJson && cfJson.error) {
							const errorMsg = typeof cfJson.error === 'string' ? cfJson.error : (cfJson.error.message || JSON.stringify(cfJson.error));
							lastError = `[${backend.name || backend.accountId}] CF API returned error in body: ${errorMsg}`;
						} else {
							return { success: true, data: cfJson, accountId: backend.accountId, accountName: backend.name || backend.accountId, durationMs: Date.now() - t0 };
						}
					}
				} else {
					const errorText = await cfResponse.text();
					lastError = `[${backend.name || backend.accountId}] CF API returned ${cfResponse.status}: ${errorText}`;

					// 5xx 回退到 REST API
					if (cfResponse.status >= 500 && cfResponse.status < 600) {
						const model = cfPayload.model;
						const restPayload = { ...cfPayload };
						delete restPayload.model;

						try {
							const t0r = Date.now();
							const controller2 = new AbortController();
							const timeoutId2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS);
							const restResponse = await fetch(
								`https://api.cloudflare.com/client/v4/accounts/${backend.accountId}/ai/run/${model}`,
								{
									method: 'POST',
									headers: {
										'Authorization': `Bearer ${backend.apiToken}`,
										'Content-Type': 'application/json',
									},
									body: JSON.stringify(restPayload),
									signal: controller2.signal,
								}
							);
							clearTimeout(timeoutId2);

							if (restResponse.ok) {
								if (stream) {
									const convertedStream = restStreamToOpenAIStream(restResponse.body, model);
									return { success: true, stream: convertedStream, accountId: backend.accountId, accountName: backend.name || backend.accountId, durationMs: Date.now() - t0r };
								} else {
									const restJson = await restResponse.json();
									if (restJson.success) {
										const openaiData = restToOpenAIResponse(restJson, model);
										return { success: true, data: openaiData, accountId: backend.accountId, accountName: backend.name || backend.accountId, durationMs: Date.now() - t0r };
									} else {
										lastError += ` | REST API failed: ${JSON.stringify(restJson.errors)}`;
									}
								}
							} else {
								const restErrorText = await restResponse.text();
								lastError += ` | REST API returned ${restResponse.status}: ${restErrorText}`;
							}
						} catch (e) {
							lastError += ` | REST API error: ${e.message}`;
						}
					}
				}
			} catch (e) {
				if (e.name === 'AbortError') {
					lastError = `[${backend.name || backend.accountId}] Timeout after ${FETCH_TIMEOUT_MS / 1000}s`;
				} else {
					lastError = `[${backend.name || backend.accountId}] Connection error: ${e.message}`;
				}
			}
		} else if (backend._type === 'ai-binding') {
			// ======== AI Binding（内建 Workers AI 绑定）========
			// 强制非流式 + 清理输入字段（Binding 不接受 frequency_penalty 等扩展字段）
			try {
				// 只保留 Binding 接受的字段（从 cfPayload 提取，cfPayload 来自请求 body）
				const allowedFields = ['messages', 'max_tokens', 'temperature', 'top_p', 'top_k', 'seed'];
				const bindingPayload = {};
				for (const key of allowedFields) {
					if (cfPayload[key] !== undefined) bindingPayload[key] = cfPayload[key];
				}
				// 某些模型（如 gpt-oss-20b）默认 max_tokens 较低，客户端未设置时给一个合理值
				if (bindingPayload.max_tokens === undefined) {
					bindingPayload.max_tokens = 4096;
				}
				if (Object.keys(bindingPayload).length === 0) {
					bindingPayload.messages = cfPayload.messages || [];
				}
				const t0 = Date.now();
				const aiResult = await env.AI.run(cfModel, bindingPayload);
				const elapsedMs = Date.now() - t0;
				// 检查 Binding 是否返回了错误信息
				if (aiResult && aiResult.error) {
					const errorMsg = typeof aiResult.error === 'string' ? aiResult.error : (aiResult.error.message || JSON.stringify(aiResult.error));
					lastError = `[AI Binding] returned error: ${errorMsg}`;
				} else if (aiResult) {
					// Binding 返回完整的 OpenAI 兼容格式，提取并过滤掉内部字段
					const choice = (aiResult.choices || [])[0] || {};
					const msg = choice.message || {};
					const content = msg.content || '';
					const role = msg.role || 'assistant';
					const finishReason = choice.finish_reason || 'stop';
					const usage = aiResult.usage || {};

					const openaiData = {
						id: aiResult.id || ('chatcmpl-' + Date.now()),
						object: 'chat.completion',
						created: aiResult.created || Math.floor(Date.now() / 1000),
						model: cfModel,
						choices: [{
							index: 0,
							message: { role, content },
							finish_reason: finishReason,
							logprobs: null
						}],
						usage: {
							prompt_tokens: usage.prompt_tokens || 0,
							completion_tokens: usage.completion_tokens || 0,
							total_tokens: usage.total_tokens || 0
						}
					};
					// 如果客户端需要流式，把完整响应转成标准 SSE
					if (stream) {
						const encoder = new TextEncoder();
						const id = openaiData.id;
						const created = openaiData.created;
						const chunks = [
							`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: cfModel, choices: [{ index: 0, delta: { role, content }, finish_reason: null }] })}\n\n`,
							`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: cfModel, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: openaiData.usage.prompt_tokens, completion_tokens: openaiData.usage.completion_tokens, total_tokens: openaiData.usage.total_tokens } })}\n\n`,
							'data: [DONE]\n\n'
						];
						const sseStream = new ReadableStream({
							start(controller) {
								chunks.forEach(c => controller.enqueue(encoder.encode(c)));
								controller.close();
							}
						});
						return { success: true, stream: sseStream, accountId: 'ai-binding', accountName: 'AI Binding', durationMs: elapsedMs };
					}
					return { success: true, data: openaiData, accountId: 'ai-binding', accountName: 'AI Binding', durationMs: elapsedMs };
				} else {
					lastError = `[AI Binding] returned empty result`;
				}
			} catch (e) {
				lastError = `[AI Binding] Error: ${e.message}`;
			}
		} else if (backend._type === 'external') {
			// ======== 外部 OpenAI 兼容服务商 ========
			const payload = { ...cfPayload, model: backend.mappedModel };
			const baseUrl = backend.baseUrl.replace(/\/+$/, ''); // 去掉尾部斜杠
			const apiEndpoint = `${baseUrl}/chat/completions`;

			try {
				const t0 = Date.now();
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
				const response = await fetch(apiEndpoint, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${backend.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(payload),
					signal: controller.signal,
				});
				clearTimeout(timeoutId);

				if (response.ok) {
					if (stream) {
						return { success: true, stream: response.body, accountId: backend.id, accountName: backend.name, durationMs: Date.now() - t0 };
					} else {
						const json = await response.json();
						// 检查响应体中是否有错误信息（部分 API 返回 200 但 body 含 error）
						if (json && json.error) {
							const errorMsg = typeof json.error === 'string' ? json.error : (json.error.message || JSON.stringify(json.error));
							lastError = `[${backend.name}] External API returned error in body: ${errorMsg}`;
						} else {
							return { success: true, data: json, accountId: backend.id, accountName: backend.name, durationMs: Date.now() - t0 };
						}
					}
				} else {
					const errorText = await response.text();
					lastError = `[${backend.name}] External API returned ${response.status}: ${errorText}`;
				}
			} catch (e) {
				if (e.name === 'AbortError') {
					lastError = `[${backend.name}] Timeout after ${FETCH_TIMEOUT_MS / 1000}s`;
				} else {
					lastError = `[${backend.name}] Connection error: ${e.message}`;
				}
			}
		}
	}

	return {
		success: false,
		error: `All backends failed. Last error: ${lastError}`,
		_diag: {
			accountsInPool: activeAccounts.length,
			providersInPool: activeProviders.length,
			totalBackends: allBackends.length,
			providersFound: externalProviders.length,
			modelLookupKey,
			shuffledOrder: shuffledBackends.map(b => `${b._type}:${b.name || b.id}`)
		}
	};
}

// 将 CF REST API 的响应转换为 OpenAI 兼容格式
function restToOpenAIResponse(restJson, model) {
	const responseText = restJson.result?.response || '';
	const usage = restJson.result?.usage || {};

	return {
		id: 'chatcmpl-' + Date.now(),
		object: 'chat.completion',
		created: Math.floor(Date.now() / 1000),
		model: model,
		choices: [{
			index: 0,
			message: {
				role: 'assistant',
				content: responseText
			},
			finish_reason: 'stop'
		}],
		usage: {
			prompt_tokens: usage.prompt_tokens || 0,
			completion_tokens: usage.completion_tokens || 0,
			total_tokens: usage.total_tokens || 0
		}
	};
}

// 将 CF REST API 的流式 SSE 转换为 OpenAI SSE 格式
function restStreamToOpenAIStream(restBody, model) {
	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	let buffer = '';
	let isFirstChunk = true;

	(async () => {
		try {
			const reader = restBody.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6).trim();
						if (data === '[DONE]') {
							await writer.write(encoder.encode('data: [DONE]\n\n'));
							continue;
						}
						try {
							const parsed = JSON.parse(data);
							const content = parsed.response || '';
							const openaiChunk = {
								id: 'chatcmpl-' + Date.now(),
								object: 'chat.completion.chunk',
								created: Math.floor(Date.now() / 1000),
								model: model,
								choices: [{
									index: 0,
									delta: isFirstChunk ? { role: 'assistant', content } : { content },
									finish_reason: null
								}]
							};
							isFirstChunk = false;
							await writer.write(encoder.encode('data: ' + JSON.stringify(openaiChunk) + '\n\n'));
						} catch (e) {
							// 跳过无效 JSON
						}
					}
				}
			}

			// 发送结束标记
			const finalChunk = {
				id: 'chatcmpl-' + Date.now(),
				object: 'chat.completion.chunk',
				created: Math.floor(Date.now() / 1000),
				model: model,
				choices: [{
					index: 0,
					delta: {},
					finish_reason: 'stop'
				}]
			};
			await writer.write(encoder.encode('data: ' + JSON.stringify(finalChunk) + '\n\n'));
			await writer.write(encoder.encode('data: [DONE]\n\n'));
		} catch (e) {
			console.error('Stream conversion error:', e);
		} finally {
			await writer.close();
		}
	})();

	return readable;
}

// 共享的模型名解析函数：根据用户传入的模型名，映射到 Cloudflare 实际模型
async function resolveModelName(model, env) {
	if (model.startsWith('@cf/')) return model;
	const customMap = await getCustomModelMap(env);
	const disabledMappings = await getDisabledMappings(env);
	const combinedMap = { ...DEFAULT_MODEL_MAP, ...customMap };
	// 如果该映射被禁用，返回 null 表示不可用
	if (disabledMappings[model]) return null;
	return combinedMap[model] || '@cf/zai-org/glm-4.7-flash';
}

// 标准化消息内容格式：将数组格式的 content 转换为纯字符串
// 很多 Agent 框架（如 Dify、Flowise）发送 content 为 [{type: "text", text: "..."}] 格式
function normalizeMessageContent(messages) {
	if (!Array.isArray(messages)) return messages;

	return messages.map(msg => {
		if (!msg.content) return msg;

		// content 已经是字符串，直接返回
		if (typeof msg.content === 'string') {
			return msg;
		}

		// content 是数组格式，转换为纯字符串
		if (Array.isArray(msg.content)) {
			let textContent = '';
			for (const part of msg.content) {
				if (part.type === 'text' && part.text) {
					textContent += part.text;
				} else if (typeof part === 'string') {
					textContent += part;
				}
			}
			return { ...msg, content: textContent };
		}

		// 其他情况，尝试转为字符串
		return { ...msg, content: String(msg.content) };
	});
}

// 对话补全 / 文本补全 的代理处理函数
async function handleCompletions(request, env, ctx, pathname, authInfo) {
	try {
		let body;
		try {
			body = await request.json();
		} catch (e) {
			return new Response(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }), { status: 400 });
		}

		const { model, messages, prompt, stream } = body;

		if (pathname === '/v1/chat/completions' && !messages) {
			return new Response(JSON.stringify({ error: { message: "messages field is required", type: "invalid_request_error" } }), { status: 400 });
		}
		if (pathname === '/v1/completions' && !prompt) {
			return new Response(JSON.stringify({ error: { message: "prompt field is required", type: "invalid_request_error" } }), { status: 400 });
		}

		// 检查 API 密钥的模型白名单
		const modelCheck = checkModelAllowed(model, authInfo);
		if (modelCheck) return modelCheck;

		const cfModel = await resolveModelName(model, env);
		if (!cfModel) {
			return new Response(JSON.stringify({
				error: { message: `Model "${model}" is disabled`, type: 'model_disabled' }
			}), { status: 403, headers: { 'Content-Type': 'application/json' } });
		}

		const normalizedMessages = pathname === '/v1/chat/completions'
			? normalizeMessageContent(messages)
			: [{ role: 'user', content: prompt }];

		const cfPayload = {
			model: cfModel,
			messages: normalizedMessages,
			stream: !!stream,
		};

		// 流式请求时，请求返回 usage 数据（用于日志记录）
		if (stream) {
			cfPayload.stream_options = { include_usage: true };
		}

		const passthroughFields = [
			'temperature', 'max_tokens', 'top_p', 'n',
			'stop', 'presence_penalty', 'frequency_penalty',
			'logprobs', 'top_logprobs', 'seed', 'user',
			'tools', 'tool_choice', 'parallel_tool_calls',
			'response_format',
		];
		for (const field of passthroughFields) {
			if (body[field] !== undefined) cfPayload[field] = body[field];
		}

		const result = await callOpenAICompatibleAPI(cfPayload, env, stream, model, authInfo?.providerIds);

		if (!result.success) {
			// 记录失败请求的日志
			ctx.waitUntil(logApiUsage(env, {
				keyId: authInfo?.keyId,
				keyName: authInfo?.keyName,
				model, cfModel,
				promptTokens: 0, completionTokens: 0,
				accountId: result.accountId,
				accountName: result.accountName,
				endpoint: pathname,
				statusCode: 502,
				durationMs: 0,
				success: false,
				errorType: result.error?.substring(0, 200) + (result._diag ? ' | DIAG:' + JSON.stringify(result._diag) : '') || 'unknown_error'
			}));
			return new Response(JSON.stringify({
				error: { message: result.error, type: "server_error" }
			}), { status: 502, headers: { 'Content-Type': 'application/json' } });
		}

		if (stream) {
			// 流式响应：包装流以捕获最终 usage 数据
			const wrappedStream = wrapStreamWithUsageTracking(result.stream, model, cfModel, authInfo, env, result.accountId, result.accountName, pathname, ctx);
			return new Response(wrappedStream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive',
					'Transfer-Encoding': 'chunked',
				},
			});
		} else {
			const cfJson = result.data;
			if (cfJson.model !== undefined) cfJson.model = model;
			// 确保 choices[0].message.content 始终为字符串
			if (cfJson.choices && cfJson.choices[0] && cfJson.choices[0].message && cfJson.choices[0].message.content !== undefined && cfJson.choices[0].message.content !== null) {
				cfJson.choices[0].message.content = String(cfJson.choices[0].message.content);
			}

			// 非流式：记录密钥用量（无论是否有 usage 数据）
			ctx.waitUntil(logApiUsage(env, {
				keyId: authInfo?.keyId, keyName: authInfo?.keyName,
				model, cfModel,
				promptTokens: cfJson.usage?.prompt_tokens || 0,
				completionTokens: cfJson.usage?.completion_tokens || 0,
				accountId: result.accountId, accountName: result.accountName,
				endpoint: pathname,
				statusCode: 200,
				durationMs: result.durationMs || 0,
				success: true,
				errorType: ''
			}));

			return new Response(JSON.stringify(cfJson), {
				headers: { 'Content-Type': 'application/json' },
			});
		}
	} catch (e) {
		console.error('Completions error:', e);
		return new Response(JSON.stringify({
			error: {
				message: "Internal server error: " + e.message,
				type: "server_error"
			}
		}), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
}

// ----------------------------------------------------
// Anthropic Messages API → OpenAI Chat Completions 格式转换
// ----------------------------------------------------
function convertAnthropicToOpenAI(anthropicBody) {
	const openaiBody = {};

	// model 直接映射
	openaiBody.model = anthropicBody.model;

	// max_tokens 直接映射
	if (anthropicBody.max_tokens !== undefined) {
		openaiBody.max_tokens = anthropicBody.max_tokens;
	}

	// stream 直接映射
	if (anthropicBody.stream !== undefined) {
		openaiBody.stream = anthropicBody.stream;
	}

	// temperature 直接映射
	if (anthropicBody.temperature !== undefined) {
		openaiBody.temperature = anthropicBody.temperature;
	}

	// top_p 直接映射
	if (anthropicBody.top_p !== undefined) {
		openaiBody.top_p = anthropicBody.top_p;
	}

	// stop_sequences → stop
	if (anthropicBody.stop_sequences !== undefined) {
		openaiBody.stop = anthropicBody.stop_sequences;
	}

	// 构建 OpenAI 格式的 messages 数组
	const openaiMessages = [];

	// Anthropic system 字段 → OpenAI system role message (插入到 messages 最前面)
	if (anthropicBody.system) {
		let systemContent = '';
		if (typeof anthropicBody.system === 'string') {
			systemContent = anthropicBody.system;
		} else if (Array.isArray(anthropicBody.system)) {
			// system 为数组格式：[{type: "text", text: "..."}, ...]
			for (const block of anthropicBody.system) {
				if (block.type === 'text' && block.text) {
					systemContent += block.text + '\n';
				}
			}
			systemContent = systemContent.trim();
		}
		if (systemContent) {
			openaiMessages.push({ role: 'system', content: systemContent });
		}
	}

	// 转换 messages
	for (const msg of anthropicBody.messages) {
		const role = msg.role;
		const content = msg.content;

		// Anthropic 的 content 可能是字符串或数组
		if (typeof content === 'string') {
			openaiMessages.push({ role, content });
		} else if (Array.isArray(content)) {

			// assistant 消息：text 和 tool_use 需合并为一条消息（Bug #4）
			if (role === 'assistant') {
				let textContent = '';
				const toolCalls = [];

				for (const block of content) {
					if (block.type === 'text') {
						textContent += block.text || '';
					} else if (block.type === 'tool_use') {
						toolCalls.push({
							id: block.id,
							type: 'function',
							function: {
								name: block.name,
								arguments: JSON.stringify(block.input || {})
							}
						});
					}
				}

				const assistantMsg = { role: 'assistant', content: textContent || null };
				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls;
				}
				openaiMessages.push(assistantMsg);
				continue;
			}

			// user 消息：先处理 tool_result，再处理 text/image（Bug #5）
			if (role === 'user') {
				// 先处理 tool_result 块
				for (const block of content) {
					if (block.type === 'tool_result') {
						let resultContent = '';
						if (typeof block.content === 'string') {
							resultContent = block.content;
						} else if (Array.isArray(block.content)) {
							for (const c of block.content) {
								if (c.type === 'text' && c.text) {
									resultContent += c.text;
								}
							}
						}
						const toolMsg = {
							role: 'tool',
							tool_call_id: block.tool_use_id,
							content: resultContent
						};
						if (block.name) toolMsg.name = block.name;
						openaiMessages.push(toolMsg);
					}
				}

				// 再处理剩余的 text 和 image 块
				const openaiContentParts = [];
				for (const block of content) {
					if (block.type === 'text') {
						openaiContentParts.push({ type: 'text', text: block.text || '' });
					} else if (block.type === 'image') {
						// Anthropic image source → OpenAI image_url
						const source = block.source || {};
						let imageUrl = '';
						if (source.type === 'url' && source.url) {
							// URL 类型图片（Bug #3）
							imageUrl = source.url;
						} else if (source.data) {
							const mediaType = source.media_type || 'image/png';
							imageUrl = `data:${mediaType};base64,${source.data}`;
						}
						if (imageUrl) {
							openaiContentParts.push({
								type: 'image_url',
								image_url: { url: imageUrl }
							});
						}
					}
				}

				if (openaiContentParts.length > 0) {
					openaiMessages.push({ role: 'user', content: openaiContentParts });
				}
				continue;
			}

			// 兜底：其他角色只处理 text 块
			const openaiContentParts = [];
			for (const block of content) {
				if (block.type === 'text') {
					openaiContentParts.push({ type: 'text', text: block.text || '' });
				}
			}
			if (openaiContentParts.length > 0) {
				openaiMessages.push({ role, content: openaiContentParts });
			}
		}
	}

	// 确保第一条消息是 user（OpenAI 要求第一条消息必须是 user 或 system）
	// 如果第一条是 assistant（来自 Anthropic 的多轮 tool calling），在它前面插入一条占位 user 消息
	const firstNonSystemMsg = openaiMessages.find(m => m.role !== 'system');
	if (firstNonSystemMsg && firstNonSystemMsg.role === 'assistant') {
		// 找到 system 消息后的位置，插入一条空的 user 消息
		const systemCount = openaiMessages.filter(m => m.role === 'system').length;
		openaiMessages.splice(systemCount, 0, {
			role: 'user',
			content: '_'
		});
	}

	openaiBody.messages = openaiMessages;

	// tools 字段转换：Anthropic 格式 → OpenAI 格式
	if (anthropicBody.tools && Array.isArray(anthropicBody.tools)) {
		openaiBody.tools = anthropicBody.tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description || '',
				parameters: tool.input_schema || {}
			}
		}));
	}

	// tool_choice 转换
	if (anthropicBody.tool_choice) {
		const tc = anthropicBody.tool_choice;
		if (tc.type === 'auto') {
			openaiBody.tool_choice = 'auto';
		} else if (tc.type === 'any') {
			openaiBody.tool_choice = 'required';
		} else if (tc.type === 'tool' && tc.name) {
			openaiBody.tool_choice = { type: 'function', function: { name: tc.name } };
		}
	}

	return openaiBody;
}

// ----------------------------------------------------
// OpenAI Chat Completion 响应 → Anthropic Messages 格式转换
// ----------------------------------------------------
function convertOpenAIToAnthropic(openaiResponse, originalModel) {
	const choice = openaiResponse.choices?.[0] || {};
	const message = choice.message || {};

	const anthropicResponse = {
		id: `msg_${crypto.randomUUID()}`,
		type: 'message',
		role: 'assistant',
		content: [],
		model: originalModel,
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: openaiResponse.usage?.prompt_tokens || 0,
			output_tokens: openaiResponse.usage?.completion_tokens || 0
		}
	};

	// 文本内容 → text block
	if (message.content) {
		anthropicResponse.content.push({
			type: 'text',
			text: message.content
		});
	}

	// tool_calls → tool_use blocks
	if (message.tool_calls && Array.isArray(message.tool_calls)) {
		for (const tc of message.tool_calls) {
			let inputObj = {};
			try {

				inputObj = typeof tc.function.arguments === 'string'
					? JSON.parse(tc.function.arguments)
					: tc.function.arguments;
			} catch (_) {
				inputObj = {};
			}
			anthropicResponse.content.push({
				type: 'tool_use',
				id: tc.id,
				name: tc.function.name,
				input: inputObj
			});
		}
	}

	// finish_reason → stop_reason 映射
	const finishReason = choice.finish_reason;
	if (finishReason === 'stop') {
		anthropicResponse.stop_reason = 'end_turn';
	} else if (finishReason === 'tool_calls') {
		anthropicResponse.stop_reason = 'tool_use';
	} else if (finishReason === 'length') {
		anthropicResponse.stop_reason = 'max_tokens';
	} else {
		anthropicResponse.stop_reason = finishReason || 'end_turn';
	}

	return anthropicResponse;
}

// ----------------------------------------------------
// OpenAI 错误响应 → Anthropic 错误格式转换
// ----------------------------------------------------
function convertOpenAIErrorToAnthropic(openaiError, statusCode) {
	return {
		type: 'error',
		error: {
			type: 'api_error',
			message: openaiError?.error?.message || openaiError?.message || 'Unknown error'
		}
	};
}

// ----------------------------------------------------
// Anthropic /v1/messages 路由处理函数
// ----------------------------------------------------
async function handleMessages(request, env, ctx, authInfo) {
	// 认证由 handleV1Proxy 的 checkProxyAuth 统一处理（支持 x-api-key + Bearer）

	// 解析请求体
	let anthropicBody;
	try {
		anthropicBody = await request.json();
	} catch (e) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'invalid_request_error', message: 'Invalid JSON body.' }
		}), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 基本参数校验
	if (!anthropicBody.messages || !Array.isArray(anthropicBody.messages)) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'invalid_request_error', message: 'messages field is required and must be an array.' }
		}), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}
	if (!anthropicBody.max_tokens) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'invalid_request_error', message: 'max_tokens is required.' }
		}), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 解析模型名映射
	const model = anthropicBody.model;

	// 检查 API 密钥的模型白名单
	const modelCheck = checkModelAllowed(model, authInfo);
	if (modelCheck) return modelCheck;

	const cfModel = await resolveModelName(model, env);
	if (!cfModel) {
		return new Response(JSON.stringify({
			type: 'error',
			error: { type: 'model_disabled', message: `Model "${model}" is disabled` }
		}), { status: 403, headers: { 'Content-Type': 'application/json' } });
	}

	// Anthropic → OpenAI 格式转换
	const openaiBody = convertAnthropicToOpenAI(anthropicBody);
	openaiBody.model = cfModel;

	const stream = !!anthropicBody.stream;

	const result = await callOpenAICompatibleAPI(openaiBody, env, stream, model, authInfo?.providerIds);

	if (!result.success) {
		// 尝试解析 CF 错误详情
		let errorDetail;
		try {
			if (result.error && result.error.includes('CF API returned')) {
				const match = result.error.match(/CF API returned \d+: (.+)/);
				if (match) {
					errorDetail = JSON.parse(match[1]);
				}
			}
		} catch (_) { }

		// 记录失败请求
		ctx.waitUntil(logApiUsage(env, {
			keyId: authInfo?.keyId, keyName: authInfo?.keyName,
			model, cfModel,
			promptTokens: 0, completionTokens: 0,
			accountId: result.accountId, accountName: result.accountName,
			endpoint: '/v1/messages',
			statusCode: 502,
			durationMs: 0,
			success: false,
			errorType: result.error?.substring(0, 200) + (result._diag ? ' | DIAG:' + JSON.stringify(result._diag) : '') || 'unknown_error'
		}));

		const anthropicError = convertOpenAIErrorToAnthropic(
			errorDetail || { message: result.error },
			502
		);
		return new Response(JSON.stringify(anthropicError), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (stream) {
		// 流式：先包装日志追踪，再转换 Anthropic 格式
		const trackingStream = wrapStreamWithUsageTracking(
			result.stream, model, cfModel, authInfo, env,
			result.accountId, result.accountName, '/v1/messages', ctx
		);
		const transformedStream = anthropicStreamTransform(trackingStream, model, anthropicBody.messages);
		return new Response(transformedStream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'Transfer-Encoding': 'chunked',
			},
		});
	} else {
		// 非流式：转换响应
		const openaiResponse = result.data;
		const anthropicResponse = convertOpenAIToAnthropic(openaiResponse, model);

		// 记录密钥用量（无论是否有 usage 数据）
		ctx.waitUntil(logApiUsage(env, {
			keyId: authInfo?.keyId, keyName: authInfo?.keyName,
			model, cfModel,
			promptTokens: openaiResponse?.usage?.prompt_tokens || 0,
			completionTokens: openaiResponse?.usage?.completion_tokens || 0,
			accountId: result.accountId, accountName: result.accountName,
			endpoint: '/v1/messages',
			statusCode: 200,
			durationMs: result.durationMs || 0,
			success: true,
			errorType: ''
		}));

		return new Response(JSON.stringify(anthropicResponse), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

// ----------------------------------------------------
// Anthropic SSE 流式转换
// 将 OpenAI SSE 格式实时转换为 Anthropic SSE 格式
// ----------------------------------------------------
function anthropicStreamTransform(upstreamBody, modelName, originalMessages) {
	const reader = upstreamBody.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	let messageId = `msg_${crypto.randomUUID()}`;
	let contentBlockIndex = -1;  // 首次递增后从 0 开始（Bug #8）
	let currentToolCallId = null;
	let currentToolName = null;
	let currentToolArgs = '';
	let streamStarted = false;
	let blockStopSent = false;  // 跟踪最后一个 content block 是否已发送 stop（Bug #2）
	let inputTokens = 0;
	let outputTokens = 0;

	let enqueuedAny = false;

	return new ReadableStream({
		async pull(controller) {
			enqueuedAny = false;
			const originalEnqueue = controller.enqueue.bind(controller);
			controller.enqueue = (chunk) => {
				enqueuedAny = true;
				originalEnqueue(chunk);
			};

			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					if (buffer.trim()) {
						buffer = processLines(buffer, controller);
					}
					controller.close();
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				buffer = processLines(buffer, controller);

				if (buffer.indexOf('\n') === -1) {
					if (enqueuedAny) {
						break;
					}
				}
			}
		},
		cancel() {
			reader.cancel();
		},
	});

	function processLines(data, controller) {
		const lines = data.split('\n');
		const remaining = lines.pop();

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			if (trimmed.startsWith('data: ')) {
				const dataStr = trimmed.slice(6);
				if (dataStr === '[DONE]') {
					// 发送最终事件
					sendFinalEvent(controller);
					continue;
				}

				try {
					const chunk = JSON.parse(dataStr);
					const choice = chunk.choices?.[0];
					if (!choice) continue;

					const delta = choice.delta || {};

					// 更新 usage
					if (chunk.usage) {
						inputTokens = chunk.usage.prompt_tokens || 0;
						outputTokens = chunk.usage.completion_tokens || 0;
					}

					// 处理 tool_calls delta
					if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
						// 首次发送任何数据前先发送 message_start（Bug #1）
						if (!streamStarted) {
							sendMessageStart(controller);
							streamStarted = true;
						}

						for (const tc of delta.tool_calls) {
							if (tc.id) {
								// 新的 tool_call 开始
								if (currentToolCallId) {
									// 先结束上一个
									sendContentBlockStop(controller);
									blockStopSent = true;
								}
								currentToolCallId = tc.id;
								currentToolName = tc.function?.name || '';
								currentToolArgs = '';
								contentBlockIndex++;
								blockStopSent = false;

								sendContentBlockStart(controller, 'tool_use');
							}

							if (tc.function?.arguments) {
								currentToolArgs += tc.function.arguments;
								// 发送 tool_use 的 input_json_delta
								sendToolUseDelta(controller, tc.function.arguments);
							}
						}
					} else if (delta.content) {
						// 文本内容 delta
						if (!streamStarted) {
							sendMessageStart(controller);
							contentBlockIndex++;
							sendContentBlockStart(controller, 'text');
							streamStarted = true;
							blockStopSent = false;
						}

						// 如果之前有 tool_call 在进行中，先结束
						if (currentToolCallId) {
							sendContentBlockStop(controller);
							blockStopSent = true;
							currentToolCallId = null;
							currentToolName = null;
							currentToolArgs = '';

							// 开始新的 text block
							contentBlockIndex++;
							sendContentBlockStart(controller, 'text');
							blockStopSent = false;
						}

						sendTextDelta(controller, delta.content);
					}

					// 检查 finish_reason
					if (choice.finish_reason) {
						if (currentToolCallId && currentToolArgs) {
							// 发送最终的 tool_use input
							sendToolUseFinalInput(controller);
						}
					}
				} catch (_) {
					// 忽略解析错误
				}
			}
		}
		return remaining;
	}

	function sendMessageStart(controller) {
		const event = {
			type: 'message_start',
			message: {
				id: messageId,
				type: 'message',
				role: 'assistant',
				content: [],
				model: modelName,
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: inputTokens, output_tokens: outputTokens }
			}
		};
		controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(event)}\n\n`));
	}

	function sendContentBlockStart(controller, blockType) {
		const event = {
			type: 'content_block_start',
			index: contentBlockIndex,
			content_block: blockType === 'tool_use'
				? { type: 'tool_use', id: currentToolCallId, name: currentToolName, input: {} }
				: { type: 'text', text: '' }
		};
		controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(event)}\n\n`));
	}

	function sendTextDelta(controller, text) {
		const event = {
			type: 'content_block_delta',
			index: contentBlockIndex,
			delta: { type: 'text_delta', text }
		};
		controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`));
	}

	function sendToolUseDelta(controller, argsDelta) {
		const event = {
			type: 'content_block_delta',
			index: contentBlockIndex,
			delta: { type: 'input_json_delta', partial_json: argsDelta }
		};
		controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`));
	}

	function sendToolUseFinalInput(controller) {
		// 发送最终的 content_block_stop
		controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({
			type: 'content_block_stop',
			index: contentBlockIndex
		})}\n\n`));
		blockStopSent = true;
	}

	function sendContentBlockStop(controller) {
		controller.enqueue(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify({
			type: 'content_block_stop',
			index: contentBlockIndex
		})}\n\n`));
	}

	function sendFinalEvent(controller) {
		// 如果 finish_reason 触发时已发送过 content_block_stop，跳过重复发送（Bug #2）
		if (!blockStopSent) {
			sendContentBlockStop(controller);
		}

		let stopReason = 'end_turn';
		if (currentToolCallId) {
			stopReason = 'tool_use';
		}

		const event = {
			type: 'message_delta',
			delta: {
				stop_reason: stopReason,
				stop_sequence: null
			},
			usage: { output_tokens: outputTokens || 0 }
		};
		controller.enqueue(encoder.encode(`event: message_delta\ndata: ${JSON.stringify(event)}\n\n`));

		controller.enqueue(encoder.encode(`event: message_stop\ndata: ${JSON.stringify({
			type: 'message_stop'
		})}\n\n`));
	}
}

// 向量嵌入（Embeddings）的代理处理函数
async function handleEmbeddings(request, env, ctx, authInfo) {
	let body;
	try {
		body = await request.json();
	} catch (e) {
		return new Response(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }), { status: 400 });
	}

	const { model, input } = body;
	if (!input) {
		return new Response(JSON.stringify({ error: { message: "input is required", type: "invalid_request_error" } }), { status: 400 });
	}

	// 检查 API 密钥的模型白名单
	const modelCheck = checkModelAllowed(model, authInfo);
	if (modelCheck) return modelCheck;

	// 解析模型名映射
	let cfModel = model;
	if (!cfModel.startsWith('@cf/')) {
		const customMap = await getCustomModelMap(env);
		const combinedMap = { ...DEFAULT_MODEL_MAP, ...customMap };
		cfModel = combinedMap[model];
		if (!cfModel) {
			cfModel = '@cf/baai/bge-m3'; // 找不到映射就用这个默认模型兜底
		}
	}

	const textArray = Array.isArray(input) ? input : [input];

	// ======== 统一后端选择（AI Binding + CF 账号 + 外部服务商）========
	let backends = [];

	// 1. AI Binding
	if (env.AI) {
		const bindingConfig = await getBindingConfig(env);
		if (bindingConfig.enabled !== false) {
			backends.push({
				_type: 'ai-binding',
				id: 'ai-binding',
				name: 'AI Binding',
				priority: bindingConfig.priority || 0
			});
		}
	}

	// 2. CF 账号
	try {
		const accounts = await getAccounts(env);
		const activeAccounts = (accounts.filter(a => a.status === 'active') || []).map(a => ({
			_type: 'cloudflare',
			id: a.id,
			name: a.name || a.accountId,
			accountId: a.accountId,
			apiToken: a.apiToken,
			priority: a.priority || 0
		}));
		backends.push(...activeAccounts);
	} catch (e) {
		// 忽略账号获取失败，继续尝试其他后端
	}

	// 3. 外部服务商（有当前模型映射的活跃服务商，含每日限额检查）
	try {
		const externalProviders = await getExternalProviders(env);
		const { activeProviders } = await filterActiveProvidersByLimit(externalProviders, model, env);
		backends.push(...activeProviders);
	} catch (e) {
		// 忽略外部服务商获取失败
	}

	// 应用 providerIds 过滤
	if (authInfo?.providerIds && authInfo.providerIds.length > 0) {
		backends = backends.filter(b => authInfo.providerIds.includes(b.id));
	}

	if (backends.length === 0) {
		return new Response(JSON.stringify({
			error: { message: "No active backend available for embeddings", type: "server_error" }
		}), { status: 503, headers: { 'Content-Type': 'application/json' } });
	}

	// 按优先级升序排列（数字越小越优先），同优先级随机打乱
	const priorityGroups = {};
	for (const b of backends) {
		const p = b.priority || 0;
		if (!priorityGroups[p]) priorityGroups[p] = [];
		priorityGroups[p].push(b);
	}
	const shuffledBackends = Object.keys(priorityGroups)
		.sort((a, b) => a - b)
		.flatMap(p => priorityGroups[p].sort(() => Math.random() - 0.5));

	let lastError = null;

	for (const backend of shuffledBackends) {
		if (backend._type === 'ai-binding') {
			// ======== AI Binding ========
			try {
				const t0 = Date.now();
				const bindingResult = await env.AI.run(cfModel, { text: textArray });
				if (bindingResult && bindingResult.success) {
					const embeddings = bindingResult.result.data.map((emb, index) => ({
						object: "embedding",
						index: index,
						embedding: emb
					}));

					const responseObj = {
						object: "list",
						data: embeddings,
						model: model,
						usage: {
							prompt_tokens: textArray.reduce((acc, text) => acc + Math.ceil(text.length / 4), 0),
							total_tokens: textArray.reduce((acc, text) => acc + Math.ceil(text.length / 4), 0)
						}
					};

					ctx.waitUntil(logApiUsage(env, {
						keyId: authInfo?.keyId, keyName: authInfo?.keyName,
						model, cfModel,
						promptTokens: responseObj.usage?.prompt_tokens || 0, completionTokens: 0,
						accountId: 'ai-binding', accountName: 'AI Binding',
						endpoint: '/v1/embeddings',
						statusCode: 200,
						durationMs: Date.now() - t0,
						success: true,
						errorType: ''
					}));

					return new Response(JSON.stringify(responseObj), { headers: { 'Content-Type': 'application/json' } });
				} else {
					lastError = `[AI Binding] returned empty or unsuccessful result`;
				}
			} catch (e) {
				lastError = `[AI Binding] Error: ${e.message}`;
			}
		} else if (backend._type === 'cloudflare') {
			// ======== CF 账号（REST API /ai/run/{model}）========
			try {
				const t0 = Date.now();
				const cfResponse = await fetch(`https://api.cloudflare.com/client/v4/accounts/${backend.accountId}/ai/run/${cfModel}`, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${backend.apiToken}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ text: textArray })
				});

				if (cfResponse.ok) {
					const cfJson = await cfResponse.json();
					if (cfJson.success) {
						const embeddings = cfJson.result.data.map((emb, index) => ({
							object: "embedding",
							index: index,
							embedding: emb
						}));

						const responseObj = {
							object: "list",
							data: embeddings,
							model: model,
							usage: {
								prompt_tokens: textArray.reduce((acc, text) => acc + Math.ceil(text.length / 4), 0),
								total_tokens: textArray.reduce((acc, text) => acc + Math.ceil(text.length / 4), 0)
							}
						};

						ctx.waitUntil(logApiUsage(env, {
							keyId: authInfo?.keyId, keyName: authInfo?.keyName,
							model, cfModel,
							promptTokens: responseObj.usage?.prompt_tokens || 0, completionTokens: 0,
							accountId: backend.accountId, accountName: backend.name,
							endpoint: '/v1/embeddings',
							statusCode: 200,
							durationMs: Date.now() - t0,
							success: true,
							errorType: ''
						}));

						return new Response(JSON.stringify(responseObj), { headers: { 'Content-Type': 'application/json' } });
					} else {
						lastError = `[${backend.name}] CF Run failed: ${JSON.stringify(cfJson.errors)}`;
					}
				} else {
					const errorText = await cfResponse.text();
					lastError = `[${backend.name}] CF API status ${cfResponse.status}: ${errorText}`;
				}
			} catch (e) {
				lastError = `[${backend.name}] Connection error: ${e.message}`;
			}
		} else if (backend._type === 'external') {
			// ======== 外部服务商（OpenAI 兼容 /embeddings 端点）========
			try {
				const baseUrl = backend.baseUrl.replace(/\/+$/, '');
				const t0 = Date.now();
				const response = await fetch(`${baseUrl}/embeddings`, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${backend.apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ model: backend.mappedModel, input: textArray })
				});

				if (response.ok) {
					const json = await response.json();
					if (json && json.data && Array.isArray(json.data)) {
						const responseObj = {
							object: "list",
							data: json.data.map((item, index) => ({
								object: "embedding",
								index: item.index !== undefined ? item.index : index,
								embedding: item.embedding
							})),
							model: model,
							usage: {
								prompt_tokens: json.usage?.prompt_tokens || textArray.reduce((acc, text) => acc + Math.ceil(text.length / 4), 0),
								total_tokens: json.usage?.total_tokens || textArray.reduce((acc, text) => acc + Math.ceil(text.length / 4), 0)
							}
						};

						ctx.waitUntil(logApiUsage(env, {
							keyId: authInfo?.keyId, keyName: authInfo?.keyName,
							model, cfModel,
							promptTokens: responseObj.usage?.prompt_tokens || 0, completionTokens: 0,
							accountId: backend.id, accountName: backend.name,
							endpoint: '/v1/embeddings',
							statusCode: 200,
							durationMs: Date.now() - t0,
							success: true,
							errorType: ''
						}));

						return new Response(JSON.stringify(responseObj), { headers: { 'Content-Type': 'application/json' } });
					} else {
						lastError = `[${backend.name}] Invalid embeddings response format`;
					}
				} else {
					const errorText = await response.text();
					lastError = `[${backend.name}] API returned ${response.status}: ${errorText}`;
				}
			} catch (e) {
				lastError = `[${backend.name}] Connection error: ${e.message}`;
			}
		}
	}

	return new Response(JSON.stringify({
		error: { message: `All backends failed. Last error: ${lastError}`, type: "server_error" }
	}), { status: 502, headers: { 'Content-Type': 'application/json' } });
}

// ----------------------------------------------------
// 粗略估算 token 数量（按每 4 个字符约 1 个 token 估算）
// ----------------------------------------------------
function estimateUsage(messages, answer) {
	let promptChars = 0;
	for (const msg of messages) {
		promptChars += (msg.content || '').length;
	}
	const completionChars = (answer || '').length;

	const promptTokens = Math.ceil(promptChars / 4);
	const completionTokens = Math.ceil(completionChars / 4);

	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens
	};
}

// 透传 CF /ai/v1/chat/completions 返回的 SSE 流
// CF 返回的本来就是标准 OpenAI 的 SSE 格式，我们只把模型名改一下，
// 这样 tool_calls、finish_reason、reasoning_content、usage 等字段都能原样保留。
function passthroughStream(upstreamBody, modelName) {
	const reader = upstreamBody.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';

	return new ReadableStream({
		async pull(controller) {
			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					// 把缓冲区里剩下的内容输出掉
					if (buffer.trim()) {
						buffer = processLines(buffer, controller);
					}
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					controller.close();
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				buffer = processLines(buffer, controller);

				if (buffer.indexOf('\n') === -1) {
					break;
				}
			}
		},
		cancel() {
			reader.cancel();
		},
	});

	function processLines(data, controller) {
		const lines = data.split('\n');
		const remaining = lines.pop(); // 把最后可能不完整的一行留在缓冲区里

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			if (trimmed.startsWith('data: ')) {
				const dataStr = trimmed.slice(6);
				if (dataStr === '[DONE]') continue;

				try {
					const chunk = JSON.parse(dataStr);
					// 只改模型名，其他字段全部原样透传
					// 这样 tool_calls、finish_reason、usage、reasoning_content 都能保留下来
					if (chunk.model !== undefined) chunk.model = modelName;
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
				} catch (_) {
					// 解析不了的行，按原样转发
					controller.enqueue(encoder.encode(`${line}\n`));
				}
			} else {
				// 非 data 开头的 SSE 行（注释、事件等），原样转发
				controller.enqueue(encoder.encode(`${line}\n`));
			}
		}
		return remaining;
	}
}

// 流式响应包装器：捕获最终 SSE 数据块中的 usage 信息并记录密钥用量
function wrapStreamWithUsageTracking(upstreamBody, modelName, cfModel, authInfo, env, accountId, accountName, endpoint, ctx) {
	const reader = upstreamBody.getReader();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = '';
	let lastUsage = null;
	const startTime = Date.now();

	const { readable, writable } = new TransformStream();
	const writer = writable.getWriter();

	// 在独立的异步上下文中处理整个流，用 ctx.waitUntil 确保日志写入完成
	const processPromise = (async () => {
		try {
			// 预编译模型名替换用的正则（比每次 new RegExp 快）
			const modelRe = /"model":"[^"]*"/;
			const modelReplacement = `"model":"${modelName}"`;

			while (true) {
				const { value, done } = await reader.read();
				if (done) {
					if (buffer.trim()) {
						for (const line of buffer.trim().split('\n')) {
							const trimmed = line.trim();
							if (!trimmed) continue;
							await writer.write(encoder.encode(trimmed + '\n'));
						}
					}
					await writer.write(encoder.encode('data: [DONE]\n\n'));
					await writer.close();
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					if (trimmed.startsWith('data: ')) {
						const dataStr = trimmed.slice(6);
						if (dataStr === '[DONE]') continue;

						// 快速路径：仅当 chunk 包含 usage 字段时才做完整 JSON 解析
						// 其他 chunk 直接用字符串替换模型名，跳过 JSON.parse/stringify
						if (dataStr.includes('"usage"')) {
							try {
								const chunk = JSON.parse(dataStr);
								if (chunk.usage) {
									lastUsage = chunk.usage;
								}
								if (chunk.model !== undefined) chunk.model = modelName;
								await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
							} catch (_) {
								await writer.write(encoder.encode(`${line}\n`));
							}
						} else {
							// 快速透传：字符串替换模型名，跳过 JSON 解析
							try {
								const replaced = dataStr.replace(modelRe, modelReplacement);
								await writer.write(encoder.encode(`data: ${replaced}\n\n`));
							} catch (_) {
								await writer.write(encoder.encode(`${line}\n`));
							}
						}
					} else {
						await writer.write(encoder.encode(`${line}\n`));
					}
				}
			}
		} catch (e) {
			try { writer.close(); } catch (_) {}
		} finally {
			// 流处理完成后记录日志（在独立上下文，不影响响应）
			const promptTokens = lastUsage?.prompt_tokens || 0;
			const completionTokens = lastUsage?.completion_tokens || 0;
			try {
				await logApiUsage(env, {
					keyId: authInfo?.keyId, keyName: authInfo?.keyName,
					model: modelName, cfModel,
					promptTokens, completionTokens,
					accountId, accountName,
					endpoint,
					statusCode: 200,
					durationMs: Date.now() - startTime,
					success: true,
					errorType: ''
				});
			} catch (e) {
			}
		}
	})();

	ctx.waitUntil(processPromise);

	return readable;
}

// ----------------------------------------------------
// WebSocket 请求处理函数
// ----------------------------------------------------
async function handleWebSocketRequest(request, env) {
	try {
		const upgradeHeader = request.headers.get('Upgrade');
		if (upgradeHeader !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		const url = new URL(request.url);
		// 安全：仅从请求头获取 API Key，不使用 URL 参数（避免日志泄漏和 Referer 泄漏）
		const apiKey = request.headers.get('x-api-key');

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		const apiKeys = await getApiKeys(env);
		if (apiKeys.length > 0) {
			if (!apiKey || !apiKeys.some(k => k.key === apiKey)) {
				return new Response('Unauthorized', { status: 401 });
			}
		}

		server.accept();

		server.addEventListener('message', async (event) => {
			try {
				const body = JSON.parse(event.data);
				const { model, messages, stream = true } = body;

				if (!model || !messages || !Array.isArray(messages)) {
					server.send(JSON.stringify({
						error: { message: "model and messages are required", type: "invalid_request_error" }
					}));
					server.close(1003, 'Missing required fields');
					return;
				}

				const cfModel = await resolveModelName(model, env);
				if (!cfModel) {
					server.close(1003, `Model "${model}" is disabled`);
					return;
				}
				const normalizedMessages = normalizeMessageContent(messages);

				const cfPayload = {
					model: cfModel,
					messages: normalizedMessages,
					stream: true,
				};

				const passthroughFields = [
					'temperature', 'max_tokens', 'top_p', 'n',
					'stop', 'presence_penalty', 'frequency_penalty',
					'logprobs', 'top_logprobs', 'seed', 'user',
					'tools', 'tool_choice', 'parallel_tool_calls',
					'response_format',
				];
				for (const field of passthroughFields) {
					if (body[field] !== undefined) cfPayload[field] = body[field];
				}

				const result = await callOpenAICompatibleAPI(cfPayload, env, true, model, null);

				if (result.success && result.stream) {
					const reader = result.stream.getReader();
					const decoder = new TextDecoder();
					let buffer = '';

					while (true) {
						const { value, done } = await reader.read();
						if (done) break;

						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() || '';

						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed || !trimmed.startsWith('data: ')) continue;

							const dataStr = trimmed.slice(6);
							if (dataStr === '[DONE]') {
								server.send(JSON.stringify({ type: 'end' }));
								continue;
							}

							try {
								const chunk = JSON.parse(dataStr);
								if (chunk.model !== undefined) chunk.model = model;
								server.send(JSON.stringify(chunk));
							} catch (_) {
							}
						}
					}
				} else if (result.success && result.data) {
					// 非流式结果（如 AI Binding 的非流式回退）
					const data = result.data;
					if (data.model !== undefined) data.model = model;
					server.send(JSON.stringify(data));
				} else {
					server.send(JSON.stringify({
						error: { message: result.error || 'All backends failed' }
					}));
				}

				server.close(1000, 'Complete');
			} catch (e) {
				console.error('WebSocket error:', e);
				try {
					server.send(JSON.stringify({ error: { message: e.message } }));
				} catch (_) { }
				server.close(1011, 'Error');
			}
		});

		server.addEventListener('close', () => { });
		server.addEventListener('error', () => { });

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	} catch (e) {
		console.error('WebSocket init error:', e);
		return new Response(JSON.stringify({ error: { message: e.message } }), { status: 500 });
	}
}

// ----------------------------------------------------
// 后台管理面板的 API 接口处理函数
// ----------------------------------------------------
async function handleDashboardApi(request, env, ctx) {
	const url = new URL(request.url);
	const method = request.method;

	// 1. 查询初始化状态（密码通过环境变量配置，所以这里永远返回已初始化）
	if (url.pathname === '/api/auth/status' && method === 'GET') {
		return new Response(JSON.stringify({
			isSetup: true
		}), { headers: { 'Content-Type': 'application/json' } });
	}

	// 2. 设置首个管理员密码（已停用，改由环境变量 ADMIN_PASSWORD 配置）
	if (url.pathname === '/api/auth/setup' && method === 'POST') {
		return new Response(JSON.stringify({ error: 'Setup is handled via environment variable ADMIN_PASSWORD' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
	}

	// 3. 登录（session + 2FA + 限流 + CSRF 防护 + Secure Cookie）
	if (url.pathname === '/api/auth/login' && method === 'POST') {
		// CSRF 防护：验证 Origin 或 Referer 是否与请求自身的 Host 匹配（同源校验）
		// 使用 Host 头而非硬编码域名列表，确保自定义域名也能正常使用
		const host = request.headers.get('Host');
		const origin = request.headers.get('Origin');
		const referer = request.headers.get('Referer');
		if (origin) {
			try {
				const originUrl = new URL(origin);
				if (originUrl.hostname !== host && originUrl.hostname !== 'localhost') {
					return new Response(JSON.stringify({ error: 'CSRF: Invalid origin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
				}
			} catch {
				return new Response(JSON.stringify({ error: 'CSRF: Invalid origin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
			}
		} else if (referer) {
			try {
				const refererUrl = new URL(referer);
				if (refererUrl.hostname !== host && refererUrl.hostname !== 'localhost') {
					return new Response(JSON.stringify({ error: 'CSRF: Invalid referer' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
				}
			} catch {
				return new Response(JSON.stringify({ error: 'CSRF: Invalid referer' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
			}
		}
		// 无 Origin 且无 Referer（如 curl 等非浏览器客户端）时放行
		// 限流：同一 IP 5 分钟内最多 5 次失败
		const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
		const rateCheck = await checkRateLimit(env, clientIp);
		if (!rateCheck.allowed) {
			return new Response(JSON.stringify({
				error: `登录过于频繁，请 ${rateCheck.retryAfter} 秒后再试`
			}), {
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					'Retry-After': String(rateCheck.retryAfter)
				}
			});
		}

		const { password, totpCode, tempToken } = await request.json();
		const expectedPassword = env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD.trim() : '';

		// 如果携带有 tempToken，说明是 2FA 第二步验证
		if (tempToken) {
			const tempData = await getTemp2FAToken(env, tempToken);
			if (!tempData) {
				return new Response(JSON.stringify({ error: '2FA 验证已过期，请重新登录' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
			}
			if (!totpCode) {
				return new Response(JSON.stringify({ error: '请输入 2FA 验证码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
			}
			const secret = await get2FASecret(env);
			if (!secret) {
				return new Response(JSON.stringify({ error: '2FA 未配置' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
			}
			const valid = await verifyTOTP(secret, totpCode);
			if (!valid) {
				await recordFailedAttempt(env, clientIp);
				ctx.waitUntil(logLoginAudit(env, clientIp, '2FA 验证码错误', request.headers.get('User-Agent') || ''));
				return new Response(JSON.stringify({ error: '2FA 验证码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
			}
			// 2FA 验证通过，创建正式 session
			await deleteTemp2FAToken(env, tempToken);
			ctx.waitUntil(logLoginAudit(env, clientIp, '登录成功 (2FA)', request.headers.get('User-Agent') || ''));
			const token = await createSession(env, tempData.adminHash, true);
			return new Response(JSON.stringify({ success: true }), {
				headers: {
					'Content-Type': 'application/json',
					'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_TTL_SECONDS}`
				}
			});
		}

		// 第一步：验证密码
		if (password !== expectedPassword) {
			await recordFailedAttempt(env, clientIp);
			// 记录登录审计日志
			ctx.waitUntil(logLoginAudit(env, clientIp, '密码错误', request.headers.get('User-Agent') || ''));
			return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}

		const expectedHash = await sha256(expectedPassword);

		// 检查是否启用了 2FA
		const twoFAEnabled = await is2FAEnabled(env);
		if (twoFAEnabled) {
			const secret = await get2FASecret(env);
			if (secret) {
				// 验证 TOTP 码（如果用户在第一步就同时提供了 TOTP 码）
				if (totpCode) {
					const valid = await verifyTOTP(secret, totpCode);
					if (valid) {
						// TOTP 验证通过，直接创建 session
						const token = await createSession(env, expectedHash, true);
						ctx.waitUntil(logLoginAudit(env, clientIp, '登录成功 (2FA 一步验证)', request.headers.get('User-Agent') || ''));
						return new Response(JSON.stringify({ success: true }), {
							headers: {
								'Content-Type': 'application/json',
								'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_TTL_SECONDS}`
							}
						});
					}
					// TOTP 验证失败，但仍然需要先经过 2FA 步骤
				}
				// 需要 2FA 第二步
				const tempToken = await createTemp2FAToken(env, expectedHash);
				return new Response(JSON.stringify({ 
					success: true, 
					needs2fa: true, 
					tempToken: tempToken 
				}), {
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}

		// 没有 2FA 或 2FA 未启用，直接创建 session
		const token = await createSession(env, expectedHash);
		ctx.waitUntil(logLoginAudit(env, clientIp, '登录成功', request.headers.get('User-Agent') || ''));
		return new Response(JSON.stringify({ success: true }), {
			headers: {
				'Content-Type': 'application/json',
				'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${SESSION_TTL_SECONDS}`
			}
		});
	}

	// 4. 退出登录（清除 session + 删除 Cookie）
	if (url.pathname === '/api/auth/logout' && method === 'POST') {
		// 从 Cookie 或 Authorization 中取出 token 并删除 session
		const cookies = request.headers.get('Cookie') || '';
		const cookieMatch = cookies.match(/admin_token=([^;]+)/);
		let token = cookieMatch ? cookieMatch[1] : null;
		if (!token) {
			const authHeader = request.headers.get('Authorization');
			if (authHeader && authHeader.startsWith('Bearer ')) {
				token = authHeader.substring(7);
			}
		}
		if (token) await deleteSession(env, token);

		return new Response(JSON.stringify({ success: true }), {
			headers: {
				'Content-Type': 'application/json',
				'Set-Cookie': `admin_token=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`
			}
		});
	}

	// 5. 2FA 状态查询
	if (url.pathname === '/api/auth/2fa/status' && method === 'GET') {
		const isAdmin = await verifyAdminCookie(request, env) || await authenticateRequest(request, env);
		if (!isAdmin) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}
		const enabled = await is2FAEnabled(env);
		return new Response(JSON.stringify({ enabled }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// 6. 2FA 设置 - 生成密钥
	if (url.pathname === '/api/auth/2fa/setup' && method === 'POST') {
		const isAdmin = await verifyAdminCookie(request, env) || await authenticateRequest(request, env);
		if (!isAdmin) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}
		const secret = await generateTOTPSecret();
		// 暂存，等待验证后启用
		await env.KV.put('2fa_pending_secret', secret, { expirationTtl: 600 });
		// 生成 otpauth URI
		const issuer = encodeURIComponent('W-ai-api');
		const otpauth = `otpauth://totp/${issuer}:${issuer}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
		return new Response(JSON.stringify({ secret, otpauth }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// 7. 2FA 验证并启用
	if (url.pathname === '/api/auth/2fa/verify-setup' && method === 'POST') {
		const isAdmin = await verifyAdminCookie(request, env) || await authenticateRequest(request, env);
		if (!isAdmin) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}
		const { code } = await request.json();
		if (!code) {
			return new Response(JSON.stringify({ error: '请输入验证码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}
		const pendingSecret = await env.KV.get('2fa_pending_secret');
		if (!pendingSecret) {
			return new Response(JSON.stringify({ error: '未找到待验证的密钥，请重新开始设置' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}
		const valid = await verifyTOTP(pendingSecret, code);
		if (!valid) {
			return new Response(JSON.stringify({ error: '验证码错误，请重试' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}
		// 验证通过，保存密钥并启用 2FA
		await set2FASecret(env, pendingSecret);
		await set2FAEnabled(env, true);
		await env.KV.delete('2fa_pending_secret');
		return new Response(JSON.stringify({ success: true, message: '2FA 已成功启用' }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// 8. 禁用 2FA
	if (url.pathname === '/api/auth/2fa/disable' && method === 'POST') {
		const isAdmin = await verifyAdminCookie(request, env) || await authenticateRequest(request, env);
		if (!isAdmin) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
		}
		const { code } = await request.json();
		if (!code) {
			return new Response(JSON.stringify({ error: '请输入当前 2FA 验证码以确认禁用' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}
		const secret = await get2FASecret(env);
		if (!secret) {
			return new Response(JSON.stringify({ error: '2FA 未启用' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}
		const valid = await verifyTOTP(secret, code);
		if (!valid) {
			return new Response(JSON.stringify({ error: '验证码错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}
		await set2FAEnabled(env, false);
		await env.KV.delete('2fa_secret');
		return new Response(JSON.stringify({ success: true, message: '2FA 已禁用' }), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// 9. 公开的用量汇总（首页未登录时也能看到）
	if (url.pathname === '/api/usage/summary') {
		if (method === 'GET') {
			const cached = await getCachedSummary(env);
			if (cached) {
				return new Response(JSON.stringify(cached), { headers: { 'Content-Type': 'application/json' } });
			}

			const accounts = await getAccounts(env);
			if (accounts.length === 0) {
				return new Response(JSON.stringify({
					totalNeuronsToday: 0,
					totalAccounts: 0,
					totalLimit: 0,
					usagePercentage: 0,
					needUpdate: false
				}), { headers: { 'Content-Type': 'application/json' } });
			}

			// 读取缓存的卡片明细来检查更新时间
			const detailsRow = await env.DB.prepare('SELECT data FROM usage_cache WHERE cache_key = ?').bind('cache_usage_details').first();
			let cacheMap = {};
			if (detailsRow && detailsRow.data) {
				try {
					cacheMap = JSON.parse(detailsRow.data) || {};
				} catch (e) { }
			}

			// 判断是否有任意一个账号的更新时间超过了 20 分钟 (20 * 60 * 1000)
			const now = Date.now();
			const hasOutdated = accounts.some(account => {
				const lastUpdated = cacheMap[account.id]?.timestamp || 0;
				return (now - lastUpdated) > 20 * 60 * 1000;
			});

			// 计算当前缓存中的汇总数据和模型占比
			let totalNeuronsToday = 0;
			let modelsToday = {};
			accounts.forEach(account => {
				const cachedItem = cacheMap[account.id];
				if (cachedItem) {
					if (cachedItem.usageToday) {
						totalNeuronsToday += cachedItem.usageToday;
					}
					if (cachedItem.modelsToday) {
						cachedItem.modelsToday.forEach(m => {
							modelsToday[m.model] = (modelsToday[m.model] || 0) + m.neurons;
						});
					}
				}
			});

			const formattedModelsToday = Object.keys(modelsToday).map(model => ({
				model,
				neurons: modelsToday[model]
			}));

			const totalLimit = accounts.length * 10000;
			const usagePercentage = totalLimit > 0 ? parseFloat(((totalNeuronsToday / totalLimit) * 100).toFixed(2)) : 0;

			const summary = {
				totalNeuronsToday,
				totalAccounts: accounts.length,
				totalLimit,
				usagePercentage,
				modelsToday: formattedModelsToday,
				needUpdate: hasOutdated
			};

			await setCachedSummary(env, summary);
			return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const accounts = await getAccounts(env);
			if (accounts.length === 0) {
				return new Response(JSON.stringify({
					totalNeuronsToday: 0,
					totalAccounts: 0,
					totalLimit: 0,
					usagePercentage: 0,
					modelsToday: [],
					needUpdate: false
				}), { headers: { 'Content-Type': 'application/json' } });
			}

			// 刷新最老数据的 20 个账号
			const cacheMap = await refreshAccountsUsage(env, accounts, 20);

			// 计算最新总量和模型占比
			let totalNeuronsToday = 0;
			let modelsToday = {};
			accounts.forEach(account => {
				const cachedItem = cacheMap[account.id];
				if (cachedItem) {
					if (cachedItem.usageToday) {
						totalNeuronsToday += cachedItem.usageToday;
					}
					if (cachedItem.modelsToday) {
						cachedItem.modelsToday.forEach(m => {
							modelsToday[m.model] = (modelsToday[m.model] || 0) + m.neurons;
						});
					}
				}
			});

			const formattedModelsToday = Object.keys(modelsToday).map(model => ({
				model,
				neurons: modelsToday[model]
			}));

			const totalLimit = accounts.length * 10000;
			const usagePercentage = totalLimit > 0 ? parseFloat(((totalNeuronsToday / totalLimit) * 100).toFixed(2)) : 0;

			const summary = {
				totalNeuronsToday,
				totalAccounts: accounts.length,
				totalLimit,
				usagePercentage,
				modelsToday: formattedModelsToday,
				needUpdate: false
			};

			await setCachedSummary(env, summary);
			return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// --------------------------------------------------
	// 下面这些都是需要登录后才能访问的接口
	// --------------------------------------------------
	const isAuthorized = await checkAdminAuth(request, env);
	if (!isAuthorized) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
	}

	function maskAccountId(id) {
		if (!id || id === '(built-in)') return id;
		return id.length > 10
			? id.slice(0, 6) + '...' + id.slice(-4)
			: id.slice(0, 4) + '...';
	}

	if (url.pathname === '/api/accounts') {
		if (method === 'GET') {
			let accounts = await getAccounts(env);
			// 如果 AI Binding 已配置，加入列表
			if (env.AI) {
				const bindingConfig = await getBindingConfig(env);
				accounts = [
					{
						id: 'ai-binding',
						name: 'AI Binding',
						accountId: '(built-in)',
						apiToken: '(binding)',
						status: bindingConfig.enabled !== false ? 'active' : 'inactive',
						priority: bindingConfig.priority || 0,
						_isBinding: true
					},
					...accounts
				];
			}
			const masked = accounts.map(a => ({
				...a,
				accountId: maskAccountId(a.accountId),
				apiToken: a.apiToken
					? a.apiToken.slice(0, 4) + '****' + a.apiToken.slice(-4)
					: a.apiToken
			}));
			return new Response(JSON.stringify(masked), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const { id, name, accountId, apiToken, priority } = await request.json();

			// AI Binding 优先级编辑
			if (id === 'ai-binding') {
				if (priority !== undefined) {
					const bindingConfig = await getBindingConfig(env);
					bindingConfig.priority = priority;
					await saveBindingConfig(env, bindingConfig);
				}
				return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
			}

			if (!accountId || !apiToken) {
				return new Response(JSON.stringify({ error: 'AccountId and ApiToken are required' }), { status: 400 });
			}

			if (priority !== undefined) {
				const accounts = await getAccounts(env);
				const providers = await getExternalProviders(env);
				const dupAccount = accounts.find(a => a.id !== id && (a.priority || 0) === priority);
				const dupProvider = providers.find(p => (p.priority || 0) === priority);
				if (dupAccount || dupProvider) {
					const dup = dupAccount || dupProvider;
					return new Response(JSON.stringify({
						error: `Priority ${priority} is already used by "${dup.name || dup.id}"`
					}), { status: 409 });
				}
			}

			let accounts = await getAccounts(env);
			if (id) {
				// 编辑已有账号
				accounts = accounts.map(a => {
					if (a.id === id) {
						const updatedToken = (apiToken && apiToken.includes('****')) ? a.apiToken : apiToken;
						const updatedAccountId = (accountId && accountId.includes('...')) ? a.accountId : accountId;
						return { ...a, name: name || a.name, accountId: updatedAccountId, apiToken: updatedToken, priority: priority !== undefined ? priority : (a.priority || 0) };
					}
					return a;
				});
			} else {
				// 新增账号
				accounts.push({
					id: crypto.randomUUID(),
					name: name || 'CF Account',
					accountId,
					apiToken,
					status: 'active',
					priority: priority || 0
				});
			}
			await saveAccounts(env, accounts);
			// 同步更新 account_usage 中的历史名称
			const updateStmts = [];
			for (const a of accounts) {
				if (a.id) updateStmts.push(env.DB.prepare('UPDATE account_usage SET account_name = ? WHERE account_id = ?').bind(a.name || a.id, a.id));
			}
			if (updateStmts.length > 0) await env.DB.batch(updateStmts);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'DELETE') {
			const { id } = await request.json();
			if (id === 'ai-binding') {
				return new Response(JSON.stringify({ error: 'AI Binding 不允许删除' }), { status: 400 });
			}
			let accounts = await getAccounts(env);
			accounts = accounts.filter(a => a.id !== id);
			await saveAccounts(env, accounts);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'PATCH') {
			const { id, status } = await request.json();
			// AI Binding 开关
			if (id === 'ai-binding') {
				if (status === 'active' || status === 'inactive') {
					const bindingConfig = await getBindingConfig(env);
					bindingConfig.enabled = (status === 'active');
					await saveBindingConfig(env, bindingConfig);
				}
				return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
			}
			let accounts = await getAccounts(env);
			const idx = accounts.findIndex(a => a.id === id);
			if (idx === -1) {
				return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404 });
			}
			if (status === 'active' || status === 'inactive') {
				accounts[idx].status = status;
			}
			await saveAccounts(env, accounts);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 7. 测试账号是否能正常连接
	if (url.pathname === '/api/accounts/test' && method === 'POST') {
		const { id, accountId, apiToken } = await request.json();
		let targetAccountId = accountId;
		let targetApiToken = apiToken;

		if (id) {
			const accounts = await getAccounts(env);
			const acc = accounts.find(a => a.id === id);
			if (acc) {
				if (!targetAccountId || targetAccountId.includes('...')) targetAccountId = acc.accountId;
				if (!targetApiToken || targetApiToken.includes('****')) {
					targetApiToken = acc.apiToken;
				}
			}
		}

		if (!targetAccountId || !targetApiToken) {
			return new Response(JSON.stringify({ success: false, error: 'Account info not found' }), { status: 400 });
		}

		const [readResult, editResult, analyticsResult] = await Promise.all([
			// 1. Workers AI > Read
			(async () => {
				try {
					const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${targetAccountId}/ai/models/search?limit=1`, {
						method: 'GET',
						headers: {
							'Authorization': `Bearer ${targetApiToken}`,
							'Content-Type': 'application/json'
						}
					});
					const data = await res.json();
					if (res.ok && data.success !== false) {
						return { success: true };
					}
					return { success: false, error: data.errors?.[0]?.message || `HTTP ${res.status}` };
				} catch (e) {
					return { success: false, error: e.message };
				}
			})(),
			// 2. Workers AI > Edit
			(async () => {
				try {
					const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${targetAccountId}/ai/run/@cf/google/embeddinggemma-300m`, {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${targetApiToken}`,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({ text: ['test'] })
					});
					const data = await res.json();
					if (res.ok && data.success !== false) {
						return { success: true };
					}
					return { success: false, error: data.errors?.[0]?.message || `HTTP ${res.status}` };
				} catch (e) {
					return { success: false, error: e.message };
				}
			})(),
			// 3. Account Analytics > Read
			(async () => {
				try {
					const query = `
						query GetAIUsage($accountId: String!, $start: String!) {
							viewer {
								accounts(filter: { accountTag: $accountId }) {
									aiInferenceAdaptiveGroups(
										filter: { datetime_geq: $start }
										limit: 1
									) {
										count
									}
								}
							}
						}
					`;
					const todayUTC = new Date();
					todayUTC.setUTCHours(0, 0, 0, 0);
					const startToday = todayUTC.toISOString().split('.')[0] + 'Z';

					const res = await fetch(`https://api.cloudflare.com/client/v4/graphql`, {
						method: 'POST',
						headers: {
							'Authorization': `Bearer ${targetApiToken}`,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							query,
							variables: {
								accountId: targetAccountId,
								start: startToday
							}
						})
					});
					const data = await res.json();
					if (res.ok && !data.errors && data.data?.viewer?.accounts) {
						return { success: true };
					}
					return { success: false, error: data.errors?.[0]?.message || `HTTP ${res.status}` };
				} catch (e) {
					return { success: false, error: e.message };
				}
			})()
		]);

		const allSuccess = readResult.success && editResult.success && analyticsResult.success;
		let overallError = null;
		if (!allSuccess) {
			const failedPerms = [];
			if (!readResult.success) failedPerms.push(`Workers AI > Read (${readResult.error})`);
			if (!editResult.success) failedPerms.push(`Workers AI > Edit (${editResult.error})`);
			if (!analyticsResult.success) failedPerms.push(`Account Analytics > Read (${analyticsResult.error})`);
			overallError = failedPerms.join('; ');
		}

		return new Response(JSON.stringify({
			success: allSuccess,
			error: overallError,
			permissions: {
				workersAiRead: readResult,
				workersAiEdit: editResult,
				accountAnalyticsRead: analyticsResult
			}
		}), { headers: { 'Content-Type': 'application/json' } });
	}

	// 外部服务商管理
	if (url.pathname === '/api/external-providers') {
		if (method === 'GET') {
			const providers = await getExternalProviders(env);

			// 查询所有外部服务商的总用量（神经元和费用）
			let totalUsageMap = {};
			if (providers.length > 0) {
				const placeholders = providers.map(() => '?').join(',');
				const totalRows = await env.DB.prepare(
					`SELECT account_id, COALESCE(SUM(neurons), 0) as total_neurons FROM account_usage WHERE account_id IN (${placeholders}) GROUP BY account_id`
				).bind(...providers.map(p => p.id)).all();
				for (const row of totalRows.results || []) {
					const neurons = row.total_neurons;
					totalUsageMap[row.account_id] = {
						totalNeurons: neurons,
						totalCost: Math.round((neurons / 1000) * 0.011 * 10000) / 10000
					};
				}
			}

			// 查询今日用量（用于每日限额显示）
			const today = new Date().toISOString().split('T')[0];
			let todayUsageMap = {};
			if (providers.length > 0) {
				const placeholders = providers.map(() => '?').join(',');
				const todayRows = await env.DB.prepare(
					`SELECT account_id, COALESCE(SUM(neurons), 0) as today_neurons FROM account_usage WHERE account_id IN (${placeholders}) AND log_date = ? GROUP BY account_id`
				).bind(...providers.map(p => p.id), today).all();
				for (const row of todayRows.results || []) {
					todayUsageMap[row.account_id] = row.today_neurons;
				}
			}

			const masked = providers.map(p => {
				const totalUsage = totalUsageMap[p.id] || { totalNeurons: 0, totalCost: 0 };
				return {
					...p,
					apiKey: p.apiKey
						? p.apiKey.slice(0, 4) + '****' + p.apiKey.slice(-4)
						: p.apiKey,
					totalNeurons: totalUsage.totalNeurons,
					totalCost: totalUsage.totalCost,
					todayNeurons: todayUsageMap[p.id] || 0
				};
			});
			return new Response(JSON.stringify(masked), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const { id, name, baseUrl, apiKey, priority, modelMap, dailyNeuronLimit } = await request.json();
			if (!baseUrl || !apiKey) {
				return new Response(JSON.stringify({ error: 'Base URL and API Key are required' }), { status: 400 });
			}

			if (priority !== undefined) {
				const accounts = await getAccounts(env);
				const providers = await getExternalProviders(env);
				const dupProvider = providers.find(p => p.id !== id && (p.priority || 0) === priority);
				const dupAccount = accounts.find(a => (a.priority || 0) === priority);
				if (dupProvider || dupAccount) {
					const dup = dupProvider || dupAccount;
					return new Response(JSON.stringify({
						error: `Priority ${priority} is already used by "${dup.name || dup.id}"`
					}), { status: 409 });
				}
			}

			let providers = await getExternalProviders(env);
			if (id) {
				// 编辑
				providers = providers.map(p => {
					if (p.id === id) {
						const updatedKey = (apiKey.includes('****')) ? p.apiKey : apiKey;
						return { ...p, name: name || p.name, baseUrl, apiKey: updatedKey, priority: priority !== undefined ? priority : (p.priority || 0), modelMap: modelMap || p.modelMap || {}, dailyNeuronLimit: dailyNeuronLimit !== undefined ? dailyNeuronLimit : (p.dailyNeuronLimit || 0) };
					}
					return p;
				});
			} else {
				// 新增
				providers.push({
					id: crypto.randomUUID(),
					name: name || 'External Provider',
					baseUrl,
					apiKey,
					priority: priority || 0,
					status: 'active',
					modelMap: modelMap || {},
					dailyNeuronLimit: dailyNeuronLimit || 0
				});
			}
			await saveExternalProviders(env, providers);
			// 同步更新 account_usage 中的历史名称
			const provUpdateStmts = [];
			for (const p of providers) {
				if (p.id) provUpdateStmts.push(env.DB.prepare('UPDATE account_usage SET account_name = ? WHERE account_id = ?').bind(p.name || p.id, p.id));
			}
			if (provUpdateStmts.length > 0) await env.DB.batch(provUpdateStmts);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'PATCH') {
			const { id, status } = await request.json();
			let providers = await getExternalProviders(env);
			const idx = providers.findIndex(p => p.id === id);
			if (idx === -1) {
				return new Response(JSON.stringify({ error: 'Provider not found' }), { status: 404 });
			}
			if (status === 'active' || status === 'inactive') {
				providers[idx].status = status;
			}
			await saveExternalProviders(env, providers);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'DELETE') {
			const { id } = await request.json();
			let providers = await getExternalProviders(env);
			providers = providers.filter(p => p.id !== id);
			await saveExternalProviders(env, providers);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 测试外部服务商连接
	if (url.pathname === '/api/external-providers/test' && method === 'POST') {
		const { id, baseUrl, apiKey } = await request.json();
		let targetUrl = baseUrl;
		let targetKey = apiKey;

		if (id) {
			const providers = await getExternalProviders(env);
			const p = providers.find(x => x.id === id);
			if (p) {
				if (!targetUrl) targetUrl = p.baseUrl;
				if (!targetKey || targetKey.includes('****')) {
					targetKey = p.apiKey;
				}
			}
		}

		if (!targetUrl || !targetKey) {
			return new Response(JSON.stringify({ success: false, error: 'Provider info not found' }), { status: 400 });
		}

		try {
			const baseUrlClean = targetUrl.replace(/\/+$/, '');
			const res = await fetch(`${baseUrlClean}/models`, {
				method: 'GET',
				headers: { 'Authorization': `Bearer ${targetKey}` }
			});
			if (res.ok) {
				const data = await res.json();
				const models = (data.data || []).map(m => m.id);
				return new Response(JSON.stringify({ success: true, models }), { headers: { 'Content-Type': 'application/json' } });
			} else {
				const errorText = await res.text();
				return new Response(JSON.stringify({ success: false, error: `HTTP ${res.status}: ${errorText}` }), { headers: { 'Content-Type': 'application/json' } });
			}
		} catch (e) {
			return new Response(JSON.stringify({ success: false, error: e.message }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 8. 登录后看到的详细用量统计
	if (url.pathname === '/api/accounts/usage' && method === 'GET') {
		const accounts = await getAccounts(env);
		if (accounts.length === 0) {
			return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
		}

		// 刷新最老数据的20个账号
		const cacheMap = await refreshAccountsUsage(env, accounts, 20);

		// 构建完整结果列表，若没有缓存数据则标为 pending
		const results = accounts.map(account => {
			const cached = cacheMap[account.id];
			return {
				id: account.id,
				name: account.name,
				accountId: maskAccountId(account.accountId),
				priority: account.priority || 0,
				activeStatus: account.status || 'active',
				status: cached ? cached.status : 'pending',
				error: cached ? cached.error : undefined,
				usageToday: cached ? cached.usageToday : 0,
				modelsToday: cached ? cached.modelsToday : [],
				history: cached ? cached.history : [],
				lastUpdated: cached ? cached.timestamp : 0
			};
		});

		return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
	}

	// 9. 密钥用量查询（需先于 /api/keys 匹配，因为 /api/keys/usage 不会被 /api/keys 匹配到）
	if (url.pathname === '/api/keys/usage' && method === 'GET') {
		// 查询时顺便清理超过 14 天的旧日志
		ctx.waitUntil(cleanupOldLogs(env));
		const usageData = await getKeyUsageHistory(env, 14);
		// 同时获取当前已有的密钥列表，用于标记哪些密钥已删除
		const currentKeys = await getApiKeys(env);
		const currentKeyIds = new Set(currentKeys.map(k => k.id));
		const enriched = usageData.map(item => ({
			...item,
			isDeleted: !currentKeyIds.has(item.keyId)
		}));
		return new Response(JSON.stringify(enriched), { headers: { 'Content-Type': 'application/json' } });
	}

	// 10. 请求明细日志查询（request_logs，按 key_id + log_date 汇总）
	if (url.pathname === '/api/usage/request-logs' && method === 'GET') {
		try {
			const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
			const offset = parseInt(url.searchParams.get('offset') || '0');
			const rows = await env.DB.prepare(
				'SELECT * FROM request_logs ORDER BY log_date DESC, requests DESC LIMIT ? OFFSET ?'
			).bind(limit, offset).all();
			// 获取总数
			const countRow = await env.DB.prepare('SELECT COUNT(*) as total FROM request_logs').first();
			return new Response(JSON.stringify({
				rows: rows.results || [],
				total: countRow?.total || 0,
				limit, offset
			}), { headers: { 'Content-Type': 'application/json' } });
		} catch (e) {
			return new Response(JSON.stringify({ error: e.message, rows: [], total: 0 }), { status: 500, headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 11. 账号级用量查询（account_usage）
	if (url.pathname === '/api/usage/account-usage' && method === 'GET') {
		try {
			const startParam = url.searchParams.get('start');
			const endParam = url.searchParams.get('end');
			let cutoffStr, endStr, days;
			if (startParam && endParam) {
				cutoffStr = startParam;
				endStr = endParam;
				days = Math.floor((new Date(endParam) - new Date(startParam)) / 86400000) + 1;
			} else {
				days = Math.min(parseInt(url.searchParams.get('days') || '7'), 30);
				cutoffStr = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
				endStr = new Date().toISOString().split('T')[0];
			}
			const rows = await env.DB.prepare(
				'SELECT * FROM account_usage WHERE log_date >= ? AND log_date <= ? ORDER BY log_date DESC, neurons DESC'
			).bind(cutoffStr, endStr).all();

			// 获取当前账号和外部服务商的最新名称，用于覆盖历史旧名
			const [accounts, providers] = await Promise.all([getAccounts(env), getExternalProviders(env)]);
			const nameMap = {};
			for (const acc of accounts || []) {
				nameMap[acc.id] = acc.name || acc.id;
			}
			for (const p of providers || []) {
				nameMap[p.id] = p.name || p.id;
			}

			// 汇总总计
			let totals = { requests: 0, neurons: 0, prompt_tokens: 0, completion_tokens: 0 };
			const enriched = (rows.results || []).map(r => {
				totals.requests += r.requests;
				totals.neurons += r.neurons;
				totals.prompt_tokens += r.prompt_tokens;
				totals.completion_tokens += r.completion_tokens;
				return {
					...r,
					account_name: nameMap[r.account_id] || r.account_name || r.account_id
				};
			});
			return new Response(JSON.stringify({
				rows: enriched,
				totals,
				days
			}), { headers: { 'Content-Type': 'application/json' } });
		} catch (e) {
			return new Response(JSON.stringify({ error: e.message, rows: [], totals: null }), { status: 500, headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 12. 模型性能统计查询（model_stats）
	if (url.pathname === '/api/usage/model-stats' && method === 'GET') {
		try {
			const mode = url.searchParams.get('mode') || '7d';
			const cacheKey = 'modelStats_' + url.search;
			const now = Date.now();
			const cached = memoryCache.modelStats[cacheKey];
			if (cached && now < cached.expiry) {
				return new Response(cached.body, { headers: { 'Content-Type': 'application/json' } });
			}

			let startDate, endDate;
			const _now = new Date();
			const today = _now.toISOString().split('T')[0];

			if (mode === 'custom') {
				startDate = url.searchParams.get('start') || today;
				endDate = url.searchParams.get('end') || today;
			} else if (mode === 'month') {
				startDate = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-01';
				endDate = today;
			} else if (mode === 'lastMonth') {
				const firstOfMonth = new Date(_now.getFullYear(), _now.getMonth(), 1);
				const lastMonthEnd = new Date(firstOfMonth - 1);
				const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
				startDate = lastMonthStart.toISOString().split('T')[0];
				endDate = lastMonthEnd.toISOString().split('T')[0];
			} else {
				const days = mode === '30d' ? 30 : 7;
				const cutoff = new Date(Date.now() - days * 86400000);
				startDate = cutoff.toISOString().split('T')[0];
				endDate = today;
			}

			// 强制限制查询范围最多 30 天
			const maxStart = new Date(new Date(endDate + 'T23:59:59').getTime() - 30 * 86400000).toISOString().split('T')[0];
			if (startDate < maxStart) startDate = maxStart;

			const rows = await env.DB.prepare(
				'SELECT * FROM model_stats WHERE log_date >= ? AND log_date <= ? ORDER BY log_date ASC, requests DESC'
			).bind(startDate, endDate).all();
			// 汇总总计
			let totals = { requests: 0, success_count: 0, error_count: 0, total_neurons: 0, total_prompt_tokens: 0, total_completion_tokens: 0 };
			// 按日期汇总（用于图表）
			const dailyMap = {};
			for (const r of rows.results || []) {
				totals.requests += r.requests;
				totals.success_count += r.success_count;
				totals.error_count += r.error_count;
				totals.total_neurons += r.total_neurons;
				totals.total_prompt_tokens += r.total_prompt_tokens;
				totals.total_completion_tokens += r.total_completion_tokens;
				if (!dailyMap[r.log_date]) dailyMap[r.log_date] = { date: r.log_date, models: {} };
				dailyMap[r.log_date].models[r.model] = {
					requests: r.requests,
					success_count: r.success_count,
					error_count: r.error_count,
					avg_duration_ms: r.avg_duration_ms,
					total_neurons: r.total_neurons
				};
			}
			const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

			// 补齐缺失的日期（让图表显示完整时间轴）
			const fullDaily = [];
			const cursor = new Date(startDate);
			const end = new Date(endDate + 'T23:59:59');
			while (cursor <= end) {
				const dateStr = cursor.toISOString().split('T')[0];
				fullDaily.push(dailyMap[dateStr] || { date: dateStr, models: {} });
				cursor.setDate(cursor.getDate() + 1);
			}

			// 写入缓存（5分钟）
			const body = JSON.stringify({
				rows: rows.results || [],
				totals,
				daily: fullDaily,
				mode,
				startDate, endDate
			});
			memoryCache.modelStats[cacheKey] = { body, expiry: Date.now() + 300000 };

			return new Response(body, { headers: { 'Content-Type': 'application/json' } });
		} catch (e) {
			return new Response(JSON.stringify({ error: e.message, rows: [], totals: null }), { status: 500, headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 13. 代理接口用的自定义 API 密钥管理
	if (url.pathname === '/api/keys') {
		if (method === 'GET') {
			const keys = await getApiKeys(env);
			// 附加上今日用量
			const todayUTC = new Date();
			todayUTC.setUTCHours(0, 0, 0, 0);
			const dateStr = todayUTC.toISOString().split('T')[0];
			try {
				const usageRows = await env.DB.prepare(
					'SELECT key_id, neurons FROM key_usage_logs WHERE log_date = ?'
				).bind(dateStr).all();
				const usageMap = {};
				for (const row of usageRows.results || []) {
					usageMap[row.key_id] = row.neurons || 0;
				}
				for (const k of keys) {
					k.todayNeurons = usageMap[k.id] || 0;
				}
			} catch (_) {}
			return new Response(JSON.stringify(keys), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const { id, name, key, allowedModels, providerIds, dailyNeuronLimit } = await request.json();
			if (!name) {
				return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400 });
			}

			const keys = await getApiKeys(env);

			if (id) {
				// 编辑已有密钥
				const updated = keys.map(k => {
					if (k.id === id) {
						const allowed = Array.isArray(allowedModels) && allowedModels.length > 0 ? allowedModels : undefined;
						return {
							...k,
							name,
							allowedModels: allowed,
							providerIds: providerIds !== undefined ? providerIds : (k.providerIds || []),
							dailyNeuronLimit: dailyNeuronLimit !== undefined ? Number(dailyNeuronLimit) : (k.dailyNeuronLimit || 1000000)
						};
					}
					return k;
				});
				await saveApiKeys(env, updated);
				return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
			}

			// 新增
			const generatedKey = key || `sk-wa-${crypto.randomUUID().replace(/-/g, '')}`;
			keys.push({
				id: crypto.randomUUID(),
				name,
				key: generatedKey,
				createdAt: new Date().toISOString(),
				allowedModels: Array.isArray(allowedModels) && allowedModels.length > 0 ? allowedModels : undefined,
				providerIds: Array.isArray(providerIds) && providerIds.length > 0 ? providerIds : [],
				dailyNeuronLimit: dailyNeuronLimit ? Number(dailyNeuronLimit) : 1000000,
				status: 'active'
			});
			await saveApiKeys(env, keys);
			return new Response(JSON.stringify({ success: true, key: generatedKey }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'PATCH') {
			const { id, status } = await request.json();
			let keys = await getApiKeys(env);
			const idx = keys.findIndex(k => k.id === id);
			if (idx === -1) {
				return new Response(JSON.stringify({ error: 'Key not found' }), { status: 404 });
			}
			if (status === 'active' || status === 'inactive') {
				keys[idx].status = status;
			}
			await saveApiKeys(env, keys);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'DELETE') {
			const { id } = await request.json();
			let keys = await getApiKeys(env);
			keys = keys.filter(k => k.id !== id);
			await saveApiKeys(env, keys);
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	// 10. 获取完整模型列表（预设 + 自定义）
	if (url.pathname === '/api/models' && method === 'GET') {
		const cacheKey = 'modelList';
		const now = Date.now();
		if (memoryCache.modelList && now < memoryCache.modelList.expiry) {
			return new Response(JSON.stringify(memoryCache.modelList.data), { headers: { 'Content-Type': 'application/json' } });
		}
		const customMap = await getCustomModelMap(env);
		const combinedMap = { ...DEFAULT_MODEL_MAP, ...customMap };
		const modelList = Object.keys(combinedMap);
		memoryCache.modelList = { data: modelList, expiry: now + 300000 };
		return new Response(JSON.stringify(modelList), { headers: { 'Content-Type': 'application/json' } });
	}

	// 11. 模型设置和映射
	if (url.pathname === '/api/settings') {
		if (method === 'GET') {
			const [customMap, modelNotes, disabledMappings] = await Promise.all([
				getCustomModelMap(env),
				getModelNotes(env),
				getDisabledMappings(env)
			]);
			return new Response(JSON.stringify({ customModelMap: customMap, modelNotes: modelNotes, disabledMappings: disabledMappings || {} }), { headers: { 'Content-Type': 'application/json' } });
		}

		if (method === 'POST') {
			const body = await request.json();
			if (body.customModelMap !== undefined) {
				if (!body.customModelMap || typeof body.customModelMap !== 'object') {
					return new Response(JSON.stringify({ error: 'Invalid customModelMap payload' }), { status: 400 });
				}
				await saveCustomModelMap(env, body.customModelMap);
			}
			if (body.modelNotes !== undefined) {
				if (typeof body.modelNotes !== 'object') {
					return new Response(JSON.stringify({ error: 'Invalid modelNotes payload' }), { status: 400 });
				}
				await saveModelNotes(env, body.modelNotes);
			}
			if (body.disabledMappings !== undefined) {
				await saveDisabledMappings(env, body.disabledMappings);
			}
			return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
		}
	}

	return new Response(JSON.stringify({ error: 'Endpoint not found' }), { status: 404 });
}

// ----------------------------------------------------
// 前端页面处理函数（按页面拆分）
// ----------------------------------------------------

// 1. 首页 / 登录页
async function handleLandingPage(request, env, ctx) {
	return env.ASSETS.fetch(new URL('/index.html', request.url).toString());
}


// 2. 后台管理控制台页面（静态文件，_worker.js 只做权限校验）
function handleAdminPage(request, env, ctx) {
	return env.ASSETS.fetch(new URL('/admin.html', request.url).toString());
}


// 3. KV 未绑定时的报错页面
function handleKVError(request) {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>KV 绑定异常 - W-ai-api</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
	<style>
		:root {
			--bg-color: #07080a;
			--card-bg: rgba(15, 18, 30, 0.55);
			--border-color: rgba(59, 130, 246, 0.2);
			--text-main: #f8fafc;
			--text-muted: #94a3b8;
			--primary-gradient: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
			--accent-color: #3b82f6;
			--glass-blur: 20px;
			--card-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
		}

		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: 'Inter', sans-serif;
			background-color: var(--bg-color);
			color: var(--text-main);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
			position: relative;
			overflow: hidden;
		}

		.error-card {
			background-color: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 20px;
			padding: 40px;
			max-width: 500px;
			width: 100%;
			text-align: center;
			box-shadow: var(--card-shadow);
			z-index: 10;
		}

		h1 {
			font-family: 'Outfit', sans-serif;
			font-size: 24px;
			color: #3b82f6;
			margin-bottom: 16px;
			font-weight: 600;
		}

		p {
			color: var(--text-muted);
			font-size: 15px;
			line-height: 1.6;
			margin-bottom: 24px;
		}

		.code-block {
			background-color: rgba(0, 0, 0, 0.25);
			padding: 20px;
			border-radius: 12px;
			font-family: monospace;
			font-size: 13px;
			color: #93c5fd;
			text-align: left;
			margin-bottom: 26px;
			border: 1px solid rgba(255, 255, 255, 0.05);
			line-height: 1.8;
		}

		.btn {
			display: inline-block;
			background: var(--primary-gradient);
			color: white;
			text-decoration: none;
			padding: 12px 28px;
			border-radius: 10px;
			font-weight: 600;
			font-size: 14px;
			transition: all 0.3s;
			box-shadow: 0 4px 14px rgba(59, 130, 246, 0.2);
		}

		.btn:hover {
			transform: translateY(-2px);
			box-shadow: 0 6px 20px rgba(59, 130, 246, 0.35);
			opacity: 0.95;
		}
	</style>
</head>
<body>
	<div class="error-card">
		<div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
		<h1>KV 命名空间未绑定</h1>
		<p>系统检测到您未在 Cloudflare 平台中为该项目绑定 KV 命名空间，或者绑定的变量名称不为 <strong>KV</strong>。这会导致数据无法保存，系统无法正常运行。</p>
		
		<div class="code-block">
			<strong>解决方案：</strong><br>
			1. 进入您的 Cloudflare Workers/Pages 仪表盘。<br>
			2. 导航至 Settings -> Functions (或 Settings -> Variables) -> KV namespace bindings。<br>
			3. 添加绑定，将【变量名称 (Variable name)】设置为: <strong>KV</strong><br>
			4. 保存并重新部署项目即可。
		</div>
		
		<a href="https://developers.cloudflare.com/kv/learning/kv-bindings/" target="_blank" class="btn">查看官方绑定教程</a>
	</div>
</body>
</html>`;

	const url = new URL(request.url);
	if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({
			error: {
				message: "Cloudflare KV namespace binding 'KV' is missing. Please bind a KV namespace to 'KV' in your Worker/Pages settings.",
				type: "server_error"
			}
		}), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
	}

	const resp = new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
	addSecurityHeaders(resp);
	return resp;
}

// 3. D1 Database Error UI Page
function handleDBError(request) {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>D1 绑定异常 - W-ai-api</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
	<style>
		:root {
			--bg-color: #07080a;
			--card-bg: rgba(15, 18, 30, 0.55);
			--border-color: rgba(59, 130, 246, 0.2);
			--text-main: #f8fafc;
			--text-muted: #94a3b8;
			--primary-gradient: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
			--accent-color: #3b82f6;
			--glass-blur: 20px;
			--card-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
		}

		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: 'Inter', sans-serif;
			background-color: var(--bg-color);
			color: var(--text-main);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
			position: relative;
			overflow: hidden;
		}

		.error-card {
			background-color: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 20px;
			padding: 40px;
			max-width: 500px;
			width: 100%;
			text-align: center;
		}

		.error-icon {
			width: 56px;
			height: 56px;
			border-radius: 50%;
			background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.3));
			display: flex;
			align-items: center;
			justify-content: center;
			margin: 0 auto 24px;
			font-size: 28px;
		}

		.error-title {
			font-family: 'Outfit', sans-serif;
			font-size: 22px;
			font-weight: 700;
			margin-bottom: 12px;
		}

		.error-desc {
			color: var(--text-muted);
			font-size: 14px;
			line-height: 1.6;
			margin-bottom: 24px;
		}

		.error-hint {
			background: rgba(59, 130, 246, 0.1);
			border: 1px solid rgba(59, 130, 246, 0.2);
			border-radius: 12px;
			padding: 16px;
			font-size: 13px;
			text-align: left;
			line-height: 1.7;
		}

		.error-hint code {
			background: rgba(255, 255, 255, 0.1);
			padding: 2px 6px;
			border-radius: 4px;
			font-size: 12px;
		}
	</style>
</head>
<body>
	<div class="error-card">
		<div class="error-icon">🔴</div>
		<div class="error-title">D1 数据库未绑定</div>
		<div class="error-desc">
			系统检测到 D1 数据库未绑定到当前 Worker。<br>
			请先创建并绑定 D1 数据库。
		</div>
		<div class="error-hint">
			<strong>部署步骤：</strong><br>
			1. 在 Cloudflare 控制台创建 D1 数据库<br>
			2. 在 Pages 项目设置中绑定 D1（变量名：<code>DB</code>）<br>
			3. 首次部署后，系统会自动创建所需的表结构
		</div>
	</div>
</body>
</html>`;
	const resp2 = new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
	addSecurityHeaders(resp2);
	return resp2;
}

// 4. Password Error UI Page
function handlePasswordError(request) {
	const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>管理员密码未配置 - W-ai-api</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
	<style>
		:root {
			--bg-color: #07080a;
			--card-bg: rgba(15, 18, 30, 0.55);
			--border-color: rgba(59, 130, 246, 0.2);
			--text-main: #f8fafc;
			--text-muted: #94a3b8;
			--primary-gradient: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
			--accent-color: #3b82f6;
			--glass-blur: 20px;
			--card-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
		}

		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}

		body {
			font-family: 'Inter', sans-serif;
			background-color: var(--bg-color);
			color: var(--text-main);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
			position: relative;
			overflow: hidden;
		}

		.error-card {
			background-color: var(--card-bg);
			border: 1px solid var(--border-color);
			border-radius: 20px;
			padding: 40px;
			max-width: 500px;
			width: 100%;
			text-align: center;
			box-shadow: var(--card-shadow);
			z-index: 10;
		}

		h1 {
			font-family: 'Outfit', sans-serif;
			font-size: 24px;
			color: #3b82f6;
			margin-bottom: 16px;
			font-weight: 600;
		}

		p {
			color: var(--text-muted);
			font-size: 15px;
			line-height: 1.6;
			margin-bottom: 24px;
		}

		.code-block {
			background-color: rgba(0, 0, 0, 0.25);
			padding: 20px;
			border-radius: 12px;
			font-family: monospace;
			font-size: 13px;
			color: #93c5fd;
			text-align: left;
			margin-bottom: 26px;
			border: 1px solid rgba(255, 255, 255, 0.05);
			line-height: 1.8;
		}
	</style>
</head>
<body>
	<div class="error-card">
		<div style="font-size: 48px; margin-bottom: 16px;">🔑</div>
		<h1>管理员密码未配置</h1>
		<p>系统检测到您未在 Cloudflare 平台中为该项目配置 <strong>ADMIN_PASSWORD</strong> 环境变量。为了您的接口 and 管理后台安全，系统已拦截所有访问，直到密码配置完成。</p>
		
		<div class="code-block">
			<strong>解决方案：</strong><br>
			1. 进入您的 Cloudflare Workers/Pages 仪表盘。<br>
			2. 导航至 Settings -> Variables (或 Settings -> Environment Variables)。<br>
			3. 点击【Add variable】，将【Variable name】设置为: <strong>ADMIN_PASSWORD</strong><br>
			4. 输入您的管理员登录密码作为其值，保存并部署即可。
		</div>
	</div>
</body>
</html>`;

	const url = new URL(request.url);
	if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({
			error: {
				message: "ADMIN_PASSWORD environment variable is missing. Please add the ADMIN_PASSWORD variable to your Worker/Pages settings.",
				type: "server_error"
			}
		}), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key' } });
	}

	const resp3 = new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
	addSecurityHeaders(resp3);
	return resp3;
}
