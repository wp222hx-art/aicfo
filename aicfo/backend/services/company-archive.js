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

// ---------- 11. 档案快照（真打快照：JSON + CSV + HTML 全部落盘 + 写 documents 表） ----------
function createSnapshot(company_id, { snapshot_name = null, created_by = null } = {}) {
  const archive = getFullArchive(company_id);
  if (!archive) throw new Error('company not found');
  const { v4: uuid } = require('uuid');
  const fs = require('fs');
  const path = require('path');

  const snapshotId = 'snap_' + uuid().slice(0, 8);
  const ts = new Date();
  const name = snapshot_name || `${archive.company.name || company_id} · ${ts.toISOString().slice(0, 19)}`;

  // 确保快照目录
  const snapDir = path.join(__dirname, '..', '..', 'data', 'snapshots', company_id, snapshotId);
  fs.mkdirSync(snapDir, { recursive: true });

  // 生成三种产物
  const json = JSON.stringify(archive, null, 2);
  const csv  = exportCSV(company_id);
  const html = exportPrintableHTML(company_id);

  // 写文件
  const jsonPath = path.join(snapDir, 'archive.json');
  const csvPath  = path.join(snapDir, 'archive.csv');
  const htmlPath = path.join(snapDir, 'archive.html');
  fs.writeFileSync(jsonPath, json, 'utf-8');
  fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf-8'); // BOM for Excel
  fs.writeFileSync(htmlPath, html, 'utf-8');

  // 计算摘要指标（写入 content 让后续对比更快）
  const s = (archive.summary && archive.summary.stats) || {};
  const summaryForDiff = {
    snapshot_id: snapshotId,
    snapshot_name: name,
    created_at: ts.toISOString(),
    created_by,
    json_bytes: json.length,
    csv_bytes: csv.length,
    html_bytes: html.length,
    metrics: {
      transactions: s.transactions || 0,
      revenue: s.revenue || 0,
      expense: s.expense || 0,
      invoice_count: s.invoices || 0,
      invoice_total: s.invoice_total || 0,
      document_count: s.documents || 0,
      tax_filings: s.tax_filings || 0,
      upload_submissions: s.upload_submissions || 0,
      last_activity_at: archive.summary?.last_activity_at || null,
    },
  };

  // 写 documents 表（一行记录代表一次快照，JSON content 含 metrics + file paths）
  const docId = 'doc_' + snapshotId;
  const content = JSON.stringify({
    ...summaryForDiff,
    files: {
      json: `/api/admin/archive/company/${company_id}/snapshot/${snapshotId}/archive.json`,
      csv:  `/api/admin/archive/company/${company_id}/snapshot/${snapshotId}/archive.csv`,
      html: `/api/admin/archive/company/${company_id}/snapshot/${snapshotId}/archive.html`,
    },
  });
  db.prepare(`
    INSERT INTO documents(id, company_id, kind, version, file_path, content, generated_by_ai, created_at)
    VALUES(?, ?, 'archive_snapshot', 1, ?, ?, 0, CURRENT_TIMESTAMP)
  `).run(docId, company_id, snapDir, content);

  return {
    ok: true,
    snapshot_id: snapshotId,
    name,
    created_at: ts.toISOString(),
    size_bytes: json.length,
    csv_bytes: csv.length,
    html_bytes: html.length,
    files: {
      json: `/api/admin/archive/company/${company_id}/snapshot/${snapshotId}/archive.json`,
      csv:  `/api/admin/archive/company/${company_id}/snapshot/${snapshotId}/archive.csv`,
      html: `/api/admin/archive/company/${company_id}/snapshot/${snapshotId}/archive.html`,
    },
    metrics: summaryForDiff.metrics,
  };
}

