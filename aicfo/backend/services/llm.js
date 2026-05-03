// Hybrid LLM service:
// - If OPENAI_API_KEY is configured, route schema calls to REAL OpenAI (GPT-5-mini via GenSpark proxy).
// - Otherwise fall back to the rule-based simulated LLM below (MVP offline mode).
// Public signature is preserved: complete({ system, messages, schema, context }).

let _real = null;
try { _real = require('./llm-real.js'); } catch (e) { /* optional */ }

function _extractPrompt(messages) {
  return (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
}

async function completeAsync({ system, messages, schema, context }) {
  if (_real && _real.isReady()) {
    try {
      const prompt = _extractPrompt(messages);
      const r = await _real.complete(prompt, schema, context || {});
      if (r && !r._error) {
        r._model = _real.model;
        r._real = true;
        return r;
      }
    } catch (e) {
      console.warn('[LLM] real call failed, using sim:', e.message);
    }
  }
  return completeSync({ system, messages, schema, context });
}

function complete(args) {
  // Preserve sync API where callers expect it, but also allow `await` for async real-LLM path.
  // Returns a Promise if real LLM is available; otherwise the sync simulated result.
  if (_real && _real.isReady()) return completeAsync(args);
  return completeSync(args);
}

function completeSync({ system, messages, schema, context }) {
  const lastUser = (messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  const lower = lastUser.toLowerCase();

  // Intent routing heuristic used by Master agent
  if (schema === 'intent') {
    let intent = 'general_chat', confidence = 0.6;
    if (/regist(er|ration)|incorp|setup company|注册|成立/.test(lower)) { intent = 'registration_agent'; confidence = 0.92; }
    else if (/kyc|singpass|passport|活体|身份/.test(lower)) { intent = 'kyc_agent'; confidence = 0.9; }
    else if (/invoice|发票|bookkeep|记账|journal|对账|reconcil/.test(lower)) { intent = 'bookkeeping_agent'; confidence = 0.9; }
    else if (/tax|eci|form c|gst|报税|税务|chargeable/.test(lower)) { intent = 'tax_agent'; confidence = 0.93; }
    else if (/agm|annual return|resolution|秘书|年报/.test(lower)) { intent = 'secretary_agent'; confidence = 0.88; }
    else if (/price|quote|多少钱|报价|cost/.test(lower)) { intent = 'pricing_agent'; confidence = 0.9; }
    else if (/contract|nda|opinion|法律/.test(lower)) { intent = 'legal_agent'; confidence = 0.85; }
    else if (/audit|working paper/.test(lower)) { intent = 'audit_agent'; confidence = 0.85; }
    else if (/due diligence|data room|尽调/.test(lower)) { intent = 'dd_agent'; confidence = 0.85; }
    return { intent, confidence, entities: extractEntities(lastUser), requires_auth: false, suggested_tool_calls: [] };
  }

  // Name compliance check
  if (schema === 'name_compliance') {
    const name = context?.name || lastUser;
    const sensitive = ['bank', 'finance', 'insurance', 'school', 'university', 'chamber of commerce'];
    const prohibited = ['temasek', 'president', 'government', 'royal'];
    const n = name.toLowerCase();
    if (prohibited.some(p => n.includes(p))) {
      return { compliance_verdict: 'fail', confidence: 0.97,
        reasoning: `Name contains prohibited word from Companies Act Section 27.`,
        reasoning_cn: '公司名包含《公司法》第27条明确禁止的词汇。',
        alternative_suggestions: suggestNames(name), regulatory_refs: ['Companies Act Section 27'] };
    }
    if (sensitive.some(s => n.includes(s))) {
      return { compliance_verdict: 'needs_approval', confidence: 0.88,
        reasoning: `Name contains regulated keyword; requires approval from MAS/MOE before ACRA can approve.`,
        reasoning_cn: '公司名包含受监管的敏感词，需先获得相关机构（如MAS）批准。',
        alternative_suggestions: suggestNames(name), regulatory_refs: ['Companies Act Section 27'] };
    }
    // Simulated ACRA similarity check (pseudo-random deterministic)
    const hash = hashCode(n);
    if (hash % 5 === 0) {
      return { compliance_verdict: 'fail', confidence: 0.9,
        reasoning: `Name too similar to existing "${name.toUpperCase()} TECHNOLOGIES PTE LTD".`,
        reasoning_cn: '公司名与已注册公司高度相似。',
        alternative_suggestions: suggestNames(name), regulatory_refs: ['Companies Act Section 27'] };
    }
    return { compliance_verdict: 'pass', confidence: 0.93,
      reasoning: 'Name appears available and compliant with ACRA rules.',
      reasoning_cn: '公司名可用，符合ACRA注册规则。',
      alternative_suggestions: [], regulatory_refs: ['Companies Act Section 27'] };
  }

  // Constitution generation
  if (schema === 'constitution') {
    return generateConstitution(context);
  }

  // Invoice OCR simulation
  if (schema === 'invoice_ocr') {
    return simulateInvoiceOCR(context);
  }

  // Journal entry generation
  if (schema === 'journal_entry') {
    return generateJournalEntry(context);
  }

  // Tax ECI calc
  if (schema === 'tax_eci') {
    return computeECI(context);
  }

  // Default: fallback conversational response
  return {
    text: buildConversationalResponse(system, lastUser, context),
    confidence: 0.8
  };
}

// ---------- Helpers ----------
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return Math.abs(h); }

function extractEntities(text) {
  const ent = {};
  const money = text.match(/S?\$\s?([\d,]+(?:\.\d+)?)/i);
  if (money) ent.amount = parseFloat(money[1].replace(/,/g, ''));
  const uen = text.match(/\b\d{8,10}[A-Z]\b/);
  if (uen) ent.uen = uen[0];
  const date = text.match(/\d{4}-\d{2}-\d{2}/);
  if (date) ent.date = date[0];
  return ent;
}

function suggestNames(base) {
  const clean = base.replace(/pte\s*ltd/i, '').trim();
  return [
    `${clean} Innovate Pte Ltd`,
    `${clean} Digital Pte Ltd`,
    `${clean} Ventures Pte Ltd`
  ];
}

function generateConstitution(ctx) {
  const name = ctx?.company_name || 'NewCo Pte Ltd';
  const capital = ctx?.capital || 1000;
  const shareholders = ctx?.shareholders || [];
  const sections = {
    '1_name_and_office': `The name of the Company is "${name}". The registered office shall be situated in Singapore.`,
    '2_objects_and_powers': `The Company shall have full capacity to carry on any business, subject to the provisions of the Companies Act 1967.`,
    '3_share_capital': `The issued share capital is S$${capital.toLocaleString()} divided into ${capital} ordinary shares of S$1.00 each (Companies Act s.62A).`,
    '4_transfer_of_shares': `Shares may be transferred only with Board approval; right of first refusal to existing shareholders (s.126).`,
    '5_transmission_of_shares': `On death of a shareholder, personal representative shall be registered upon providing probate (s.129).`,
    '6_general_meetings': `AGM to be held in accordance with s.175; any 2 members may requisition an EGM (s.176).`,
    '7_proceedings_at_meetings': `Quorum: 2 members personally present or by proxy. Chairman: elected by simple majority.`,
    '8_votes_of_members': `One vote per ordinary share on poll. Proxy form must be lodged 48 hours prior.`,
    '9_directors_appointment': `Minimum 1 director ordinarily resident in Singapore (s.145). Directors appointed/removed by ordinary resolution.`,
    '10_directors_proceedings': `Board quorum: 2 (or 1 if sole director). Written resolutions permitted in lieu of meetings.`,
    '11_secretary': `Company Secretary appointed by directors in accordance with s.171; must be ordinarily resident in Singapore.`,
    '12_seal': `Common seal (if any) may be affixed only by authority of a directors' resolution.`,
    '13_accounts_and_audit': `Accounts prepared in accordance with SFRS. Audit exemption applies if "small company" criteria met (s.205C).`,
    '14_dividends_and_reserves': `Dividends payable out of profits only (s.403). Interim dividends may be declared by directors.`,
    '15_notices': `Notices may be served personally, by post, or by electronic means (s.387).`
  };
  return {
    sections,
    summary: [
      '§3 Share Capital — verify amount and class of shares',
      '§4 Transfer restrictions — confirm right of first refusal',
      '§9 Director residency — at least 1 SG resident required',
      '§13 Audit exemption — check small company criteria',
      '§14 Dividend policy — confirm if interim dividends allowed'
    ],
    signatories: shareholders.map(s => s.name),
    generated_at: new Date().toISOString()
  };
}

function simulateInvoiceOCR(ctx) {
  // Context may include vendor hint
  const vendors = ['AWS Singapore', 'Google Asia Pacific', 'CapitaLand', 'Grab Enterprise', 'Canva Pro'];
  const vendor = ctx?.hint_vendor || vendors[Math.floor(Math.random() * vendors.length)];
  const subtotal = +(Math.random() * 3000 + 100).toFixed(2);
  const gst = +(subtotal * 0.09).toFixed(2);
  return {
    vendor_name: vendor,
    vendor_uen: null,
    invoice_number: `INV-${Date.now().toString().slice(-6)}`,
    issue_date: new Date().toISOString().split('T')[0],
    currency: 'SGD',
    subtotal,
    gst_amount: gst,
    gst_rate: 0.09,
    total: +(subtotal + gst).toFixed(2),
    line_items: [{ desc: `Service from ${vendor}`, qty: 1, unit_price: subtotal, amount: subtotal }],
    confidence: +(0.9 + Math.random() * 0.09).toFixed(2)
  };
}

function generateJournalEntry(ctx) {
  const { amount, description = '', invoice } = ctx;
  const isIncome = amount > 0;
  const abs = Math.abs(amount);
  const desc = description.toLowerCase();

  // Rule-based chart-of-accounts mapping
  let expenseCode = '6500', expenseName = 'Professional Fees';
  if (/aws|google|cloud|workspace|azure/i.test(description)) { expenseCode = '6300'; expenseName = 'Cloud Services'; }
  else if (/salary|payroll|staff/i.test(description)) { expenseCode = '5100'; expenseName = 'Staff Costs'; }
  else if (/rent/i.test(description)) { expenseCode = '5200'; expenseName = 'Rent'; }
  else if (/bank|fee|charge/i.test(description)) { expenseCode = '6900'; expenseName = 'Bank Charges'; }
  else if (/marketing|ads|advertis/i.test(description)) { expenseCode = '6400'; expenseName = 'Marketing'; }

  let entries, reasoning, confidence;
  if (isIncome) {
    entries = [
      { account_code: '1100', account_name: 'DBS Current Account', debit: abs, credit: 0 },
      { account_code: '4100', account_name: 'Service Revenue', debit: 0, credit: abs }
    ];
    reasoning = `Inflow of S$${abs} → debit cash, credit service revenue.`;
    confidence = 0.91;
  } else if (invoice && invoice.gst_amount) {
    const net = abs - invoice.gst_amount;
    entries = [
      { account_code: expenseCode, account_name: expenseName, debit: net, credit: 0 },
      { account_code: '2100', account_name: 'GST Input Tax', debit: invoice.gst_amount, credit: 0 },
      { account_code: '1100', account_name: 'DBS Current Account', debit: 0, credit: abs }
    ];
    reasoning = `Outflow with GST: expense ${expenseName} net + GST input tax recoverable.`;
    confidence = 0.93;
  } else {
    entries = [
      { account_code: expenseCode, account_name: expenseName, debit: abs, credit: 0 },
      { account_code: '1100', account_name: 'DBS Current Account', debit: 0, credit: abs }
    ];
    reasoning = `Outflow → debit ${expenseName}, credit cash.`;
    confidence = 0.86;
  }

  const requires_review = abs > 10000 || confidence < 0.85;
  return {
    entries, confidence, reasoning,
    requires_review,
    review_reason: requires_review ? (abs > 10000 ? 'Amount exceeds S$10,000 threshold' : 'Low confidence score') : null
  };
}

function computeECI(ctx) {
  const revenue = ctx?.revenue || 0;
  const expenses = ctx?.expenses || 0;
  const netProfit = revenue - expenses;
  // Chargeable income = net profit + non-deductible adjustments (simplified = 0)
  const chargeable = Math.max(0, netProfit);

  // SUTR (first 3 YAs, qualifying new company)
  const eligibleSUTR = ctx?.sutr_eligible !== false;
  let exempt = 0, taxable = chargeable;
  if (eligibleSUTR) {
    const first = Math.min(chargeable, 100000);
    const second = Math.max(0, Math.min(chargeable - 100000, 100000));
    exempt = first * 0.75 + second * 0.5;
    taxable = Math.max(0, chargeable - exempt);
  } else {
    // PTE
    const first = Math.min(chargeable, 10000) * 0.75;
    const second = Math.max(0, Math.min(chargeable - 10000, 190000)) * 0.5;
    exempt = first + second;
    taxable = Math.max(0, chargeable - exempt);
  }
  const tax = +(taxable * 0.17).toFixed(2);

  return {
    revenue, expenses, net_profit: netProfit,
    chargeable_income: chargeable,
    exempt_amount: +exempt.toFixed(2),
    taxable_income: +taxable.toFixed(2),
    tax_payable: tax,
    effective_rate: chargeable > 0 ? +(tax / chargeable * 100).toFixed(2) : 0,
    scheme: eligibleSUTR ? 'Start-Up Tax Exemption (SUTR)' : 'Partial Tax Exemption (PTE)',
    confidence: 0.94,
    deadline: getDeadline(ctx?.fye || '12-31'),
    notes: [
      'Basis period ending determines YA assignment.',
      'ECI must be filed within 3 months of FYE unless waiver conditions met.',
      'Payment can be made in installments via GIRO if ECI filed on time.'
    ]
  };
}

function getDeadline(fye) {
  const [mm, dd] = fye.split('-');
  const now = new Date();
  const year = now.getFullYear();
  const fyeDate = new Date(`${year}-${mm}-${dd}`);
  const deadline = new Date(fyeDate);
  deadline.setMonth(deadline.getMonth() + 3);
  return deadline.toISOString().split('T')[0];
}

function buildConversationalResponse(system, user, ctx) {
  // A minimal conversational assistant grounded in system prompt + user message.
  const hints = [
    'I can help with company registration, bookkeeping, tax filing and compliance.',
    'Key Singapore frameworks I work with: Companies Act, Income Tax Act, GST Act, SFRS.',
    'For any final filing I will flag a persistent CSP licensed reviewer.'
  ];
  return `Based on your question, here is what I can do:\n\n${hints.join('\n- ')}\n\nYou asked: "${user.slice(0, 200)}"\n\nLet me route this to the right specialist agent.`;
}

module.exports = { complete };
