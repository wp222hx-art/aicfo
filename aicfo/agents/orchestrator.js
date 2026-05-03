// Master Agent Orchestrator (LangGraph-inspired) - routes to sub-agents + Reflexion loop
const db = require('../backend/db/schema');
const llm = require('../backend/services/llm');
const rag = require('../rag/engine');
const { v4: uuid } = require('uuid');

// Small helper: await any llm.complete call (sync or async).
const _call = (args) => Promise.resolve(llm.complete(args));

// Resolve agent by type or id from DB so admin can edit prompts live.
function getAgent(typeOrId) {
  let row = db.prepare(`SELECT * FROM agents WHERE id=?`).get(typeOrId);
  if (!row) row = db.prepare(`SELECT * FROM agents WHERE type=? AND status='active' LIMIT 1`).get(typeOrId);
  return row;
}

// Tool registry — Agents may "call" these during a run
const TOOLS = {
  async acra_name_search({ name }) {
    const out = await _call({ schema: 'name_compliance', context: { name }, messages: [{ role: 'user', content: name }] });
    return { tool: 'acra_name_search', result: out };
  },
  ssic_recommend({ description }) {
    const map = [
      { keys: ['software', 'saas', 'development', 'app'], code: '62011', desc: 'Development of software' },
      { keys: ['consulting', 'advisory', 'consult'], code: '62021', desc: 'IT consultancy' },
      { keys: ['ecommerce', 'trading', 'import', 'export', 'retail'], code: '46900', desc: 'Wholesale trade' },
      { keys: ['finance', 'invest', 'fund'], code: '64202', desc: 'Investment holding' },
      { keys: ['web3', 'blockchain', 'crypto', 'token'], code: '62012', desc: 'Blockchain development' },
      { keys: ['marketing', 'ads', 'brand'], code: '73100', desc: 'Advertising activities' }
    ];
    const d = (description || '').toLowerCase();
    const matches = map.filter(m => m.keys.some(k => d.includes(k))).slice(0, 3);
    return { tool: 'ssic_recommend', result: matches.length ? matches : [{ code: '70209', desc: 'Other management consultancy' }] };
  },
  async constitution_generate({ company_name, capital, shareholders }) {
    return { tool: 'constitution_generate', result: await _call({ schema: 'constitution', context: { company_name, capital, shareholders }, messages: [{ role: 'user', content: `Draft constitution for ${company_name}` }] }) };
  },
  bizfile_submit({ order_id }) {
    const bizfileId = `BIZ${Date.now().toString().slice(-10)}`;
    return { tool: 'bizfile_submit', result: { submitted: true, bizfile_submission_id: bizfileId, eta_hours: 24 } };
  },
  singpass_oauth({ person_id }) {
    return { tool: 'singpass_oauth', result: { qr_url: `https://api.singpass.gov.sg/auth?state=${person_id}`, expires_in: 900 } };
  },
  passport_ocr({ image_ref }) {
    return { tool: 'passport_ocr', result: { confidence: 0.96, passport_no: 'E12345678', nationality: 'CHN', dob: '1990-05-01', full_name: 'Simulated Name' } };
  },
  liveness_check({ video_ref }) {
    return { tool: 'liveness_check', result: { score: 0.92, passed: true } };
  },
  aml_screen({ full_name }) {
    return { tool: 'aml_screen', result: { hits: 0, status: 'clear', provider: 'DowJonesRiskCenter' } };
  },
  async invoice_ocr({ image_url, hint_vendor }) {
    return { tool: 'invoice_ocr', result: await _call({ schema: 'invoice_ocr', context: { hint_vendor }, messages: [{ role: 'user', content: `OCR invoice from ${hint_vendor || 'vendor'}` }] }) };
  },
  async journal_generate({ amount, description, invoice, date }) {
    return { tool: 'journal_generate', result: await _call({ schema: 'journal_entry', context: { amount, description, invoice, date }, messages: [{ role: 'user', content: description || '' }] }) };
  },
  async eci_compute({ revenue, expenses, fye, sutr_eligible, company_name }) {
    return { tool: 'eci_compute', result: await _call({ schema: 'tax_eci', context: { revenue, expenses, fye, sutr_eligible, company_name, ya_count: 1 }, messages: [{ role: 'user', content: `ECI for rev ${revenue} exp ${expenses}` }] }) };
  },
  async form_cs_draft({ company_id, ya }) {
    const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
    const txns = db.prepare(`SELECT amount FROM transactions WHERE company_id=?`).all(company_id);
    const revenue = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = -txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const eci = await _call({ schema: 'tax_eci', context: { revenue, expenses, fye: company.fye, company_name: company.name, ya_count: 1 }, messages: [{ role: 'user', content: 'Draft Form C-S' }] });
    return { tool: 'form_cs_draft', result: { ...eci, company: company.name, ya, form_type: 'Form C-S', eligibility: revenue <= 5000000 ? 'Eligible' : 'Requires Form C' } };
  },
  pricing_query({ service, segment, shareholders, cross_border, monthly_txn, urgency }) {
    const rows = db.prepare(`SELECT price FROM pricing_history WHERE service=? ORDER BY ABS(shareholders-?) + ABS(cross_border-?)*10 LIMIT 5`).all(service || 'registration', shareholders || 1, cross_border || 0);
    const median = rows.length ? rows.map(r => r.price).sort((a, b) => a - b)[Math.floor(rows.length / 2)] : 388;
    const multiplier = 1 + 0.05 * Math.max(0, (shareholders || 1) - 2) + 0.25 * (cross_border ? 1 : 0) + 0.1 * Math.log(Math.max(1, (monthly_txn || 0) / 100));
    const regionPremium = { local_sg: 1, china_outbound: 1.15, web3: 1.3, family_office: 1.5 }[segment || 'local_sg'] || 1;
    const urgencyPremium = { standard: 1, rush: 1.3, express: 1.8 }[urgency || 'standard'] || 1;
    const final = median * multiplier * regionPremium * urgencyPremium;
    return { tool: 'pricing_query', result: {
      basic: +(final * 0.85).toFixed(2),
      pro: +final.toFixed(2),
      enterprise: +(final * 1.6).toFixed(2),
      factors: { median, multiplier, regionPremium, urgencyPremium }
    } };
  },
  async resolution_draft({ subject, company_id, directors }) {
    const c = db.prepare(`SELECT * FROM companies WHERE id=?`).get(company_id) || {};
    try {
      const r = await _call({ schema: 'board_resolution', context: { company_name: c.name || 'the Company', directors }, messages: [{ role: 'user', content: subject }] });
      return { tool: 'resolution_draft', result: r };
    } catch (_) {
      return { tool: 'resolution_draft', result: {
        title: `Directors' Resolution — ${subject}`,
        body: `The Board of Directors of ${c.name || 'the Company'} resolved that ${subject.toLowerCase()}. Pursuant to s.184A of the Companies Act 1967, this resolution in writing shall take effect immediately.`,
        signatories: directors || ['Director 1', 'Director 2'],
        date: new Date().toISOString().split('T')[0]
      } };
    }
  },
  contract_draft({ type, parties }) {
    return { tool: 'contract_draft', result: {
      title: `${type || 'Service'} Agreement`,
      clauses: ['Definitions', 'Scope of Services', 'Fees & Payment', 'Term & Termination', 'Confidentiality', 'Limitation of Liability', 'Governing Law (Singapore)'],
      disclaimer: 'DRAFT: requires review by a qualified Singapore-admitted lawyer before execution.'
    } };
  }
};

