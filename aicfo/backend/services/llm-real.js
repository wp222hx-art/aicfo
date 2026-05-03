// AiCFO Real LLM Service — 经由统一 Tokenhot/OpenAI-兼容网关
// Falls back to simulated LLM if API key is missing or a call fails.
const gateway = require('./llm-gateway');

function getClient() {
  if (process.env.AICFO_LLM_OFFLINE === '1') return null;
  return gateway.getClient();
}

// --- In-memory response cache (keyed by schema+input hash) ---
const cache = new Map();
function hashKey(obj) {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return String(h);
}

function DEFAULT_MODEL() { return gateway.getModel({ purpose: 'default' }); }

/**
 * Calls a real LLM with JSON-mode. Returns parsed object.
 * @param {string} system - System prompt.
 * @param {string} user - User prompt.
 * @param {object} opts - { schema_hint, model, tier, purpose, temperature, max_tokens }.
 */
async function chatJSON(system, user, opts = {}) {
  if (!gateway.isReady()) throw new Error('LLM client not configured');
  const model = gateway.getModel({ model: opts.model, tier: opts.tier, purpose: opts.purpose || opts.schema_hint });
  const key = hashKey({ system, user, schema: opts.schema_hint || null, model });
  if (cache.has(key)) return cache.get(key);

  const r = await gateway.chat({
    system: system + '\n\nIMPORTANT: Respond ONLY with a valid JSON object. No prose, no markdown fences.',
    user,
    purpose: opts.purpose || opts.schema_hint,
    tier: opts.tier,
    model: opts.model,
    json: true
  });
  const raw = r.content || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) {
    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    try { parsed = JSON.parse(cleaned); } catch (_) { parsed = { _raw: raw, _error: 'parse_failed' }; }
  }
  if (parsed && typeof parsed === 'object') parsed._model = r.model;
  cache.set(key, parsed);
  return parsed;
}

async function chatText(system, user, opts = {}) {
  if (!gateway.isReady()) throw new Error('LLM client not configured');
  const r = await gateway.chat({
    system, user,
    purpose: opts.purpose || opts.schema_hint,
    tier: opts.tier, model: opts.model,
    temperature: opts.temperature
  });
  return r.content || '';
}

// ================================================================================
// Schema-specific helpers (match the mock LLM's schemas)
// ================================================================================
const sim = require('./llm.js');

async function complete(prompt, schema, ctx = {}) {
  const client = getClient();
  // If no client, always fall back to simulated LLM.
  if (!client) return sim.complete(prompt, schema, ctx);

  try {
    switch (schema) {
      case 'intent': return await schemaIntent(prompt);
      case 'name_compliance': return await schemaNameCompliance(prompt, ctx);
      case 'constitution': return await schemaConstitution(prompt, ctx);
      case 'invoice_ocr': return await schemaInvoiceOCR(prompt, ctx);
      case 'journal_entry': return await schemaJournalEntry(prompt, ctx);
      case 'tax_eci': return await schemaTaxECI(prompt, ctx);
      case 'management_report': return await schemaManagementReport(prompt, ctx);
      case 'board_resolution': return await schemaBoardResolution(prompt, ctx);
      case 'agent_plan': return await schemaAgentPlan(prompt, ctx);
      case 'agent_synthesize': return await schemaAgentSynthesize(prompt, ctx);
      default: return await schemaChat(prompt, ctx);
    }
  } catch (e) {
    console.warn('[LLM] Real call failed, falling back to sim:', e.message);
    return sim.complete(prompt, schema, ctx);
  }
}

async function schemaIntent(prompt) {
  const sys = `You are AiCFO's intent router for a Singapore corporate compliance AI platform.
Classify the user's message into one of these agent intents:
- registration_agent: company registration, name check, SSIC, BizFile+, incorporation
- kyc_agent: Singpass, MyInfo, ID verification, KYC/AML, passport OCR, liveness
- bookkeeping_agent: transactions, invoices, OCR, journals, ledger, reconciliation
- tax_agent: ECI, Form C-S, corporate tax, GST, tax exemption, IRAS filings
- secretary_agent: AGM, annual return, board resolutions, statutory registers
- legal_agent: contracts, NDA, shareholder agreements, legal opinions
- dd_agent: due diligence, data room, UBO, red-flag scan
- audit_agent: working papers, SFRS, audit, going concern
- pricing_agent: pricing, quote, fees, competitor comparison
- general: greetings, small talk, unclear intent

Extract entities: amount (SGD), uen (e.g. 202501234K), dates (YYYY-MM-DD).

Return strict JSON: { "intent": "<id>", "confidence": <0-1>, "entities": { "amount": number|null, "uen": string|null, "dates": string[] }, "reasoning_en": string, "reasoning_cn": string }`;
  return await chatJSON(sys, prompt, { schema_hint: 'intent' });
}

