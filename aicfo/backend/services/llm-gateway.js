// ================================================================================
// AiCFO 统一 LLM 网关 (Tokenhot.ai 兼容)
// ================================================================================
// 目标：
//   • 一个统一 API Key (Tokenhot 兼容 OpenAI 协议) 即可调用 100+ 模型
//   • 支持 tier 路由：reasoning (最强推理) / fast (快速分析) / default
//   • 所有模块 (ai-chat, ai-kb-builder, file-ingest, llm-real) 经此出口
//   • 配置持久化到 system_settings 表，后台可热更新，无需重启
//
// Tokenhot 官方接入 (https://tokenhot.ai/zh):
//   base_url = https://api.tokenhot.ai/v1
//   api_key  = sk-xxxxxxxxxxxxxxxx
//   protocol = OpenAI-compatible /v1/chat/completions
//
// 导出：
//   • getClient({tier})   -> OpenAI 实例（已注入 baseURL / apiKey）
//   • getModel(tier)      -> 当前 tier 对应的具体模型名
//   • getConfig()         -> 返回当前配置（含 provider / base_url / key_preview / models）
//   • updateConfig(patch) -> 持久化新配置并清缓存
//   • testConnection()    -> 发送一次最小 ping，返回延迟与 provider 信息
//   • logCall({...})      -> 写入 llm_call_logs
//   • isReady()           -> 是否有可用凭证
// ================================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuid } = require('uuid');

let OpenAI; try { OpenAI = require('openai'); } catch (_) { OpenAI = null; }
let db; try { db = require('../db/schema'); } catch (_) { db = null; }

// --------------------------------------------------------------------------------
// 1. 默认配置（首次启动时写入 system_settings）
// --------------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  provider: 'tokenhot',                    // tokenhot | openai | genspark-proxy | custom
  base_url: 'https://api.tokenhot.ai/v1',  // Tokenhot 官方推荐地址
  api_key: '',                             // 由后台配置
  // tier → 模型映射（基于 Tokenhot 账号实际可用的 83 个模型，用户在后台可改）
  models: {
    reasoning: 'claude-opus-4.7',   // 最强推理
    fast:      'claude-haiku-4.5',  // 快速分析
    default:   'gpt-5.4'            // 日常核心
  },
  // 可选模型库（Tokenhot 实测可用）
  available_models: {
    reasoning: [
      'claude-opus-4.7', 'claude-opus-4.6',
      'gemini-3.1-pro-preview', 'grok-4.2-thinking',
      'DeepSeek-V3.2-Thinking', 'kimi-k2.5-thinking',
      'gpt-5.5', 'gpt-5.3-codex'
    ],
    fast: [
      'claude-haiku-4.5', 'gpt-5.4-mini',
      'gemini-3.1-flash-lite-preview',
      'qwen3.6-flash', 'DeepSeek-V3.2-Fast',
      'MiniMax-M2.7-highspeed', 'deepseek-v4-flash'
    ],
    default: [
      'gpt-5.4', 'claude-sonnet-4.6',
      'DeepSeek-V3.2', 'deepseek-v4-pro',
      'qwen3.6-plus', 'glm-5.1',
      'kimi-k2.6', 'MiniMax-M2.7'
    ]
  },
  // 模块默认 tier（被单次调用的 tier 参数覆盖）
  tier_by_purpose: {
    chat:              'default',   // 用户对话
    agent_plan:        'reasoning', // Agent 规划
    agent_synthesize:  'reasoning', // Agent 归纳
    ocr:               'fast',      // 发票/流水 OCR
    kb_build:          'default',   // 知识库批量生成
    journal:           'default',   // 记账
    intent:            'fast',      // 意图分类
    name_compliance:   'reasoning', // 公司名合规
    constitution:      'reasoning', // 章程起草
    tax_eci:           'reasoning', // 税务计算
    management_report: 'reasoning', // 管理报告
    board_resolution:  'default',
    invoice_ocr:       'fast'
  },
  enabled: true
};

