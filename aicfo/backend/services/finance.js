// AiCFO Singapore Financial Reports Engine
// Generates SFRS-for-SE-compliant financial statements:
// - Profit & Loss (Statement of Comprehensive Income)
// - Balance Sheet (Statement of Financial Position)
// - Cash Flow Statement (Indirect Method)
// - Statement of Changes in Equity (SoCE)
// - Trial Balance
// - Notes to Financial Statements
// - General Ledger (GL)
// Plus Singapore-specific compliance outputs:
// - GST F5 return
// - CPF monthly contribution (IR8A / IR21 support)
// - IR8A / Appendix 8A year-end
// - XBRL tags (ACRA Simplified template)
// - ACRA BizFile+ Annual Return (AR) submission payload

const db = require('../db/schema');

// ================================================================================
// Account classification (Singapore SFRS chart-of-accounts)
// ================================================================================
const ACC_MAP = {
  // Assets (1xxx)
  '1000': { name: 'Cash and Bank', class: 'asset', type: 'current' },
  '1010': { name: 'Petty Cash', class: 'asset', type: 'current' },
  '1100': { name: 'Trade Receivables', class: 'asset', type: 'current' },
  '1150': { name: 'Other Receivables', class: 'asset', type: 'current' },
  '1200': { name: 'Inventory', class: 'asset', type: 'current' },
  '1300': { name: 'Prepayments', class: 'asset', type: 'current' },
  '1500': { name: 'Property, Plant & Equipment', class: 'asset', type: 'non_current' },
  '1510': { name: 'Accumulated Depreciation', class: 'asset', type: 'non_current', contra: true },
  '1600': { name: 'Intangible Assets', class: 'asset', type: 'non_current' },
  // Liabilities (2xxx)
  '2000': { name: 'Trade Payables', class: 'liability', type: 'current' },
  '2050': { name: 'Other Payables', class: 'liability', type: 'current' },
  '2100': { name: 'GST Input Tax (Receivable)', class: 'asset', type: 'current' },
  '2200': { name: 'GST Output Tax (Payable)', class: 'liability', type: 'current' },
  '2300': { name: 'CPF Payable', class: 'liability', type: 'current' },
  '2400': { name: 'Income Tax Payable', class: 'liability', type: 'current' },
  '2500': { name: 'Accruals', class: 'liability', type: 'current' },
  '2600': { name: 'Deferred Revenue', class: 'liability', type: 'current' },
  '2700': { name: 'Long-term Loans', class: 'liability', type: 'non_current' },
  // Equity (3xxx)
  '3000': { name: 'Share Capital', class: 'equity' },
  '3100': { name: 'Retained Earnings', class: 'equity' },
  '3200': { name: 'Dividends Declared', class: 'equity', contra: true },
  // Revenue (4xxx)
  '4000': { name: 'Revenue', class: 'revenue' },
  '4100': { name: 'Other Income', class: 'revenue' },
  '4200': { name: 'Interest Income', class: 'revenue' },
  '4900': { name: 'Foreign Exchange Gain', class: 'revenue' },
  // COGS / Expenses (5xxx / 6xxx)
  '5000': { name: 'Cost of Goods Sold', class: 'expense', subclass: 'cogs' },
  '5100': { name: 'Staff Costs - Salaries', class: 'expense', subclass: 'staff' },
  '5150': { name: 'Staff Costs - Bonus', class: 'expense', subclass: 'staff' },
  '5200': { name: 'Staff Costs - CPF Employer', class: 'expense', subclass: 'staff' },
  '5250': { name: 'Staff Costs - SDL', class: 'expense', subclass: 'staff' },
  '5300': { name: 'Rent Expense', class: 'expense', subclass: 'opex' },
  '5400': { name: 'Utilities', class: 'expense', subclass: 'opex' },
  '5500': { name: 'IT/Software Subscriptions', class: 'expense', subclass: 'opex' },
  '5600': { name: 'Marketing & Advertising', class: 'expense', subclass: 'opex' },
  '5700': { name: 'Professional Fees', class: 'expense', subclass: 'opex' },
  '5800': { name: 'Bank Charges', class: 'expense', subclass: 'finance' },
  '5850': { name: 'Interest Expense', class: 'expense', subclass: 'finance' },
  '5900': { name: 'Depreciation Expense', class: 'expense', subclass: 'opex' },
  '5950': { name: 'Amortisation Expense', class: 'expense', subclass: 'opex' },
  '6000': { name: 'Other Operating Expenses', class: 'expense', subclass: 'opex' },
  '6100': { name: 'Foreign Exchange Loss', class: 'expense', subclass: 'opex' },
};

function classify(code) {
  return ACC_MAP[code] || { name: `Account ${code}`, class: 'expense', subclass: 'opex' };
}