async function schemaNameCompliance(prompt, ctx) {
  const sys = `You are AiCFO's name compliance checker for Singapore Pte Ltd companies.
Check the proposed company name against ACRA Companies Act Section 27:
- Prohibited words: Bank, Finance, Insurance, Trust, School, Medical, Government, Temasek, MAS, Police, Presidential
- Sensitive words: International, Global, National, Holdings (may need approval)
- Must end with "Pte Ltd" or "Private Limited"
- Similar existing names can cause rejection

Return strict JSON: { "proposed_name": string, "verdict": "pass"|"fail"|"needs_approval", "confidence": <0-1>, "reasoning": string, "reasoning_cn": string, "regulatory_refs": ["Companies Act Section 27", ...], "alternatives": [string, ...], "issues": [string, ...] }
If verdict is pass, alternatives can be empty. If fail/needs_approval, provide 3-5 alternatives.`;
  const user = `Proposed name: "${prompt}"\nSuffix: ${ctx.suffix || 'Pte Ltd'}\nActivity: ${ctx.activity || 'general'}`;
  return await chatJSON(sys, user, { schema_hint: 'name_compliance' });
}

async function schemaConstitution(prompt, ctx) {
  const sys = `You are a Singapore company secretary drafting a Pte Ltd Constitution.
Generate a complete, legally-sound Constitution following ACRA Model Constitution for Singapore private companies.

Return strict JSON: {
  "company_name": string,
  "uen_placeholder": string,
  "clauses": [
    { "number": "1", "title": "NAME", "content": string },
    { "number": "2", "title": "REGISTERED OFFICE", "content": string },
    { "number": "3", "title": "OBJECTS AND POWERS", "content": string },
    { "number": "4", "title": "LIABILITY OF MEMBERS", "content": string },
    { "number": "5", "title": "SHARE CAPITAL", "content": string },
    { "number": "6", "title": "TRANSFER OF SHARES", "content": string },
    { "number": "7", "title": "GENERAL MEETINGS", "content": string },
    { "number": "8", "title": "DIRECTORS", "content": string },
    { "number": "9", "title": "DIVIDENDS", "content": string },
    { "number": "10", "title": "WINDING UP", "content": string }
  ],
  "summary_en": string,
  "summary_cn": string,
  "checklist": [ { "item": string, "done": boolean } ],
  "generated_at": string
}`;
  const user = `Company: ${ctx.company_name || prompt}\nBusiness: ${ctx.business || 'General business'}\nShare capital: S$${ctx.capital || 1000}\nDirectors: ${JSON.stringify(ctx.shareholders || [])}`;
  return await chatJSON(sys, user, { schema_hint: 'constitution', model: 'gpt-5-mini' });
}

async function schemaInvoiceOCR(prompt, ctx) {
  const sys = `You are an OCR + structured extraction engine for Singapore vendor invoices.
Extract fields with high accuracy. GST rate is 9% (from 2024). If vendor has GST registration number (format: 20xxxxxxxx or M90012345K), include it.

Return strict JSON: {
  "vendor": string,
  "vendor_gst_reg": string,
  "invoice_number": string,
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "currency": "SGD",
  "line_items": [ { "description": string, "qty": number, "unit_price": number, "amount": number } ],
  "subtotal": number,
  "gst_rate": 0.09,
  "gst_amount": number,
  "total": number,
  "confidence": <0-1>,
  "suggested_account": string,
  "suggested_account_code": string
}`;
  const user = `Invoice filename/hint: ${prompt}\nCompany context: ${ctx.company_name || 'Skyhawk Innovate Pte Ltd'}`;
  return await chatJSON(sys, user, { schema_hint: 'invoice_ocr' });
}

