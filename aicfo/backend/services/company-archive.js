// ============================================================================
// Company Archive Service — 企业档案库
// ----------------------------------------------------------------------------
// 一家公司 = 一个档案库，聚合所有业务数据为后续服务的单一入口：
//   1. 基础信息（公司、法人、KYC、银行）
//   2. 消费记录（transactions、invoices）
//   3. 报税信息（tax_filings、journal_entries）
//   4. 财报（每年 P&L、BS、CF；revenue/expense 汇总）
//   5. 历史记录（文件、上传、WhatsApp/Telegram 消息、AI agent 执行）
//   6. 订阅支付、注册流程、提醒
//
// 设计原则：
//   - 只读聚合，不改业务表（各模块保持独立写入）
//   - getFullArchive() 一次返回全部（用于详情页）
//   - getSummary() 轻量摘要（用于列表页）
//   - listAllCompaniesWithSummary() 给 Admin 企业列表用
//   - timeline() 统一时间线视图
// ============================================================================
const db = require('../db/schema');

// ---------- 1. 基础信息 ----------
function getBasicInfo(company_id) {
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id);
  if (!company) return null;
  const owner = company.created_by
    ? db.prepare(`SELECT id, email, name, role FROM users WHERE id=?`).get(company.created_by)
    : null;
  const persons = db.prepare(`SELECT * FROM persons WHERE company_id=? ORDER BY created_at ASC`).all(company_id);
  // kyc_sessions 通过 person_id 关联（没有 company_id 列）
  const kycList = db.prepare(`
    SELECT k.* FROM kyc_sessions k
    JOIN persons p ON p.id = k.person_id
    WHERE p.company_id=?
    ORDER BY k.created_at DESC
  `).all(company_id);
  const bankAccounts = db.prepare(`SELECT * FROM bank_accounts WHERE company_id=? ORDER BY last_synced_at DESC`).all(company_id);
  const regOrders = db.prepare(`SELECT * FROM registration_orders WHERE company_id=? ORDER BY created_at DESC`).all(company_id);
  return { company, owner, persons, kyc: kycList, bank_accounts: bankAccounts, registration_orders: regOrders };
}

