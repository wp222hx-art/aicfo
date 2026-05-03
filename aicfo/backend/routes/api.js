// AiCFO REST API routes
const express = require('express');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const db = require('../db/schema');
const llm = require('../services/llm');
const rag = require('../../rag/engine');
const orchestrator = require('../../agents/orchestrator');
const finance = require('../services/finance');
const simulation = require('../services/simulation');
const aiChat = require('../services/ai-chat');
const aiKB   = require('../services/ai-kb-builder');
const fileIngest = require('../services/file-ingest');
const waBot = require('../services/wa-bot');
const waMeta = require('../services/wa-meta');
const uploadPortal = require('../services/upload-portal');
const tgBot = require('../services/telegram-bot');
const subs  = require('../services/subscription');
const llmGateway = require('../services/llm-gateway');
const sgRegistry = require('../services/sg-registry');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ---------- Health ----------
router.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now(), service: 'aicfo-platform' }));

// ---------- Auth (simplified demo auth via email) ----------
router.post('/auth/login', (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare(`SELECT * FROM users WHERE email=?`).get(email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  delete user.password_hash;
  res.json({ user, token: `demo_${user.id}` });
});

router.get('/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const userId = token.replace('demo_', '');
  const user = db.prepare(`SELECT id,email,name,role,kyc_status FROM users WHERE id=?`).get(userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user });
});

// ---------- Companies ----------
router.get('/companies', (req, res) => {
  const rows = db.prepare(`SELECT * FROM companies ORDER BY created_at DESC`).all();
  res.json(rows);
});

router.get('/companies/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM companies WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const persons = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(row.id);
  const reminders = db.prepare(`SELECT * FROM reminders WHERE company_id=? ORDER BY due_date`).all(row.id);
  res.json({ ...row, persons, reminders });
});

// ---------- Registration ----------
router.post('/registration/name-check', async (req, res) => {
  const { proposed_name, suffix = 'Pte Ltd' } = req.body || {};
  const full = `${proposed_name} ${suffix}`;

  // 1) ACRA / BizFile 官方可用性检查（mock/sandbox/live 由后台配置切换）
  let registryResult = null;
  try {
    registryResult = await sgRegistry.checkCompanyName(full);
  } catch (e) {
    registryResult = { ok: false, source: 'error', available: null, reason: e.message };
  }

  // 2) LLM 合规判断（关键字/敏感词/Companies Act Section 27）
  const llmResult = await Promise.resolve(llm.complete({
    schema: 'name_compliance',
    context: { name: full, suffix, registry_hint: registryResult },
    messages: [{ role: 'user', content: full }]
  }));
  const verdict = llmResult.verdict || llmResult.compliance_verdict || 'pass';
  const alternatives = llmResult.alternatives || llmResult.alternative_suggestions || [];

  // 3) 只有 ACRA 可用 + LLM 合规 pass 两者都通过才算 available
  const acraAvailable = registryResult?.available !== false;
  const finalAvailable = acraAvailable && verdict === 'pass';

  res.json({
    proposed_name: full,
    available: finalAvailable,
    verdict,
    confidence: llmResult.confidence,
    reasoning: llmResult.reasoning,
    reasoning_cn: llmResult.reasoning_cn,
    alternatives: alternatives.length ? alternatives : (registryResult?.suggestions || []),
    regulatory_refs: llmResult.regulatory_refs || ['Companies Act Section 27'],
    registry: registryResult,          // 真/模拟 ACRA 响应
    _model: llmResult._model || 'sim',
    checked_at: new Date().toISOString()
  });
});

router.post('/registration/orders', (req, res) => {
  const body = req.body || {};
  const orderId = `ord_${uuid().slice(0, 8)}`;
  const companyId = `co_${uuid().slice(0, 8)}`;
  const userId = body.user_id || 'usr_demo_001';

  db.prepare(`INSERT INTO companies (id,name,status,fye,ssic_codes,paid_up_capital,currency,segment,created_by)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    companyId, body.company_name, 'draft',
    body.financial_year_end || '12-31',
    (body.ssic_codes || []).join(','),
    body.paid_up_capital?.amount || 1000,
    body.paid_up_capital?.currency || 'SGD',
    body.segment || 'local_sg', userId
  );

  (body.shareholders || []).forEach(s => {
    db.prepare(`INSERT INTO persons (id,company_id,role,type,full_name,nric_fin,passport_no,nationality,shares_held)
                VALUES (?,?,?,?,?,?,?,?,?)`).run(
      `per_${uuid().slice(0, 8)}`, companyId,
      s.is_director ? 'shareholder,director' : 'shareholder',
      s.type || 'individual', s.name, s.nric_fin || null, s.passport_no || null,
      s.nationality || 'SGP', s.shares || 0
    );
  });

  const price = body.price || 388;
  const timeline = [
    { stage: 'created', at: new Date().toISOString(), status: 'done' },
    { stage: 'kyc', status: 'pending' },
    { stage: 'constitution', status: 'pending' },
    { stage: 'signed', status: 'pending' },
    { stage: 'reviewing', status: 'pending' },
    { stage: 'bizfile', status: 'pending' },
    { stage: 'uen_issued', status: 'pending' },
    { stage: 'completed', status: 'pending' }
  ];
  db.prepare(`INSERT INTO registration_orders (id,company_id,user_id,stage,progress,price_sgd,timeline)
              VALUES (?,?,?,?,?,?,?)`).run(
    orderId, companyId, userId, 'created', 0.125, price, JSON.stringify(timeline)
  );

  res.json({ order_id: orderId, company_id: companyId, stage: 'created', price_sgd: price, timeline });
});

router.get('/registration/orders/:id', (req, res) => {
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(order.company_id);
  const persons = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(order.company_id);
  order.timeline = JSON.parse(order.timeline || '[]');
  res.json({ ...order, company, persons });
});

router.get('/registration/orders', (req, res) => {
  const { stage, user_id } = req.query;
  let q = `SELECT o.*, c.name AS company_name FROM registration_orders o
           LEFT JOIN companies c ON c.id = o.company_id WHERE 1=1`;
  const params = [];
  if (stage) { q += ` AND o.stage=?`; params.push(stage); }
  if (user_id) { q += ` AND o.user_id=?`; params.push(user_id); }
  q += ` ORDER BY o.created_at DESC`;
  res.json(db.prepare(q).all(...params).map(r => ({ ...r, timeline: JSON.parse(r.timeline || '[]') })));
});

router.post('/registration/orders/:id/advance', (req, res) => {
  // Advance stage by one step (demo helper)
  const { next_stage } = req.body || {};
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const timeline = JSON.parse(order.timeline || '[]');
  const stages = ['created', 'kyc', 'constitution', 'signed', 'reviewing', 'bizfile', 'uen_issued', 'completed'];
  const target = next_stage || stages[Math.min(stages.indexOf(order.stage) + 1, stages.length - 1)];
  const idx = stages.indexOf(target);
  timeline.forEach((t, i) => {
    if (i < idx) t.status = 'done';
    else if (i === idx) { t.status = 'in_progress'; t.at = new Date().toISOString(); }
  });
  if (target === 'completed') {
    // Issue UEN
    const uen = `${new Date().getFullYear()}${Math.floor(100000 + Math.random() * 900000)}K`;
    db.prepare(`UPDATE companies SET uen=?, status='active' WHERE id=?`).run(uen, order.company_id);
    timeline.forEach(t => t.status = 'done');
  }
  const progress = Math.min(1, (idx + 1) / stages.length);
  db.prepare(`UPDATE registration_orders SET stage=?, progress=?, timeline=? WHERE id=?`)
    .run(target, progress, JSON.stringify(timeline), req.params.id);
  res.json({ ok: true, stage: target, progress, timeline });
});

router.post('/registration/orders/:id/constitution', async (req, res) => {
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(order.company_id);
  const shareholders = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(order.company_id);
  const constitution = await Promise.resolve(llm.complete({
    schema: 'constitution',
    context: { company_name: company.name, capital: company.paid_up_capital, shareholders, business: company.ssic_codes },
    messages: [{ role: 'user', content: `Draft constitution for ${company.name}` }]
  }));
  const docId = `doc_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO documents (id,company_id,kind,version,generated_by_ai,content)
              VALUES (?,?,?,?,?,?)`).run(docId, company.id, 'constitution', 1, 1, JSON.stringify(constitution));
  res.json({ document_id: docId, constitution });
});

// ---------- KYC ----------
router.post('/kyc/initiate', (req, res) => {
  const { person_id, method } = req.body || {};
  const sessionId = `kyc_${uuid().slice(0, 8)}`;
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO kyc_sessions (id,person_id,method,status,expires_at)
              VALUES (?,?,?,?,?)`).run(sessionId, person_id, method, 'pending', expires);
  const payload = { kyc_session_id: sessionId, expires_at: expires };
  if (method === 'singpass') payload.singpass_qr_url = `https://api.singpass.gov.sg/auth?state=${sessionId}`;
  else payload.upload_hint = 'Please capture passport photo + record 3-second liveness video';
  res.json(payload);
});

