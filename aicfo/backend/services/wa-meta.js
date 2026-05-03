// ============================================================================
// WhatsApp Meta Cloud API Adapter
// ----------------------------------------------------------------------------
// 负责与 Meta Cloud API (graph.facebook.com/v19.0) 通信：
//   1. webhook verify (GET  /wa/webhook/meta)
//   2. incoming message parse (POST /wa/webhook/meta) → 归一化后调 waBot.handleIncoming
//   3. outbound sendText / sendTemplate (主动回消息 / 月报推送)
//   4. downloadMedia (收到图片时下载原图 → 供 OCR 使用)
//
// 配置持久化在 system_settings 表，3 个关键值：
//   - phone_number_id: Meta 测试号 / 正式号 ID
//   - access_token:    Meta App 的长期 token (或 24h 测试 token)
//   - verify_token:    自定义字符串，与 Meta 后台填入值一致
//
// 依赖：node 18+ 内置 fetch
// ============================================================================
const db = require('../db/schema');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const SETTINGS_KEY = 'wa_meta_config';

let _cache = null;

const DEFAULT_CONFIG = {
  phone_number_id: '',     // 如 '123456789012345'
  access_token:    '',     // 如 'EAAxxxxxxxxxx...'
  verify_token:    'aicfo-verify-2026',
  bot_display_name:'AiCFO Finance Bot',
  enabled:         false,  // 未配完前保持 false，走 mock 模式
  auto_reply:      true,   // 收到消息后自动回复处理结果
};

function readConfig() {
  if (_cache) return _cache;
  try {
    const row = db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(SETTINGS_KEY);
    if (row?.value) {
      _cache = { ...DEFAULT_CONFIG, ...JSON.parse(row.value) };
    } else {
      _cache = { ...DEFAULT_CONFIG };
    }
    // env 覆盖
    if (process.env.META_WA_PHONE_NUMBER_ID) _cache.phone_number_id = process.env.META_WA_PHONE_NUMBER_ID;
    if (process.env.META_WA_ACCESS_TOKEN)    _cache.access_token    = process.env.META_WA_ACCESS_TOKEN;
    if (process.env.META_WA_VERIFY_TOKEN)    _cache.verify_token    = process.env.META_WA_VERIFY_TOKEN;
  } catch (e) {
    _cache = { ...DEFAULT_CONFIG };
  }
  return _cache;
}

function updateConfig(patch) {
  const cur = readConfig();
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_CONFIG)) {
    if (patch[k] !== undefined && patch[k] !== null) next[k] = patch[k];
  }
  db.prepare(`
    INSERT INTO system_settings(key, value, updated_at)
    VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
  `).run(SETTINGS_KEY, JSON.stringify(next));
  _cache = next;
  return next;
}

function getMaskedConfig() {
  const c = readConfig();
  return {
    ...c,
    access_token: c.access_token ? c.access_token.slice(0, 6) + '****' + c.access_token.slice(-4) : '',
    access_token_set: !!c.access_token,
    configured: !!(c.phone_number_id && c.access_token && c.verify_token),
  };
}

function isReady() {
  const c = readConfig();
  return !!(c.enabled && c.phone_number_id && c.access_token);
}

// ---------------------------------------------------------------------------
// 1. Webhook verification (Meta 初次挂 webhook 时会 GET 请求带这 3 个 query)
// ---------------------------------------------------------------------------
function verifyWebhook({ mode, token, challenge }) {
  const c = readConfig();
  if (mode === 'subscribe' && token === c.verify_token) {
    return { ok: true, challenge };
  }
  return { ok: false, error: 'verify_token mismatch' };
}

