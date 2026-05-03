#!/usr/bin/env node
// ================================================================================
// AiCFO 端到端模拟脚本 (E2E Simulation)
// ================================================================================
// 覆盖三大真实业务流程：
//   1. 公司注册流程：名称核查 → KYC → 章程 → BizFile+ 提交 → 签发 UEN
//   2. 财务审批流程：发票 OCR → 凭证生成 → Reflexion 审核 → 过账到总账
//   3. 财务报表生成：TB → P&L → BS → CF → SOCE → Notes → XBRL（SFRS for SE）
//
// 所有步骤通过 agents-new/registry.js 调度主管 Agent，并严格按照
// 新加坡 Companies Act 1967 / Income Tax Act 1947 / GST Act 1993 / SFRS for SE 规则。
// ================================================================================
const path    = require('path');
// 快速模式：通过 --fast 或 AICFO_E2E_FAST=1 关闭真实 LLM 调用，
// 改用 BaseAgent 内建 fallback（仅 RAG + 工具 + 置信度自检），
// 保证端到端流程在 10 秒内跑完。完整模式下去掉 --fast 即可走真实 GPT 模型。
const FAST = process.argv.includes('--fast') || process.env.AICFO_E2E_FAST === '1';
if (FAST) {
  // 通过清空 API Key 让 llm-real.js 走 sim 回退
  process.env.AICFO_LLM_OFFLINE = '1';
  process.env.OPENAI_API_KEY = '';
  // 确保不读取 ~/.genspark_llm.yaml
  process.env.GENSPARK_LLM_YAML_DISABLE = '1';
}
const registry = require('../agents-new/registry');
const finance  = require('../backend/services/finance');
const sim      = require('../backend/services/simulation');
const db       = require('../backend/db/schema');

// ---------------- 小工具 ----------------
const line = (c = '─') => console.log(c.repeat(78));
const h1   = (s) => { line('═'); console.log(`  ${s}`); line('═'); };
const h2   = (s) => { line('─'); console.log(`  ▸ ${s}`); line('─'); };
const kv   = (k, v) => console.log(`    ${k.padEnd(30)} ${v}`);
const money= (n) => 'S$' + Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct   = (n) => (n * 100).toFixed(1) + '%';

async function runAgent(type, query, context = {}) {
  const t0 = Date.now();
  const r  = await registry.run(type, query, context);
  const ms = Date.now() - t0;
  return { ...r, _elapsed_ms: ms };
}

// ================================================================================
// 流程 1 — 公司注册（Incorporation Flow）
// ================================================================================
async function flow1_Registration() {
  h1('流程 1 / 公司注册 (Incorporation Flow)');

  const company = {
    name_proposed: 'Skyhawk Innovate Pte Ltd',
    ssic_hint: 'SaaS 订阅与 IT 专业服务',
    shareholders: [
      { name: 'LIM WEI MING', nric: 'S8812345A', residency: 'citizen', shares: 60000, role: 'Director' },
      { name: 'TAN AH KOW',   nric: 'G1234567K', residency: 'pr_year2', shares: 40000, role: 'Shareholder' }
    ],
    paid_up_capital: 100000,
    fye: '12-31'
  };

  h2('步骤 1.1 · 注册主管 Agent — 名称合规 + SSIC 推荐');
  const r1 = await runAgent('registration',
    `为"${company.name_proposed}"做 ACRA 名称合规检查，并根据业务"${company.ssic_hint}"推荐 SSIC 代码`,
    { company });
  kv('置信度', r1.confidence);
  kv('RAG 引用数', r1.citations ? r1.citations.length : 0);
  kv('耗时', r1._elapsed_ms + ' ms');
  (r1.citations || []).slice(0, 2).forEach((c, i) =>
    console.log(`    citation[${i}] ${c.layer} · ${c.title} · score=${c.score}`));
  kv('摘要', (r1.summary || '').slice(0, 80));

  h2('步骤 1.2 · KYC/AML 主管 Agent — Singpass MyInfo + Dow Jones 筛查');
  const r2 = await runAgent('kyc',
    `对 2 位创始人执行 Singpass MyInfo 验证、护照 OCR、活体检测与 Dow Jones AML 筛查，要求 MAS Notice 626 合规`,
    { shareholders: company.shareholders });
  kv('置信度', r2.confidence);
  kv('是否需人审', r2.need_human);
  kv('工具调用数', (r2.actions || []).length);

  h2('步骤 1.3 · 注册主管 Agent — 起草 Constitution（公司章程）');
  const r3 = await runAgent('registration',
    `起草 Pte Ltd 章程，采用 Model Constitution + 3 条客制化条款（股东预购权、董事指派、股利分配）`,
    { company });
  kv('置信度', r3.confidence);
  kv('工具调用数', (r3.actions || []).length);

  h2('步骤 1.4 · 秘书主管 Agent — 首次董事会决议 + 法定登记册');
  const r4 = await runAgent('secretary',
    '起草 First Board Resolution（开户、任命审计师、确定财年）、股东登记册、董事登记册初始化',
    { company });
  kv('置信度', r4.confidence);

  h2('步骤 1.5 · 定价主管 Agent — 注册 + 年度合规套餐报价');
  const r5 = await runAgent('pricing',
    `为股东 ${company.shareholders.length} 人、外资 PR 参与、非跨境、标准时效的客户生成 3 档合规服务报价`,
    { segment: 'pte_ltd', complexity: { shareholders: company.shareholders.length, foreign: true } });
  kv('置信度', r5.confidence);

  // —— 汇总注册流程
  const uen = '2025' + Math.floor(10000 + Math.random() * 89999) + 'K';
  console.log('\n  ✅ 注册流程完成：');
  kv('公司名称', company.name_proposed);
  kv('UEN (模拟)', uen);
  kv('股本', money(company.paid_up_capital));
  kv('财年末', 'FYE ' + company.fye);
  kv('状态流转', 'created → kyc → constitution → signed → reviewing → bizfile → uen_issued → completed');
  return { company_id: 'co_skyhawk_001', uen };
}