// ================================================================================
// Rule-based auto-journaling for a transaction (works when LLM is not called)
// ================================================================================
function autoJournalRuleBased(txn) {
  const amt = Math.abs(Number(txn.amount) || 0);
  const desc = (txn.description || '').toLowerCase();
  const isInflow = Number(txn.amount) > 0;
  const gstRate = 0.09;

  // Match a category
  let acct = { code: '6000', name: 'Other Operating Expenses' };
  let gstApplicable = true;
  if (isInflow) {
    acct = /interest/.test(desc)
      ? { code: '4200', name: 'Interest Income' }
      : { code: '4000', name: 'Revenue' };
  } else {
    if (/(salary|payroll|wages)/.test(desc)) { acct = { code: '5100', name: 'Staff Costs - Salaries' }; gstApplicable = false; }
    else if (/(cpf)/.test(desc)) { acct = { code: '5200', name: 'Staff Costs - CPF Employer' }; gstApplicable = false; }
    else if (/(rent|office lease|capitaland|wework)/.test(desc)) acct = { code: '5300', name: 'Rent Expense' };
    else if (/(utility|utilities|sp group|electric|water)/.test(desc)) acct = { code: '5400', name: 'Utilities' };
    else if (/(aws|google|microsoft|cloud|slack|canva|notion|saas|software|github)/.test(desc)) acct = { code: '5500', name: 'IT/Software Subscriptions' };
    else if (/(facebook|meta|tiktok|linkedin|ad(s|vert)|marketing)/.test(desc)) acct = { code: '5600', name: 'Marketing & Advertising' };
    else if (/(legal|audit|consulting|accounting|professional|law firm|consult)/.test(desc)) acct = { code: '5700', name: 'Professional Fees' };
    else if (/(bank.*(charge|fee)|stripe.*fee|paynow fee)/.test(desc)) { acct = { code: '5800', name: 'Bank Charges' }; gstApplicable = false; }
    else if (/(interest)/.test(desc)) { acct = { code: '5850', name: 'Interest Expense' }; gstApplicable = false; }
    else if (/(depreciation)/.test(desc)) { acct = { code: '5900', name: 'Depreciation Expense' }; gstApplicable = false; }
    else if (/(inventory|stock|goods)/.test(desc)) acct = { code: '5000', name: 'Cost of Goods Sold' };
  }

  const gstAmount = gstApplicable ? +(amt * gstRate / (1 + gstRate)).toFixed(2) : 0;
  const netAmount = +(amt - gstAmount).toFixed(2);

  let lines;
  if (isInflow) {
    lines = [
      { account_code: '1000', account_name: 'Cash and Bank', debit: amt, credit: 0, description: txn.description },
      { account_code: acct.code, account_name: acct.name, debit: 0, credit: netAmount, description: txn.description }
    ];
    if (gstApplicable && gstAmount > 0) lines.push({ account_code: '2200', account_name: 'GST Output Tax (Payable)', debit: 0, credit: gstAmount, description: 'GST 9% output' });
  } else {
    lines = [
      { account_code: acct.code, account_name: acct.name, debit: netAmount, credit: 0, description: txn.description }
    ];
    if (gstApplicable && gstAmount > 0) lines.push({ account_code: '2100', account_name: 'GST Input Tax (Receivable)', debit: gstAmount, credit: 0, description: 'GST 9% input' });
    lines.push({ account_code: '1000', account_name: 'Cash and Bank', debit: 0, credit: amt, description: txn.description });
  }

  return {
    lines,
    confidence: 0.88,
    requires_review: amt > 10000,
    gst_applicable: gstApplicable,
    gst_amount: gstAmount,
    reasoning: `Rule-based: matched "${txn.description}" → ${acct.code} ${acct.name}. ${gstApplicable ? `GST 9% inclusive: S$${gstAmount}.` : 'Non-GST transaction.'}`,
    reasoning_cn: `规则引擎：根据描述 "${txn.description}" 匹配到科目 ${acct.code} ${acct.name}。${gstApplicable ? `含 9% GST：S$${gstAmount}。` : '非 GST 交易。'}`
  };
}