async function schemaJournalEntry(prompt, ctx) {
  const sys = `You are AiCFO's auto-journal AI for Singapore SFRS / small-company bookkeeping.
Generate a double-entry journal for the transaction. Use Singapore Chart of Accounts codes:
1000 Cash/Bank · 1100 AR · 1200 Inventory · 1500 Fixed Assets · 2000 AP · 2100 GST Input · 2200 GST Output
2500 Accruals · 3000 Share Capital · 3100 Retained Earnings · 4000 Revenue · 5000 COGS
5100 Staff Costs · 5200 CPF · 5300 Rent · 5400 Utilities · 5500 IT/Software · 5600 Marketing
5700 Professional Fees · 5800 Bank Charges · 5900 Depreciation · 6000 Other Expenses

Confidence threshold: if amount > S$10,000 OR unclear description, set requires_review=true.

Return strict JSON: {
  "lines": [ { "account_code": string, "account_name": string, "debit": number, "credit": number, "description": string } ],
  "reasoning": string,
  "reasoning_cn": string,
  "confidence": <0-1>,
  "requires_review": boolean,
  "gst_applicable": boolean,
  "gst_amount": number
}
Lines MUST balance (sum debit == sum credit).`;
  const user = `Date: ${ctx.date || 'today'}\nDescription: ${prompt}\nAmount: S$${ctx.amount}\nDirection: ${ctx.amount < 0 ? 'outflow (expense/payment)' : 'inflow (revenue/receipt)'}`;
  return await chatJSON(sys, user, { schema_hint: 'journal_entry' });
}

async function schemaTaxECI(prompt, ctx) {
  const sys = `You are AiCFO's IRAS-certified tax computation engine for Singapore corporate income tax (CIT).

RULES:
- Corporate tax rate: 17% of chargeable income
- Start-Up Tax Exemption (SUTE) (first 3 YAs): 75% exemption on first S$100,000, 50% on next S$100,000
- Partial Tax Exemption (PTE): 75% on first S$10,000, 50% on next S$190,000
- Eligibility for SUTE: incorporated in SG, tax resident in SG, ≤20 shareholders (at least 1 individual holds ≥10%), not investment-holding/property-dev company
- ECI filing deadline: 3 months after FYE
- Tax rebate (if applicable in YA): cap at S$2,000

Return strict JSON: {
  "revenue": number, "expenses": number, "net_profit": number,
  "adjustments": { "non_deductible": number, "capital_allowances": number, "other": number },
  "chargeable_income": number,
  "scheme": "SUTE"|"PTE",
  "scheme_reasoning": string,
  "exempt_amount": number, "taxable_income": number,
  "gross_tax": number, "rebate": number, "tax_payable": number,
  "effective_rate": number,
  "ya": number, "fye": "YYYY-MM-DD", "filing_deadline": "YYYY-MM-DD",
  "confidence": <0-1>,
  "notes": [string, ...],
  "notes_cn": [string, ...]
}`;
  const user = `Company: ${ctx.company_name || 'Skyhawk Innovate Pte Ltd'}\nFYE: ${ctx.fye || '2025-12-31'}\nRevenue: S$${ctx.revenue}\nExpenses: S$${ctx.expenses}\nCompany age (YAs since incorporation): ${ctx.ya_count || 1}\nUser query: ${prompt}`;
  return await chatJSON(sys, user, { schema_hint: 'tax_eci' });
}

async function schemaManagementReport(prompt, ctx) {
  const sys = `You are AiCFO's management accountant. Generate an executive monthly management report for a Singapore Pte Ltd.
Must include: exec summary, KPIs (revenue MoM/YoY, gross margin, opex, cash runway, AR days, AP days), risks, cash-flow alerts, tax calendar, action items. Be concise, data-driven, bilingual (EN + CN summary).

Return strict JSON: {
  "period": string, "company": string, "generated_at": string,
  "executive_summary_en": string, "executive_summary_cn": string,
  "kpis": [ { "label": string, "label_cn": string, "value": string, "delta": string, "status": "good"|"warn"|"bad" } ],
  "highlights": [string, ...],
  "risks": [ { "title": string, "severity": "low"|"medium"|"high", "mitigation": string } ],
  "cash_runway_months": number,
  "tax_calendar_next_30d": [ { "event": string, "due_date": "YYYY-MM-DD" } ],
  "action_items": [ { "owner": string, "task": string, "due": "YYYY-MM-DD" } ]
}`;
  const user = `Period: ${ctx.period}\nCompany: ${ctx.company_name}\nFinancials: ${JSON.stringify(ctx.financials || {})}\nUser ask: ${prompt}`;
  return await chatJSON(sys, user, { schema_hint: 'management_report', model: 'gpt-5-mini' });
}

