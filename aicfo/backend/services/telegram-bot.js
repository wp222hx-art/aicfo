// ============================================================================
// Telegram Bot Service
// ----------------------------------------------------------------------------
// 通过 Bot Token 接入 Telegram Bot API (api.telegram.org/bot<token>/<method>)
//   - webhook / long-polling 都支持
//   - 接收文字、图片、文档 → 复用 waBot.handleIncoming
//   - 自动回复处理结果
//
// 配置持久化在 system_settings，3 个关键值：
//   - bot_token: BotFather 给的 token (如 7654321:AAxxxxx...)
//   - bot_username: @AiCFO_Bot（用户拼深链接用）
//   - webhook_secret: Telegram webhook 校验用
// ============================================================================
const { v4: uuid } = require('uuid');
const db = require('../db/schema');
const waBot = require('./wa-bot');

const TG_BASE = 'https://api.telegram.org';
const SETTINGS_KEY = 'tg_bot_config';

let _cache = null;

const DEFAULT_CONFIG = {
  bot_token:       '',
  bot_username:    '',     // @AiCFO_Bot (without @ 也可)
  webhook_secret:  'aicfo-tg-secret-2026',
  enabled:         false,
  auto_reply:      true,
};

function readConfig() {
  if (_cache) return _cache;
  try {
    const row = db.prepare(`SELECT value FROM system_settings WHERE key=?`).get(SETTINGS_KEY);
    _cache = row?.value ? { ...DEFAULT_CONFIG, ...JSON.parse(row.value) } : { ...DEFAULT_CONFIG };
    if (process.env.TG_BOT_TOKEN)      _cache.bot_token      = process.env.TG_BOT_TOKEN;
    if (process.env.TG_BOT_USERNAME)   _cache.bot_username   = process.env.TG_BOT_USERNAME;
    if (process.env.TG_WEBHOOK_SECRET) _cache.webhook_secret = process.env.TG_WEBHOOK_SECRET;
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
    bot_token: c.bot_token ? c.bot_token.slice(0, 8) + '****' + c.bot_token.slice(-4) : '',
    bot_token_set: !!c.bot_token,
    configured: !!(c.bot_token),
  };
}

function isReady() {
  const c = readConfig();
  return !!(c.enabled && c.bot_token);
}

async function apiCall(method, body) {
  const c = readConfig();
  if (!c.bot_token) return { ok: false, error: 'bot_token 未配置' };
  const url = `${TG_BASE}/bot${c.bot_token}/${method}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) return { ok: false, status: r.status, error: data.description || JSON.stringify(data) };
    return { ok: true, result: data.result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 测试连通 getMe
async function testConnection() {
  const r = await apiCall('getMe');
  if (!r.ok) return r;
  return { ok: true, bot_id: r.result.id, bot_username: r.result.username, bot_name: r.result.first_name, can_read_all_group_messages: r.result.can_read_all_group_messages };
}

// 挂 webhook
async function setWebhook(webhook_url) {
  const c = readConfig();
  const r = await apiCall('setWebhook', {
    url: webhook_url,
    secret_token: c.webhook_secret,
    allowed_updates: ['message', 'edited_message'],
  });
  return r;
}

async function deleteWebhook() {
  return await apiCall('deleteWebhook');
}

// 主动发送文本
async function sendText(chat_id, text) {
  return await apiCall('sendMessage', { chat_id, text: String(text).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true });
}

// 下载文件：getFile → 返回 file_path → GET https://api.telegram.org/file/bot<token>/<file_path>
async function downloadFile(file_id) {
  const c = readConfig();
  if (!c.bot_token) return { ok: false, error: 'no token' };
  const meta = await apiCall('getFile', { file_id });
  if (!meta.ok) return meta;
  const file_path = meta.result.file_path;
  try {
    const r = await fetch(`${TG_BASE}/file/bot${c.bot_token}/${file_path}`);
    if (!r.ok) return { ok: false, error: `download ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, buffer: buf, file_size: buf.length, file_path };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 解析 Telegram Update
