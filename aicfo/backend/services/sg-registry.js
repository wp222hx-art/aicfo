// ================================================================================
// Singapore Registry Adapter  —  ACRA BizFile / MyInfo / IRAS UEN 统一外部接口
// ================================================================================
// 目的：
//   • 用一份 system_settings['sg_registry'] 控制所有新加坡官方接口的接入方式
//   • mock 模式（默认，离线可用） / sandbox 模式（测试环境 key） / live 模式（生产）
//   • 提供 4 个方法：
//       - checkCompanyName(name)        ACRA 名称可用性（用于 /registration/name-check）
//       - verifyUEN(uen)                ACRA UEN 校验（用于聊天/阅读中提到某公司时做核验）
//       - lookupSsicCode(keyword)       ACRA 行业代码查询
//       - submitIncorporation(payload)  ACRA BizFile 公司注册提交
//   • 所有调用写 system_settings + llm_call_logs 兄弟表 registry_call_logs
// ================================================================================
const { v4: uuid } = require('uuid');

let db; try { db = require('../db/schema'); } catch (_) { db = null; }

const CFG_KEY = 'sg_registry';

// ---- 默认配置：mock 模式，离线可用 ----
const DEFAULT = {
  mode: 'mock',                                // mock | sandbox | live
  bizfile_base_url: 'https://api.bizfile.gov.sg/v1',
  bizfile_api_key: '',                         // 后台填
  myinfo_base_url: 'https://api.myinfo.gov.sg/v2',
  myinfo_client_id: '',
  myinfo_client_secret: '',
  iras_base_url: 'https://apiservices.iras.gov.sg',
  iras_api_key: '',
  // 速率控制
  timeout_ms: 15000,
  retry: 1
};

let _cache = null;
function getConfig() {
  if (_cache) return _cache;
  let cfg = { ...DEFAULT };
  if (db) {
    try {
      const row = db.prepare('SELECT value FROM system_settings WHERE key=?').get(CFG_KEY);
      if (row?.value) cfg = { ...cfg, ...JSON.parse(row.value) };
    } catch (_) {}
  }
  _cache = cfg;
  return cfg;
}

function updateConfig(patch = {}) {
  const cur = getConfig();
  const next = { ...cur, ...patch };
  if (db) {
    db.prepare(`INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`)
      .run(CFG_KEY, JSON.stringify(next));
  }
  _cache = next;
  return getMaskedConfig();
}

function getMaskedConfig() {
  const c = getConfig();
  const mask = k => (k ? `${k.slice(0,4)}****${k.slice(-4)}` : '');
  return {
    mode: c.mode,
    bizfile_base_url: c.bizfile_base_url,
    bizfile_api_key_set: !!c.bizfile_api_key,
    bizfile_api_key_preview: mask(c.bizfile_api_key),
    myinfo_base_url: c.myinfo_base_url,
    myinfo_client_id: c.myinfo_client_id,
    myinfo_client_secret_set: !!c.myinfo_client_secret,
    iras_base_url: c.iras_base_url,
    iras_api_key_set: !!c.iras_api_key,
    timeout_ms: c.timeout_ms
  };
}