// ---------- 11b. 快照列表 ----------
function listSnapshots(company_id) {
  const rows = db.prepare(`
    SELECT id, file_path, content, created_at
    FROM documents
    WHERE company_id=? AND kind='archive_snapshot'
    ORDER BY created_at DESC
    LIMIT 200
  `).all(company_id);
  return rows.map(r => {
    let meta = null;
    try { meta = JSON.parse(r.content || '{}'); } catch (e) { meta = {}; }
    return {
      doc_id: r.id,
      snapshot_id: meta.snapshot_id || r.id,
      name: meta.snapshot_name || r.id,
      created_at: meta.created_at || r.created_at,
      created_by: meta.created_by || null,
      json_bytes: meta.json_bytes || 0,
      csv_bytes: meta.csv_bytes || 0,
      html_bytes: meta.html_bytes || 0,
      metrics: meta.metrics || null,
      files: meta.files || null,
      file_path: r.file_path,
    };
  });
}

// ---------- 11c. 读取快照原始 JSON 用于对比 ----------
function getSnapshotArchive(company_id, snapshot_id) {
  const fs = require('fs');
  const path = require('path');
  const row = db.prepare(`
    SELECT file_path, content FROM documents
    WHERE company_id=? AND kind='archive_snapshot' AND (id=? OR id='doc_'||?)
    LIMIT 1
  `).get(company_id, snapshot_id, snapshot_id);
  if (!row) return null;
  const jsonPath = path.join(row.file_path, 'archive.json');
  if (!fs.existsSync(jsonPath)) return null;
  try { return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); }
  catch (e) { return null; }
}

// ---------- 11d. 比较两个快照 ----------
function diffSnapshots(company_id, snap_a_id, snap_b_id) {
  const list = listSnapshots(company_id);
  const a = list.find(s => s.snapshot_id === snap_a_id || s.doc_id === snap_a_id);
  const b = list.find(s => s.snapshot_id === snap_b_id || s.doc_id === snap_b_id);
  if (!a || !b) return { ok: false, error: 'snapshot not found' };
  const mA = a.metrics || {};
  const mB = b.metrics || {};
  const keys = ['transactions', 'revenue', 'expense', 'invoice_count', 'invoice_total', 'document_count', 'tax_filings', 'upload_submissions'];
  const diff = keys.map(k => ({
    metric: k,
    a: mA[k] || 0,
    b: mB[k] || 0,
    delta: (mB[k] || 0) - (mA[k] || 0),
  }));
  return {
    ok: true,
    a: { snapshot_id: a.snapshot_id, name: a.name, created_at: a.created_at, metrics: mA },
    b: { snapshot_id: b.snapshot_id, name: b.name, created_at: b.created_at, metrics: mB },
    diff,
  };
}

// ---------- 11e. 返回快照文件（JSON/CSV/HTML）----------
function getSnapshotFile(company_id, snapshot_id, fname) {
  const fs = require('fs');
  const path = require('path');
  if (!['archive.json', 'archive.csv', 'archive.html'].includes(fname)) return null;
  const row = db.prepare(`
    SELECT file_path FROM documents
    WHERE company_id=? AND kind='archive_snapshot' AND (id=? OR id='doc_'||?)
    LIMIT 1
  `).get(company_id, snapshot_id, snapshot_id);
  if (!row) return null;
  const fp = path.join(row.file_path, fname);
  if (!fs.existsSync(fp)) return null;
  return { path: fp, content: fs.readFileSync(fp, 'utf-8') };
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
  listSnapshots,
  getSnapshotArchive,
  diffSnapshots,
  getSnapshotFile,
  exportCSV,
  exportPrintableHTML,
  getAnalytics,
  getExpensesFiltered,
};