// ---------- 2. 消费记录（transactions + invoices） ----------
function getExpenses(company_id, { limit = 200 } = {}) {
  const transactions = db.prepare(`
    SELECT * FROM transactions WHERE company_id=?
    ORDER BY transaction_date DESC, created_at DESC LIMIT ?
  `).all(company_id, limit);

  const invoices = db.prepare(`
    SELECT * FROM invoices WHERE company_id=?
    ORDER BY issue_date DESC, created_at DESC LIMIT ?
  `).all(company_id, limit);

  // 统计
  const txnAgg = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_income,
      COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS total_expense,
      COALESCE(SUM(amount), 0) AS net_cashflow
    FROM transactions WHERE company_id=?
  `).get(company_id);

  const invAgg = db.prepare(`
    SELECT
      COUNT(*) AS total_invoices,
      COALESCE(SUM(total), 0) AS total_invoice_amount,
      COALESCE(SUM(gst_amount), 0) AS total_gst,
      COALESCE(SUM(CASE WHEN status='paid' THEN total ELSE 0 END), 0) AS paid_amount,
      COALESCE(SUM(CASE WHEN status!='paid' THEN total ELSE 0 END), 0) AS unpaid_amount
    FROM invoices WHERE company_id=?
  `).get(company_id);

  return { transactions, invoices, summary: { ...txnAgg, ...invAgg } };
}

// ---------- 3. 报税信息（tax_filings + journal_entries） ----------
function getTax(company_id) {
  // tax_filings 使用 filing_type（不是 kind）和 period_end（不是 due_date）
  const filings = db.prepare(`
    SELECT * FROM tax_filings WHERE company_id=?
    ORDER BY period_end DESC, created_at DESC
  `).all(company_id);

  const journals = db.prepare(`
    SELECT * FROM journal_entries WHERE company_id=?
    ORDER BY entry_date DESC, created_at DESC LIMIT 100
  `).all(company_id);

  // 按类型聚合
  const byType = db.prepare(`
    SELECT filing_type AS kind, COUNT(*) AS count, status
    FROM tax_filings WHERE company_id=? GROUP BY filing_type, status
  `).all(company_id);

  // 即将到期（period_end 在 30 天内且未提交）
  const upcoming = db.prepare(`
    SELECT * FROM tax_filings
    WHERE company_id=? AND status!='submitted'
      AND period_end IS NOT NULL
      AND DATE(period_end) BETWEEN DATE('now') AND DATE('now','+30 days')
    ORDER BY period_end ASC
  `).all(company_id);

  return { filings, journals, by_type: byType, upcoming_deadlines: upcoming };
}

// ---------- 4. 财报（按年聚合 P&L / BS / CF） ----------
function getFinancialReports(company_id) {
  // 按年聚合收入/支出（从 transactions）
  const yearly = db.prepare(`
    SELECT
      substr(transaction_date, 1, 4) AS year,
      COUNT(*) AS txn_count,
      COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END), 0) AS expense,
      COALESCE(SUM(amount), 0) AS net_profit
    FROM transactions
    WHERE company_id=? AND transaction_date IS NOT NULL
    GROUP BY substr(transaction_date, 1, 4)
    ORDER BY year DESC
  `).all(company_id);

  // 按月聚合（最近 24 个月）
  const monthly = db.prepare(`
    SELECT
      substr(transaction_date, 1, 7) AS month,
      COUNT(*) AS txn_count,
      COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END), 0) AS expense
    FROM transactions
    WHERE company_id=? AND transaction_date IS NOT NULL
    GROUP BY substr(transaction_date, 1, 7)
    ORDER BY month DESC LIMIT 24
  `).all(company_id);

  // 已生成的财报 documents
  const reportDocs = db.prepare(`
    SELECT * FROM documents
    WHERE company_id=? AND (kind='report' OR kind='financial_report' OR kind='pnl' OR kind='balance_sheet' OR kind='cash_flow')
    ORDER BY created_at DESC
  `).all(company_id);

  return { yearly, monthly, report_documents: reportDocs };
}

// ---------- 5. 历史记录（文件 + 消息 + agent 执行） ----------
function getHistory(company_id, { limit = 50 } = {}) {
  const documents = db.prepare(`
    SELECT * FROM documents WHERE company_id=?
    ORDER BY created_at DESC LIMIT ?
  `).all(company_id, limit);

  // WhatsApp messages（通过 wa_channels join）
  const waMessages = db.prepare(`
    SELECT m.*, ch.wa_phone, ch.finance_token
    FROM wa_messages m
    LEFT JOIN wa_channels ch ON ch.id=m.channel_id
    WHERE m.company_id=? OR ch.company_id=?
    ORDER BY m.received_at DESC LIMIT ?
  `).all(company_id, company_id, limit);

  // Upload submissions（通过 upload_tokens join）
  const uploads = db.prepare(`
    SELECT s.*, t.label AS token_label, t.token AS token_code
    FROM upload_submissions s
    LEFT JOIN upload_tokens t ON t.token=s.token
    WHERE s.company_id=? OR t.company_id=?
    ORDER BY s.created_at DESC LIMIT ?
  `).all(company_id, company_id, limit);

  // Telegram 消息（通过 telegram_channels join）
  let tgMessages = [];
  try {
    tgMessages = db.prepare(`
      SELECT m.*, ch.tg_username, ch.tg_chat_id
      FROM telegram_messages m
      LEFT JOIN telegram_channels ch ON ch.id=m.channel_id
      WHERE ch.company_id=?
      ORDER BY m.received_at DESC LIMIT ?
    `).all(company_id, limit);
  } catch (e) { /* telegram 表可能还没数据 */ }

  // Agent 执行历史（agent_runs 使用 created_at，没有 started_at 列）
  const agentRuns = db.prepare(`
    SELECT * FROM agent_runs WHERE company_id=?
    ORDER BY created_at DESC LIMIT ?
  `).all(company_id, limit);

  return {
    documents,
    wa_messages: waMessages,
    uploads,
    tg_messages: tgMessages,
    agent_runs: agentRuns,
  };
}

// ---------- 6. 订阅 & 支付 & 提醒 ----------
function getSubscriptionAndPayments(company_id) {
  // payments 通过 user_id 关联（payments 表本身没有 company_id，改为根据 company.created_by 查）
  const company = db.prepare(`SELECT created_by FROM companies WHERE id=?`).get(company_id);
  const ownerId = company?.created_by || null;
  const payments = ownerId
    ? db.prepare(`SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(ownerId)
    : [];

  let reminders = [];
  try {
    reminders = db.prepare(`
      SELECT * FROM reminders WHERE company_id=?
      ORDER BY due_date ASC LIMIT 50
    `).all(company_id);
  } catch (e) {}

  const paymentAgg = ownerId ? db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status='success' OR status='paid' THEN amount_sgd ELSE 0 END), 0) AS paid_sum,
      COALESCE(SUM(CASE WHEN status='pending' THEN amount_sgd ELSE 0 END), 0) AS pending_sum
    FROM payments WHERE user_id=?
  `).get(ownerId) : { total: 0, paid_sum: 0, pending_sum: 0 };

  return { payments, reminders, summary: paymentAgg };
}

// ---------- 7. 统一时间线 ----------
function getTimeline(company_id, { limit = 100 } = {}) {
  // 把所有事件揉成一个时间线
  const events = [];

  // 公司创建
  const company = db.prepare(`SELECT id, name, created_at, status FROM companies WHERE id=?`).get(company_id);
  if (company) {
    events.push({ ts: company.created_at, type: 'company_created', title: `企业档案创建：${company.name}`, icon: '🏢', detail: `status=${company.status}` });
  }

  // Registration orders
  db.prepare(`SELECT id, stage, progress, created_at FROM registration_orders WHERE company_id=? ORDER BY created_at DESC`).all(company_id).forEach(r => {
    events.push({ ts: r.created_at, type: 'registration', title: `注册流程：${r.stage}`, icon: '📝', detail: `进度 ${Math.round((r.progress || 0) * 100)}%`, ref_id: r.id });
  });

  // KYC
  db.prepare(`
    SELECT k.id, k.status, k.created_at FROM kyc_sessions k
    JOIN persons p ON p.id = k.person_id
    WHERE p.company_id=? ORDER BY k.created_at DESC
  `).all(company_id).forEach(k => {
    events.push({ ts: k.created_at, type: 'kyc', title: `KYC 会话`, icon: '🪪', detail: `status=${k.status}`, ref_id: k.id });
  });

  // Invoices
  db.prepare(`SELECT id, vendor_name, total, currency, status, created_at FROM invoices WHERE company_id=? ORDER BY created_at DESC LIMIT 40`).all(company_id).forEach(i => {
    events.push({ ts: i.created_at, type: 'invoice', title: `发票：${i.vendor_name || '-'}`, icon: '🧾', detail: `${i.currency || 'SGD'} ${i.total || 0} · ${i.status}`, ref_id: i.id });
  });

  // Transactions (近 30 条)
  db.prepare(`SELECT id, transaction_date, amount, currency, description, created_at FROM transactions WHERE company_id=? ORDER BY created_at DESC LIMIT 30`).all(company_id).forEach(t => {
    const sign = (t.amount || 0) >= 0 ? '+' : '';
    events.push({ ts: t.created_at, type: 'transaction', title: `交易：${t.description || '-'}`, icon: t.amount >= 0 ? '💰' : '💸', detail: `${t.currency || 'SGD'} ${sign}${t.amount}`, ref_id: t.id });
  });

  // Tax filings
  db.prepare(`SELECT id, filing_type, status, period_end, created_at FROM tax_filings WHERE company_id=? ORDER BY created_at DESC`).all(company_id).forEach(f => {
    events.push({ ts: f.created_at, type: 'tax', title: `税务申报：${f.filing_type}`, icon: '🏛️', detail: `status=${f.status} · 期末 ${f.period_end || '-'}`, ref_id: f.id });
  });

  // Documents
  db.prepare(`SELECT id, kind, version, created_at FROM documents WHERE company_id=? ORDER BY created_at DESC LIMIT 30`).all(company_id).forEach(d => {
    events.push({ ts: d.created_at, type: 'document', title: `文件：${d.kind}`, icon: '📄', detail: `v${d.version || 1}`, ref_id: d.id });
  });

  // Upload submissions
  db.prepare(`SELECT s.id, s.file_count, s.classified_as, s.submitter_name, s.created_at, t.label AS token_label
              FROM upload_submissions s LEFT JOIN upload_tokens t ON t.token=s.token
              WHERE s.company_id=? ORDER BY s.created_at DESC LIMIT 30`).all(company_id).forEach(u => {
    events.push({ ts: u.created_at, type: 'upload', title: `上传：${u.token_label || '账单直传'}`, icon: '📤', detail: `${u.file_count} 文件 · ${u.classified_as || '-'} · by ${u.submitter_name || '匿名'}`, ref_id: u.id });
  });

  // WA messages
  db.prepare(`SELECT id, classified_as, ai_confidence, content, received_at FROM wa_messages WHERE company_id=? ORDER BY received_at DESC LIMIT 20`).all(company_id).forEach(m => {
    events.push({ ts: m.received_at, type: 'wa_message', title: `WhatsApp 消息`, icon: '💬', detail: `${m.classified_as || '-'} · conf ${((m.ai_confidence || 0) * 100).toFixed(0)}% · ${(m.content || '').slice(0, 30)}`, ref_id: m.id });
  });

  // Agent runs
  db.prepare(`SELECT id, agent_id, status, created_at FROM agent_runs WHERE company_id=? ORDER BY created_at DESC LIMIT 20`).all(company_id).forEach(r => {
    events.push({ ts: r.created_at, type: 'agent_run', title: `AI Agent 执行：${r.agent_id}`, icon: '🤖', detail: `status=${r.status}`, ref_id: r.id });
  });

  // Payments
  // payments 通过 company.created_by → user_id 关联
  const _pc = db.prepare(`SELECT created_by FROM companies WHERE id=?`).get(company_id);
  const _pUser = _pc?.created_by || null;
  (_pUser ? db.prepare(`SELECT id, amount_sgd AS amount, 'SGD' AS currency, status, created_at FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 20`).all(_pUser) : []).forEach(p => {
    events.push({ ts: p.created_at, type: 'payment', title: `支付 ${p.status}`, icon: '💳', detail: `${p.currency || 'SGD'} ${p.amount}`, ref_id: p.id });
  });

  // 按时间倒序
  events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return events.slice(0, limit);
}

// ---------- 8. 轻量摘要（列表页用） ----------
function getSummary(company_id) {
  const c = db.prepare(`SELECT id, name, uen, status, subscription_tier, segment, created_at FROM companies WHERE id=?`).get(company_id);
  if (!c) return null;

  const txn = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END), 0) rev, COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END), 0) exp FROM transactions WHERE company_id=?`).get(company_id);
  const inv = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total), 0) total FROM invoices WHERE company_id=?`).get(company_id);
  const doc = db.prepare(`SELECT COUNT(*) n FROM documents WHERE company_id=?`).get(company_id);
  const tax = db.prepare(`SELECT COUNT(*) n FROM tax_filings WHERE company_id=?`).get(company_id);
  const up  = db.prepare(`SELECT COUNT(*) n FROM upload_submissions WHERE company_id=?`).get(company_id);
  const uTok = db.prepare(`SELECT COUNT(*) n FROM upload_tokens WHERE company_id=? AND status='active'`).get(company_id);
  const runs = db.prepare(`SELECT COUNT(*) n FROM agent_runs WHERE company_id=?`).get(company_id);
  const last = db.prepare(`SELECT MAX(created_at) ts FROM (
    SELECT created_at FROM transactions WHERE company_id=?
    UNION ALL SELECT created_at FROM invoices WHERE company_id=?
    UNION ALL SELECT created_at FROM documents WHERE company_id=?
    UNION ALL SELECT created_at FROM upload_submissions WHERE company_id=?
  )`).get(company_id, company_id, company_id, company_id);

  return {
    ...c,
    stats: {
      transactions: txn.n,
      revenue:      txn.rev,
      expense:      txn.exp,
      invoices:     inv.n,
      invoice_total: inv.total,
      documents:    doc.n,
      tax_filings:  tax.n,
      upload_submissions: up.n,
      active_upload_tokens: uTok.n,
      agent_runs:   runs.n,
    },
    last_activity_at: last?.ts || c.created_at,
  };
}

// ---------- 9. 一次性拉全档案（详情页用） ----------
function getFullArchive(company_id) {
  const basic = getBasicInfo(company_id);
  if (!basic) return null;
  return {
    ...basic,
    expenses:  getExpenses(company_id),
    tax:       getTax(company_id),
    reports:   getFinancialReports(company_id),
    history:   getHistory(company_id),
    billing:   getSubscriptionAndPayments(company_id),
    timeline:  getTimeline(company_id, { limit: 80 }),
    summary:   getSummary(company_id),
  };
}

// ---------- 10. 列出所有公司 + 摘要（Admin 首屏） ----------
function listAllCompaniesWithSummary({ limit = 200 } = {}) {
  const rows = db.prepare(`
    SELECT id FROM companies ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  return rows.map(r => getSummary(r.id)).filter(Boolean);
}