// ---- 调用日志 ----
function _log({ api, endpoint, status, latency_ms, error }) {
  if (!db) return;
  try {
    // 复用 llm_call_logs 兼容表结构；如无则跳过
    db.prepare(`INSERT INTO llm_call_logs(id,provider,tier,model,purpose,latency_ms,tokens_in,tokens_out,status,error,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .run('reg_' + uuid().slice(0,8), 'sg-registry', getConfig().mode, api, endpoint, latency_ms||0, 0, 0, status, error||null);
  } catch (_) {}
}

// ---- 通用 fetch 封装 ----
async function _call(url, opts = {}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), getConfig().timeout_ms);
  try {
    const resp = await fetch(url, { ...opts, signal: ctl.signal });
    clearTimeout(to);
    const latency = Date.now() - t0;
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      _log({ api: 'http', endpoint: url, status: 'error', latency_ms: latency, error: `${resp.status} ${resp.statusText}` });
      throw new Error(`${resp.status} ${resp.statusText}: ${JSON.stringify(body).slice(0,200)}`);
    }
    _log({ api: 'http', endpoint: url, status: 'ok', latency_ms: latency });
    return body;
  } catch (e) {
    clearTimeout(to);
    _log({ api: 'http', endpoint: url, status: 'error', latency_ms: Date.now()-t0, error: e.message });
    throw e;
  }
}

// ================================================================================
// 1. ACRA 名称可用性检查
// ================================================================================
async function checkCompanyName(name) {
  const c = getConfig();
  const full = String(name || '').trim();

  if (c.mode === 'mock' || !c.bizfile_api_key) {
    // 规则 mock：含 "Bank/Police/Government/Temasek" 判失败；其余 90% 通过
    const blacklist = /\b(bank|police|government|temasek|mas|acra|iras|cpf)\b/i;
    const dup = /\b(apple|google|facebook|tencent|alibaba)\b/i;
    const fail = blacklist.test(full) || dup.test(full);
    return {
      ok: true,
      source: 'mock',
      available: !fail,
      name: full,
      reason: fail ? 'Contains restricted / duplicated keyword (mock rule)' : 'No conflict found (mock)',
      suggestions: fail ? [full.replace(/bank|police|gov/gi,'Biz')+' Services', full+' Global'] : []
    };
  }

  // 真 BizFile API（sandbox / live）
  const url = `${c.bizfile_base_url}/entity/name-availability?name=${encodeURIComponent(full)}`;
  const data = await _call(url, {
    headers: { 'X-API-Key': c.bizfile_api_key, 'Accept': 'application/json' }
  });
  return {
    ok: true,
    source: c.mode,
    available: data.available === true || data.status === 'AVAILABLE',
    name: full,
    reason: data.reason || data.message || '',
    suggestions: data.suggestions || []
  };
}

// ================================================================================
// 2. ACRA UEN 校验  ——  聊天/阅读中提到某公司时用它做真实核验
// ================================================================================
async function verifyUEN(uen) {
  const c = getConfig();
  const u = String(uen || '').trim().toUpperCase();
  // UEN 格式校验（离线也能做）
  const formatOk = /^(\d{9}[A-Z]|\d{4}\d{5}[A-Z]|[STR]\d{2}[A-Z]{2}\d{4}[A-Z])$/.test(u);
  if (!formatOk) return { ok: true, source: 'format-check', valid: false, uen: u, reason: 'UEN 格式不正确' };

  if (c.mode === 'mock' || !c.bizfile_api_key) {
    return {
      ok: true, source: 'mock', valid: true, uen: u,
      entity: {
        uen: u, name: `Mock Company ${u.slice(-4)} Pte Ltd`,
        entity_type: 'Local Company (Private Limited)',
        status: 'Live',
        registration_date: '2020-01-15',
        primary_ssic_code: '62010',
        primary_ssic_desc: 'Computer Programming Activities',
        registered_address: '1 Raffles Place #20-00, Singapore 048616'
      }
    };
  }

  const url = `${c.bizfile_base_url}/entity/${encodeURIComponent(u)}`;
  const data = await _call(url, { headers: { 'X-API-Key': c.bizfile_api_key }});
  return { ok: true, source: c.mode, valid: !!data.uen, uen: u, entity: data };
}

// ================================================================================
// 3. SSIC 行业代码查询
// ================================================================================
async function lookupSsicCode(keyword) {
  const c = getConfig();
  const kw = String(keyword || '').trim().toLowerCase();
  const MOCK_SSIC = [
    { code: '62010', desc: 'Computer programming activities' },
    { code: '62020', desc: 'Information technology consultancy' },
    { code: '63111', desc: 'Web portals' },
    { code: '47919', desc: 'Retail sale via online platforms' },
    { code: '46900', desc: 'Non-specialized wholesale trade' },
    { code: '70209', desc: 'Other management consultancy activities' },
    { code: '64110', desc: 'Central banking' },
    { code: '66190', desc: 'Other financial service activities' },
    { code: '56101', desc: 'Restaurants' },
    { code: '68101', desc: 'Real estate developers' }
  ];
  if (c.mode === 'mock' || !c.bizfile_api_key) {
    const hits = MOCK_SSIC.filter(s => s.desc.toLowerCase().includes(kw) || s.code.startsWith(kw));
    return { ok: true, source: 'mock', keyword: kw, matches: hits.slice(0, 10) };
  }
  const url = `${c.bizfile_base_url}/ssic/search?q=${encodeURIComponent(kw)}`;
  const data = await _call(url, { headers: { 'X-API-Key': c.bizfile_api_key }});
  return { ok: true, source: c.mode, keyword: kw, matches: data.matches || data.items || [] };
}

// ================================================================================
// 4. ACRA 公司注册提交
// ================================================================================
async function submitIncorporation(payload) {
  const c = getConfig();
  if (c.mode === 'mock' || !c.bizfile_api_key) {
    const uen = `${new Date().getFullYear()}${Math.floor(100000+Math.random()*900000)}K`;
    return {
      ok: true, source: 'mock',
      submission_ref: 'MOCK-' + uuid().slice(0,8),
      uen, status: 'APPROVED_MOCK',
      approved_at: new Date().toISOString(),
      notes: 'Mock submission — no real filing occurred'
    };
  }
  const url = `${c.bizfile_base_url}/incorporation/submit`;
  const data = await _call(url, {
    method: 'POST',
    headers: { 'X-API-Key': c.bizfile_api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { ok: true, source: c.mode, ...data };
}

// ---- 健康自检 ----
async function ping() {
  const c = getConfig();
  if (c.mode === 'mock') return { ok: true, mode: 'mock', note: 'offline mock, always healthy' };
  const r = await checkCompanyName('AiCFO Health Check Pte Ltd').catch(e => ({ ok: false, error: e.message }));
  return { ok: r.ok !== false, mode: c.mode, latency_ms: 0, probe: 'checkCompanyName' };
}

module.exports = {
  getConfig: () => getMaskedConfig(),
  updateConfig,
  checkCompanyName,
  verifyUEN,
  lookupSsicCode,
  submitIncorporation,
  ping
};