// ---------- 14. 按年/月筛选消费记录 ----------
function getExpensesFiltered(company_id, { year = null, month = null, vendor = null, limit = 500 } = {}) {
  const whereParts = ['company_id=?'];
  const params = [company_id];
  if (year) {
    whereParts.push(`(strftime('%Y', COALESCE(transaction_date, created_at))=? OR strftime('%Y', created_at)=?)`);
    params.push(String(year), String(year));
  }
  if (month && year) {
    const mm = String(month).padStart(2, '0');
    whereParts.push(`(strftime('%m', COALESCE(transaction_date, created_at))=? OR strftime('%m', created_at)=?)`);
    params.push(mm, mm);
  }
  const txnWhere = whereParts.join(' AND ');
  const transactions = db.prepare(
    `SELECT * FROM transactions WHERE ${txnWhere} ORDER BY COALESCE(transaction_date, created_at) DESC LIMIT ?`
  ).all(...params, limit);

  // 发票: 用 issue_date 筛选
  const invParts = ['company_id=?'];
  const invParams = [company_id];
  if (year) {
    invParts.push(`(strftime('%Y', COALESCE(issue_date, created_at))=? OR strftime('%Y', created_at)=?)`);
    invParams.push(String(year), String(year));
  }
  if (month && year) {
    const mm = String(month).padStart(2, '0');
    invParts.push(`(strftime('%m', COALESCE(issue_date, created_at))=? OR strftime('%m', created_at)=?)`);
    invParams.push(mm, mm);
  }
  if (vendor) {
    invParts.push(`vendor_name LIKE ?`);
    invParams.push(`%${vendor}%`);
  }
  const invoices = db.prepare(
    `SELECT * FROM invoices WHERE ${invParts.join(' AND ')} ORDER BY COALESCE(issue_date, created_at) DESC LIMIT ?`
  ).all(...invParams, limit);

  return { transactions, invoices, filter: { year, month, vendor } };
}

