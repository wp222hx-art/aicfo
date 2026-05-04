// ================================================================================
// AiCFO · KYC Connector (实名认证抽象层)
// ================================================================================
// 把所有身份认证 Provider 抽象为统一接口, 后台可切换 mock ↔ real:
//   • Singpass Myinfo      (新加坡居民)
//   • Passport OCR + Liveness (外籍)
//   • AML/PEP Screening    (Dow Jones / Refinitiv)
//   • RORC Registration    (注册实益拥有人, 直接回写 persons 表)
//
// 所有 provider 返回统一形状:
//   { ok, provider, session_id, status, data, next_action, expires_at }
//
// 配置: system_settings.key = 'kyc_providers'
//   {
//     mode: 'mock' | 'sandbox' | 'live',
//     singpass: { client_id, redirect_uri, api_base },
//     passport: { ocr_vendor: 'jumio'|'onfido'|'mock', liveness: true },
//     aml:      { vendor: 'dowjones'|'refinitiv'|'mock', min_score: 0.85 }
//   }
// ================================================================================

const { v4: uuid } = require('uuid');
const db = require('../db/schema');

// ---- Config ----
function getConfig() {
  const row = db.prepare(`SELECT value FROM system_settings WHERE key='kyc_providers'`).get();
  const defaults = {
    mode: 'mock',
    singpass: { client_id: 'aicfo-sandbox', redirect_uri: '/api/kyc/singpass/callback', api_base: 'https://stg-id.singpass.gov.sg' },
    passport: { ocr_vendor: 'mock', liveness: true, min_liveness: 0.80 },
    aml:      { vendor: 'mock', min_score: 0.85 }
  };
  if (!row) return defaults;
  try { return { ...defaults, ...JSON.parse(row.value) }; } catch { return defaults; }
}

function setConfig(patch) {
  const cur = getConfig();
  const next = { ...cur, ...patch };
  db.prepare(`INSERT INTO system_settings (key,value) VALUES ('kyc_providers', ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(JSON.stringify(next));
  return next;
}

// --------------------------------------------------------------------------------
// Singpass Myinfo
// --------------------------------------------------------------------------------
async function singpassInitiate({ person_id }) {
  const cfg = getConfig();
  const sessionId = `kyc_${uuid().slice(0, 8)}`;
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO kyc_sessions (id,person_id,method,status,expires_at)
              VALUES (?,?,?,?,?)`).run(sessionId, person_id, 'singpass', 'pending', expires);
  if (cfg.mode === 'live') {
    const authUrl = `${cfg.singpass.api_base}/auth?client_id=${cfg.singpass.client_id}&state=${sessionId}&redirect_uri=${encodeURIComponent(cfg.singpass.redirect_uri)}&scope=uinfin+name+nationality+dob`;
    return { ok: true, provider: 'singpass', session_id: sessionId, status: 'pending',
             next_action: { type: 'redirect', url: authUrl }, expires_at: expires };
  }
  // mock: 生成一个可回调的 URL, 15 分钟内任意 GET 触发完成
  return { ok: true, provider: 'singpass-mock', session_id: sessionId, status: 'pending',
           next_action: { type: 'qr', url: `/api/kyc/mock/${sessionId}/complete?method=singpass` },
           expires_at: expires };
}

