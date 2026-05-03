// ============================================================================
// Upload Portal Service
// ----------------------------------------------------------------------------
// 给每个用户/公司生成专属公共上传链接：
//   https://<domain>/upload/UP-XXXXXXXX
//   - 无需注册，点开手机相机/相册直传
//   - 多文件、拖拽、粘贴、拍照全支持
//   - 复用 waBot.handleIncoming 的分类+入库+归档逻辑
// ============================================================================
const { v4: uuid } = require('uuid');
const QRCode = require('qrcode');
const db = require('../db/schema');
const waBot = require('./wa-bot');

function mkToken() {
  // UP-XXXXXXXX (8 chars, url-safe)
  return 'UP-' + uuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

// 1. 生成链接
//    关键保证：一个 token 锁定一家公司（company_id）
//    - 显式传入 company_id → 用它
//    - 未传 → 自动查 user 的默认公司（companies 表里 user_id 匹配的第一条）
//    - 仍找不到 → 抛错，禁止创建"孤儿链接"
async function generateToken({ user_id, company_id = null, label = null, expires_days = 0, max_uploads = 0, created_by = null, public_base = '' }) {
  if (!user_id) throw new Error('user_id 必填');

  // 自动推断 company_id（若未显式指定）
  //   优先级: 1) 用户创建的公司  2) 用户的 registration_order 关联的公司
  let effectiveCompanyId = company_id;
  if (!effectiveCompanyId) {
    const row1 = db.prepare(`SELECT id FROM companies WHERE created_by=? ORDER BY created_at ASC LIMIT 1`).get(user_id);
    if (row1?.id) effectiveCompanyId = row1.id;
    else {
      const row2 = db.prepare(`SELECT company_id FROM registration_orders WHERE user_id=? AND company_id IS NOT NULL ORDER BY created_at ASC LIMIT 1`).get(user_id);
      if (row2?.company_id) effectiveCompanyId = row2.company_id;
    }
  }
  if (!effectiveCompanyId) {
    // 严格模式：user 没有公司则拒绝创建
    const anyCompany = db.prepare(`SELECT COUNT(*) n FROM companies`).get()?.n || 0;
    throw new Error(
      anyCompany === 0
        ? '系统中还没有任何公司，请先完成注册流程（registration_orders → companies）'
        : `用户 ${user_id} 未关联任何公司，无法生成企业专属上传链接。请显式传入 company_id，或先完成公司注册。`
    );
  }

  // 校验 company 是否存在
  const companyExists = db.prepare(`SELECT id, name FROM companies WHERE id=?`).get(effectiveCompanyId);
  if (!companyExists) throw new Error(`company_id=${effectiveCompanyId} 不存在`);

  const token = mkToken();
  const expires_at = expires_days > 0 ? new Date(Date.now() + expires_days * 86400_000).toISOString() : null;
  db.prepare(`
    INSERT INTO upload_tokens(token, user_id, company_id, label, max_uploads, expires_at, created_by, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(token, user_id, effectiveCompanyId, label || '上传链接', max_uploads, expires_at, created_by);

  const url = public_base ? `${public_base.replace(/\/+$/, '')}/upload/${token}` : `/upload/${token}`;
  const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  return { token, url, qr_data_url: qr, expires_at, max_uploads, company_id: effectiveCompanyId, company_name: companyExists.name };
}

// 2. 校验链接是否可用
function validateToken(token) {
  const row = db.prepare(`SELECT * FROM upload_tokens WHERE token=?`).get(token);
  if (!row) return { ok: false, error: 'token 无效' };
  if (row.status !== 'active') return { ok: false, error: '链接已停用' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { ok: false, error: '链接已过期' };
  if (row.max_uploads > 0 && row.uploads_count >= row.max_uploads) return { ok: false, error: '上传次数已达上限' };
  // 企业归属完整性校验（防御历史孤儿 token）
  if (!row.company_id) return { ok: false, error: '该链接未绑定企业，请联系管理员重新生成' };
  const company = db.prepare(`SELECT id FROM companies WHERE id=?`).get(row.company_id);
  if (!company) return { ok: false, error: '链接绑定的企业已被删除' };
  return { ok: true, token: row };
}

function getTokenInfo(token) {
  const row = db.prepare(`
    SELECT t.*, u.email, u.name AS user_name, c.name AS company_name
    FROM upload_tokens t
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN companies c ON c.id=t.company_id
    WHERE t.token=?
  `).get(token);
  return row;
}

// 3. 接收提交
async function submitFiles({ token, files = [], text = '', submitter_name = '', submitter_phone = '', ip, user_agent }) {
  const v = validateToken(token);
  if (!v.ok) return v;
  const tk = v.token;

  // 确保该 user 有个 virtual channel 且 company_id 与 token 一致
  // （关键：不能复用属于其它公司的 wa_channel，否则上传文件会挂到错公司名下）
  let ch = db.prepare(
    `SELECT * FROM wa_channels WHERE user_id=? AND company_id=? AND status='active' LIMIT 1`
  ).get(tk.user_id, tk.company_id);
  if (!ch) {
    // 为这家公司创建一个虚拟 channel 作为归属
    const cid = 'wac_up_' + uuid().slice(0, 8);
    db.prepare(`
      INSERT INTO wa_channels(id,user_id,company_id,finance_token,qr_payload,bot_phone,status,wa_phone,created_at)
      VALUES(?, ?, ?, ?, ?, 'UPLOAD-PORTAL', 'active', ?, CURRENT_TIMESTAMP)
    `).run(cid, tk.user_id, tk.company_id, 'UP-' + tk.token, 'upload-portal://' + tk.token, submitter_phone || 'web-upload');
    ch = db.prepare(`SELECT * FROM wa_channels WHERE id=?`).get(cid);
  }

  const linked_ids = [];
  let main_classified = null;
  const now = Date.now();

  if (files.length === 0 && text) {
    // 纯文字也走 handleIncoming
    const r = await waBot.handleIncoming({
      channel_id: ch.id,
      text,
      media_url: null,
      media_mime: null,
      filename: null,
      buffer: null,
      msg_type: 'text',
    });
    if (r.ok) {
      main_classified = r.classified_as;
      if (r.linked_entity_id) linked_ids.push(r.linked_entity_id);
    }
  } else {
    for (const f of files) {
      const r = await waBot.handleIncoming({
        channel_id: ch.id,
        text: text || f.caption || '',
        media_url: `upload://${tk.token}/${f.originalname || 'file'}`,
        media_mime: f.mimetype,
        filename: f.originalname,
        buffer: f.buffer,
        msg_type: (f.mimetype || '').startsWith('image/') ? 'image' : 'document',
      });
      if (r.ok) {
        main_classified = main_classified || r.classified_as;
        if (r.linked_entity_id) linked_ids.push(r.linked_entity_id);
      }
    }
  }

  // 记录一条 submission
  const subId = 'us_' + uuid().slice(0, 8);
  db.prepare(`
    INSERT INTO upload_submissions(id, token, user_id, company_id, submitter_name, submitter_phone, file_count, note, classified_as, linked_entity_ids, ip, user_agent, status, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed', CURRENT_TIMESTAMP)
  `).run(subId, tk.token, tk.user_id, tk.company_id, submitter_name, submitter_phone, files.length || (text ? 1 : 0), text || '', main_classified || 'other', JSON.stringify(linked_ids), ip || '', user_agent || '');

  db.prepare(`UPDATE upload_tokens SET uploads_count=uploads_count+1, last_used_at=CURRENT_TIMESTAMP WHERE token=?`).run(tk.token);

  // 刷新归档
  waBot.refreshArchive({ user_id: tk.user_id, company_id: tk.company_id });

  return {
    ok: true,
    submission_id: subId,
    classified_as: main_classified || 'other',
    file_count: files.length || (text ? 1 : 0),
    linked_entity_ids: linked_ids,
    elapsed_ms: Date.now() - now,
    reply: `✓ 已收到 ${files.length || 1} 个文件，AI 已分类为 ${main_classified || 'other'}，感谢您的上传。`,
  };
}

// 4. 列出某用户的所有链接
function listTokens({ user_id }) {
  return db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM upload_submissions s WHERE s.token=t.token) AS submission_count
    FROM upload_tokens t
    WHERE t.user_id=?
    ORDER BY t.created_at DESC
  `).all(user_id);
}

function revokeToken(token) {
  db.prepare(`UPDATE upload_tokens SET status='revoked' WHERE token=?`).run(token);
  return { ok: true };
}

function listAllTokens({ limit = 100 } = {}) {
  return db.prepare(`
    SELECT t.*, u.email, u.name AS user_name, c.name AS company_name,
           (SELECT COUNT(*) FROM upload_submissions s WHERE s.token=t.token) AS submission_count
    FROM upload_tokens t
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN companies c ON c.id=t.company_id
    ORDER BY t.created_at DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  generateToken, validateToken, getTokenInfo, submitFiles,
  listTokens, listAllTokens, revokeToken,
};