// ---------------------------------------------------------------------------
// 2. 解析 Meta 入站消息格式 → 归一化字段
//    Meta payload 典型结构：
//    { object:'whatsapp_business_account', entry:[{ changes:[{ value:{
//        messages:[{ from, id, timestamp, type:'text|image|document|audio',
//          text:{body}, image:{id,mime_type,sha256}, document:{id,filename,mime_type} } ],
//        contacts:[{profile:{name}, wa_id}]
//    }}]}]}
// ---------------------------------------------------------------------------
function parseInboundPayload(body) {
  const out = [];
  if (!body || !Array.isArray(body.entry)) return out;
  for (const entry of body.entry) {
    for (const change of entry.changes || []) {
      const val = change.value || {};
      const contacts = val.contacts || [];
      for (const m of (val.messages || [])) {
        const contact = contacts.find(c => c.wa_id === m.from) || {};
        const rec = {
          message_id:  m.id,
          from:        m.from,                          // 发送方手机号 e.g. 6591234567
          name:        contact.profile?.name || null,
          timestamp:   m.timestamp ? new Date(parseInt(m.timestamp) * 1000) : new Date(),
          type:        m.type || 'text',
          text:        m.text?.body || m.button?.text || m.interactive?.button_reply?.title || '',
          media_id:    null,
          media_mime:  null,
          filename:    null,
        };
        if (m.type === 'image' && m.image) {
          rec.media_id = m.image.id; rec.media_mime = m.image.mime_type || 'image/jpeg';
          rec.filename = `wa-image-${m.id}.jpg`;
          rec.text = m.image.caption || rec.text;
        } else if (m.type === 'document' && m.document) {
          rec.media_id = m.document.id; rec.media_mime = m.document.mime_type || 'application/octet-stream';
          rec.filename = m.document.filename || `wa-doc-${m.id}`;
          rec.text = m.document.caption || rec.text;
        } else if (m.type === 'audio' && m.audio) {
          rec.media_id = m.audio.id; rec.media_mime = m.audio.mime_type || 'audio/ogg';
          rec.filename = `wa-audio-${m.id}.ogg`;
        } else if (m.type === 'video' && m.video) {
          rec.media_id = m.video.id; rec.media_mime = m.video.mime_type || 'video/mp4';
          rec.filename = `wa-video-${m.id}.mp4`;
          rec.text = m.video.caption || rec.text;
        }
        out.push(rec);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 主动发送文本消息 (sendText)
// ---------------------------------------------------------------------------
async function sendText(to, body) {
  const c = readConfig();
  if (!c.phone_number_id || !c.access_token) {
    return { ok: false, error: 'meta wa not configured' };
  }
  const url = `${GRAPH_BASE}/${c.phone_number_id}/messages`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.access_token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type:              'text',
        text: { preview_url: false, body: (body || '').slice(0, 4000) },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: data?.error?.message || JSON.stringify(data) };
    return { ok: true, wa_message_id: data.messages?.[0]?.id, raw: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// 4. 下载媒体 (收到图片/文件时，先 GET media 元信息，再 GET 下载原始 bytes)
// ---------------------------------------------------------------------------
async function downloadMedia(mediaId) {
  const c = readConfig();
  if (!c.access_token) return { ok: false, error: 'no access_token' };
  try {
    // step1: 拿 media URL
    const metaR = await fetch(`${GRAPH_BASE}/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${c.access_token}` },
    });
    if (!metaR.ok) return { ok: false, error: `meta api ${metaR.status}` };
    const meta = await metaR.json();
    if (!meta.url) return { ok: false, error: 'no url in media meta' };

    // step2: 下载实际 bytes
    const binR = await fetch(meta.url, {
      headers: { 'Authorization': `Bearer ${c.access_token}` },
    });
    if (!binR.ok) return { ok: false, error: `download ${binR.status}` };
    const buf = Buffer.from(await binR.arrayBuffer());
    return { ok: true, buffer: buf, mime: meta.mime_type, size: buf.length, sha256: meta.sha256 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// 5. 测试连通：直接用 Phone Number ID 查询元信息
// ---------------------------------------------------------------------------
async function testConnection() {
  const c = readConfig();
  if (!c.phone_number_id || !c.access_token) {
    return { ok: false, error: 'phone_number_id / access_token 未配置' };
  }
  const url = `${GRAPH_BASE}/${c.phone_number_id}?fields=display_phone_number,verified_name,quality_rating`;
  try {
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${c.access_token}` } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: data?.error?.message || JSON.stringify(data) };
    return {
      ok: true,
      display_phone_number: data.display_phone_number,
      verified_name:        data.verified_name,
      quality_rating:       data.quality_rating,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  readConfig, updateConfig, getMaskedConfig, isReady,
  verifyWebhook, parseInboundPayload,
  sendText, downloadMedia, testConnection,
  GRAPH_BASE,
};