async function schemaBoardResolution(prompt, ctx) {
  const sys = `You are a Singapore-qualified corporate secretary drafting a Board Resolution in writing.
Follow Singapore Companies Act Section 184A (resolutions in writing).

Return strict JSON: {
  "resolution_number": string,
  "company_name": string,
  "date": "YYYY-MM-DD",
  "directors_present": [string, ...],
  "whereas_clauses": [string, ...],
  "resolved_clauses": [string, ...],
  "signature_block": string,
  "summary_en": string,
  "summary_cn": string
}`;
  const user = `Company: ${ctx.company_name || 'Skyhawk Innovate Pte Ltd'}\nTopic: ${prompt}\nDirectors: ${JSON.stringify(ctx.directors || ['James Chen'])}`;
  return await chatJSON(sys, user, { schema_hint: 'board_resolution' });
}

async function schemaChat(prompt, ctx) {
  const sys = `You are AiCFO, the AI-first corporate brain for Singapore SMEs. You help founders with:
- Company registration (ACRA BizFile+)
- Bookkeeping (SFRS compliant)
- Corporate tax (IRAS CIT, GST, ECI, Form C-S)
- Company secretarial (AGM, Annual Return, resolutions)
- Compliance & KYC

Be concise, cite Singapore regulations where relevant, give actionable next steps. Answer in the user's language (Chinese if the user writes in Chinese).

Return strict JSON: {
  "summary": string,
  "next_steps": [string, ...],
  "actions": [ { "tool": string, "params": object } ],
  "grounding": [string, ...],
  "confidence": <0-1>
}`;
  const user = `${ctx.company_name ? `Company: ${ctx.company_name}\n` : ''}User: ${prompt}`;
  return await chatJSON(sys, user, { schema_hint: 'chat' });
}

// ================================================================================
// Agent 规划 Schema —— 供 BaseAgent.plan() 使用
// ================================================================================
async function schemaAgentPlan(prompt, ctx) {
  const sys = `You are an execution planner for an AiCFO specialized agent.
Agent role: ${ctx.agent_role || 'unknown'}
Agent system prompt:
${ctx.system_prompt || '(none)'}

You receive:
- The user's / upstream agent's query
- RAG retrieval context (Singapore regulations / playbooks / pricing / customer history)
- A list of available tools the agent may call

Produce an execution plan. Return STRICT JSON:
{
  "thought": "1-2 sentence reasoning (bilingual EN/中文 allowed)",
  "tool_calls": [ { "tool": "<one of available_tools>", "args": { ... } } ],
  "next": "synthesize" | "reflect" | "escalate",
  "confidence": <0-1>
}
Rules:
- Only call tools from available_tools. If none fit, return empty tool_calls.
- Keep args minimal and JSON-serializable.
- If the query involves figures/amounts/regulations, cite them in thought.`;
  const user = `User query: ${ctx.user_query || prompt}

Available tools: ${JSON.stringify(ctx.available_tools || [])}

RAG context:
${ctx.rag_context || '(empty)'}

Business context: ${JSON.stringify(ctx.business_context || {}).slice(0, 500)}`;
  return await chatJSON(sys, user, { schema_hint: 'agent_plan' });
}

async function schemaAgentSynthesize(prompt, ctx) {
  const sys = `You are an AiCFO specialized agent synthesizing final output.
Agent role: ${ctx.agent_role || 'unknown'}

You are given the user query, the results of tool calls the agent executed, and RAG context.
Produce a concise, professional summary for the user. Return STRICT JSON:
{
  "summary": "2-4 sentence bilingual summary (EN + 中文 if applicable)",
  "highlights": [string, ...],
  "confidence": <0-1>,
  "need_human": boolean,
  "next_steps": [string, ...]
}
Rules:
- Cite Singapore regulations (Companies Act, Income Tax Act, GST Act, SFRS, MAS 626) if relevant.
- If any tool failed or produced low-confidence output, set need_human=true.`;
  const user = `User query: ${ctx.user_query || prompt}

Tool results:
${JSON.stringify(ctx.tool_results || [], null, 2).slice(0, 2000)}

RAG titles: ${JSON.stringify(ctx.rag_context || [])}`;
  return await chatJSON(sys, user, { schema_hint: 'agent_synthesize' });
}

module.exports = {
  complete,
  chatJSON,
  chatText,
  isReady: () => gateway.isReady(),
  get model() { return DEFAULT_MODEL(); }
};