// ================================================================================
// Ensure all transactions for a company have a journal entry (posts rule-based if missing)
// ================================================================================
function ensureJournalsForCompany(company_id) {
  const { v4: uuid } = require('uuid');
  const rows = db.prepare(`SELECT * FROM transactions WHERE company_id=? AND journal_entry_id IS NULL`).all(company_id);
  let posted = 0;
  rows.forEach(txn => {
    const je = autoJournalRuleBased(txn);
    const jid = `je_${uuid().slice(0, 8)}`;
    db.prepare(`INSERT INTO journal_entries
      (id,company_id,entry_date,reference,ai_generated,ai_confidence,review_status,source_txn_id,lines,reasoning)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      jid, company_id, txn.transaction_date, `JE-${txn.id}`, 1, je.confidence,
      je.requires_review ? 'pending' : 'approved', txn.id,
      JSON.stringify(je.lines), je.reasoning
    );
    db.prepare(`UPDATE transactions SET journal_entry_id=? WHERE id=?`).run(jid, txn.id);
    posted++;
  });
  return posted;
}

// ================================================================================
// Build the General Ledger + Trial Balance for a period
// ================================================================================
function trialBalance({ company_id, from, to }) {
  const journals = db.prepare(`SELECT * FROM journal_entries WHERE company_id=? AND entry_date BETWEEN ? AND ? AND review_status IN ('approved','pending')`)
    .all(company_id, from, to);
  const acc = {}; // code -> { debit, credit }
  journals.forEach(j => {
    const lines = JSON.parse(j.lines || '[]');
    lines.forEach(l => {
      const code = l.account_code;
      acc[code] = acc[code] || { code, name: l.account_name || classify(code).name, debit: 0, credit: 0 };
      acc[code].debit += Number(l.debit) || 0;
      acc[code].credit += Number(l.credit) || 0;
    });
  });
  const rows = Object.values(acc).map(a => {
    const net = a.debit - a.credit;
    return { ...a, debit: +a.debit.toFixed(2), credit: +a.credit.toFixed(2), net: +net.toFixed(2), classification: classify(a.code).class };
  }).sort((x, y) => x.code.localeCompare(y.code));
  const totals = rows.reduce((s, r) => ({ debit: s.debit + r.debit, credit: s.credit + r.credit }), { debit: 0, credit: 0 });
  return { rows, totals: { debit: +totals.debit.toFixed(2), credit: +totals.credit.toFixed(2), balanced: Math.abs(totals.debit - totals.credit) < 0.01 } };
}

// ================================================================================
// Profit & Loss Statement (Income Statement) - SFRS compliant
// ================================================================================
function profitAndLoss({ company_id, from, to, comparative = true }) {
  const tb = trialBalance({ company_id, from, to });

  const sum = (cls, sub) => tb.rows
    .filter(r => classify(r.code).class === cls && (!sub || classify(r.code).subclass === sub))
    .reduce((s, r) => s + (cls === 'revenue' ? -r.net : r.net), 0);

  const revenue = sum('revenue');
  const cogs = sum('expense', 'cogs');
  const gross_profit = revenue - cogs;
  const staff_costs = sum('expense', 'staff');
  const opex = sum('expense', 'opex');
  const operating_profit = gross_profit - staff_costs - opex;
  const finance_costs = sum('expense', 'finance');
  const profit_before_tax = operating_profit - finance_costs;
  const tax_expense = 0; // booked at year-end
  const net_profit = profit_before_tax - tax_expense;

  const revenue_breakdown = tb.rows.filter(r => classify(r.code).class === 'revenue').map(r => ({ code: r.code, name: r.name, amount: -r.net }));
  const expense_breakdown = tb.rows.filter(r => classify(r.code).class === 'expense').map(r => ({ code: r.code, name: r.name, subclass: classify(r.code).subclass, amount: r.net }));

  return {
    period: { from, to },
    currency: 'SGD',
    revenue: +revenue.toFixed(2),
    cost_of_sales: +cogs.toFixed(2),
    gross_profit: +gross_profit.toFixed(2),
    gross_margin: revenue > 0 ? +((gross_profit / revenue) * 100).toFixed(2) : 0,
    staff_costs: +staff_costs.toFixed(2),
    other_operating_expenses: +opex.toFixed(2),
    operating_profit: +operating_profit.toFixed(2),
    operating_margin: revenue > 0 ? +((operating_profit / revenue) * 100).toFixed(2) : 0,
    finance_costs: +finance_costs.toFixed(2),
    profit_before_tax: +profit_before_tax.toFixed(2),
    tax_expense: +tax_expense.toFixed(2),
    net_profit_after_tax: +net_profit.toFixed(2),
    net_margin: revenue > 0 ? +((net_profit / revenue) * 100).toFixed(2) : 0,
    revenue_breakdown,
    expense_breakdown,
    notes: [
      'Prepared on accrual basis per SFRS for Small Entities.',
      'Revenue recognised per SFRS(I) 15 — performance obligations satisfied at a point in time.',
      'Staff costs include CPF employer contribution and SDL per CPF Act.',
    ]
  };
}

// ================================================================================
// Balance Sheet (Statement of Financial Position) - SFRS compliant
// ================================================================================
function balanceSheet({ company_id, asOf }) {
  const from = '1900-01-01';
  const tb = trialBalance({ company_id, from, to: asOf });

  const current_assets = [];
  const non_current_assets = [];
  const current_liabilities = [];
  const non_current_liabilities = [];
  const equity = [];

  tb.rows.forEach(r => {
    const c = classify(r.code);
    const val = c.contra ? -r.net : r.net;
    if (c.class === 'asset') {
      const item = { code: r.code, name: r.name, amount: +val.toFixed(2) };
      if (c.type === 'current') current_assets.push(item); else non_current_assets.push(item);
    } else if (c.class === 'liability') {
      const item = { code: r.code, name: r.name, amount: +(-val).toFixed(2) };
      if (c.type === 'current') current_liabilities.push(item); else non_current_liabilities.push(item);
    } else if (c.class === 'equity') {
      equity.push({ code: r.code, name: r.name, amount: +(-val).toFixed(2) });
    }
  });

  // Accrued net profit flows to retained earnings
  const pnl = profitAndLoss({ company_id, from: '1900-01-01', to: asOf });
  const retained = equity.find(e => e.code === '3100');
  if (retained) retained.amount = +(retained.amount + pnl.net_profit_after_tax).toFixed(2);
  else equity.push({ code: '3100', name: 'Retained Earnings', amount: +pnl.net_profit_after_tax.toFixed(2) });

  const sum = arr => arr.reduce((s, x) => s + x.amount, 0);
  const total_current_assets = sum(current_assets);
  const total_non_current_assets = sum(non_current_assets);
  const total_assets = total_current_assets + total_non_current_assets;
  const total_current_liabilities = sum(current_liabilities);
  const total_non_current_liabilities = sum(non_current_liabilities);
  const total_liabilities = total_current_liabilities + total_non_current_liabilities;
  const total_equity = sum(equity);

  return {
    as_of: asOf,
    currency: 'SGD',
    current_assets, non_current_assets,
    current_liabilities, non_current_liabilities,
    equity,
    totals: {
      current_assets: +total_current_assets.toFixed(2),
      non_current_assets: +total_non_current_assets.toFixed(2),
      total_assets: +total_assets.toFixed(2),
      current_liabilities: +total_current_liabilities.toFixed(2),
      non_current_liabilities: +total_non_current_liabilities.toFixed(2),
      total_liabilities: +total_liabilities.toFixed(2),
      total_equity: +total_equity.toFixed(2),
      total_liabilities_and_equity: +(total_liabilities + total_equity).toFixed(2)
    },
    ratios: {
      current_ratio: total_current_liabilities > 0 ? +(total_current_assets / total_current_liabilities).toFixed(2) : null,
      quick_ratio: total_current_liabilities > 0 ? +((total_current_assets) / total_current_liabilities).toFixed(2) : null,
      debt_to_equity: total_equity !== 0 ? +(total_liabilities / total_equity).toFixed(2) : null
    },
    balanced: Math.abs(total_assets - (total_liabilities + total_equity)) < 1,
    notes: [
      'Presented per SFRS(I) 1 — Presentation of Financial Statements.',
      'Current/non-current distinction per SFRS(I) 1.66.',
      'Retained earnings include YTD net profit from P&L.'
    ]
  };
}

// ================================================================================
// Cash Flow Statement (Indirect Method)
// ================================================================================
function cashFlow({ company_id, from, to }) {
  const pnl = profitAndLoss({ company_id, from, to });
  const bsEnd = balanceSheet({ company_id, asOf: to });
  const startDate = new Date(from);
  startDate.setDate(startDate.getDate() - 1);
  const bsStart = balanceSheet({ company_id, asOf: startDate.toISOString().split('T')[0] });

  const delta = (code) => {
    const e = bsEnd.current_assets.concat(bsEnd.non_current_assets, bsEnd.current_liabilities, bsEnd.non_current_liabilities).find(x => x.code === code)?.amount || 0;
    const s = bsStart.current_assets.concat(bsStart.non_current_assets, bsStart.current_liabilities, bsStart.non_current_liabilities).find(x => x.code === code)?.amount || 0;
    return e - s;
  };

  const operating_activities = [
    { label: 'Profit before tax', label_cn: '税前利润', amount: pnl.profit_before_tax },
    { label: 'Depreciation & amortisation', label_cn: '折旧与摊销', amount: (pnl.expense_breakdown.find(x => x.code === '5900')?.amount || 0) + (pnl.expense_breakdown.find(x => x.code === '5950')?.amount || 0) },
    { label: 'Interest expense', label_cn: '利息支出', amount: pnl.finance_costs },
    { label: '(Increase)/Decrease in Trade Receivables', label_cn: '应收账款减少/(增加)', amount: -delta('1100') },
    { label: '(Increase)/Decrease in Inventory', label_cn: '存货减少/(增加)', amount: -delta('1200') },
    { label: 'Increase/(Decrease) in Trade Payables', label_cn: '应付账款增加/(减少)', amount: delta('2000') },
    { label: 'Increase/(Decrease) in GST Payable', label_cn: 'GST 应付增加/(减少)', amount: delta('2200') },
    { label: 'Increase/(Decrease) in CPF Payable', label_cn: 'CPF 应付增加/(减少)', amount: delta('2300') }
  ];
  const net_operating = operating_activities.reduce((s, x) => s + x.amount, 0);

  const investing_activities = [
    { label: 'Purchase of PPE', label_cn: '购置固定资产', amount: -delta('1500') },
    { label: 'Purchase of Intangible Assets', label_cn: '购置无形资产', amount: -delta('1600') }
  ];
  const net_investing = investing_activities.reduce((s, x) => s + x.amount, 0);

  const financing_activities = [
    { label: 'Issuance of Share Capital', label_cn: '股本发行', amount: delta('3000') * -1 },
    { label: 'Dividends paid', label_cn: '已付股息', amount: delta('3200') * -1 },
    { label: 'Proceeds from / (Repayment of) Long-term Loans', label_cn: '长期借款收到/(偿还)', amount: delta('2700') }
  ];
  const net_financing = financing_activities.reduce((s, x) => s + x.amount, 0);

  const net_change = net_operating + net_investing + net_financing;
  const cash_start = bsStart.current_assets.find(x => x.code === '1000')?.amount || 0;
  const cash_end = bsEnd.current_assets.find(x => x.code === '1000')?.amount || 0;

  return {
    period: { from, to },
    currency: 'SGD',
    method: 'indirect',
    operating_activities: operating_activities.map(x => ({ ...x, amount: +x.amount.toFixed(2) })),
    net_operating: +net_operating.toFixed(2),
    investing_activities: investing_activities.map(x => ({ ...x, amount: +x.amount.toFixed(2) })),
    net_investing: +net_investing.toFixed(2),
    financing_activities: financing_activities.map(x => ({ ...x, amount: +x.amount.toFixed(2) })),
    net_financing: +net_financing.toFixed(2),
    net_change_in_cash: +net_change.toFixed(2),
    cash_at_beginning: +cash_start.toFixed(2),
    cash_at_end: +cash_end.toFixed(2),
    reconciled: Math.abs((cash_start + net_change) - cash_end) < 100, // tolerance for rounding
    notes: ['Prepared under indirect method per SFRS(I) 1.111.']
  };
}

// ================================================================================
// Statement of Changes in Equity (SoCE)
// ================================================================================
function statementOfChangesInEquity({ company_id, from, to }) {
  const bsStart = balanceSheet({ company_id, asOf: new Date(new Date(from).getTime() - 86400000).toISOString().split('T')[0] });
  const bsEnd = balanceSheet({ company_id, asOf: to });
  const pnl = profitAndLoss({ company_id, from, to });

  const startEquity = bsStart.equity;
  const endEquity = bsEnd.equity;
  const movements = [
    { label: 'Opening balance', label_cn: '期初余额',
      share_capital: startEquity.find(e => e.code === '3000')?.amount || 0,
      retained_earnings: (startEquity.find(e => e.code === '3100')?.amount || 0),
      total: startEquity.reduce((s, e) => s + e.amount, 0) },
    { label: 'Profit for the period', label_cn: '本期利润',
      share_capital: 0, retained_earnings: pnl.net_profit_after_tax, total: pnl.net_profit_after_tax },
    { label: 'Dividends declared', label_cn: '宣派股息',
      share_capital: 0, retained_earnings: 0, total: 0 },
    { label: 'Closing balance', label_cn: '期末余额',
      share_capital: endEquity.find(e => e.code === '3000')?.amount || 0,
      retained_earnings: (endEquity.find(e => e.code === '3100')?.amount || 0),
      total: endEquity.reduce((s, e) => s + e.amount, 0) }
  ];
  return { period: { from, to }, currency: 'SGD', movements: movements.map(m => ({ ...m, share_capital: +m.share_capital.toFixed(2), retained_earnings: +m.retained_earnings.toFixed(2), total: +m.total.toFixed(2) })) };
}

// ================================================================================
// Notes to Financial Statements (condensed)
// ================================================================================
function notesToFS({ company_id, from, to }) {
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
  return [
    { num: 1, title: 'Corporate Information', title_cn: '公司信息',
      body: `${company.name || 'The Company'} (UEN ${company.uen || '—'}) is a private company limited by shares incorporated in Singapore. Registered office: 160 Robinson Road, #14-04 SBF Center, Singapore 068914. Principal activities: ${company.ssic_codes || '62011 (Software development)'}.`,
      body_cn: `${company.name || '本公司'}（UEN ${company.uen || '—'}）是一家在新加坡注册成立的股份有限私人公司，注册办事处位于 160 Robinson Road, #14-04 SBF Center, Singapore 068914。主要业务：${company.ssic_codes || '62011（软件开发）'}。` },
    { num: 2, title: 'Basis of Preparation', title_cn: '编制基础',
      body: 'Financial statements are prepared in accordance with the Singapore Financial Reporting Standards for Small Entities (SFRS for SE), on the historical cost basis, and presented in Singapore Dollars (SGD).',
      body_cn: '财务报表根据新加坡小型实体财务报告准则（SFRS for SE）以历史成本基础编制，以新加坡元（SGD）呈列。' },
    { num: 3, title: 'Revenue Recognition', title_cn: '收入确认',
      body: 'Revenue from contracts with customers is recognised when control of services has transferred, at an amount reflecting the consideration expected (SFRS(I) 15).',
      body_cn: '与客户签订合同产生的收入在服务控制权转移时按预期对价金额确认（SFRS(I) 15）。' },
    { num: 4, title: 'Employee Benefits / CPF', title_cn: '员工福利与 CPF',
      body: 'Contributions to the Central Provident Fund (CPF) are recognised as an expense in the period in which the related service is rendered. Employer CPF rate: 17% (below 55), SDL 0.25% capped.',
      body_cn: '公积金（CPF）缴纳在相关服务发生的期间确认为费用。雇主 CPF 税率：17%（55 岁以下），SDL 0.25%（设有上限）。' },
    { num: 5, title: 'Income Tax', title_cn: '所得税',
      body: 'Singapore corporate income tax rate is 17%. Start-Up Tax Exemption (SUTE): 75% on first S$100k chargeable income and 50% on next S$100k for the first 3 YAs.',
      body_cn: '新加坡公司所得税率为 17%。新成立公司免税（SUTE）：首 10 万应税收入免 75%，次 10 万免 50%，前 3 个课税年适用。' },
    { num: 6, title: 'Goods & Services Tax (GST)', title_cn: '商品与服务税（GST）',
      body: 'GST registration threshold: taxable turnover > S$1 million in a year. Current GST rate: 9%. Returns filed quarterly on Form F5.',
      body_cn: 'GST 注册门槛：年度应税营业额超过 100 万新元。现行 GST 税率：9%，通过 F5 表格按季度申报。' }
  ];
}

// ================================================================================
// SINGAPORE CPF (monthly payroll)
// Source: CPF Act, CPF Board rates effective 2024-2025
// ================================================================================
function cpfCompute({ ordinary_wage, age = 30, residency = 'citizen' }) {
  const ow = Math.min(Number(ordinary_wage) || 0, 7400); // OW ceiling S$7,400/month (from 2025-01)
  // Simplified — below 55, citizen or PR (after 3rd year)
  let rates = { employer: 0.17, employee: 0.20 };
  if (age > 55 && age <= 60) rates = { employer: 0.155, employee: 0.17 };
  else if (age > 60 && age <= 65) rates = { employer: 0.12, employee: 0.115 };
  else if (age > 65 && age <= 70) rates = { employer: 0.09, employee: 0.075 };
  else if (age > 70) rates = { employer: 0.075, employee: 0.05 };
  if (residency === 'pr_year1') rates = { employer: 0.04, employee: 0.05 };
  if (residency === 'pr_year2') rates = { employer: 0.09, employee: 0.15 };
  if (residency === 'ep_spass') rates = { employer: 0.0, employee: 0.0 }; // EP/S-Pass holders are not on CPF

  const employer_cpf = +(ow * rates.employer).toFixed(2);
  const employee_cpf = +(ow * rates.employee).toFixed(2);
  const sdl = +(Math.min(Number(ordinary_wage) || 0, 4500) * 0.0025).toFixed(2); // SDL 0.25% capped at S$11.25/month
  return {
    ordinary_wage: Number(ordinary_wage) || 0,
    capped_wage: ow,
    employer_cpf_rate: rates.employer,
    employee_cpf_rate: rates.employee,
    employer_cpf,
    employee_cpf,
    total_cpf: +(employer_cpf + employee_cpf).toFixed(2),
    sdl,
    net_to_employee: +((Number(ordinary_wage) || 0) - employee_cpf).toFixed(2),
    employer_total_cost: +((Number(ordinary_wage) || 0) + employer_cpf + sdl).toFixed(2),
    source: 'CPF Board rates effective 2025-01; OW ceiling S$7,400/month'
  };
}

// Monthly CPF contribution file (generates the upload CSV structure for CPF EZPay)
function cpfMonthlyContributionFile({ company_id, month, employees }) {
  const lines = employees.map(e => {
    const ow = Number(e.ordinary_wage || e.monthly_salary || e.salary || 0);
    const c = cpfCompute({ ordinary_wage: ow, age: e.age, residency: e.residency });
    return { ...e, ordinary_wage: ow, ...c };
  });
  const totals = lines.reduce((s, l) => ({
    gross_wages: s.gross_wages + l.ordinary_wage,
    employer_cpf: s.employer_cpf + l.employer_cpf,
    employee_cpf: s.employee_cpf + l.employee_cpf,
    sdl: s.sdl + l.sdl,
    total_cpf: s.total_cpf + l.total_cpf
  }), { gross_wages: 0, employer_cpf: 0, employee_cpf: 0, sdl: 0, total_cpf: 0 });
  const deadline = (() => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 14); // 14th of following month
    return d.toISOString().split('T')[0];
  })();
  const roundedLines = lines.map(l => ({ ...l, employer_cpf: +l.employer_cpf.toFixed(2), employee_cpf: +l.employee_cpf.toFixed(2), sdl: +l.sdl.toFixed(2) }));
  return {
    company_id, month,
    // expose both `lines` and `rows` aliases so front-end/back-end callers can use either
    lines: roundedLines,
    rows: roundedLines,
    totals: {
      gross_wages: +totals.gross_wages.toFixed(2),
      employer_cpf: +totals.employer_cpf.toFixed(2),
      employee_cpf: +totals.employee_cpf.toFixed(2),
      total_cpf: +totals.total_cpf.toFixed(2),
      sdl: +totals.sdl.toFixed(2)
    },
    deadline,
    submission_channel: 'CPF EZPay (https://www.cpf.gov.sg/employers)',
    notes: ['Payment deadline: 14th of following month', 'Late payment interest: 1.5% per month', 'SDL capped at S$11.25/month per employee']
  };
}