function parseUpdate(update) {
  const m = update.message || update.edited_message;
  if (!m) return null;
  const rec = {
    update_id:  update.update_id,
    message_id: m.message_id,
    chat_id:    String(m.chat.id),
    chat_type:  m.chat.type,
    from_id:    String(m.from?.id || ''),
    username:   m.from?.username || null,
    first_name: m.from?.first_name || null,
    date:       new Date((m.date || 0) * 1000),
    type:       'text',
    text:       m.text || m.caption || '',
    file_id:    null,
    mime:       null,
    filename:   null,
  };
  if (m.photo && m.photo.length) {
    // photo 数组选最大分辨率
    const biggest = m.photo[m.photo.length - 1];
    rec.type = 'photo';
    rec.file_id = biggest.file_id;
    rec.mime = 'image/jpeg';
    rec.filename = `tg-photo-${m.message_id}.jpg`;
  } else if (m.document) {
    rec.type = 'document';
    rec.file_id = m.document.file_id;
    rec.mime = m.document.mime_type || 'application/octet-stream';
    rec.filename = m.document.file_name || `tg-doc-${m.message_id}`;
  } else if (m.voice) {
    rec.type = 'voice';
    rec.file_id = m.voice.file_id;
    rec.mime = m.voice.mime_type || 'audio/ogg';
    rec.filename = `tg-voice-${m.message_id}.ogg`;
  } else if (m.video) {
    rec.type = 'video';
    rec.file_id = m.video.file_id;
    rec.mime = m.video.mime_type || 'video/mp4';
    rec.filename = `tg-video-${m.message_id}.mp4`;
  }
  return rec;
}

// ---------- Channel binding (TG chat_id ↔ user) ----------
function getChannelByChatId(chat_id) {
  return db.prepare(`SELECT * FROM telegram_channels WHERE tg_chat_id=? AND status='active' LIMIT 1`).get(String(chat_id));
}

function linkChannel({ token, chat_id, tg_username }) {
  // 支持用 WhatsApp 已生成的 FIN-xxx 或专属 UP-xxx 或 TG-xxx
  let ch = null;
  // 1) WA channel 有 finance_token？借来创建一个 TG 关联
  const wa = db.prepare(`SELECT * FROM wa_channels WHERE finance_token=?`).get(token);
  const user_id = wa?.user_id;
  const company_id = wa?.company_id;
  if (!wa) return { ok: false, error: '无效 token' };

  const id = 'tgc_' + uuid().slice(0, 8);
  db.prepare(`
    INSERT INTO telegram_channels(id, user_id, company_id, finance_token, tg_chat_id, tg_username, status, linked_at, created_at)
    VALUES(?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT DO NOTHING
  `).run(id, user_id, company_id, token, String(chat_id), tg_username);
  ch = db.prepare(`SELECT * FROM telegram_channels WHERE tg_chat_id=?`).get(String(chat_id));
  return { ok: true, channel_id: ch?.id || id, user_id, company_id };
}