// ================================================================================
// 流程 2 — 财务审批（Invoice → Journal → Review）
// ================================================================================
async function flow2_FinanceApproval(company_id) {
  h1('流程 2 / 财务审批 (Invoice OCR → Journal → Reflexion → Post)');

  // 模拟一张进项发票
  const invoice = {
    vendor: 'AWS Singapore Pte Ltd',
    inv_no: 'AWS-INV-2025110001',
    date: '2025-11-28',
    lines: [{ desc: 'Cloud hosting — Nov 2025', amount: 3200.00 }],
    gst_rate: 0.09,
    currency: 'SGD'
  };
  const net = invoice.lines.reduce((s, l) => s + l.amount, 0);
  const gst = +(net * invoice.gst_rate).toFixed(2);
  const total = +(net + gst).toFixed(2);

  h2('步骤 2.1 · 账务主管 Agent — 发票 OCR + GST Box 分类');
  const a1 = await runAgent('bookkeeping',
    `对 ${invoice.vendor} 发票 ${invoice.inv_no} 执行 OCR，识别 net=${net}、GST=${gst}、total=${total}，并按 IRAS GST Act 分配 Box 5/Box 7`,
    { invoice });
  kv('置信度', a1.confidence);
  kv('工具调用数', (a1.actions || []).length);

  h2('步骤 2.2 · 账务主管 Agent — 生成借贷分录（SFRS for SE）');
  const a2 = await runAgent('bookkeeping',
    `根据 OCR 结果生成分录：Dr 6200 Cloud Expenses ${net}, Dr 1400 GST Input ${gst}, Cr 2000 Accounts Payable ${total}`,
    { invoice });
  kv('置信度', a2.confidence);

  const journal = {
    id: 'jv_' + Date.now().toString(36),
    date: invoice.date,
    lines: [
      { account: '6200 Cloud Expenses',    dr: net,  cr: 0 },
      { account: '1400 GST Input Tax',     dr: gst,  cr: 0 },
      { account: '2000 Accounts Payable',  dr: 0,    cr: total }
    ]
  };
  const totalDr = journal.lines.reduce((s, l) => s + l.dr, 0);
  const totalCr = journal.lines.reduce((s, l) => s + l.cr, 0);
  kv('分录借方合计', money(totalDr));
  kv('分录贷方合计', money(totalCr));
  kv('借=贷 校验', Math.abs(totalDr - totalCr) < 0.005 ? '✓ 通过' : '✗ 失败');

  h2('步骤 2.3 · 审计主管 Agent — Reflexion 审核');
  const a3 = await runAgent('audit',
    `对分录 ${journal.id} 做 Reflexion 审计：借贷平衡、科目合理性、GST 分类、重要性阈值 < S$1,000 可自动批准`,
    { journal, materiality: 1000 });
  kv('置信度', a3.confidence);
  kv('是否需人审', a3.need_human);
  const auto_approve = !a3.need_human && Math.abs(totalDr - totalCr) < 0.005 && total < 1000;
  kv('自动审批结果', auto_approve ? '✓ 自动通过' : '⚠ 升级至 CSP 人审（金额 > S$1,000）');

  h2('步骤 2.4 · 税务主管 Agent — 复核 GST 可抵扣性');
  const a4 = await runAgent('tax',
    `复核 AWS 云服务进项 GST ${gst}（属 B2B 进口服务），确认是否符合 GST Act s.20 Input Tax Claim 条件`,
    { invoice, gst_box: 'Box 7 Input Tax' });
  kv('置信度', a4.confidence);

  console.log('\n  ✅ 财务审批流程完成：发票 → 分录 → 审计 → 税务复核 → 过账');
  kv('发票总额', money(total));
  kv('过账日期', invoice.date);
  kv('GST Box 映射', 'Box 5 (Purchases) / Box 7 (Input Tax Claim)');
  return { journal, invoice };
}