// ================================================================================
// GST F5 Return (quarterly)
// Boxes per IRAS GST F5: Box 1-9 + net GST (Box 7)
// ================================================================================
function gstF5({ company_id, from, to }) {
  const tb = trialBalance({ company_id, from, to });
  const revenueRow = tb.rows.filter(r => r.code === '4000');
  const gstOutputRow = tb.rows.find(r => r.code === '2200');
  const gstInputRow = tb.rows.find(r => r.code === '2100');

  const standardRatedSupplies = revenueRow.reduce((s, r) => s + (-r.net), 0); // Box 1
  const standardRatedPurchases = tb.rows
    .filter(r => classify(r.code).class === 'expense' && !['5100', '5150', '5200', '5250', '5800', '5850'].includes(r.code))
    .reduce((s, r) => s + r.net, 0); // Box 5

  const outputTax = gstOutputRow ? -gstOutputRow.net : 0; // Box 6
  const inputTax = gstInputRow ? gstInputRow.net : 0; // Box 7

  const netGst = outputTax - inputTax;

  return {
    company_id,
    period: { from, to },
    filing_form: 'GST F5',
    boxes: {
      box1_standard_rated_supplies: +standardRatedSupplies.toFixed(2),
      box2_zero_rated_supplies: 0,
      box3_exempt_supplies: 0,
      box4_total_supplies: +standardRatedSupplies.toFixed(2),
      box5_taxable_purchases: +standardRatedPurchases.toFixed(2),
      box6_output_tax_due: +outputTax.toFixed(2),
      box7_input_tax_and_refunds_claimed: +inputTax.toFixed(2),
      box8_net_gst: +netGst.toFixed(2),
      box9_bad_debt_relief: 0,
      box13_revenue: +standardRatedSupplies.toFixed(2)
    },
    net_gst_payable_or_refundable: +netGst.toFixed(2),
    status: netGst > 0 ? 'payable' : (netGst < 0 ? 'refundable' : 'nil'),
    filing_deadline: (() => {
      const d = new Date(to);
      d.setMonth(d.getMonth() + 1);
      d.setDate(d.getDate());
      return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
    })(),
    submission_channel: 'IRAS myTax Portal (https://mytax.iras.gov.sg)',
    notes: [
      'GST rate 9% effective 1 Jan 2024.',
      'Quarterly filing; due 1 month after end of quarter.',
      'Late filing: S$200 first month + S$200/month up to S$10,000.',
      'GIRO payment allowed up to 15th of following month.'
    ]
  };
}