// ---------- 核心：收到消息后处理 ----------
async function handleUpdate(update) {
  const msg = parseUpdate(update);
  if (!msg) return { ok: false, error: 'no message' };

  // 1. 查 channel
  let ch = getChannelByChatId(msg.chat_id);

  // 2. /start 或 LINK: 指令 → 尝试绑定
  if (!ch) {
    const startMatch = (msg.text || '').match(/\/start\s+([A-Z0-9\-]+)/i);
    const linkMatch  = (msg.text || '').match(/LINK:([A-Z0-9\-]+)/i);
    const token = startMatch?.[1] || linkMatch?.[1];
    if (token) {
      const lr = linkChannel({ token, chat_id: msg.chat_id, tg_username: msg.username });
      if (lr.ok) {
        ch = getChannelByChatId(msg.chat_id);
        const cfg = readConfig();
        if (cfg.auto_reply) {
          await sendText(msg.chat_id, `✅ 绑定成功！欢迎使用 AiCFO Finance Bot。\n\n现在你可以：\n📸 拍照上传发票\n📄 发 PDF 账单\n📊 发 CSV 银行流水\n💬 发文字描述交易\n\n我会自动识别并记账，每次都给你回复。`);
        }
        return { ok: true, linked: true, user_id: lr.user_id };
      } else {
        await sendText(msg.chat_id, `❌ 绑定失败：${lr.error}\n请登录 AiCFO 账户获取正确的 token。`).catch(()=>{});
        return { ok: false, error: lr.error };
      }
    }
    // 未绑定
    const cfg = readConfig();
    if (cfg.auto_reply) {
      await sendText(msg.chat_id, `👋 欢迎！请先绑定你的 AiCFO 账户：\n回复 <code>/start FIN-XXXXXXXX</code>（在 AiCFO 后台「我的链接」获取 token）`).catch(()=>{});
    }
    return { ok: false, error: 'unbound' };
  }

  // 3. 有 channel，继续流程
  //    a) 下载媒体
  let buffer = null, media_url = null;
  if (msg.file_id) {
    const dl = await downloadFile(msg.file_id);
    if (dl.ok) buffer = dl.buffer;
    media_url = `tg://${msg.file_id}`;
  }

  //    b) 复用 waBot.handleIncoming（它会写到 wa_messages / invoices / transactions）
  //       我们同时也额外写 telegram_messages 保留原始 TG context
  const subType = msg.type === 'text' ? 'text' : (msg.mime?.startsWith('image/') ? 'image' : 'document');
  const result = await waBot.handleIncoming({
    channel_id: await ensureWaChannelForTgUser(ch),
    text:       msg.text || '',
    media_url,
    media_mime: msg.mime,
    filename:   msg.filename,
    buffer,
    msg_type:   subType,
  });

  // 写 telegram_messages
  const tgMsgId = 'tgm_' + uuid().slice(0, 8);
  try {
    db.prepare(`
      INSERT INTO telegram_messages(id, channel_id, tg_chat_id, tg_message_id, direction, msg_type, content, file_id, classified_as, linked_entity_type, linked_entity_id, ai_confidence, ai_summary, received_at)
      VALUES(?, ?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(tgMsgId, ch.id, msg.chat_id, msg.message_id, msg.type, msg.text || '', msg.file_id,
           result.classified_as || 'other', 'invoices', result.linked_entity_id || null,
           result.confidence || 0, result.ai_summary || '');
  } catch(e) { /* 表结构不对齐则跳过 */ }

  // 更新 channel
  db.prepare(`UPDATE telegram_channels SET message_count=message_count+1, last_message_at=CURRENT_TIMESTAMP WHERE id=?`).run(ch.id);

  // 自动回复
  const cfg = readConfig();
  if (cfg.auto_reply && result.ok) {
    await sendText(msg.chat_id, result.reply || '✓ 已记录').catch(() => {});
  }

  return { ok: true, classified_as: result.classified_as, confidence: result.confidence, linked_entity_id: result.linked_entity_id };
}

// 借用 wa_channel 作为 handleIncoming 的主体（统一 invoices/transactions 入库）
async function ensureWaChannelForTgUser(tgCh) {
  let wa = db.prepare(`SELECT * FROM wa_channels WHERE user_id=? AND status='active' LIMIT 1`).get(tgCh.user_id);
  if (!wa) {
    const id = 'wac_tg_' + uuid().slice(0, 8);
    db.prepare(`
      INSERT INTO wa_channels(id,user_id,company_id,finance_token,qr_payload,bot_phone,wa_phone,status,created_at)
      VALUES(?,?,?,?, 'telegram-bridge', 'TELEGRAM', ?, 'active', CURRENT_TIMESTAMP)
    `).run(id, tgCh.user_id, tgCh.company_id, tgCh.finance_token || 'TG-' + tgCh.id, String(tgCh.tg_chat_id));
    wa = db.prepare(`SELECT * FROM wa_channels WHERE id=?`).get(id);
  }
  return wa.id;
}

// Long-polling 后备（无 webhook 时使用）
let _pollingOffset = 0;
let _pollingTimer = null;
async function startPolling({ intervalMs = 2000 } = {}) {
  if (_pollingTimer) return;
  console.log('[tg-bot] start long polling');
  const loop = async () => {
    const r = await apiCall('getUpdates', { offset: _pollingOffset, timeout: 1, limit: 20 });
    if (r.ok && Array.isArray(r.result) && r.result.length) {
      for (const u of r.result) {
        _pollingOffset = u.update_id + 1;
        try { await handleUpdate(u); } catch (e) { console.error('[tg poll handle]', e.message); }
      }
    }
  };
  _pollingTimer = setInterval(() => loop().catch(() => {}), intervalMs);
}

function stopPolling() {
  if (_pollingTimer) { clearInterval(_pollingTimer); _pollingTimer = null; }
}

function listChannels({ limit = 100 } = {}) {
  return db.prepare(`
    SELECT t.*, u.email, u.name AS user_name, c.name AS company_name
    FROM telegram_channels t
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN companies c ON c.id=t.company_id
    ORDER BY t.created_at DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  readConfig, updateConfig, getMaskedConfig, isReady,
  testConnection, setWebhook, deleteWebhook,
  sendText, downloadFile, parseUpdate, handleUpdate, linkChannel,
  startPolling, stopPolling, listChannels,
  TG_BASE,
};