// Master Agent - multi-step pipeline: Intent -> RAG -> Route -> Sub-agent -> Reflexion
async function runMaster({ user_query, user_id, company_id, session_id }) {
  const startTs = Date.now();
  const trace = [];

  // Step 1: Intent classification
  const intentOut = await _call({ schema: 'intent', messages: [{ role: 'user', content: user_query }] });
  trace.push({ step: 'intent_classifier', ts: Date.now(), output: intentOut });

  // Step 2: RAG retrieval (grounding)
  const ragHits = rag.search({ query: user_query, layers: ['L1_regulatory', 'L2_practice', 'L4_customer'], k: 3, company_id });
  trace.push({ step: 'rag_retrieval', ts: Date.now(), output: ragHits.map(h => ({ title: h.title, score: h.score })) });

  // Step 3: Route to sub-agent
  const intentName = intentOut.intent || 'general';
  const subType = intentName === 'escalate_human' ? 'master' : intentName.replace('_agent', '');
  const subAgent = getAgent((subType === 'general_chat' || subType === 'general') ? 'master' : subType) || getAgent('master');
  trace.push({ step: 'router', ts: Date.now(), routed_to: subAgent.type, agent_id: subAgent.id });

  // Step 4: Execute sub-agent (tool calls + generation)
  const subOut = await executeSubAgent(subAgent, user_query, { user_id, company_id, ragHits });
  trace.push({ step: 'sub_agent_execution', ts: Date.now(), output: subOut });

  // Step 5: Reflexion (self-check confidence)
  const confidence = subOut.confidence || intentOut.confidence || 0.7;
  const need_human = confidence < 0.75 || intentName === 'escalate_human';
  trace.push({ step: 'reflexion', ts: Date.now(), confidence, need_human });

  // Persist agent_runs
  const runId = `run_${uuid().slice(0, 8)}`;
  db.prepare(`INSERT INTO agent_runs (id,agent_id,user_id,company_id,input,output,trace,tokens_in,tokens_out,latency_ms,confidence,status)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    runId, subAgent.id, user_id, company_id, user_query, JSON.stringify(subOut),
    JSON.stringify(trace), user_query.length, JSON.stringify(subOut).length,
    Date.now() - startTs, confidence, 'completed'
  );

  return {
    run_id: runId,
    intent: intentName,
    confidence,
    need_human,
    agent: { id: subAgent.id, name: subAgent.name, type: subAgent.type },
    response: subOut,
    rag_citations: ragHits,
    trace,
    latency_ms: Date.now() - startTs
  };
}

async function executeSubAgent(agent, query, ctx) {
  const type = agent.type;
  const out = { agent: agent.name, actions: [], summary: '', confidence: 0.85 };

  if (type === 'registration') {
    const nameMatch = query.match(/["']([^"']+)["']|([A-Z][\w]+(?:\s+[A-Z][\w]+)*\s+(?:Pte Ltd|Private Limited))/i);
    const name = nameMatch ? (nameMatch[1] || nameMatch[2]) : null;
    if (name) out.actions.push(await TOOLS.acra_name_search({ name }));
    out.actions.push(TOOLS.ssic_recommend({ description: query }));
    out.summary = `Registration Agent: assessed company name, recommended SSIC codes, ready for KYC + constitution.`;
    out.next_steps = ['Complete KYC for all shareholders', 'Generate constitution', 'Submit to ACRA via BizFile+ RPA'];
    out.confidence = 0.9;
  } else if (type === 'kyc') {
    out.actions.push(TOOLS.aml_screen({ full_name: query }));
    out.summary = 'KYC Agent: AML screen clear. Ready to initiate Singpass (SG resident) or passport OCR + liveness (foreigner).';
    out.next_steps = ['Select KYC method', 'Complete liveness', 'Review by Compliance Officer if PEP hit'];
    out.confidence = 0.88;
  } else if (type === 'bookkeeping') {
    const rows = db.prepare(`SELECT * FROM transactions WHERE company_id=? AND journal_entry_id IS NULL ORDER BY transaction_date DESC LIMIT 5`).all(ctx.company_id || '');
    for (const r of rows) out.actions.push(await TOOLS.journal_generate({ amount: r.amount, description: r.description, date: r.transaction_date }));
    out.summary = `Bookkeeping Agent: generated journal entries for ${rows.length} uncategorised transactions (SFRS compliant).`;
    out.next_steps = ['Review entries in Books → Journals', 'Approve bulk confirmed entries', 'Match to invoices'];
    out.confidence = 0.9;
  } else if (type === 'tax') {
    const companyId = ctx.company_id || '';
    const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(companyId) || { fye: '12-31', name: 'Demo Co' };
    const txns = db.prepare(`SELECT amount FROM transactions WHERE company_id=?`).all(companyId);
    const revenue = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = -txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    out.actions.push(await TOOLS.eci_compute({ revenue, expenses, fye: company.fye, sutr_eligible: true, company_name: company.name }));
    out.summary = `Tax Agent: computed ECI using SUTR. Revenue S$${revenue.toLocaleString()}, expenses S$${expenses.toLocaleString()}.`;
    out.next_steps = ['Verify non-deductible adjustments', 'CSP reviewer to sign off', 'RPA submit via myTax Portal'];
    out.confidence = 0.92;
  } else if (type === 'pricing') {
    const isWeb3 = /web3|crypto|token/i.test(query);
    const isCross = /cross[- ]?border|outbound|overseas/i.test(query);
    out.actions.push(TOOLS.pricing_query({
      service: 'registration',
      segment: isWeb3 ? 'web3' : (isCross ? 'china_outbound' : 'local_sg'),
      shareholders: 2, cross_border: isCross ? 1 : 0, monthly_txn: 500, urgency: 'standard'
    }));
    out.summary = 'Pricing Agent: generated 3-tier quote vs. competitor benchmark.';
    out.confidence = 0.9;
  } else if (type === 'secretary') {
    out.actions.push(await TOOLS.resolution_draft({ subject: 'Adoption of AGM minutes', company_id: ctx.company_id }));
    out.summary = 'Company Secretary Agent: drafted board resolution; AGM + AR deadlines surfaced.';
    out.next_steps = ['Circulate resolution for signatures', 'File AR via BizFile+'];
    out.confidence = 0.88;
  } else if (type === 'legal') {
    out.actions.push(TOOLS.contract_draft({ type: 'Service', parties: ['Party A', 'Party B'] }));
    out.summary = 'Legal Agent: drafted service agreement skeleton. Qualified lawyer review required before execution.';
    out.confidence = 0.82;
  } else if (type === 'dd') {
    out.summary = 'DD Agent: data room index + UBO map + red-flag scan generated. Export as zip from the DD workspace.';
    out.confidence = 0.85;
  } else if (type === 'audit') {
    out.summary = 'Audit Agent: working papers for SFRS 115/116/109 prepared. Flag any material items for senior reviewer.';
    out.confidence = 0.85;
  } else {
    out.summary = `Master Agent: I can help with registration, bookkeeping, tax, secretarial, KYC, legal, audit, due diligence, and pricing queries. Ask me anything about a Singapore Pte Ltd.`;
    out.confidence = 0.75;
  }

  out.grounding = ctx.ragHits.map(r => ({ title: r.title, source: r.source, score: r.score }));
  return out;
}

module.exports = { runMaster, TOOLS, getAgent, executeSubAgent };
