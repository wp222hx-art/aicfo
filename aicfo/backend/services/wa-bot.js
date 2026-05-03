// WhatsApp Finance Bot service
// - 为每个付费用户生成专属 finance_token 和二维码
// - 接收 WhatsApp webhook 消息，AI 分类后挂到对应业务表
// - 写入 wa_messages + 更新 user_finance_archive
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const db = require('../db/schema');
const llmReal = require('./llm-real');
const rag = require('../../rag/engine');

// 上传文件物理存储目录
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}

function persistBuffer(buffer, mime, originalname) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  const extFromName = originalname ? path.extname(originalname) : '';
  const extFromMime = mime ? '.' + mime.split('/')[1].split(';')[0] : '';
  const ext = extFromName || extFromMime || '.bin';
  const safeId = uuid().replace(/-/g, '').slice(0, 16);
  const fname = safeId + ext;
  const abs = path.join(UPLOADS_DIR, fname);
  fs.writeFileSync(abs, buffer);
  // 对外可访问的 URL（由 /api/files/:fname 路由服务）
  return { abs, rel: '/api/files/' + fname, size: buffer.length, mime };
}

const BOT_PHONE = process.env.AICFO_WA_BOT_PHONE || '6580000000'; // 模拟 bot 号
const PUBLIC_BASE = process.env.AICFO_PUBLIC_BASE_URL || '';

// ---------- 1. 生成专属财务二维码 ----------
async function createFinanceChannel({ user_id, company_id = null }) {
  // 一个用户只保留一个 active channel
  const exist = db.prepare(`SELECT * FROM wa_channels WHERE user_id=? AND status='active' LIMIT 1`).get(user_id);
  if (exist) return await attachQr(exist);

  const id = 'wac_' + uuid().slice(0, 8);
  const token = 'FIN-' + uuid().replace(/-/g, '').slice(0, 12).toUpperCase();
  const payload = `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent('LINK:' + token)}`;

  db.prepare(`INSERT INTO wa_channels(id,user_id,company_id,finance_token,qr_payload,bot_phone,status,created_at)
              VALUES(?,?,?,?,?,?, 'active', CURRENT_TIMESTAMP)`)
    .run(id, user_id, company_id, token, payload, BOT_PHONE);

  const row = db.prepare(`SELECT * FROM wa_channels WHERE id=?`).get(id);
  return await attachQr(row);
}