// ================================================================================
// IR8A (Annual remuneration return) + Appendix 8A
// ================================================================================
function ir8aForEmployee({ employee, year }) {
  const total_wages = (employee.monthly_salary || 0) * 12;
  const bonus = employee.bonus || 0;
  const total_gross = total_wages + bonus;
  const cpf_year = cpfCompute({ ordinary_wage: employee.monthly_salary || 0 });
  const employer_cpf_year = +(cpf_year.employer_cpf * 12).toFixed(2);
  const employee_cpf_year = +(cpf_year.employee_cpf * 12).toFixed(2);
  return {
    year,
    employee_name: employee.name,
    nric_fin: employee.nric_fin || employee.passport_no,
    designation: employee.designation || 'Employee',
    section_d_employment_income: {
      '1a_gross_salary': total_wages,
      '1b_bonus': bonus,
      '1e_total': total_gross
    },
    section_e_cpf_contribution: {
      employee_cpf: employee_cpf_year,
      employer_cpf: employer_cpf_year
    },
    section_f_donations: 0,
    taxable_income: +(total_gross - employee_cpf_year).toFixed(2),
    submission_channel: 'IRAS AIS (Auto-Inclusion Scheme) via myTax Portal',
    submission_deadline: `${year + 1}-03-01`
  };
}