router.post('/kyc/complete', (req, res) => {
  const { kyc_session_id } = req.body || {};
  const session = db.prepare(`SELECT * FROM kyc_sessions WHERE id=?`).get(kyc_session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const livenessScore = 0.85 + Math.random() * 0.14;
  const amlResult = { hits: 0, status: 'clear', provider: 'DowJonesRiskCenter' };
  db.prepare(`UPDATE kyc_sessions SET liveness_score=?, aml_screening_result=?, status=? WHERE id=?`)
    .run(livenessScore, JSON.stringify(amlResult), 'passed', kyc_session_id);
  if (session.person_id) {
    db.prepare(`UPDATE persons SET kyc_session_id=? WHERE id=?`).run(kyc_session_id, session.person_id);
  }
  res.json({ ok: true, status: 'passed', liveness_score: +livenessScore.toFixed(2), aml: amlResult });
});

// ---------- Bookkeeping ----------
router.get('/books/transactions', (req, res) => {
  const { company_id, limit = 100 } = req.query;
  let q = `SELECT * FROM transactions`;
  const params = [];
  if (company_id) { q += ` WHERE company_id=?`; params.push(company_id); }
  q += ` ORDER BY transaction_date DESC LIMIT ?`;
  params.push(Number(limit));
  res.json(db.prepare(q).all(...params));
});

router.post('/books/transactions/import', upload.single('file'), (req, res) => {
  const { company_id, bank_code = 'DBS' } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });

  // Parse CSV or generate synthetic sample data
  let rows = [];
  if (req.file) {
    const lines = req.file.buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase().split(',');
    const dateIdx = header.findIndex(h => /date/.test(h));
    const amtIdx = header.findIndex(h => /amount|debit|credit/.test(h));
    const descIdx = header.findIndex(h => /desc|narrat|detail/.test(h));
    rows = lines.slice(1).map(l => {
      const cols = l.split(',');
      return {
        date: cols[dateIdx] || new Date().toISOString().split('T')[0],
        amount: parseFloat(cols[amtIdx]) || 0,
        description: cols[descIdx] || 'Imported transaction'
      };
    });
  } else {
    // Generate demo transactions
    const samples = [
      [-688, 'Slack Subscription'], [2400, 'Client Payment - ABC Ltd'],
      [-120, 'Canva Pro'], [-450, 'Stripe Fees'],
      [5000, 'Consulting Fee - DEF Pte Ltd'], [-1200, 'Office Supplies']
    ];
    rows = samples.map(([a, d]) => ({
      date: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString().split('T')[0],
      amount: a, description: d
    }));
  }

  const stmt = db.prepare(`INSERT INTO transactions (id,company_id,transaction_date,amount,currency,description,counterparty)
                           VALUES (?,?,?,?,?,?,?)`);
  let imported = 0;
  rows.forEach(r => {
    stmt.run(`txn_${uuid().slice(0, 8)}`, company_id, r.date, r.amount, 'SGD',
      r.description, r.description.split(/\s/)[0]);
    imported++;
  });
  res.json({ imported, bank_code, duplicates_skipped: 0, parse_errors: 0 });
});

router.post('/books/invoices/ocr', async (req, res) => {
  const { company_id, hint_vendor } = req.body || {};
  const result = await Promise.resolve(llm.complete({ schema: 'invoice_ocr', context: { hint_vendor, company_name: hint_vendor }, messages: [{ role: 'user', content: `OCR invoice from ${hint_vendor || 'unknown vendor'}` }] }));
  // Normalize between sim + real LLM field names
  const vendor_name = result.vendor_name || result.vendor;
  const invoice_number = result.invoice_number;
  const issue_date = result.issue_date || result.invoice_date;
  const invoiceId = `inv_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO invoices (id,company_id,vendor_name,invoice_number,issue_date,total,gst_amount,currency,ocr_confidence,ocr_raw,status)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    invoiceId, company_id, vendor_name, invoice_number,
    issue_date, result.total, result.gst_amount, result.currency || 'SGD',
    result.confidence, JSON.stringify(result), 'ocr_done'
  );
  res.json({ invoice_id: invoiceId, vendor_name, invoice_number, issue_date, ...result });
});

router.get('/books/invoices', (req, res) => {
  const { company_id } = req.query;
  const rows = db.prepare(`SELECT * FROM invoices WHERE company_id=? ORDER BY issue_date DESC`).all(company_id || '');
  res.json(rows);
});

router.post('/books/journals/auto', async (req, res) => {
  const { company_id, transaction_id } = req.body || {};
  const txn = db.prepare(`SELECT * FROM transactions WHERE id=?`).get(transaction_id);
  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  const matchedInvoice = db.prepare(`SELECT * FROM invoices WHERE company_id=? AND total=? LIMIT 1`).get(company_id, Math.abs(txn.amount));
  const entry = await Promise.resolve(llm.complete({
    schema: 'journal_entry',
    context: { amount: txn.amount, description: txn.description, invoice: matchedInvoice, date: txn.transaction_date },
    messages: [{ role: 'user', content: txn.description }]
  }));
  // Normalize lines between sim + real LLM
  const lines = entry.lines || entry.entries || [];
  const journalId = `je_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO journal_entries
    (id,company_id,entry_date,reference,ai_generated,ai_confidence,review_status,source_txn_id,source_invoice_id,lines,reasoning)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    journalId, company_id, txn.transaction_date, `JE-${txn.id}`,
    1, entry.confidence, entry.requires_review ? 'pending' : 'approved',
    transaction_id, matchedInvoice?.id || null,
    JSON.stringify(lines), entry.reasoning
  );
  db.prepare(`UPDATE transactions SET journal_entry_id=? WHERE id=?`).run(journalId, transaction_id);
  res.json({ journal_id: journalId, ...entry, lines });
});

router.get('/books/journals', (req, res) => {
  const { company_id, status } = req.query;
  let q = `SELECT * FROM journal_entries WHERE company_id=?`;
  const params = [company_id || ''];
  if (status) { q += ` AND review_status=?`; params.push(status); }
  q += ` ORDER BY entry_date DESC LIMIT 200`;
  const rows = db.prepare(q).all(...params);
  rows.forEach(r => r.lines = JSON.parse(r.lines || '[]'));
  res.json(rows);
});