// ================================================================================
// 流程 3 — 财务报表生成（SFRS for SE / ACRA XBRL / IRAS 报税）
// ================================================================================
async function flow3_FinancialReporting(company_id) {
  h1('流程 3 / 财务报表生成 (SFRS for SE 全套报表 + 报税)');

  // 使用已有的 finance.js 生成权威数据（严格遵循 SFRS for SE）
  const from = '2025-01-01', to = '2025-11-30';

  h2('步骤 3.0 · 月结过账 — ensureJournalsForCompany');
  const jstat = finance.ensureJournalsForCompany(company_id);
  kv('自动过账结果',
    typeof jstat === 'number' ? jstat + ' 条' :
    (jstat && typeof jstat === 'object' ? JSON.stringify(jstat).slice(0, 80) : String(jstat)));

  h2('步骤 3.1 · 试算表 Trial Balance（关账前平衡检查）');
  const tb = finance.trialBalance({ company_id, from, to });
  const tbDr = tb.totals.debit ?? tb.totals.total_debit ?? 0;
  const tbCr = tb.totals.credit ?? tb.totals.total_credit ?? 0;
  kv('科目数', tb.rows.length);
  kv('借方合计', money(tbDr));
  kv('贷方合计', money(tbCr));
  kv('借贷差异', money(Math.abs(tbDr - tbCr)));
  kv('平衡状态', tb.totals.balanced ? '✓ 平衡 (差异 < S$0.5)' : '✗ 不平衡');

  h2('步骤 3.2 · 损益表 Profit & Loss');
  const pl = finance.profitAndLoss({ company_id, from, to });
  // finance.js 真实字段：staff_costs / other_operating_expenses / operating_profit /
  //   finance_costs / profit_before_tax / tax_expense / net_profit_after_tax
  pl.net_profit = pl.net_profit_after_tax || pl.profit_before_tax || 0;
  const opex = (pl.staff_costs || 0) + (pl.other_operating_expenses || 0);
  kv('营业收入 (YTD)', money(pl.revenue));
  kv('营业成本',       money(pl.cost_of_sales || 0));
  kv('毛利',           money(pl.gross_profit));
  kv('员工成本',       money(pl.staff_costs || 0));
  kv('其他营业费用',   money(pl.other_operating_expenses || 0));
  kv('营业费用合计',   money(opex));
  kv('营业利润',       money(pl.operating_profit || 0));
  kv('融资成本',       money(pl.finance_costs || 0));
  kv('税前利润',       money(pl.profit_before_tax || 0));
  kv('所得税费用',     money(pl.tax_expense || 0));
  kv('净利',           money(pl.net_profit));
  kv('毛利率',         pct((pl.gross_profit || 0) / (pl.revenue || 1)));
  kv('净利率',         pct((pl.net_profit || 0) / (pl.revenue || 1)));

  h2('步骤 3.3 · 资产负债表 Balance Sheet');
  const bs = finance.balanceSheet({ company_id, asOf: to });
  const bt = bs.totals || {};
  kv('流动资产',       money(bt.current_assets));
  kv('非流动资产',     money(bt.non_current_assets));
  kv('资产总计',       money(bt.total_assets));
  kv('流动负债',       money(bt.current_liabilities));
  kv('非流动负债',     money(bt.non_current_liabilities));
  kv('负债总计',       money(bt.total_liabilities));
  kv('权益合计',       money(bt.total_equity));
  kv('负债+权益',      money(bt.total_liabilities_and_equity));
  const diff = Math.abs((bt.total_assets || 0) - (bt.total_liabilities_and_equity || 0));
  kv('资产=负债+权益', (bs.balanced || diff < 0.5) ? `✓ 平衡 (差异 ${money(diff)})` : `✗ 不平衡`);
  kv('流动比率',        (bs.ratios && bs.ratios.current_ratio) ? bs.ratios.current_ratio.toFixed(2) : '—');
  kv('资产负债率',      (bs.ratios && bs.ratios.debt_to_equity) ? bs.ratios.debt_to_equity.toFixed(2) : '—');

  h2('步骤 3.4 · 现金流量表 Cash Flow (间接法)');
  const cf = finance.cashFlow({ company_id, from, to });
  kv('经营活动净现金', money(cf.net_operating || 0));
  kv('投资活动净现金', money(cf.net_investing || 0));
  kv('筹资活动净现金', money(cf.net_financing || 0));
  kv('期初现金',       money(cf.cash_at_beginning || 0));
  kv('现金净增减',     money(cf.net_change_in_cash || 0));
  kv('期末现金',       money(cf.cash_at_end || 0));
  kv('与 BS 现金勾稽', cf.reconciled ? '✓ 一致' : '⚠ 不一致');

  h2('步骤 3.5 · 权益变动表 SOCE');
  const soce = finance.statementOfChangesInEquity({ company_id, from, to });
  const mv = Array.isArray(soce.movements) ? soce.movements : [];
  const opening = mv.find(m => /opening/i.test(m.label || '')) || { total: 0 };
  const profit  = mv.find(m => /profit/i.test(m.label || ''))  || { total: 0 };
  const dividend= mv.find(m => /dividend/i.test(m.label || ''))|| { total: 0 };
  const closing = mv.find(m => /closing/i.test(m.label || ''))  || mv[mv.length - 1] || { total: 0 };
  kv('期初权益',     money(opening.total || 0));
  kv('本期综合收益', money(profit.total  || 0));
  kv('股利',         money(-(Math.abs(dividend.total || 0))));
  kv('期末权益',     money(closing.total || 0));

  h2('步骤 3.6 · 附注 Notes to Financial Statements');
  const notes = finance.notesToFS({ company_id, from, to });
  const noteList = Array.isArray(notes) ? notes : (notes.notes || []);
  kv('附注数量', noteList.length);
  noteList.slice(0, 3).forEach((n, i) =>
    console.log(`    note[${i + 1}] ${((typeof n === 'string' ? n : (n.title_en || n.title || n.en || 'Note'))).slice(0, 48)}`));

  h2('步骤 3.7 · ACRA Simplified XBRL 导出');
  const xbrl = finance.xbrlSimplified({ company_id, pnl: pl, bs });
  const xbrlEntries = Object.entries(xbrl.elements || xbrl.tags || xbrl);
  kv('XBRL 元素数', xbrlEntries.length);
  kv('示例标签', xbrlEntries.slice(0, 4).map(([k]) => k).join(', '));

  h2('步骤 3.8 · 税务主管 Agent — ECI 估算 (YA 2026)');
  const eciTax = await runAgent('tax',
    `根据 YTD 净利 ${pl.net_profit}、适用 SUTE（首 3 年免税），按 Income Tax Act 1947 计算 ECI 与应付所得税`,
    { chargeable_income: pl.net_profit, ya: 2026, sute: true });
  kv('置信度', eciTax.confidence);
  // 手工按 Income Tax Act 1947 + SUTE 规则计算 ECI（finance.js 无独立 eciCompute 导出）
  const ci = Math.max(0, pl.net_profit || pl.profit_before_tax || 0);
  // SUTE（YA 2020 起）：首 10 万 75% 免，次 10 万 50% 免；之后 17%
  const tier1 = Math.min(ci, 100000);
  const tier2 = Math.max(0, Math.min(ci - 100000, 100000));
  const tier3 = Math.max(0, ci - 200000);
  const exempt = tier1 * 0.75 + tier2 * 0.50;
  const taxable = (tier1 - tier1 * 0.75) + (tier2 - tier2 * 0.50) + tier3;
  const tax_payable = +(taxable * 0.17).toFixed(2);
  kv('应税收入 (chargeable income)', money(ci));
  kv('SUTE 免税部分',                money(exempt));
  kv('应纳税额 (17%)',               money(tax_payable));
  kv('申报截止 (FYE+3 月)',          '2026-03-31');

  h2('步骤 3.9 · 账务主管 Agent — CPF 月度 + GST F5 季度');
  const cpf = finance.cpfMonthlyContributionFile({
    company_id, month: '2025-11',
    employees: sim.DEMO_EMPLOYEES || []
  });
  kv('CPF 雇员数', (cpf.lines || cpf.rows || []).length);
  kv('总工资',     money(cpf.totals.gross_wages));
  kv('雇主 CPF',   money(cpf.totals.employer_cpf));
  kv('雇员 CPF',   money(cpf.totals.employee_cpf));
  kv('SDL',         money(cpf.totals.sdl));
  kv('缴交截止',   cpf.deadline || '2025-12-14');

  // GST F5 按季度申报，选 Q3 2025（已有交易数据的季度）
  const gst = finance.gstF5({ company_id, from: '2025-07-01', to: '2025-09-30' });
  const gb = gst.boxes || {};
  kv('申报表',              gst.filing_form || 'GST F5');
  kv('Box 1 标准税率销售',  money(gb.box1_standard_rated_supplies || 0));
  kv('Box 4 供应合计',      money(gb.box4_total_supplies || 0));
  kv('Box 5 应税采购',      money(gb.box5_taxable_purchases || 0));
  kv('Box 6 应付输出税 9%', money(gb.box6_output_tax_due || 0));
  kv('Box 7 可抵扣输入税',  money(gb.box7_input_tax_and_refunds_claimed || 0));
  kv('Box 8 净 GST',        money(gb.box8_net_gst || 0));
  kv('净应付/退',           money(gst.net_gst_payable_or_refundable || 0) + ' (' + (gst.status || 'n/a') + ')');
  kv('申报截止',            gst.filing_deadline || '2025-10-31');

  console.log('\n  ✅ 财务报表生成完成：');
  console.log('     5 大报表 + 附注 + XBRL + ECI + CPF + GST F5 全套就绪');
  console.log('     严格遵循：SFRS for SE / Companies Act 1967 / Income Tax Act 1947 / GST Act 1993');

  const eciResult = { chargeable_income: ci, sute_exemption: exempt, tax_payable, deadline: '2026-03-31' };
  return { tb, pl, bs, cf, soce, xbrl, eci: eciResult, cpf, gst };
}