// --------------------------------------------------------------------------------
// 2. 配置读写（system_settings 持久化 + 内存缓存）
// --------------------------------------------------------------------------------
const CONFIG_KEY = 'llm_gateway';
let _configCache = null;
let _clientCache = null;  // { baseURL+apiKey -> OpenAI instance }

function _readFromEnv() {
  // 环境变量优先（CI/E2E），并同时兼容旧的 GenSpark YAML 文件
  const envKey = process.env.TOKENHOT_API_KEY
              || process.env.AICFO_LLM_API_KEY
              || process.env.OPENAI_API_KEY
              || '';
  const envBase = process.env.TOKENHOT_BASE_URL
               || process.env.AICFO_LLM_BASE_URL
               || process.env.OPENAI_BASE_URL
               || '';
  if (envKey) {
    return { api_key: envKey, base_url: envBase || DEFAULT_CONFIG.base_url };
  }
  // YAML 回退（保持旧部署兼容）
  try {
    const yaml = require('js-yaml');
    const p = path.join(os.homedir(), '.genspark_llm.yaml');
    if (fs.existsSync(p)) {
      const c = yaml.load(fs.readFileSync(p, 'utf8')) || {};
      return {
        api_key: c?.openai?.api_key || '',
        base_url: c?.openai?.base_url || 'https://www.genspark.ai/api/llm_proxy/v1'
      };
    }
  } catch (_) {}
  return { api_key: '', base_url: DEFAULT_CONFIG.base_url };
}

function getConfig() {
  if (_configCache) return _configCache;

  let cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // 1) 从 DB 读取持久化配置
  if (db) {
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE key=?').get(CONFIG_KEY);
      if (row && row.value) {
        const saved = JSON.parse(row.value);
        cfg = Object.assign(cfg, saved);
        cfg.models = Object.assign({}, DEFAULT_CONFIG.models, saved.models || {});
        cfg.tier_by_purpose = Object.assign({}, DEFAULT_CONFIG.tier_by_purpose, saved.tier_by_purpose || {});
      }
    } catch (e) { /* 首次运行 system_settings 可能还没建 */ }
  }

  // 2) 若 DB 没有 api_key，则回退读环境变量 / YAML（但 provider 仍保留 tokenhot 默认）
  if (!cfg.api_key) {
    const envCfg = _readFromEnv();
    if (envCfg.api_key) {
      cfg.api_key = envCfg.api_key;
      // 若用户没改过 base_url 或 base_url 是 tokenhot 默认，则按环境 base 更新
      if (!cfg.base_url || cfg.base_url === DEFAULT_CONFIG.base_url) {
        cfg.base_url = envCfg.base_url || cfg.base_url;
      }
      // 如果走的是 GenSpark 代理，provider 标记改一下（仅显示用）
      if (/genspark/.test(cfg.base_url)) cfg.provider = 'genspark-proxy';
    }
  }

  _configCache = cfg;
  return cfg;
}

function _writeToDb(cfg) {
  if (!db) return;
  const val = JSON.stringify(cfg);
  try {
    db.prepare(`INSERT INTO system_settings (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`)
      .run(CONFIG_KEY, val);
  } catch (e) {
    console.warn('[LLMGateway] persist failed:', e.message);
  }
}

function updateConfig(patch = {}) {
  const cur = getConfig();
  const next = Object.assign({}, cur, patch);
  if (patch.models)          next.models          = Object.assign({}, cur.models, patch.models);
  if (patch.tier_by_purpose) next.tier_by_purpose = Object.assign({}, cur.tier_by_purpose, patch.tier_by_purpose);
  _writeToDb(next);
  _configCache = next;
  _clientCache = null; // 清客户端缓存
  return getMaskedConfig(next);
}

function getMaskedConfig(cfg) {
  const c = cfg || getConfig();
  const k = c.api_key || '';
  const preview = k ? `${k.slice(0, 4)}****${k.slice(-4)}` : '';
  return {
    provider: c.provider,
    base_url: c.base_url,
    api_key_set: !!k,
    api_key_preview: preview,
    enabled: c.enabled !== false,
    models: c.models,
    available_models: c.available_models,
    tier_by_purpose: c.tier_by_purpose
  };
}