// ---------- 15. 分析聚合：按供应商 + 按分类 + 按月份 + 可用年份 ----------
function getAnalytics(company_id, { year = null } = {}) {
  // 可用的年份列表（用于下拉）
  const yearsRaw = db.prepare(`
    SELECT DISTINCT y FROM (
      SELECT strftime('%Y', COALESCE(issue_date, created_at)) AS y FROM invoices WHERE company_id=?
      UNION
      SELECT strftime('%Y', COALESCE(transaction_date, created_at)) AS y FROM transactions WHERE company_id=?
    ) WHERE y IS NOT NULL ORDER BY y DESC
  `).all(company_id, company_id);
  const years = yearsRaw.map(r => r.y).filter(Boolean);

  // 年份过滤条件
  const yf = year ? `AND strftime('%Y', COALESCE(issue_date, created_at))='${year}'` : '';
  const ytf = year ? `AND strftime('%Y', COALESCE(transaction_date, created_at))='${year}'` : '';

  // 1) 按供应商汇总 (invoices.vendor_name)
  const byVendor = db.prepare(`
    SELECT
      COALESCE(TRIM(vendor_name), '(未知)') AS vendor,
      COUNT(*) AS count,
      COALESCE(SUM(total), 0) AS total_amount,
      COALESCE(SUM(gst_amount), 0) AS total_gst,
      COALESCE(AVG(total), 0) AS avg_amount,
      MAX(issue_date) AS last_invoice_date
    FROM invoices WHERE company_id=? ${yf}
    GROUP BY COALESCE(TRIM(vendor_name), '(未知)')
    ORDER BY total_amount DESC
    LIMIT 50
  `).all(company_id);

  // 2) 按分类（wa_messages.classified_as + documents.kind）汇总
  const byCategory = db.prepare(`
    SELECT classified_as AS category, COUNT(*) AS count
    FROM wa_messages WHERE company_id=? ${year ? `AND strftime('%Y', received_at)='${year}'` : ''}
    GROUP BY classified_as
    ORDER BY count DESC
  `).all(company_id);

  // 3) 文档按 kind 分布
  const byDocKind = db.prepare(`
    SELECT kind, COUNT(*) AS count
    FROM documents WHERE company_id=? ${year ? `AND strftime('%Y', created_at)='${year}'` : ''}
    GROUP BY kind
    ORDER BY count DESC
  `).all(company_id);

  // 4) 按月份聚合（发票金额 + 交易）
  const byMonth = db.prepare(`
    SELECT
      strftime('%Y-%m', COALESCE(issue_date, created_at)) AS ym,
      COUNT(*) AS inv_count,
      COALESCE(SUM(total), 0) AS inv_total,
      COALESCE(SUM(gst_amount), 0) AS gst_total
    FROM invoices WHERE company_id=? ${yf}
    GROUP BY ym ORDER BY ym ASC
  `).all(company_id);

  const byMonthTxn = db.prepare(`
    SELECT
      strftime('%Y-%m', COALESCE(transaction_date, created_at)) AS ym,
      COUNT(*) AS txn_count,
      COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END), 0) AS expense
    FROM transactions WHERE company_id=? ${ytf}
    GROUP BY ym ORDER BY ym ASC
  `).all(company_id);

  // 合并同月数据
  const monthMap = new Map();
  for (const m of byMonth) monthMap.set(m.ym, { ym: m.ym, inv_count: m.inv_count, inv_total: m.inv_total, gst_total: m.gst_total, txn_count: 0, revenue: 0, expense: 0 });
  for (const t of byMonthTxn) {
    const existing = monthMap.get(t.ym) || { ym: t.ym, inv_count: 0, inv_total: 0, gst_total: 0 };
    existing.txn_count = t.txn_count;
    existing.revenue = t.revenue;
    existing.expense = t.expense;
    monthMap.set(t.ym, existing);
  }
  const monthly = Array.from(monthMap.values()).sort((a, b) => a.ym.localeCompare(b.ym));

  // 5) 总计
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS invoice_count,
      COALESCE(SUM(total), 0) AS invoice_total,
      COALESCE(SUM(gst_amount), 0) AS gst_total
    FROM invoices WHERE company_id=? ${yf}
  `).get(company_id);

  return {
    year: year || null,
    years_available: years,
    totals,
    by_vendor: byVendor,
    by_category: byCategory,
    by_doc_kind: byDocKind,
    by_month: monthly,
  };
}

// ---------- 12. CSV 导出（支持按节选择） ----------
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}
function rowsToCSV(headers, rows) {
  const out = [headers.map(csvEscape).join(',')];
  for (const r of rows) out.push(headers.map(h => csvEscape(r[h])).join(','));
  return out.join('\n');
}

function exportCSV(company_id, section = 'all') {
  const a = getFullArchive(company_id);
  if (!a) return null;
  const sections = {};

  sections.invoices = rowsToCSV(
    ['id', 'invoice_number', 'vendor_name', 'issue_date', 'total', 'gst_amount', 'currency', 'status', 'ocr_confidence', 'image_url', 'created_at'],
    a.expenses.invoices
  );
  sections.transactions = rowsToCSV(
    ['id', 'transaction_date', 'amount', 'currency', 'description', 'counterparty', 'reference', 'created_at'],
    a.expenses.transactions
  );
  sections.tax_filings = rowsToCSV(
    ['id', 'filing_type', 'ya', 'period_start', 'period_end', 'revenue', 'chargeable_income', 'tax_payable', 'status', 'created_at'],
    a.tax.filings
  );
  sections.documents = rowsToCSV(
    ['id', 'kind', 'version', 'file_path', 'generated_by_ai', 'created_at'],
    a.history.documents
  );
  sections.uploads = rowsToCSV(
    ['id', 'token', 'submitter_name', 'submitter_phone', 'file_count', 'classified_as', 'note', 'created_at'],
    a.history.uploads
  );
  sections.wa_messages = rowsToCSV(
    ['id', 'direction', 'msg_type', 'content', 'classified_as', 'ai_confidence', 'ai_summary', 'media_url', 'received_at'],
    a.history.wa_messages
  );
  sections.payments = rowsToCSV(
    ['id', 'amount_sgd', 'method', 'status', 'gateway_ref', 'paid_at', 'created_at'],
    a.billing.payments
  );
  sections.timeline = rowsToCSV(
    ['ts', 'type', 'title', 'detail', 'ref_id'],
    a.timeline
  );

  if (section !== 'all' && sections[section]) {
    return { company: a.company, filename: `${a.company.id}_${section}.csv`, body: sections[section] };
  }
  // all → 把所有节合并为一份多节 CSV（每节之间加空行和表头注释）
  const parts = [];
  parts.push(`# AiCFO Archive Export — ${a.company.name} (${a.company.id})`);
  parts.push(`# Generated at: ${new Date().toISOString()}`);
  parts.push('');
  for (const [name, body] of Object.entries(sections)) {
    parts.push(`# ===== ${name.toUpperCase()} =====`);
    parts.push(body);
    parts.push('');
  }
  return { company: a.company, filename: `${a.company.id}_archive_full.csv`, body: parts.join('\n') };
}