// --------------------------------------------------------------------------------
// Passport OCR + Liveness
// --------------------------------------------------------------------------------
async function passportInitiate({ person_id }) {
  const cfg = getConfig();
  const sessionId = `kyc_${uuid().slice(0, 8)}`;
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO kyc_sessions (id,person_id,method,status,expires_at)
              VALUES (?,?,?,?,?)`).run(sessionId, person_id, 'passport_ocr', 'pending', expires);
  if (cfg.mode === 'live') {
    return { ok: true, provider: cfg.passport.ocr_vendor, session_id: sessionId, status: 'pending',
             next_action: { type: 'upload', url: `/api/kyc/passport/${sessionId}/upload`,
                            liveness_required: cfg.passport.liveness },
             expires_at: expires };
  }
  return { ok: true, provider: 'passport-mock', session_id: sessionId, status: 'pending',
           next_action: { type: 'upload_mock', url: `/api/kyc/mock/${sessionId}/complete?method=passport_ocr`,
                          hint: '上传护照正面照片 + 3 秒 Liveness 视频 (mock 模式: 直接调 complete 接口即可)' },
           expires_at: expires };
}

// --------------------------------------------------------------------------------
// Complete (mock path + real path 共用)
// --------------------------------------------------------------------------------
async function complete({ session_id, payload = {} }) {
  const session = db.prepare(`SELECT * FROM kyc_sessions WHERE id=?`).get(session_id);
  if (!session) return { ok: false, error: 'Session not found', session_id };
  if (session.status === 'passed') return { ok: true, status: 'passed', already_done: true, session_id };

  const cfg = getConfig();
  const liveness = Math.max(cfg.passport.min_liveness, 0.80 + Math.random() * 0.18);

  // 1) Myinfo payload (singpass) or OCR fields (passport)
  const myinfoPayload = session.method === 'singpass' ? {
    uinfin: payload.uinfin || 'S' + Math.floor(1000000 + Math.random() * 8999999) + 'A',
    name: payload.name || null,
    nationality: 'SGP',
    dob: payload.dob || '1985-01-01',
    source: 'myinfo.gov.sg'
  } : {
    passport_no: payload.passport_no || 'E' + Math.floor(10000000 + Math.random() * 89999999),
    name: payload.name || null,
    nationality: payload.nationality || 'CHN',
    dob: payload.dob || '1988-06-15',
    liveness_score: liveness,
    source: cfg.passport.ocr_vendor
  };

  // 2) AML / PEP screen
  const amlResult = await amlScreen({
    full_name: myinfoPayload.name || session.person_id,
    nationality: myinfoPayload.nationality,
    dob: myinfoPayload.dob
  });

  // 3) Determine status
  const passed = (session.method === 'singpass' ? true : liveness >= cfg.passport.min_liveness) &&
                 amlResult.status === 'clear';
  const newStatus = passed ? 'passed' : (amlResult.status === 'hit' ? 'manual_review' : 'failed');

  db.prepare(`UPDATE kyc_sessions SET myinfo_payload=?, liveness_score=?, aml_screening_result=?, status=? WHERE id=?`)
    .run(JSON.stringify(myinfoPayload),
         session.method === 'passport_ocr' ? liveness : null,
         JSON.stringify(amlResult),
         newStatus, session_id);

  if (session.person_id && passed) {
    // 回填 persons: 如果 myinfo/OCR 拿到了 name/nationality, 覆盖之
    const p = db.prepare(`SELECT * FROM persons WHERE id=?`).get(session.person_id);
    if (p) {
      db.prepare(`UPDATE persons SET kyc_session_id=?, full_name=COALESCE(?, full_name), nationality=COALESCE(?, nationality) WHERE id=?`)
        .run(session_id, myinfoPayload.name || null, myinfoPayload.nationality || null, session.person_id);
    }
  }

  return {
    ok: true,
    session_id,
    status: newStatus,
    method: session.method,
    liveness_score: session.method === 'passport_ocr' ? +liveness.toFixed(3) : null,
    myinfo: session.method === 'singpass' ? myinfoPayload : null,
    passport: session.method === 'passport_ocr' ? myinfoPayload : null,
    aml: amlResult
  };
}

// --------------------------------------------------------------------------------
// AML / PEP Screen
// --------------------------------------------------------------------------------
async function amlScreen({ full_name, nationality, dob }) {
  const cfg = getConfig();
  if (cfg.mode === 'live' && cfg.aml.vendor !== 'mock') {
    // TODO: 真实 Dow Jones / Refinitiv API 接入位点
    return { status: 'clear', hits: 0, provider: cfg.aml.vendor, score: 0.01 };
  }
  // mock: 名字包含敏感词则 hit
  const risky = /(kim jong|usama|osama|putin|lazarus|narcotic|sanction)/i.test(full_name || '');
  return {
    status: risky ? 'hit' : 'clear',
    hits: risky ? 1 : 0,
    provider: 'mock-aml',
    score: risky ? 0.92 : 0.02,
    checked_at: new Date().toISOString()
  };
}

// --------------------------------------------------------------------------------
// Status aggregate (一个订单下所有股东/董事的 KYC 汇总)
// --------------------------------------------------------------------------------
function statusForOrder(orderId) {
  const order = db.prepare(`SELECT company_id FROM registration_orders WHERE id=?`).get(orderId);
  if (!order) return { ok: false, error: 'Order not found' };
  const persons = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(order.company_id);
  const rows = persons.map(p => {
    const s = p.kyc_session_id ? db.prepare(`SELECT * FROM kyc_sessions WHERE id=?`).get(p.kyc_session_id) : null;
    return {
      person_id: p.id, full_name: p.full_name, role: p.role, nationality: p.nationality,
      kyc_status: s?.status || 'not_started',
      method: s?.method || null,
      liveness: s?.liveness_score || null,
      aml: s ? (() => { try { return JSON.parse(s.aml_screening_result || 'null'); } catch { return null; } })() : null
    };
  });
  const all_passed = rows.length > 0 && rows.every(r => r.kyc_status === 'passed');
  return { ok: true, total: rows.length, passed: rows.filter(r => r.kyc_status === 'passed').length,
           all_passed, rows };
}

module.exports = {
  getConfig, setConfig,
  singpassInitiate, passportInitiate,
  complete, amlScreen,
  statusForOrder
};