router.post('/books/journals/:id/approve', (req, res) => {
  db.prepare(`UPDATE journal_entries SET review_status='approved' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

router.get('/books/reports/:month', (req, res) => {
  const { company_id } = req.query;
  const month = req.params.month;
  const txns = db.prepare(`SELECT * FROM transactions WHERE company_id=? AND transaction_date LIKE ?`)
    .all(company_id || '', `${month}%`);
  const revenue = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = -txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const byCategory = {};
  txns.filter(t => t.amount < 0).forEach(t => {
    const k = (t.description || 'Other').split(' ').slice(0, 2).join(' ');
    byCategory[k] = (byCategory[k] || 0) + Math.abs(t.amount);
  });
  res.json({
    month,
    summary: { revenue, expenses, net_profit: revenue - expenses, transaction_count: txns.length },
    by_category: byCategory,
    transactions: txns
  });
});

router.get('/books/chart-of-accounts', (req, res) => {
  const { company_id } = req.query;
  res.json(db.prepare(`SELECT * FROM chart_of_accounts WHERE company_id=? ORDER BY code`).all(company_id || ''));
});

// ---------- Tax ----------
router.post('/tax/eci/compute', async (req, res) => {
  const { company_id, revenue, expenses, sutr_eligible = true } = req.body || {};
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id || '') || { fye: '12-31', name: 'Demo Co' };
  const result = await Promise.resolve(llm.complete({
    schema: 'tax_eci',
    context: { revenue, expenses, fye: company.fye, sutr_eligible, company_name: company.name, ya_count: 1 },
    messages: [{ role: 'user', content: `Compute ECI for revenue S$${revenue} expenses S$${expenses}` }]
  }));
  const filingId = `tax_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO tax_filings (id,company_id,filing_type,ya,revenue,chargeable_income,tax_payable,exemptions,status)
              VALUES (?,?,?,?,?,?,?,?,?)`).run(
    filingId, company_id || null, 'ECI', result.ya || new Date().getFullYear() + 1,
    revenue, result.chargeable_income, result.tax_payable,
    JSON.stringify({ scheme: result.scheme, exempt_amount: result.exempt_amount }), 'draft'
  );
  res.json({ filing_id: filingId, ...result });
});

router.post('/tax/form-cs/draft', async (req, res) => {
  const { company_id, ya } = req.body || {};
  const result = await orchestrator.TOOLS.form_cs_draft({ company_id, ya: ya || new Date().getFullYear() + 1 });
  res.json(result.result);
});

router.get('/tax/filings', (req, res) => {
  const { company_id } = req.query;
  res.json(db.prepare(`SELECT * FROM tax_filings WHERE company_id=? ORDER BY created_at DESC`).all(company_id || ''));
});

router.get('/tax/reminders', (req, res) => {
  const { company_id } = req.query;
  res.json(db.prepare(`SELECT * FROM reminders WHERE company_id=? ORDER BY due_date`).all(company_id || ''));
});

// ================================================================================
// SINGAPORE FINANCIAL REPORTS (SFRS for Small Entities)
// ================================================================================

// Ensure journals exist for all transactions (rule-based auto-journaling)
router.post('/finance/post-journals', (req, res) => {
  const { company_id } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  const posted = finance.ensureJournalsForCompany(company_id);
  res.json({ ok: true, journals_posted: posted });
});

// Trial Balance
router.get('/finance/trial-balance', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  res.json(finance.trialBalance({ company_id, from, to }));
});

// Profit & Loss Statement
router.get('/finance/profit-loss', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  res.json(finance.profitAndLoss({ company_id, from, to }));
});

// Balance Sheet
router.get('/finance/balance-sheet', (req, res) => {
  const { company_id, as_of = '2025-12-31' } = req.query;
  res.json(finance.balanceSheet({ company_id, asOf: as_of }));
});

// Cash Flow Statement
router.get('/finance/cash-flow', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  res.json(finance.cashFlow({ company_id, from, to }));
});

// Statement of Changes in Equity
router.get('/finance/equity-changes', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  res.json(finance.statementOfChangesInEquity({ company_id, from, to }));
});

// Notes to Financial Statements
router.get('/finance/notes', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  res.json(finance.notesToFS({ company_id, from, to }));
});

// Complete Financial Statements Package
router.get('/finance/full-package', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
  const pnl = finance.profitAndLoss({ company_id, from, to });
  const bs = finance.balanceSheet({ company_id, asOf: to });
  const cf = finance.cashFlow({ company_id, from, to });
  const soce = finance.statementOfChangesInEquity({ company_id, from, to });
  const tb = finance.trialBalance({ company_id, from, to });
  const notes = finance.notesToFS({ company_id, from, to });
  const xbrl = finance.xbrlSimplified({ company_id, pnl, bs });
  res.json({
    company: { id: company.id, name: company.name, uen: company.uen, fye: company.fye },
    period: { from, to },
    trial_balance: tb,
    profit_and_loss: pnl,
    balance_sheet: bs,
    cash_flow_statement: cf,
    statement_of_changes_in_equity: soce,
    notes_to_financial_statements: notes,
    xbrl_simplified: xbrl,
    generated_at: new Date().toISOString()
  });
});

// ================================================================================
// CPF (monthly contributions + computation)
// ================================================================================
router.post('/payroll/cpf/compute', (req, res) => {
  res.json(finance.cpfCompute(req.body || {}));
});

router.post('/payroll/cpf/monthly', (req, res) => {
  const { company_id, month, employees } = req.body || {};
  const emps = employees && employees.length ? employees : simulation.DEMO_EMPLOYEES;
  res.json(finance.cpfMonthlyContributionFile({ company_id, month: month || '2025-11', employees: emps }));
});

// IR8A (annual remuneration)
router.get('/payroll/ir8a', (req, res) => {
  const { company_id, year = 2025 } = req.query;
  const rows = simulation.DEMO_EMPLOYEES.map(e => finance.ir8aForEmployee({ employee: e, year: Number(year) }));
  res.json({ company_id, year: Number(year), employees: rows, submission_channel: 'IRAS AIS (Auto-Inclusion Scheme)', deadline: `${Number(year) + 1}-03-01` });
});

// ================================================================================
// GST F5 Quarterly Return
// ================================================================================
router.get('/tax/gst/f5', (req, res) => {
  const { company_id, from = '2025-09-01', to = '2025-11-30' } = req.query;
  res.json(finance.gstF5({ company_id, from, to }));
});

// ================================================================================
// XBRL (ACRA Simplified)
// ================================================================================
router.get('/compliance/xbrl', (req, res) => {
  const { company_id, from = '2025-01-01', to = '2025-12-31' } = req.query;
  const pnl = finance.profitAndLoss({ company_id, from, to });
  const bs = finance.balanceSheet({ company_id, asOf: to });
  res.json(finance.xbrlSimplified({ company_id, pnl, bs }));
});

// ================================================================================
// ACRA BizFile+ Annual Return
// ================================================================================
router.get('/compliance/annual-return', (req, res) => {
  const { company_id, as_of = '2025-12-31' } = req.query;
  res.json(finance.annualReturnPayload({ company_id, as_of }));
});

// ================================================================================
// MONTHLY REPORT PACK (end-of-month executive bundle)
// ================================================================================
router.get('/finance/monthly-pack', async (req, res) => {
  const { company_id, month = '2025-11' } = req.query;
  if (!company_id) return res.status(400).json({ error: 'company_id required' });

  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 0);
  const to = endDate.toISOString().split('T')[0];
  const ytdFrom = `${y}-01-01`;

  // Make sure journals exist
  finance.ensureJournalsForCompany(company_id);

  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
  const monthPnL = finance.profitAndLoss({ company_id, from, to });
  const ytdPnL = finance.profitAndLoss({ company_id, from: ytdFrom, to });
  const bs = finance.balanceSheet({ company_id, asOf: to });
  const cf = finance.cashFlow({ company_id, from, to });
  const tb = finance.trialBalance({ company_id, from, to });
  const cpfPack = finance.cpfMonthlyContributionFile({ company_id, month, employees: simulation.DEMO_EMPLOYEES });
  // GST is quarterly: Oct-Nov-Dec quarter → run Sep/Oct/Nov for 11月 pack (interim view)
  const gstFrom = `${y}-${String(Math.max(1, m - 2)).padStart(2, '0')}-01`;
  const gstReport = finance.gstF5({ company_id, from: gstFrom, to });

  // Try LLM-powered executive summary (falls back to deterministic if unavailable)
  let execSummary = null;
  try {
    const financials = {
      revenue_mtd: monthPnL.revenue,
      revenue_ytd: ytdPnL.revenue,
      net_profit_mtd: monthPnL.net_profit_after_tax,
      net_profit_ytd: ytdPnL.net_profit_after_tax,
      gross_margin: monthPnL.gross_margin,
      cash_balance: (bs.current_assets.find(a => a.code === '1000') || {}).amount || 0,
      total_assets: bs.totals.total_assets,
      total_equity: bs.totals.total_equity
    };
    const r = await Promise.resolve(llm.complete({
      schema: 'management_report',
      context: { period: month, company_name: company.name, financials },
      messages: [{ role: 'user', content: `Generate the ${month} monthly management report for ${company.name}` }]
    }));
    execSummary = r && !r._error ? r : null;
  } catch (e) { console.warn('[monthly-pack] LLM exec summary failed:', e.message); }

  // Deterministic fallback summary
  if (!execSummary) {
    const cash = (bs.current_assets.find(a => a.code === '1000') || {}).amount || 0;
    const monthlyBurn = Math.max(1, Math.abs(monthPnL.other_operating_expenses + monthPnL.staff_costs));
    execSummary = {
      period: month,
      company: company.name,
      generated_at: new Date().toISOString(),
      executive_summary_en: `In ${month}, revenue of S$${monthPnL.revenue.toLocaleString()} was achieved with a net profit after tax of S$${monthPnL.net_profit_after_tax.toLocaleString()} (margin ${monthPnL.net_margin}%). YTD revenue stands at S$${ytdPnL.revenue.toLocaleString()}. Cash position S$${cash.toLocaleString()}; total equity S$${bs.totals.total_equity.toLocaleString()}.`,
      executive_summary_cn: `${month} 当月实现营收 S$${monthPnL.revenue.toLocaleString()}，税后净利 S$${monthPnL.net_profit_after_tax.toLocaleString()}（净利率 ${monthPnL.net_margin}%）。年初至今营收累计 S$${ytdPnL.revenue.toLocaleString()}。期末现金 S$${cash.toLocaleString()}，所有者权益合计 S$${bs.totals.total_equity.toLocaleString()}。`,
      kpis: [
        { label: 'Revenue (MTD)', label_cn: '当月营收', value: `S$${monthPnL.revenue.toLocaleString()}`, delta: '—', status: monthPnL.revenue > 0 ? 'good' : 'warn' },
        { label: 'Revenue (YTD)', label_cn: '年累营收', value: `S$${ytdPnL.revenue.toLocaleString()}`, delta: '—', status: 'good' },
        { label: 'Gross Margin', label_cn: '毛利率', value: `${monthPnL.gross_margin}%`, delta: '—', status: monthPnL.gross_margin > 40 ? 'good' : 'warn' },
        { label: 'Net Margin', label_cn: '净利率', value: `${monthPnL.net_margin}%`, delta: '—', status: monthPnL.net_margin > 10 ? 'good' : 'warn' },
        { label: 'Cash Balance', label_cn: '期末现金', value: `S$${cash.toLocaleString()}`, delta: '—', status: cash > monthlyBurn * 3 ? 'good' : 'warn' },
        { label: 'Runway (months)', label_cn: '现金跑道(月)', value: `${(cash / monthlyBurn).toFixed(1)}`, delta: '—', status: cash / monthlyBurn > 6 ? 'good' : 'warn' }
      ],
      highlights: [`${monthPnL.revenue_breakdown.length} revenue lines`, `${monthPnL.expense_breakdown.length} expense categories`, `GST net ${gstReport.net_gst_payable_or_refundable >= 0 ? 'payable' : 'refundable'} S$${Math.abs(gstReport.net_gst_payable_or_refundable).toLocaleString()}`],
      risks: [
        { title: 'CPF deadline (14th of following month)', severity: 'medium', mitigation: 'Auto-submit via CPF EZPay on the 10th' },
        { title: 'GST F5 quarterly filing', severity: 'medium', mitigation: 'Schedule filing 2 weeks before deadline' }
      ],
      cash_runway_months: +(cash / monthlyBurn).toFixed(1),
      tax_calendar_next_30d: [
        { event: 'CPF contribution (Nov payroll)', due_date: `${y}-12-14` },
        { event: 'GST F5 (Oct-Dec quarter)', due_date: `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-31` }
      ],
      action_items: [
        { owner: 'Finance', task: 'Reconcile bank statement 2025-11', due: `${y}-12-05` },
        { owner: 'Payroll', task: 'Submit CPF via EZPay', due: `${y}-12-14` },
        { owner: 'Tax', task: 'Draft ECI based on YTD projections', due: `${y + 1}-03-31` }
      ]
    };
  }

  res.json({
    month,
    company: { id: company.id, name: company.name, uen: company.uen, fye: company.fye },
    generated_at: new Date().toISOString(),
    executive_summary: execSummary,
    monthly_pnl: monthPnL,
    ytd_pnl: ytdPnL,
    balance_sheet: bs,
    cash_flow: cf,
    trial_balance: tb,
    payroll_cpf: cpfPack,
    gst_interim: gstReport,
    filings_checklist: [
      { item: `CPF Monthly Contribution (${month})`, deadline: cpfPack.deadline, status: 'pending', channel: 'CPF EZPay', amount_sgd: cpfPack.totals.total_cpf },
      { item: `GST F5 Quarterly Return`, deadline: gstReport.filing_deadline, status: 'draft', channel: 'IRAS myTax Portal', amount_sgd: Math.abs(gstReport.net_gst_payable_or_refundable) },
      { item: `SDL (Skills Development Levy)`, deadline: cpfPack.deadline, status: 'pending', channel: 'CPF EZPay', amount_sgd: cpfPack.totals.sdl },
      { item: `Bank Reconciliation`, deadline: `${y}-12-05`, status: 'pending', channel: 'Internal', amount_sgd: null },
      { item: `Management Accounts Sign-off`, deadline: `${y}-12-10`, status: 'pending', channel: 'Board approval', amount_sgd: null }
    ]
  });
});

// ================================================================================
// SIMULATION HARNESS — seed YTD realistic data for demo
// ================================================================================
router.post('/simulation/seed-ytd', (req, res) => {
  const { company_id, year = 2025, end_month = 11 } = req.body || {};
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  const r = simulation.generateYTDTransactions({ company_id, year, endMonth: end_month });
  const posted = finance.ensureJournalsForCompany(company_id);
  res.json({ ...r, journals_posted: posted });
});

// ---------- Pricing ----------
router.post('/pricing/quote', (req, res) => {
  const out = orchestrator.TOOLS.pricing_query(req.body || {});
  res.json(out.result);
});

// ---------- Agents ----------
router.get('/agents', (req, res) => {
  res.json(db.prepare(`SELECT * FROM agents ORDER BY type`).all());
});

router.get('/agents/:id', (req, res) => {
  const a = db.prepare(`SELECT * FROM agents WHERE id=?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

router.post('/agents', (req, res) => {
  const b = req.body || {};
  const id = b.id || `agent_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO agents (id,name,type,description,system_prompt,model,temperature,tools,rag_layers,status,version,created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, b.name, b.type || 'custom', b.description || '', b.system_prompt || '',
    b.model || 'aicfo-sim-1', b.temperature ?? 0.2,
    JSON.stringify(b.tools || []), JSON.stringify(b.rag_layers || ['L1', 'L2']),
    b.status || 'active', b.version || '1.0.0', b.created_by || 'usr_admin_001'
  );
  res.json({ id, ok: true });
});

router.put('/agents/:id', (req, res) => {
  const b = req.body || {};
  db.prepare(`UPDATE agents SET name=?, description=?, system_prompt=?, model=?, temperature=?,
              tools=?, rag_layers=?, status=?, version=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    b.name, b.description, b.system_prompt, b.model, b.temperature,
    typeof b.tools === 'string' ? b.tools : JSON.stringify(b.tools || []),
    typeof b.rag_layers === 'string' ? b.rag_layers : JSON.stringify(b.rag_layers || []),
    b.status, b.version, req.params.id
  );
  res.json({ ok: true });
});

router.delete('/agents/:id', (req, res) => {
  db.prepare(`DELETE FROM agents WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

router.post('/agents/:id/test', async (req, res) => {
  const { input, company_id } = req.body || {};
  const agent = db.prepare(`SELECT * FROM agents WHERE id=?`).get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const ragHits = rag.search({ query: input, layers: ['L1_regulatory', 'L2_practice', 'L4_customer'], k: 3, company_id });
  const out = await orchestrator.executeSubAgent(agent, input, { ragHits, company_id });
  res.json({ agent: { id: agent.id, name: agent.name, type: agent.type }, response: out, rag_citations: ragHits });
});

router.get('/agents/runs/recent', (req, res) => {
  const rows = db.prepare(`SELECT r.*, a.name AS agent_name FROM agent_runs r
                           LEFT JOIN agents a ON a.id=r.agent_id
                           ORDER BY r.created_at DESC LIMIT 50`).all();
  rows.forEach(r => { r.trace = JSON.parse(r.trace || '[]'); try { r.output = JSON.parse(r.output); } catch (_) {} });
  res.json(rows);
});

// ---------- Chat ----------
router.post('/chat/sessions', (req, res) => {
  const { user_id, company_id, title } = req.body || {};
  const id = `sess_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO chat_sessions (id,user_id,company_id,title) VALUES (?,?,?,?)`)
    .run(id, user_id || 'usr_demo_001', company_id || null, title || 'New Chat');
  res.json({ session_id: id });
});

router.get('/chat/sessions', (req, res) => {
  const { user_id } = req.query;
  res.json(db.prepare(`SELECT * FROM chat_sessions WHERE user_id=? ORDER BY created_at DESC`).all(user_id || 'usr_demo_001'));
});

router.get('/chat/sessions/:id/messages', (req, res) => {
  res.json(db.prepare(`SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at`).all(req.params.id));
});

router.post('/chat/send', async (req, res) => {
  const { session_id, message, user_id = 'usr_demo_001', company_id, mode = 'ai' } = req.body || {};
  // Ensure session
  let sid = session_id;
  if (!sid) {
    sid = `sess_${uuid().slice(0, 8)}`;
    db.prepare(`INSERT INTO chat_sessions (id,user_id,company_id,title) VALUES (?,?,?,?)`)
      .run(sid, user_id, company_id || null, (message || '').slice(0, 40));
  }
  // User message
  const umid = `msg_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO chat_messages (id,session_id,role,content) VALUES (?,?,?,?)`)
    .run(umid, sid, 'user', message);

  // 读取最近 8 条历史作为上下文
  const history = db.prepare(
    `SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY created_at DESC LIMIT 8`
  ).all(sid).reverse();

  let payload;
  if (mode === 'agent') {
    // 保留原 Master Agent 流程
    const result = await orchestrator.runMaster({ user_query: message, user_id, company_id, session_id: sid });
    const content = typeof result.response === 'string' ? result.response :
      (result.response.summary || JSON.stringify(result.response));
    payload = {
      reply: content, citations: result.rag_citations || [],
      model: 'master-agent', mode: 'agent',
      intent: result.intent, confidence: result.confidence, need_human: result.need_human,
      agent: result.agent
    };
  } else {
    // 默认：真实 GPT + RAG
    const r = await aiChat.chatWithRAG({
      message, company_id, history: history.slice(0, -1), // 排除刚刚插入的这条 user
    });
    payload = { reply: r.reply, citations: r.citations, model: r.model, mode: 'ai', latency_ms: r.latency_ms };
  }

  const amid = `msg_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO chat_messages (id,session_id,role,content,metadata) VALUES (?,?,?,?,?)`)
    .run(amid, sid, 'assistant', payload.reply, JSON.stringify(payload));

  res.json({ session_id: sid, message_id: amid, ...payload });
});

// ---------- AI Knowledge Base Builder ----------
router.get('/rag/ai-build/topics', (req, res) => {
  res.json({ total: aiKB.TOPICS.length, topics: aiKB.TOPICS });
});

router.post('/rag/ai-build/run', async (req, res) => {
  const { concurrency = 3, model = 'gpt-5-mini', skipExisting = true } = req.body || {};
  try {
    const summary = await aiKB.buildAll({ concurrency, model, skipExisting });
    res.json({ ok: true, ...summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/rag/ai-build/status', (req, res) => {
  const byLayer = db.prepare(
    `SELECT layer, COUNT(*) n FROM rag_documents GROUP BY layer ORDER BY layer`
  ).all();
  const aiGen = db.prepare(
    `SELECT COUNT(*) n FROM rag_documents WHERE source LIKE 'ai-generated/%'`
  ).get().n;
  const uploaded = db.prepare(
    `SELECT COUNT(*) n FROM rag_documents WHERE source LIKE 'upload/%'`
  ).get().n;
  res.json({
    ai_chat_ready: aiChat.isReady(),
    kb_builder_ready: true,
    file_ingest_ready: fileIngest.isReady(),
    rag: { total_docs: byLayer.reduce((s, r) => s + r.n, 0), by_layer: byLayer, ai_generated: aiGen, uploaded }
  });
});

// ---------- 文件上传统一入口 ----------
// 用途说明：
// kind=rag       → 直接入 RAG 知识库
// kind=invoice   → AI 结构化解析为发票并入 invoices 表
// kind=bank      → AI 解析银行流水 → transactions
// kind=report    → 入 RAG 的 L4_customer（公司内部材料）
router.post('/upload', upload.single('file'), async (req, res) => {
  const { kind = 'rag', layer = 'L4_customer', title, company_id, hint_vendor } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field: file)' });
  const filename = req.file.originalname || 'upload.bin';
  const mime = req.file.mimetype || '';
  const buffer = req.file.buffer;

  try {
    if (kind === 'invoice') {
      const parsed = await fileIngest.parseBuffer(buffer, filename, mime);
      const extracted = await fileIngest.extractInvoiceWithAI({
        text: parsed.text, base64: parsed.base64, mime, hint_vendor
      });
      const total = Number(extracted.total || 0);
      const gst   = Number(extracted.gst_amount || 0);
      const invoiceId = `inv_${uuid().slice(0, 8)}`;
      db.prepare(`INSERT INTO invoices (id,company_id,vendor_name,invoice_number,issue_date,total,gst_amount,currency,ocr_confidence,ocr_raw,status)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        invoiceId, company_id || 'co_skyhawk_001',
        extracted.vendor_name || hint_vendor || 'Unknown',
        extracted.invoice_number || null,
        extracted.issue_date || new Date().toISOString().slice(0, 10),
        total, gst, extracted.currency || 'SGD',
        extracted.confidence || 0.7, JSON.stringify(extracted), 'ocr_done'
      );
      return res.json({ ok: true, kind, invoice_id: invoiceId, extracted, file: { name: filename, size: buffer.length, format: parsed.format } });
    }

    if (kind === 'bank') {
      const parsed = await fileIngest.parseBuffer(buffer, filename, mime);
      const txns = await fileIngest.extractTransactionsWithAI({ text: parsed.text, rows: parsed.rows });
      const stmt = db.prepare(`INSERT INTO transactions (id,company_id,transaction_date,amount,currency,description,counterparty)
                               VALUES (?,?,?,?,?,?,?)`);
      let imported = 0;
      for (const t of txns) {
        try {
          stmt.run(`txn_${uuid().slice(0, 8)}`, company_id || 'co_skyhawk_001',
            t.date, Number(t.amount) || 0, 'SGD', t.description || '', t.counterparty || '');
          imported++;
        } catch (_) {}
      }
      return res.json({ ok: true, kind, imported, sample: txns.slice(0, 5), file: { name: filename, size: buffer.length, format: parsed.format } });
    }

    // rag / report / 其他 → 入 RAG
    const targetLayer = kind === 'report' ? 'L4_customer' : (layer || 'L4_customer');
    const r = await fileIngest.ingestAsRagDoc({
      buffer, filename, mime, layer: targetLayer,
      title: title || filename, company_id: company_id || (targetLayer === 'L4_customer' ? 'co_skyhawk_001' : null)
    });
    return res.json({ ok: true, kind, ...r, file: { name: filename, size: buffer.length } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- 一键跑通全流程（上传 → 解析 → 报表） ----------
router.post('/flow/run-all', async (req, res) => {
  const t0 = Date.now();
  const { company_id = 'co_skyhawk_001', from = '2025-01-01', to = '2025-11-30' } = req.body || {};
  const trace = [];
  const tick = (step, data) => trace.push({ step, ok: true, ts: Date.now(), data });

  try {
    // 1. 自动过账
    const posted = finance.ensureJournalsForCompany(company_id);
    tick('ensure_journals', { posted });

    // 2. 全套财务报表
    const tb  = finance.trialBalance({ company_id, from, to });                      tick('trial_balance', tb.totals);
    const pl  = finance.profitAndLoss({ company_id, from, to });                     tick('profit_and_loss', { revenue: pl.revenue, net: pl.net_profit_after_tax });
    const bs  = finance.balanceSheet({ company_id, asOf: to });                      tick('balance_sheet', { balanced: bs.balanced, total_assets: bs.totals.total_assets });
    const cf  = finance.cashFlow({ company_id, from, to });                          tick('cash_flow', { net_operating: cf.net_operating, cash_at_end: cf.cash_at_end });
    const soce= finance.statementOfChangesInEquity({ company_id, from, to });        tick('soce', { movements: (soce.movements || []).length });
    const nts = finance.notesToFS({ company_id, from, to });                         tick('notes', { n: (nts.notes || nts).length });
    const xbrl= finance.xbrlSimplified({ company_id, pnl: pl, bs });                 tick('xbrl', { elements: Object.keys(xbrl.elements || xbrl.tags || xbrl).length });

    // 3. 报税（ECI + GST F5 + CPF）
    const ci = Math.max(0, pl.net_profit_after_tax || pl.profit_before_tax || 0);
    const t1 = Math.min(ci, 100000), t2 = Math.max(0, Math.min(ci - 100000, 100000)), t3 = Math.max(0, ci - 200000);
    const eci = { chargeable_income: ci,
      sute_exemption: +(t1 * 0.75 + t2 * 0.5).toFixed(2),
      tax_payable:    +(((t1 - t1 * 0.75) + (t2 - t2 * 0.5) + t3) * 0.17).toFixed(2),
      deadline: '2026-03-31' };
    tick('eci', eci);

    const cpf = finance.cpfMonthlyContributionFile({ company_id, month: '2025-11', employees: simulation.DEMO_EMPLOYEES || [] });
    tick('cpf', { employees: (cpf.lines || cpf.rows || []).length, total_cpf: cpf.totals.total_cpf });

    const gst = finance.gstF5({ company_id, from: '2025-07-01', to: '2025-09-30' });
    tick('gst_f5', { net: gst.net_gst_payable_or_refundable, status: gst.status });

    res.json({
      ok: true, company_id, period: { from, to },
      latency_ms: Date.now() - t0,
      summary: {
        journals_posted: posted,
        tb_balanced: tb.totals.balanced,
        bs_balanced: !!bs.balanced,
        cf_reconciled: !!cf.reconciled,
        revenue: pl.revenue, net_profit: pl.net_profit_after_tax,
        total_assets: bs.totals.total_assets,
        cash_at_end: cf.cash_at_end,
        xbrl_elements: Object.keys(xbrl.elements || xbrl.tags || xbrl).length,
        eci_tax_payable: eci.tax_payable,
        cpf_total: cpf.totals.total_cpf,
        gst_net: gst.net_gst_payable_or_refundable
      },
      reports: { trial_balance: tb, profit_and_loss: pl, balance_sheet: bs, cash_flow: cf, soce, notes: nts, xbrl },
      tax: { eci, cpf, gst },
      trace
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, trace });
  }
});

// ---------- RAG ----------
router.get('/rag/stats', (req, res) => res.json(rag.stats()));

router.get('/rag/documents', (req, res) => {
  const { layer } = req.query;
  let q = `SELECT id,layer,source,title,substr(content,1,200) AS preview,metadata,chunk_count,status,created_at FROM rag_documents`;
  const params = [];
  if (layer) { q += ` WHERE layer=?`; params.push(layer); }
  q += ` ORDER BY created_at DESC LIMIT 200`;
  res.json(db.prepare(q).all(...params));
});

router.get('/rag/documents/:id', (req, res) => {
  const doc = db.prepare(`SELECT * FROM rag_documents WHERE id=?`).get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const chunks = db.prepare(`SELECT id,chunk_index,content,token_count FROM rag_chunks WHERE document_id=? ORDER BY chunk_index`).all(req.params.id);
  res.json({ ...doc, chunks });
});

router.post('/rag/ingest', (req, res) => {
  const { layer, source, title, content, metadata, company_id } = req.body || {};
  if (!layer || !content) return res.status(400).json({ error: 'layer and content required' });
  const result = rag.ingest({ layer, source, title, content, metadata, company_id });
  res.json({ ok: true, ...result });
});

router.delete('/rag/documents/:id', (req, res) => {
  db.prepare(`DELETE FROM rag_chunks WHERE document_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM rag_documents WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

router.post('/rag/search', (req, res) => {
  const { query, layers, k, company_id } = req.body || {};
  const hits = rag.search({ query, layers, k, company_id });
  res.json({ query, hits });
});

router.post('/rag/training/run', (req, res) => {
  const { name, layer, docs, user_id } = req.body || {};
  if (!Array.isArray(docs) || docs.length === 0) return res.status(400).json({ error: 'docs array required' });
  const result = rag.runTrainingJob({ name: name || 'Training Job', layer: layer || 'L2_practice', docs, user_id: user_id || 'usr_admin_001' });
  res.json(result);
});

router.get('/rag/training/jobs', (req, res) => {
  const rows = db.prepare(`SELECT * FROM rag_training_jobs ORDER BY created_at DESC LIMIT 50`).all();
  rows.forEach(r => r.logs = JSON.parse(r.logs || '[]'));
  res.json(rows);
});

router.post('/rag/feedback', (req, res) => {
  const result = rag.submitFeedback(req.body || {});
  res.json(result);
});

router.post('/rag/learn', (req, res) => {
  res.json(rag.learnFromFeedback());
});

// ---------- Admin / CSP review ----------
router.get('/admin/review-queue', (req, res) => {
  const orders = db.prepare(`SELECT o.*, c.name as company_name FROM registration_orders o
                              LEFT JOIN companies c ON c.id=o.company_id
                              WHERE o.stage IN ('reviewing','constitution','signed')
                              ORDER BY o.created_at`).all();
  const journals = db.prepare(`SELECT j.*, c.name as company_name FROM journal_entries j
                                LEFT JOIN companies c ON c.id=j.company_id
                                WHERE j.review_status='pending' ORDER BY j.created_at DESC LIMIT 50`).all();
  journals.forEach(j => j.lines = JSON.parse(j.lines || '[]'));
  const tax = db.prepare(`SELECT * FROM tax_filings WHERE status='draft' ORDER BY created_at DESC`).all();
  res.json({ orders, journals, tax });
});

router.post('/admin/orders/:id/approve', (req, res) => {
  const { reviewer_id, notes } = req.body || {};
  db.prepare(`UPDATE registration_orders SET csp_reviewer_id=?, csp_notes=?, approved_at=? WHERE id=?`)
    .run(reviewer_id || 'usr_csp_001', notes || '', new Date().toISOString(), req.params.id);
  // Advance to bizfile
  res.redirect(307, `/api/registration/orders/${req.params.id}/advance`);
});

router.get('/admin/stats', (req, res) => {
  const companies = db.prepare(`SELECT COUNT(*) as n FROM companies`).get().n;
  const activeCompanies = db.prepare(`SELECT COUNT(*) as n FROM companies WHERE status='active'`).get().n;
  const orders = db.prepare(`SELECT stage, COUNT(*) as n FROM registration_orders GROUP BY stage`).all();
  const runs = db.prepare(`SELECT COUNT(*) as n, AVG(confidence) as avg_conf, AVG(latency_ms) as avg_lat FROM agent_runs`).get();
  const txns = db.prepare(`SELECT COUNT(*) as n FROM transactions`).get().n;
  const invoices = db.prepare(`SELECT COUNT(*) as n FROM invoices`).get().n;
  const reviewQueue = db.prepare(`SELECT COUNT(*) as n FROM journal_entries WHERE review_status='pending'`).get().n;
  res.json({
    companies, active_companies: activeCompanies,
    orders_by_stage: orders,
    agent_runs: { total: runs.n, avg_confidence: +(runs.avg_conf || 0).toFixed(3), avg_latency_ms: Math.round(runs.avg_lat || 0) },
    transactions: txns, invoices, pending_reviews: reviewQueue
  });
});

// ================================================================================
// 用户注册开放 / 套餐筛选 / 支付 / WhatsApp 财务二维码 / 用户财务档案
// ================================================================================

// 1. 公开注册 (邮箱 + 手机号 + 公司名 + 国家 + 业务类型)
router.post('/auth/register', (req, res) => {
  const { email, name, phone, country = 'SG', segment = 'local_sg', company_name } = req.body || {};
  if (!email || !name) return res.status(400).json({ ok: false, error: '缺少 email/name' });
  const exist = db.prepare(`SELECT id FROM users WHERE email=?`).get(email);
  if (exist) return res.status(409).json({ ok: false, error: '该邮箱已注册', user_id: exist.id });

  const userId = 'usr_' + uuid().slice(0, 8);
  db.prepare(`INSERT INTO users(id,email,name,phone,role,kyc_status,created_at)
              VALUES(?,?,?,?, 'customer', 'pending', CURRENT_TIMESTAMP)`)
    .run(userId, email, name, phone || '');

  let companyId = null;
  if (company_name) {
    companyId = 'co_' + uuid().slice(0, 8);
    db.prepare(`INSERT INTO companies(id,name,status,segment,currency,paid_up_capital,created_by,created_at)
                VALUES(?,?, 'draft', ?, 'SGD', 1000, ?, CURRENT_TIMESTAMP)`)
      .run(companyId, company_name, segment, userId);
  }
  res.json({ ok: true, user: { id: userId, email, name, phone, country }, company_id: companyId, token: `demo_${userId}` });
});

// 2. 套餐列表
router.get('/plans', (req, res) => res.json({ ok: true, plans: subs.listPlans() }));

// 3. 选套餐 -> 创建订阅（pending_payment）
router.post('/subscriptions', (req, res) => {
  const { user_id, company_id, plan_code } = req.body || {};
  const r = subs.createSubscription({ user_id, company_id, plan_code });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

// 4. 支付（Mock）-> 成功后自动创建专属 WhatsApp 二维码
router.post('/payments/pay', async (req, res) => {
  try {
    const { user_id, subscription_id, method = 'mock_card', card_last4 = '4242' } = req.body || {};
    const pay = subs.payMock({ user_id, subscription_id, method, card_last4 });
    if (!pay.ok) return res.status(400).json(pay);

    // 支付成功 -> 生成专属财务二维码
    const sub = pay.subscription;
    const channel = await waBot.createFinanceChannel({ user_id, company_id: sub.company_id });
    res.json({ ok: true, payment: pay, finance_channel: channel });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 5. 查询 / 重新获取用户的专属财务二维码
router.get('/wa/channel', async (req, res) => {
  const { user_id } = req.query;
  const ch = waBot.getChannelByUser(user_id);
  if (!ch) return res.status(404).json({ ok: false, error: '未找到财务渠道，请先完成支付' });
  const QRCode = require('qrcode');
  const qr_data_url = await QRCode.toDataURL(ch.qr_payload, { margin: 1, width: 320 });
  res.json({ ok: true, channel: { ...ch, qr_data_url } });
});

router.post('/wa/channel/create', async (req, res) => {
  try {
    const { user_id, company_id } = req.body || {};
    if (!user_id) return res.status(400).json({ ok: false, error: '缺少 user_id' });
    const channel = await waBot.createFinanceChannel({ user_id, company_id });
    res.json({ ok: true, channel });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 6. WhatsApp Webhook: 绑定 + 接收消息（模拟，可被真实 WA Cloud API 替换）
router.post('/wa/webhook/link', (req, res) => {
  const { token, wa_phone } = req.body || {};
  const r = waBot.linkChannel({ token, wa_phone });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

router.post('/wa/webhook/message', upload.single('media'), async (req, res) => {
  try {
    const { token, wa_phone, text = '', msg_type = 'text' } = req.body || {};
    // 支持两种：先 link 再发 message；或 message 自带 token 直接 link+send
    let ch = waBot.getChannelByToken(token);
    if (!ch) return res.status(404).json({ ok: false, error: '无效 token' });
    if (!ch.wa_phone && wa_phone) { waBot.linkChannel({ token, wa_phone }); ch = waBot.getChannelByToken(token); }

    const filename = req.file?.originalname || null;
    const media_mime = req.file?.mimetype || null;
    const r = await waBot.handleIncoming({
      channel_id: ch.id, text, media_url: null,
      media_mime, filename,
      buffer: req.file?.buffer || null,
      msg_type: req.file ? (media_mime?.startsWith('image/') ? 'image' : 'document') : msg_type
    });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/wa/messages', (req, res) => {
  const { user_id, limit = 50 } = req.query;
  const ch = waBot.getChannelByUser(user_id);
  if (!ch) return res.json({ ok: true, messages: [] });
  const rows = db.prepare(`SELECT * FROM wa_messages WHERE channel_id=? ORDER BY received_at DESC LIMIT ?`).all(ch.id, +limit);
  res.json({ ok: true, channel_id: ch.id, messages: rows });
});

// ============================================================================
// Meta WhatsApp Cloud API: webhook verify + real inbound + admin config
// ============================================================================

// Meta 挂 webhook 时会用 GET 验证
router.get('/wa/webhook/meta', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const r = waMeta.verifyWebhook({ mode, token, challenge });
  if (r.ok) return res.status(200).send(String(r.challenge || ''));
  res.status(403).send('verify failed');
});

// Meta 推送真实消息（入站图片/文字/文档）
router.post('/wa/webhook/meta', async (req, res) => {
  // Meta 要求 5 秒内回 200，先快速应答再异步处理
  res.status(200).send('EVENT_RECEIVED');
  try {
    const msgs = waMeta.parseInboundPayload(req.body);
    for (const m of msgs) {
      // 找对应 channel：按 wa_phone 查
      let ch = db.prepare(`SELECT * FROM wa_channels WHERE wa_phone=? AND status='active' ORDER BY created_at DESC LIMIT 1`).get(m.from);
      // 首次接入且正文含 'LINK:xxxx' → 绑定
      if (!ch) {
        const linkMatch = (m.text || '').match(/LINK:([A-Z0-9\-]+)/i);
        if (linkMatch) {
          const lr = waBot.linkChannel({ token: linkMatch[1], wa_phone: m.from });
          if (lr.ok) ch = db.prepare(`SELECT * FROM wa_channels WHERE id=?`).get(lr.channel_id);
        }
      }
      if (!ch) {
        console.log('[wa-meta] no channel for', m.from, 'text=', m.text);
        // 自动回复提示绑定
        const cfg = waMeta.readConfig();
        if (cfg.auto_reply) {
          await waMeta.sendText(m.from, '👋 欢迎使用 AiCFO Finance Bot！请先在小程序内支付成功后扫码发送 LINK:xxxx 绑定账户。').catch(()=>{});
        }
        continue;
      }

      // 下载媒体（图片/文件）→ 走现有 handleIncoming
      let buffer = null, media_url = null;
      if (m.media_id) {
        const dl = await waMeta.downloadMedia(m.media_id);
        if (dl.ok) buffer = dl.buffer;
        media_url = `meta://${m.media_id}`;
      }

      const result = await waBot.handleIncoming({
        channel_id: ch.id,
        text:       m.text || '',
        media_url,
        media_mime: m.media_mime,
        filename:   m.filename,
        buffer,
        msg_type:   m.type === 'text' ? 'text' : (m.media_mime?.startsWith('image/') ? 'image' : 'document'),
      });

      // 自动回复结果给用户
      const cfg = waMeta.readConfig();
      if (cfg.auto_reply && result.ok) {
        await waMeta.sendText(m.from, result.reply || '✓ 已记录').catch(e => console.error('[wa-meta reply]', e.message));
      }
    }
  } catch (e) {
    console.error('[wa-meta webhook] handle error', e);
  }
});

// ---- Admin config endpoints ----
router.get('/admin/wa/config', (req, res) => {
  res.json({ ok: true, config: waMeta.getMaskedConfig() });
});

router.post('/admin/wa/config', (req, res) => {
  const allowed = ['phone_number_id','access_token','verify_token','bot_display_name','enabled','auto_reply'];
  const patch = {};
  for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
  const next = waMeta.updateConfig(patch);
  res.json({ ok: true, config: waMeta.getMaskedConfig() });
});

router.post('/admin/wa/test', async (req, res) => {
  const r = await waMeta.testConnection();
  res.json(r);
});

router.post('/admin/wa/send', async (req, res) => {
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ ok: false, error: '需要 to + text' });
  const r = await waMeta.sendText(to, text);
  res.json(r);
});

// 7. 用户财务档案
router.get('/archive/user', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ ok: false, error: '缺少 user_id' });
  waBot.refreshArchive({ user_id, company_id: waBot.getChannelByUser(user_id)?.company_id });
  res.json({ ok: true, ...waBot.getUserArchive({ user_id }) });
});