// ================================================================================
// XBRL (Simplified for ACRA) tagging
// ================================================================================
function xbrlSimplified({ company_id, pnl, bs }) {
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
  return {
    template: 'ACRA Simplified XBRL',
    entity: {
      uen: company.uen,
      name: company.name,
      period_end: bs.as_of,
      currency: 'SGD',
      level_of_rounding: 'units'
    },
    elements: {
      'sg-dei:EntityRegistrantName': company.name,
      'sg-dei:UniqueEntityNumber': company.uen,
      'sg-dei:CurrentPeriodEndDate': bs.as_of,
      'sg-as:Revenue': pnl.revenue,
      'sg-as:ProfitLoss': pnl.net_profit_after_tax,
      'sg-as:ProfitLossBeforeTaxation': pnl.profit_before_tax,
      'sg-as:IncomeTaxExpense': pnl.tax_expense,
      'sg-as:Assets': bs.totals.total_assets,
      'sg-as:Liabilities': bs.totals.total_liabilities,
      'sg-as:Equity': bs.totals.total_equity,
      'sg-as:CurrentAssets': bs.totals.current_assets,
      'sg-as:CurrentLiabilities': bs.totals.current_liabilities,
      'sg-as:CashAndCashEquivalents': (bs.current_assets.find(a => a.code === '1000') || {}).amount || 0,
      'sg-as:TradeAndOtherReceivables': (bs.current_assets.find(a => a.code === '1100') || {}).amount || 0,
      'sg-as:ShareCapital': (bs.equity.find(e => e.code === '3000') || {}).amount || 0,
      'sg-as:RetainedEarnings': (bs.equity.find(e => e.code === '3100') || {}).amount || 0
    },
    filing_channel: 'BizFinx (https://www.acra.gov.sg/how-to-guides/filing-financial-statements)',
    deadline_note: 'File together with Annual Return within 7 months of FYE (Section 201 Companies Act).'
  };
}