// ---------- 11. 档案快照（冻结当前时刻的档案，写入 documents 表） ----------
function createSnapshot(company_id, { snapshot_name = null, created_by = null } = {}) {
  const archive = getFullArchive(company_id);
  if (!archive) throw new Error('company not found');
  const { v4: uuid } = require('uuid');
  const id = 'doc_snap_' + uuid().slice(0, 8);
  const name = snapshot_name || `Archive Snapshot ${new Date().toISOString().slice(0, 19)}`;

  // 把完整档案 JSON 存到 documents 表（kind=archive_snapshot）
  const json = JSON.stringify(archive);
  db.prepare(`
    INSERT INTO documents(id, company_id, kind, version, file_path, content, generated_by_ai, created_at)
    VALUES(?, ?, 'archive_snapshot', 1, ?, ?, 0, CURRENT_TIMESTAMP)
  `).run(id, company_id, `archive://${company_id}/${id}`, json);
  return { ok: true, snapshot_id: id, name, size_bytes: json.length };
}

module.exports = {
  getBasicInfo,
  getExpenses,
  getTax,
  getFinancialReports,
  getHistory,
  getSubscriptionAndPayments,
  getTimeline,
  getSummary,
  getFullArchive,
  listAllCompaniesWithSummary,
  createSnapshot,
};