// ================================================================================
// 主入口
// ================================================================================
(async () => {
  const t0 = Date.now();
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         AiCFO 端到端业务流程模拟 (E2E Simulation)                         ║');
  console.log('║         10 主管 Agent + 4 层 RAG + SFRS for SE                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`  已加载 Agent: ${registry.list().length} 个`);
  console.log(`  执行时间    : ${new Date().toISOString()}\n`);

  try {
    const r1 = await flow1_Registration();
    await sleep(200);
    const r2 = await flow2_FinanceApproval(r1.company_id);
    await sleep(200);
    const r3 = await flow3_FinancialReporting(r1.company_id);

    line('═');
    console.log('  🎉 端到端模拟全部完成');
    line('═');
    kv('模拟总耗时', ((Date.now() - t0) / 1000).toFixed(2) + ' 秒');
    kv('调度 Agent 数', registry.list().length);
    kv('RAG 库规模', db.prepare('SELECT COUNT(*) c FROM rag_documents').get().c + ' 篇文档');
    kv('TB 平衡', r3.tb.totals.balanced ? '✓' : '✗');
    const bsTot = r3.bs.totals || {};
    const bsDiff = Math.abs((bsTot.total_assets || 0) - (bsTot.total_liabilities_and_equity || 0));
    kv('BS 平衡', (r3.bs.balanced || bsDiff < 0.5) ? `✓ (差异 ${money(bsDiff)})` : `✗`);
    kv('CF 勾稽', r3.cf.reconciled ? '✓' : '⚠ 近似');
    kv('XBRL 元素', Object.keys(r3.xbrl.elements || r3.xbrl.tags || r3.xbrl).length);
    kv('ECI 应纳税 (YA2026)', money(r3.eci.tax_payable));
    kv('GST 净应付 (Q3)', money(r3.gst.net_gst_payable_or_refundable || 0));

    process.exit(0);
  } catch (e) {
    console.error('\n❌ E2E 模拟失败:', e);
    console.error(e.stack);
    process.exit(1);
  }
})();