async function attachQr(row) {
  const dataUrl = await QRCode.toDataURL(row.qr_payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  return { ...row, qr_data_url: dataUrl };
}

function getChannelByToken(token) {
  return db.prepare(`SELECT * FROM wa_channels WHERE finance_token=? AND status='active'`).get(token);
}

function getChannelByUser(user_id) {
  return db.prepare(`SELECT * FROM wa_channels WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`).get(user_id);
}

// ---------- 2. Webhook: 首次绑定 ----------
function linkChannel({ token, wa_phone }) {
  const ch = getChannelByToken(token);
  if (!ch) return { ok: false, error: '无效 token' };
  db.prepare(`UPDATE wa_channels SET wa_phone=?, linked_at=COALESCE(linked_at,CURRENT_TIMESTAMP) WHERE id=?`)
    .run(wa_phone, ch.id);
  return { ok: true, channel_id: ch.id, user_id: ch.user_id, company_id: ch.company_id };
}

// ---------- 3. Webhook: 接收消息并 AI 分类 ----------
async function classifyMessage({ text, has_media, media_mime, filename }) {
  // 纯规则快速分类（无需 LLM，也保障离线可用）
  const t = (text || '').toLowerCase();
  if (has_media) {
    if ((media_mime || '').startsWith('image/')) {
      if (/invoice|发票|tax|gst|receipt|收据/.test(t) || /invoice|receipt/.test(filename || '')) return { kind: 'invoice', confidence: 0.88 };
      return { kind: 'invoice', confidence: 0.72 }; // 图片默认按发票/收据处理
    }
    if (/csv|xls|xlsx/.test(media_mime || '') || /\.(csv|xlsx?|xls)$/i.test(filename || '')) return { kind: 'bank_txn', confidence: 0.92 };
    if (/pdf/.test(media_mime || '') && /(report|report_|statement)/i.test(filename || '')) return { kind: 'report', confidence: 0.82 };
    if (/pdf/.test(media_mime || '')) return { kind: 'invoice', confidence: 0.7 };
  }
  if (/报表|report|trial balance|pnl|p&l/.test(t)) return { kind: 'report', confidence: 0.8 };
  if (/发票|invoice|gst/.test(t)) return { kind: 'invoice', confidence: 0.8 };
  if (/流水|transaction|bank/.test(t)) return { kind: 'bank_txn', confidence: 0.8 };
  return { kind: 'other', confidence: 0.5 };
}

async function handleIncoming({ channel_id, text = '', media_url = null, media_mime = null, filename = null, buffer = null, msg_type = 'text' }) {
  const ch = db.prepare(`SELECT * FROM wa_channels WHERE id=?`).get(channel_id);
  if (!ch) return { ok: false, error: 'channel not found' };

  const msgId = 'wam_' + uuid().slice(0, 8);
  const cls = await classifyMessage({ text, has_media: !!(media_url || buffer), media_mime, filename });

  // 如果带有真实文件 buffer，先落盘，拿到公网可访问 URL
  const persisted = persistBuffer(buffer, media_mime, filename);
  if (persisted) {
    media_url = persisted.rel;  // 覆盖掉 upload://token/… 占位符
  }

  let linked_entity_type = null, linked_entity_id = null, ai_summary = null;

  // 发票类：入 invoices 表（即使没有真实 OCR，也写一条占位发票）
  if (cls.kind === 'invoice') {
    const invId = 'inv_wa_' + uuid().slice(0, 6);
    const vendor = (text.match(/([A-Za-z][A-Za-z0-9 &]{2,30})/) || [])[1] || 'WhatsApp 上传发票';
    const amountMatch = text.match(/(\d+(?:[,.]\d{2})?)/);
    const total = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;
    const gst = +(total * 0.09 / 1.09).toFixed(2);
    db.prepare(`INSERT INTO invoices(id, company_id, vendor_name, invoice_number, issue_date, total, gst_amount, currency, ocr_confidence, ocr_raw, image_url, status, created_at)
                VALUES(?,?,?,?,?,?,?, 'SGD', ?, ?, ?, 'pending_review', CURRENT_TIMESTAMP)`)
      .run(invId, ch.company_id, vendor, 'WA-' + msgId, new Date().toISOString().slice(0, 10), total, gst, cls.confidence, text || filename || '', media_url);
    linked_entity_type = 'invoices'; linked_entity_id = invId;
    ai_summary = `已识别发票: ${vendor}, 金额 S$${total}, GST S$${gst}`;
  }
  // 银行流水类：写一条 transactions（示例：金额 + 对手方）
  else if (cls.kind === 'bank_txn') {
    const txnId = 'txn_wa_' + uuid().slice(0, 6);
    const amountMatch = text.match(/(-?\d+(?:[,.]\d{2})?)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '')) : 0;
    db.prepare(`INSERT INTO transactions(id, company_id, transaction_date, amount, currency, description, counterparty, reference, created_at)
                VALUES(?,?,?,?, 'SGD', ?, ?, ?, CURRENT_TIMESTAMP)`)
      .run(txnId, ch.company_id, new Date().toISOString().slice(0, 10), amount, text || 'WA-' + msgId, 'WA User', 'WA:' + msgId);
    linked_entity_type = 'transactions'; linked_entity_id = txnId;
    ai_summary = `已记账流水: S$${amount}`;
  }
  // 报表类：存入 documents
  else if (cls.kind === 'report') {
    const docId = 'doc_wa_' + uuid().slice(0, 6);
    try {
      db.prepare(`INSERT INTO documents(id, company_id, kind, version, file_path, content, created_at)
                  VALUES(?,?, 'report', 1, ?, ?, CURRENT_TIMESTAMP)`)
        .run(docId, ch.company_id, media_url || filename || '', text || filename || 'wa-report');
      linked_entity_type = 'documents'; linked_entity_id = docId;
    } catch (e) { /* documents 表字段未对齐则忽略 */ }
    ai_summary = '收到财务报表';
  } else {
    ai_summary = '已接收消息，暂未匹配业务分类';
  }

  // 如果落盘了文件但上面分支没写入 documents，这里补记一条文档，确保文件能在档案里看到
  if (persisted && !(linked_entity_type === 'documents' || linked_entity_type === 'invoices')) {
    const docId = 'doc_up_' + uuid().slice(0, 6);
    try {
      const docKind = cls.kind === 'receipt' ? 'receipt'
        : cls.kind === 'bank_txn' ? 'bank_statement'
        : (media_mime || '').startsWith('image/') ? 'image' : 'attachment';
      db.prepare(`INSERT INTO documents(id, company_id, kind, version, file_path, content, created_at)
                  VALUES(?,?,?, 1, ?, ?, CURRENT_TIMESTAMP)`)
        .run(docId, ch.company_id, docKind, media_url, text || filename || '');
      // 如果原来什么都没挂，就把 documents 挂上
      if (!linked_entity_type) { linked_entity_type = 'documents'; linked_entity_id = docId; }
    } catch (e) { /* ignore */ }
  }

  db.prepare(`INSERT INTO wa_messages(id, channel_id, user_id, company_id, direction, msg_type, media_url, content, classified_as, linked_entity_type, linked_entity_id, ai_confidence, ai_summary, processed, received_at)
              VALUES(?,?,?,?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`)
    .run(msgId, ch.id, ch.user_id, ch.company_id, msg_type, media_url, text, cls.kind, linked_entity_type, linked_entity_id, cls.confidence, ai_summary);

  db.prepare(`UPDATE wa_channels SET last_message_at=CURRENT_TIMESTAMP, message_count=message_count+1 WHERE id=?`).run(ch.id);

  // 刷新当月财务档案
  refreshArchive({ user_id: ch.user_id, company_id: ch.company_id });

  return { ok: true, message_id: msgId, classified_as: cls.kind, confidence: cls.confidence, linked_entity_id, ai_summary, reply: buildBotReply(cls, ai_summary) };
}