// ---------- 13. 可打印 HTML（客户端可另存为 PDF） ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function exportPrintableHTML(company_id) {
  const a = getFullArchive(company_id);
  if (!a) return null;
  const c = a.company;
  const s = a.expenses.summary;
  const ownerName = a.owner?.name || a.owner?.email || '-';

  const invRows = a.expenses.invoices.slice(0, 200).map(i => `
    <tr>
      <td>${i.image_url ? `<img src="${esc(i.image_url)}" style="width:40px;height:40px;object-fit:cover;border:1px solid #ccc">` : ''}</td>
      <td>${esc(i.invoice_number || i.id)}</td>
      <td>${esc(i.vendor_name || '-')}</td>
      <td>${esc(i.issue_date || '-')}</td>
      <td style="text-align:right">${esc(i.currency || 'SGD')} ${(i.total || 0).toFixed(2)}</td>
      <td style="text-align:right">${(i.gst_amount || 0).toFixed(2)}</td>
      <td>${esc(i.status)}</td>
    </tr>`).join('');

  const txnRows = a.expenses.transactions.slice(0, 200).map(t => `
    <tr>
      <td>${esc(t.transaction_date || '-')}</td>
      <td style="text-align:right;color:${t.amount >= 0 ? 'green' : 'red'}">${(t.amount || 0).toFixed(2)}</td>
      <td>${esc(t.description || '-')}</td>
      <td>${esc(t.counterparty || '-')}</td>
    </tr>`).join('');

  const taxRows = a.tax.filings.slice(0, 50).map(f => `
    <tr>
      <td>${esc(f.filing_type || '-')}</td>
      <td>${esc(f.ya || '-')}</td>
      <td>${esc(f.period_end || '-')}</td>
      <td style="text-align:right">${(f.revenue || 0).toFixed(2)}</td>
      <td style="text-align:right">${(f.tax_payable || 0).toFixed(2)}</td>
      <td>${esc(f.status)}</td>
    </tr>`).join('');

  const docRows = a.history.documents.slice(0, 50).map(d => `
    <tr>
      <td>${esc(d.kind)}</td>
      <td>v${d.version || 1}</td>
      <td style="font-family:monospace;font-size:11px">${esc((d.file_path || '').slice(0, 60))}</td>
      <td>${esc((d.created_at || '').slice(0, 16))}</td>
    </tr>`).join('');

  const timelineRows = a.timeline.slice(0, 80).map(e => `
    <tr>
      <td>${esc((e.ts || '').slice(0, 16))}</td>
      <td>${e.icon || ''} ${esc(e.type || '')}</td>
      <td>${esc(e.title || '')}</td>
      <td>${esc(e.detail || '')}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>档案导出 · ${esc(c.name)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#111;max-width:1000px;margin:20px auto;padding:0 20px;background:#fff}
  h1{font-size:24px;margin:0 0 4px}
  h2{font-size:16px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid #333}
  .muted{color:#666;font-size:12px}
  table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:12px}
  th,td{border:1px solid #ddd;padding:5px 8px;vertical-align:top}
  th{background:#f5f5f5;font-weight:600;text-align:left}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}
  .card{border:1px solid #ddd;padding:10px;border-radius:6px}
  .card .lbl{color:#666;font-size:11px}
  .card .val{font-size:18px;font-weight:700}
  .toolbar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #eee;margin-bottom:10px;display:flex;gap:8px}
  .toolbar button{padding:6px 14px;border:1px solid #333;background:#111;color:#fff;border-radius:6px;cursor:pointer;font-size:13px}
  @media print { .toolbar{display:none} body{margin:0;padding:0} h2{page-break-before:auto} table{page-break-inside:auto} tr{page-break-inside:avoid} }
</style></head><body>
<div class="toolbar">
  <button onclick="window.print()">🖨️ 打印 / 保存为 PDF</button>
  <button onclick="history.back()" style="background:#fff;color:#111">← 返回</button>
  <span class="muted" style="align-self:center">提示：点"打印"后选择"另存为 PDF"即可导出 PDF</span>
</div>

<h1>🏢 ${esc(c.name)}</h1>
<div class="muted">UEN: ${esc(c.uen || '-')} · 状态: <b>${esc(c.status)}</b> · 订阅: ${esc(c.subscription_tier || 'basic')} · 细分: ${esc(c.segment || '')} · 创建于 ${esc((c.created_at || '').slice(0, 10))}</div>
<div class="muted">负责人: ${esc(ownerName)} · 导出时间: ${new Date().toLocaleString('zh-SG')}</div>

<div class="summary">
  <div class="card"><div class="lbl">总收入</div><div class="val" style="color:#10b981">S$ ${(s.total_income || 0).toFixed(2)}</div></div>
  <div class="card"><div class="lbl">总支出</div><div class="val" style="color:#ef4444">S$ ${(s.total_expense || 0).toFixed(2)}</div></div>
  <div class="card"><div class="lbl">净现金流</div><div class="val">S$ ${(s.net_cashflow || 0).toFixed(2)}</div></div>
  <div class="card"><div class="lbl">发票总额</div><div class="val">S$ ${(s.total_invoice_amount || 0).toFixed(2)}</div></div>
</div>

<h2>🧾 发票 (${a.expenses.invoices.length})</h2>
${invRows ? `<table><thead><tr><th>原件</th><th>发票号</th><th>供应商</th><th>日期</th><th>金额</th><th>GST</th><th>状态</th></tr></thead><tbody>${invRows}</tbody></table>` : '<p class="muted">无</p>'}

<h2>💸 交易流水 (${a.expenses.transactions.length})</h2>
${txnRows ? `<table><thead><tr><th>日期</th><th>金额</th><th>描述</th><th>对方</th></tr></thead><tbody>${txnRows}</tbody></table>` : '<p class="muted">无</p>'}

<h2>🏛️ 税务申报 (${a.tax.filings.length})</h2>
${taxRows ? `<table><thead><tr><th>类型</th><th>YA</th><th>期末</th><th>营收</th><th>应纳</th><th>状态</th></tr></thead><tbody>${taxRows}</tbody></table>` : '<p class="muted">暂无申报</p>'}

<h2>📄 文档记录 (${a.history.documents.length})</h2>
${docRows ? `<table><thead><tr><th>类型</th><th>版本</th><th>路径</th><th>创建</th></tr></thead><tbody>${docRows}</tbody></table>` : '<p class="muted">无</p>'}

<h2>⏰ 时间线 (最近 ${Math.min(80, a.timeline.length)} 条)</h2>
${timelineRows ? `<table><thead><tr><th style="width:140px">时间</th><th style="width:120px">类型</th><th>标题</th><th>详情</th></tr></thead><tbody>${timelineRows}</tbody></table>` : '<p class="muted">无</p>'}

<div style="margin-top:30px;padding-top:10px;border-top:1px solid #ddd;text-align:center;color:#999;font-size:11px">
  AiCFO Company Archive · ${c.id} · 本文档包含原始数据镜像，请妥善保管
</div>
</body></html>`;
}