router.get('/admin/archives', (req, res) => {
  res.json({ ok: true, archives: waBot.listAllArchives({ limit: +req.query.limit || 100 }) });
});

router.get('/admin/wa/channels', (req, res) => {
  const rows = db.prepare(`
    SELECT w.*, u.email, u.name, c.name AS company_name
    FROM wa_channels w
    LEFT JOIN users u ON u.id=w.user_id
    LEFT JOIN companies c ON c.id=w.company_id
    ORDER BY w.created_at DESC LIMIT 200`).all();
  res.json({ ok: true, channels: rows });
});

// ================================================================================
// Upload Portal (方案 A — 专属链接上传账单)
// ================================================================================
// 生成新链接：POST /upload-portal/tokens  body:{ user_id, company_id?, label?, expires_days?, max_uploads? }
router.post('/upload-portal/tokens', async (req, res) => {
  try {
    const { user_id, company_id, label, expires_days, max_uploads } = req.body || {};
    if (!user_id) return res.status(400).json({ ok: false, error: 'user_id required' });
    const public_base = req.headers['x-public-base'] || process.env.AICFO_PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const r = await uploadPortal.generateToken({ user_id, company_id, label, expires_days: +expires_days || 0, max_uploads: +max_uploads || 0, public_base });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 列表 (我的): GET /upload-portal/tokens?user_id=xxx
router.get('/upload-portal/tokens', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ ok: false, error: 'user_id required' });
  res.json({ ok: true, tokens: uploadPortal.listTokens({ user_id }) });
});