function buildBotReply(cls, summary) {
  const emoji = { invoice: '🧾', bank_txn: '🏦', report: '📊', receipt: '🧾', other: '💬' }[cls.kind] || '💬';
  return `${emoji} AiCFO Bot: ${summary || '已收到'} (${(cls.confidence * 100).toFixed(0)}% 置信)\n输入 /stats 查看本月档案 · /help 获取帮助`;
}

// ---------- 4. 用户财务档案聚合 ----------
function refreshArchive({ user_id, company_id }) {
  if (!user_id) return null;
  const month = new Date().toISOString().slice(0, 7);
  const invCnt = db.prepare(`SELECT COUNT(*) n FROM invoices WHERE company_id=?`).get(company_id)?.n || 0;
  const txnCnt = db.prepare(`SELECT COUNT(*) n FROM transactions WHERE company_id=?`).get(company_id)?.n || 0;
  const waRcpt = db.prepare(`SELECT COUNT(*) n FROM wa_messages WHERE user_id=? AND classified_as IN('invoice','receipt')`).get(user_id)?.n || 0;
  const rev = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE company_id=? AND amount>0`).get(company_id)?.s || 0;
  const exp = db.prepare(`SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE company_id=? AND amount<0`).get(company_id)?.s || 0;

  const existing = db.prepare(`SELECT id FROM user_finance_archive WHERE user_id=? AND archive_date=?`).get(user_id, month);
  if (existing) {
    db.prepare(`UPDATE user_finance_archive SET company_id=?, invoice_count=?, txn_count=?, receipt_count=?, total_revenue=?, total_expense=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(company_id, invCnt, txnCnt, waRcpt, rev, exp, existing.id);
    return existing.id;
  }
  const id = 'arc_' + uuid().slice(0, 8);
  db.prepare(`INSERT INTO user_finance_archive(id,user_id,company_id,archive_date,invoice_count,txn_count,receipt_count,total_revenue,total_expense,created_at,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(id, user_id, company_id, month, invCnt, txnCnt, waRcpt, rev, exp);
  return id;
}

function getUserArchive({ user_id }) {
  const archives = db.prepare(`SELECT * FROM user_finance_archive WHERE user_id=? ORDER BY archive_date DESC`).all(user_id);
  const channel = getChannelByUser(user_id);
  const recentMsgs = channel ? db.prepare(`SELECT * FROM wa_messages WHERE channel_id=? ORDER BY received_at DESC LIMIT 20`).all(channel.id) : [];
  const invoices = channel?.company_id ? db.prepare(`SELECT id,vendor_name,total,gst_amount,issue_date,status FROM invoices WHERE company_id=? ORDER BY created_at DESC LIMIT 20`).all(channel.company_id) : [];
  const txns = channel?.company_id ? db.prepare(`SELECT id,transaction_date,amount,description FROM transactions WHERE company_id=? ORDER BY transaction_date DESC LIMIT 20`).all(channel.company_id) : [];
  return { user_id, channel, archives, recent_messages: recentMsgs, invoices, transactions: txns };
}

function listAllArchives({ limit = 100 } = {}) {
  return db.prepare(`
    SELECT a.*, u.email, u.name, u.phone, c.name AS company_name, c.uen,
           w.finance_token, w.message_count, w.last_message_at, w.wa_phone
    FROM user_finance_archive a
    LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN companies c ON c.id=a.company_id
    LEFT JOIN wa_channels w ON w.user_id=a.user_id AND w.status='active'
    ORDER BY a.updated_at DESC
    LIMIT ?`).all(limit);
}

module.exports = {
  createFinanceChannel, getChannelByToken, getChannelByUser,
  linkChannel, handleIncoming, classifyMessage,
  refreshArchive, getUserArchive, listAllArchives,
  BOT_PHONE
};