// --------------------------------------------------------------------------------
// 3. 客户端构造 & 模型路由
// --------------------------------------------------------------------------------
function isReady() {
  if (process.env.AICFO_LLM_OFFLINE === '1') return false;
  const c = getConfig();
  return !!(c.api_key && c.enabled !== false && OpenAI);
}

function getClient() {
  if (!isReady()) return null;
  const c = getConfig();
  const key = `${c.base_url}::${c.api_key}`;
  if (_clientCache && _clientCache._key === key) return _clientCache.client;
  const inst = new OpenAI({ apiKey: c.api_key, baseURL: c.base_url });
  _clientCache = { _key: key, client: inst };
  return inst;
}

/**
 * 根据 tier / purpose 解析最终模型名
 * 优先级：显式 model > 显式 tier > purpose→tier 映射 > default
 */
function getModel({ model, tier, purpose } = {}) {
  if (model) return model;
  const c = getConfig();
  let t = tier;
  if (!t && purpose) t = c.tier_by_purpose[purpose];
  if (!t) t = 'default';
  return c.models[t] || c.models.default || 'gpt-5-mini';
}

// --------------------------------------------------------------------------------
// 4. 调用日志
// --------------------------------------------------------------------------------
function logCall({ tier, model, purpose, latency_ms, tokens_in = 0, tokens_out = 0, status = 'ok', error = null }) {
  if (!db) return;
  try {
    const c = getConfig();
    db.prepare(`INSERT INTO llm_call_logs (id, provider, tier, model, purpose, latency_ms, tokens_in, tokens_out, status, error)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`llm_${uuid().slice(0, 8)}`, c.provider, tier || null, model || null, purpose || null,
           latency_ms || 0, tokens_in || 0, tokens_out || 0, status, error);
  } catch (e) { /* 表可能刚建未迁移，忽略 */ }
}

// --------------------------------------------------------------------------------
// 5. 便捷调用封装：chat / chatJSON（带 tier + 日志）
// --------------------------------------------------------------------------------
async function chat({ system, user, messages, purpose, tier, model, json = false, temperature } = {}) {
  const client = getClient();
  if (!client) throw new Error('LLM gateway not configured (missing API key). 请到后台 → 模型网关 填入 Tokenhot API Key。');
  const useModel = getModel({ model, tier, purpose });
  const msgs = messages || [
    { role: 'system', content: system || '' },
    { role: 'user',   content: user   || '' }
  ];
  const t0 = Date.now();
  try {
    const req = { model: useModel, messages: msgs };
    if (json)               req.response_format = { type: 'json_object' };
    if (temperature != null) req.temperature = temperature;
    const resp = await client.chat.completions.create(req);
    const latency = Date.now() - t0;
    const content = resp?.choices?.[0]?.message?.content || '';
    const usage = resp?.usage || {};
    logCall({
      tier: tier || (purpose ? getConfig().tier_by_purpose[purpose] : 'default'),
      model: useModel, purpose,
      latency_ms: latency,
      tokens_in: usage.prompt_tokens || 0,
      tokens_out: usage.completion_tokens || 0,
      status: 'ok'
    });
    return { content, model: useModel, latency_ms: latency, usage };
  } catch (e) {
    logCall({ tier, model: useModel, purpose,
              latency_ms: Date.now() - t0, status: 'error', error: e.message });
    throw e;
  }
}

// --------------------------------------------------------------------------------
// 6. 连通性自检 (ping)
// --------------------------------------------------------------------------------
async function testConnection({ tier = 'fast' } = {}) {
  const t0 = Date.now();
  try {
    const r = await chat({
      system: 'Reply with a single word: pong',
      user:   'ping',
      purpose: 'ping',
      tier,
      temperature: 0
    });
    return {
      ok: true,
      provider: getConfig().provider,
      base_url: getConfig().base_url,
      model:   r.model,
      latency_ms: r.latency_ms,
      reply: (r.content || '').slice(0, 80)
    };
  } catch (e) {
    return {
      ok: false,
      provider: getConfig().provider,
      base_url: getConfig().base_url,
      latency_ms: Date.now() - t0,
      error: e.message
    };
  }
}

// --------------------------------------------------------------------------------
// 7. 最近调用日志（后台看板用）
// --------------------------------------------------------------------------------
// 6.5 发现账号下真实可用的模型 (GET /v1/models)
// --------------------------------------------------------------------------------
async function listAvailableModels() {
  const t0 = Date.now();
  const c = getConfig();
  if (!isReady()) {
    return {
      ok: false, ready: false,
      latency_ms: Date.now() - t0,
      error: 'LLM 网关未就绪 (缺少 API Key 或已停用)',
      provider: c.provider, base_url: c.base_url,
      models: []
    };
  }
  const client = getClient();
  try {
    const resp = await client.models.list();
    const data = resp?.data || resp?.body?.data || [];
    const names = data.map(m => m.id || m.name).filter(Boolean).sort();
    return {
      ok: true, ready: true,
      latency_ms: Date.now() - t0,
      provider: c.provider, base_url: c.base_url,
      count: names.length, models: names
    };
  } catch (e) {
    return {
      ok: false, ready: true,
      latency_ms: Date.now() - t0,
      error: e.message,
      provider: c.provider, base_url: c.base_url,
      models: []
    };
  }
}

// --------------------------------------------------------------------------------
// 6.6 并发探测三个 tier 的连通状态（进入页面自动调用）
// --------------------------------------------------------------------------------
async function probeAllTiers() {
  const c = getConfig();
  const tiers = ['reasoning', 'fast', 'default'];
  if (!isReady()) {
    return {
      ok: false, ready: false,
      error: 'LLM 网关未就绪 (缺少 API Key 或已停用)',
      provider: c.provider,
      results: tiers.map(t => ({
        tier: t, model: c.models[t] || null,
        ok: false, skipped: true, reason: 'gateway_not_ready'
      }))
    };
  }
  const results = await Promise.all(tiers.map(async (tier) => {
    const t0 = Date.now();
    try {
      const r = await testConnection({ tier });
      return {
        tier, model: r.model || c.models[tier],
        ok: !!r.ok,
        latency_ms: r.latency_ms ?? (Date.now() - t0),
        reply: r.reply || '',
        error: r.error || null
      };
    } catch (e) {
      return { tier, model: c.models[tier], ok: false,
               latency_ms: Date.now() - t0, error: e.message };
    }
  }));
  const okCount = results.filter(r => r.ok).length;
  return {
    ok: okCount > 0, ready: true,
    provider: c.provider,
    ok_count: okCount, total: tiers.length, results
  };
}

// --------------------------------------------------------------------------------
function recentLogs(limit = 30) {
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM llm_call_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch (_) { return []; }
}

function stats() {
  if (!db) return {};
  try {
    const total = db.prepare('SELECT COUNT(*) c FROM llm_call_logs').get().c;
    const ok    = db.prepare("SELECT COUNT(*) c FROM llm_call_logs WHERE status='ok'").get().c;
    const avg   = db.prepare("SELECT AVG(latency_ms) a FROM llm_call_logs WHERE status='ok'").get().a || 0;
    const by_tier  = db.prepare("SELECT tier, COUNT(*) c FROM llm_call_logs GROUP BY tier").all();
    const by_model = db.prepare("SELECT model, COUNT(*) c FROM llm_call_logs GROUP BY model ORDER BY c DESC LIMIT 10").all();
    return {
      total_calls: total, ok_calls: ok,
      success_rate: total ? +(ok / total * 100).toFixed(1) : 0,
      avg_latency_ms: Math.round(avg),
      by_tier, by_model
    };
  } catch (_) { return { total_calls: 0, ok_calls: 0 }; }
}

module.exports = {
  getClient, getModel, isReady,
  getConfig: () => getMaskedConfig(),
  updateConfig,
  chat, testConnection,
  listAvailableModels, probeAllTiers,
  logCall, recentLogs, stats,
  _raw: getConfig   // internal use only (llm-real 等要真 api_key 才能构造 client)
};