// 撤销：POST /upload-portal/tokens/:token/revoke
router.post('/upload-portal/tokens/:token/revoke', (req, res) => {
  res.json(uploadPortal.revokeToken(req.params.token));
});

// 公共元信息：GET /upload-portal/public/:token  （上传页前端加载时调用，展示公司名/链接名）
router.get('/upload-portal/public/:token', (req, res) => {
  const tk = uploadPortal.getTokenInfo(req.params.token);
  if (!tk) return res.status(404).json({ ok: false, error: 'not found' });
  const v = uploadPortal.validateToken(req.params.token);
  res.json({
    ok: v.ok, error: v.error || null,
    token: req.params.token,
    label: tk.label,
    company_name: tk.company_name || tk.user_name || 'AiCFO',
    user_name: tk.user_name,
    expires_at: tk.expires_at,
    uploads_count: tk.uploads_count,
    max_uploads: tk.max_uploads,
  });
});

// 公共提交：POST /upload-portal/public/:token/submit  multipart: files[], text, submitter_name, submitter_phone
router.post('/upload-portal/public/:token/submit', upload.array('files', 10), async (req, res) => {
  try {
    const { text = '', submitter_name = '', submitter_phone = '' } = req.body || {};
    const r = await uploadPortal.submitFiles({
      token: req.params.token,
      files: req.files || [],
      text, submitter_name, submitter_phone,
      ip: req.ip, user_agent: req.get('user-agent') || '',
    });
    res.json(r);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 管理列表：GET /admin/upload-portal/tokens
router.get('/admin/upload-portal/tokens', (req, res) => {
  res.json({ ok: true, tokens: uploadPortal.listAllTokens({ limit: +req.query.limit || 100 }) });
});

// ================================================================================
// Telegram Bot (方案 C — 国际/华人全覆盖)
// ================================================================================
// 读取配置（bot_token 脱敏）
router.get('/admin/telegram/config', (req, res) => {
  res.json({ ok: true, config: tgBot.getMaskedConfig() });
});

// 保存配置：POST /admin/telegram/config body:{ bot_token?, bot_username?, webhook_secret?, enabled?, auto_reply? }
router.post('/admin/telegram/config', (req, res) => {
  const next = tgBot.updateConfig(req.body || {});
  res.json({ ok: true, config: tgBot.getMaskedConfig() });
});

// 连通测试 getMe：POST /admin/telegram/test
router.post('/admin/telegram/test', async (req, res) => {
  const r = await tgBot.testConnection();
  res.json(r);
});

// 挂 webhook：POST /admin/telegram/webhook/set body:{ webhook_url }
router.post('/admin/telegram/webhook/set', async (req, res) => {
  const public_base = req.body?.public_base || process.env.AICFO_PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = req.body?.webhook_url || `${public_base}/api/telegram/webhook`;
  const r = await tgBot.setWebhook(url);
  res.json({ ok: r.ok, webhook_url: url, result: r.result, error: r.error });
});

// 取消 webhook：POST /admin/telegram/webhook/delete
router.post('/admin/telegram/webhook/delete', async (req, res) => {
  res.json(await tgBot.deleteWebhook());
});

// Telegram webhook 入口（Meta 对应 /wa/webhook/meta）
router.post('/telegram/webhook', express.json({ limit: '20mb' }), async (req, res) => {
  try {
    // 校验 secret_token (Telegram 会在 header 里带 X-Telegram-Bot-Api-Secret-Token)
    const cfg = tgBot.readConfig();
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (cfg.webhook_secret && secret !== cfg.webhook_secret) {
      return res.status(403).json({ ok: false, error: 'invalid secret' });
    }
    const r = await tgBot.handleUpdate(req.body || {});
    res.json({ ok: true, handled: r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 管理：手动触发一次 handleUpdate（用于联调）
router.post('/admin/telegram/simulate', async (req, res) => {
  const r = await tgBot.handleUpdate(req.body || {});
  res.json({ ok: true, result: r });
});

// 列出 TG 已绑定用户
router.get('/admin/telegram/channels', (req, res) => {
  res.json({ ok: true, channels: tgBot.listChannels({ limit: +req.query.limit || 100 }) });
});

// ================================================================================
// LLM Gateway (Tokenhot.ai 统一网关) — 配置 / 测试 / 日志
// ================================================================================
// 读取当前配置（api_key 已脱敏）
router.get('/admin/llm/config', (req, res) => {
  res.json({ ok: true, config: llmGateway.getConfig() });
});

// 更新配置（Tokenhot API Key / base_url / 模型路由 / 用途映射）
router.post('/admin/llm/config', (req, res) => {
  try {
    const patch = req.body || {};
    // 安全：只允许白名单字段
    const allow = ['provider', 'base_url', 'api_key', 'enabled', 'models', 'tier_by_purpose'];
    const cleaned = {};
    for (const k of allow) if (k in patch) cleaned[k] = patch[k];
    const cfg = llmGateway.updateConfig(cleaned);
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 连通性测试（实际发一次最小 ping）
router.post('/admin/llm/test', async (req, res) => {
  try {
    const { tier = 'fast' } = req.body || {};
    const r = await llmGateway.testConnection({ tier });
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 最近调用日志 + 统计
router.get('/admin/llm/logs', (req, res) => {
  const limit = +req.query.limit || 30;
  res.json({ ok: true, stats: llmGateway.stats(), logs: llmGateway.recentLogs(limit) });
});

// ================================================================================
// Singapore Registry (ACRA/BizFile/MyInfo/IRAS) 管理 API
// ================================================================================
router.get('/admin/registry/config', (req, res) => {
  res.json({ ok: true, config: sgRegistry.getConfig() });
});

router.post('/admin/registry/config', (req, res) => {
  try {
    const patch = req.body || {};
    const allow = ['mode','bizfile_base_url','bizfile_api_key',
                   'myinfo_base_url','myinfo_client_id','myinfo_client_secret',
                   'iras_base_url','iras_api_key','timeout_ms','retry'];
    const cleaned = {};
    for (const k of allow) if (k in patch) cleaned[k] = patch[k];
    const cfg = sgRegistry.updateConfig(cleaned);
    res.json({ ok: true, config: cfg });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/registry/ping', async (req, res) => {
  try {
    const r = await sgRegistry.ping();
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 聊天/阅读中被 agent 调用的 UEN 核验工具
router.post('/registry/uen/verify', async (req, res) => {
  try {
    const { uen } = req.body || {};
    if (!uen) return res.status(400).json({ ok: false, error: '缺少 uen' });
    const r = await sgRegistry.verifyUEN(uen);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/registry/ssic/lookup', async (req, res) => {
  try {
    const { keyword } = req.body || {};
    if (!keyword) return res.status(400).json({ ok: false, error: '缺少 keyword' });
    const r = await sgRegistry.lookupSsicCode(keyword);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 正式提交注册到 ACRA（支付完成/KYC完成后触发）
router.post('/registration/orders/:id/submit-to-acra', async (req, res) => {
  try {
    const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
    const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(order.company_id);
    const persons = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(order.company_id);

    const payload = {
      company_name: company.name,
      paid_up_capital: company.paid_up_capital,
      currency: company.currency,
      fye: company.fye,
      ssic_codes: (company.ssic_codes || '').split(',').filter(Boolean),
      shareholders: persons
    };
    const acra = await sgRegistry.submitIncorporation(payload);
    if (acra.ok && acra.uen) {
      db.prepare(`UPDATE companies SET uen=?, status='active' WHERE id=?`).run(acra.uen, company.id);
      const timeline = JSON.parse(order.timeline || '[]');
      timeline.forEach(t => { if (t.stage === 'bizfile' || t.stage === 'uen_issued') { t.status = 'done'; t.at = new Date().toISOString(); }});
      db.prepare(`UPDATE registration_orders SET stage='uen_issued', progress=0.875, timeline=? WHERE id=?`)
        .run(JSON.stringify(timeline), order.id);
    }
    res.json({ ok: true, submission: acra });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