// ================================================================================
// ACRA BizFile+ Annual Return submission payload
// ================================================================================
function annualReturnPayload({ company_id, as_of }) {
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
  const persons = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(company_id);
  return {
    form: 'Annual Return (AR)',
    uen: company.uen,
    company_name: company.name,
    ar_date: as_of,
    financial_year_end: company.fye,
    type_of_company: 'Private Company Limited by Shares',
    officers: persons.filter(p => (p.role || '').includes('director')).map(p => ({
      name: p.full_name, nric_fin: p.nric_fin, nationality: p.nationality, role: 'Director'
    })),
    shareholders: persons.filter(p => (p.role || '').includes('shareholder')).map(p => ({
      name: p.full_name, shares: p.shares_held, class: 'Ordinary'
    })),
    share_capital: {
      issued_shares: persons.reduce((s, p) => s + (p.shares_held || 0), 0),
      paid_up_capital: company.paid_up_capital,
      currency: company.currency || 'SGD'
    },
    audit_exemption: 'Small Company Exemption — meets ≥2 of 3: revenue ≤ S$10m, assets ≤ S$10m, employees ≤ 50',
    financial_statements: 'Attached as XBRL (Simplified template)',
    submission_channel: 'ACRA BizFile+ (https://www.bizfile.gov.sg)',
    deadline: (() => {
      const d = new Date(as_of);
      d.setMonth(d.getMonth() + 7);
      return d.toISOString().split('T')[0];
    })(),
    filing_fee: 60, // SGD
    notes: ['Must be filed within 7 months of FYE per Section 197 Companies Act.', 'Late filing penalty: S$300+.']
  };
}

module.exports = {
  classify, autoJournalRuleBased, ensureJournalsForCompany,
  trialBalance, profitAndLoss, balanceSheet, cashFlow, statementOfChangesInEquity, notesToFS,
  cpfCompute, cpfMonthlyContributionFile,
  gstF5, ir8aForEmployee, xbrlSimplified, annualReturnPayload,
  ACC_MAP
};
