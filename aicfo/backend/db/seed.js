// Seed initial data: admin user, sample company, built-in agents, RAG corpus
const db = require('./schema');
const { v4: uuid } = require('uuid');

function seed() {
  // --- Users ---
  const adminId = 'usr_admin_001';
  const cspId = 'usr_csp_001';
  const demoId = 'usr_demo_001';

  const upsertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, role, kyc_status, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  upsertUser.run(adminId, 'admin@aicfo.sg', 'AiCFO Admin', 'admin', 'passed', 'demo');
  upsertUser.run(cspId, 'csp@aicfo.sg', 'Kevin Tan (CSP)', 'csp', 'passed', 'demo');
  upsertUser.run(demoId, 'james@skyhawk.sg', 'James Chen', 'customer', 'passed', 'demo');

  // --- Demo company ---
  const companyId = 'co_skyhawk_001';
  db.prepare(`INSERT OR IGNORE INTO companies
    (id, uen, name, status, fye, ssic_codes, paid_up_capital, segment, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    companyId, '202501234K', 'Skyhawk Innovate Pte Ltd', 'active', '12-31',
    '62011,62021', 10000, 'china_outbound', demoId
  );

  // --- Built-in Agents ---
  const agents = [
    {
      id: 'agent_master', type: 'master', name: 'Master Orchestrator',
      description: 'ReAct + Reflexion router that delegates to sub-agents.',
      system_prompt: `You are AiCFO's Master Orchestrator. Route user requests to the right sub-agent.

# Sub-Agents
- registration_agent: Company registration, name check, constitution
- kyc_agent: Identity verification, AML screening
- bookkeeping_agent: Invoices, bank feeds, journal entries
- tax_agent: ECI, Form C-S, GST, tax optimization
- secretary_agent: AGM, Annual Return, resolutions
- dd_agent: Due diligence, data room
- audit_agent: Audit draft, working papers
- legal_agent: Contracts, resolutions, opinions
- pricing_agent: Quotes, package comparison
- escalate_human: Complex cases needing human CSP

# Output (STRICT JSON)
{"intent":"...","confidence":0.0,"entities":{},"requires_auth":false,"suggested_tool_calls":[]}

# Rules
- If confidence < 0.75, set intent to "escalate_human"
- Never execute tools directly, only suggest`,
      rag_layers: '["L1","L2","L3","L4"]'
    },
    {
      id: 'agent_registration', type: 'registration', name: 'Registration Agent',
      description: 'Handles ACRA company registration end-to-end.',
      system_prompt: `You are AiCFO's Registration Agent. Handle ACRA Pte Ltd registration.

Capabilities:
- Name compliance check (Companies Act Section 27)
- SSIC code recommendation
- Constitution drafting (ACRA Model Constitution)
- BizFile+ submission orchestration

Rules:
- Always cite Companies Act sections
- Flag sensitive keywords (Bank, Finance, Insurance) for MAS approval
- If confidence < 0.85, escalate to CSP human review`,
      rag_layers: '["L1","L2"]',
      tools: '["acra_name_search","ssic_recommend","constitution_generate","bizfile_submit"]'
    },
    {
      id: 'agent_kyc', type: 'kyc', name: 'KYC Agent',
      description: 'Identity verification, Singpass, passport OCR, AML screening.',
      system_prompt: `You are AiCFO's KYC Agent. Verify identity via Singpass/MyInfo or passport OCR + liveness.

Rules:
- Singpass for SG residents, passport OCR for foreigners
- Liveness threshold >= 0.85
- Always run AML screening (Dow Jones Risk Center)
- PEP / sanction hits must escalate to Compliance Officer immediately`,
      rag_layers: '["L1","L2"]',
      tools: '["singpass_oauth","passport_ocr","liveness_check","aml_screen"]'
    },
    {
      id: 'agent_bookkeeping', type: 'bookkeeping', name: 'Bookkeeping Agent',
      description: 'Invoice OCR, bank reconciliation, auto journal entries (SFRS).',
      system_prompt: `You are AiCFO's Bookkeeper. Generate double-entry journal based on transaction.

Rules:
1. Follow Singapore FRS (SFRS)
2. sum(debits) = sum(credits)
3. GST: separate "GST Input Tax" (2100) or "GST Output Tax" (2200)
4. Multi-currency: use base SGD, record FX gain/loss
5. Common patterns:
   - AWS/Google Cloud → Cloud Services (6300)
   - Salary → Staff Costs (5100)
   - Bank fees → Bank Charges (6900)

Set requires_review=true if amount > SGD 10,000 or confidence < 0.85.`,
      rag_layers: '["L2","L4"]',
      tools: '["invoice_ocr","bank_import","journal_generate","reconcile"]'
    },
    {
      id: 'agent_tax', type: 'tax', name: 'Tax Agent',
      description: 'ECI, Form C-S, GST, tax optimization for Singapore.',
      system_prompt: `You are AiCFO's Tax Agent specializing in Singapore tax law.

Scope:
- ECI estimate (within 3 months of FYE)
- Form C-S draft (revenue < S$5M)
- GST quarterly returns
- Partial Tax Exemption (PTE), Start-Up Tax Exemption (SUTE/SUTR)
- Section 13/14 deductions

Rules:
- Cite specific Income Tax Act sections
- Tax computation: Chargeable Income × 17% corporate rate
- Apply SUTR: first 3 YA: 75% exemption on first S$100K + 50% on next S$100K
- Flag if turnover crosses S$1M (GST registration mandatory)`,
      rag_layers: '["L1","L2","L4"]',
      tools: '["eci_compute","form_cs_draft","gst_quarterly","tax_optimize"]'
    },
    {
      id: 'agent_secretary', type: 'secretary', name: 'Company Secretary Agent',
      description: 'AGM, Annual Return, board resolutions, registers.',
      system_prompt: `You are AiCFO's Corporate Secretary Agent.

Responsibilities:
- AGM scheduling (within 6 months of FYE for public, flexible for Pte Ltd)
- Annual Return filing (within 7 months of FYE)
- Board/shareholder resolution drafting
- Maintain statutory registers (ROM, ROD, ROC)

Always reference Companies Act sections in resolutions.`,
      rag_layers: '["L1","L2"]',
      tools: '["resolution_draft","ar_file","register_update"]'
    },
    {
      id: 'agent_dd', type: 'dd', name: 'Due Diligence Agent',
      description: 'Data room generation, UBO mapping, risk flags.',
      system_prompt: `You are AiCFO's Due Diligence Agent. Support M&A / financing DD.

Produce:
- Virtual data room index
- UBO (Ultimate Beneficial Owner) map
- Red-flag register (litigation, AML, related-party)
- Historical financial summary (3 years)`,
      rag_layers: '["L2","L4"]',
      tools: '["data_room_gen","ubo_map","redflag_scan"]'
    },
    {
      id: 'agent_audit', type: 'audit', name: 'Audit Agent',
      description: 'Audit drafts, working papers, SFRS checks.',
      system_prompt: `You are AiCFO's Audit Support Agent.

Produce working papers for:
- Revenue recognition (SFRS 115)
- Lease accounting (SFRS 116)
- Financial instruments (SFRS 109)
- Going concern assessment

Flag audit thresholds: total assets > S$10M, revenue > S$10M, employees > 50.`,
      rag_layers: '["L1","L2","L4"]',
      tools: '["wp_generate","sfrs_check"]'
    },
    {
      id: 'agent_legal', type: 'legal', name: 'Legal Agent',
      description: 'Contracts, NDAs, opinions; not a substitute for a lawyer.',
      system_prompt: `You are AiCFO's Legal Drafting Agent. NOT legal advice; always flag "requires qualified lawyer review".

Draft:
- NDAs, service agreements, shareholders agreements
- Board resolutions, shareholder resolutions
- Cease & desist letters

Always include: "Disclaimer: For licensed attorney review before execution."`,
      rag_layers: '["L1","L2"]',
      tools: '["contract_draft","nda_gen","opinion_draft"]'
    }
  ];

  const agentStmt = db.prepare(`INSERT OR REPLACE INTO agents
    (id,name,type,description,system_prompt,model,temperature,tools,rag_layers,status,version,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  agents.forEach(a => {
    agentStmt.run(a.id, a.name, a.type, a.description, a.system_prompt,
      'aicfo-sim-1', 0.2, a.tools || '[]', a.rag_layers, 'active', '1.0.0', adminId);
  });

  // --- Chart of Accounts (Singapore standard) ---
  const coa = [
    ['1000', 'Cash', 'asset'], ['1100', 'DBS Current Account', 'asset'],
    ['1200', 'Accounts Receivable', 'asset'], ['1500', 'Fixed Assets', 'asset'],
    ['2100', 'GST Input Tax', 'liability'], ['2200', 'GST Output Tax', 'liability'],
    ['2300', 'Accounts Payable', 'liability'], ['3000', 'Share Capital', 'equity'],
    ['3100', 'Retained Earnings', 'equity'], ['4000', 'Revenue', 'income'],
    ['4100', 'Service Revenue', 'income'], ['5100', 'Staff Costs', 'expense'],
    ['5200', 'Rent', 'expense'], ['6300', 'Cloud Services', 'expense'],
    ['6400', 'Marketing', 'expense'], ['6500', 'Professional Fees', 'expense'],
    ['6900', 'Bank Charges', 'expense']
  ];
  const coaStmt = db.prepare(`INSERT OR IGNORE INTO chart_of_accounts (company_id,code,name,type) VALUES (?,?,?,?)`);
  coa.forEach(([c, n, t]) => coaStmt.run(companyId, c, n, t));

  // --- RAG corpus seed ---
  const ragDocs = [
    {
      layer: 'L1_regulatory', source: 'Companies Act',
      title: 'Companies Act Section 27 - Prohibited & Restricted Names',
      content: `Companies Act Section 27: A company shall not be registered under a name that the Registrar considers undesirable, or too similar to the name of an existing corporation. Sensitive words like "Bank", "Finance", "Insurance", "School", "University", "Chamber of Commerce" require approval from relevant authorities (e.g., MAS for financial terms). The name must end with "Private Limited" or "Pte Ltd" for private companies.`
    },
    {
      layer: 'L1_regulatory', source: 'Income Tax Act',
      title: 'Section 43 - Corporate Tax Rate',
      content: `Corporate income tax rate in Singapore is 17% of chargeable income. Partial Tax Exemption (PTE): 75% exemption on first S$10,000 chargeable income, 50% exemption on next S$190,000. Start-Up Tax Exemption (SUTR) for qualifying new companies: 75% exemption on first S$100,000, 50% on next S$100,000 for first 3 YAs.`
    },
    {
      layer: 'L1_regulatory', source: 'GST Act',
      title: 'GST Registration Threshold',
      content: `From 1 Jan 2024, standard GST rate is 9%. Compulsory registration: taxable turnover exceeds S$1 million over past 12 months, or expected to exceed S$1 million in next 12 months. Voluntary registration available. Quarterly returns due 1 month after end of accounting period.`
    },
    {
      layer: 'L2_practice', source: 'ACRA FAQ',
      title: 'Annual Return Filing Requirements',
      content: `Annual Return (AR) must be filed within 7 months from FYE for private companies. AGM must be held before AR filing (unless exempted). Financial statements (audited or unaudited based on "small company" criteria) must be attached. Late filing penalty starts at S$300 and escalates.`
    },
    {
      layer: 'L2_practice', source: 'IRAS e-Tax Guide',
      title: 'ECI Filing - Estimated Chargeable Income',
      content: `Companies must file ECI within 3 months after FYE unless turnover <= S$5M AND ECI is NIL. Filing is done via myTax Portal. Companies meeting waiver criteria need not file. ECI forms basis of installment plan for tax payment.`
    },
    {
      layer: 'L3_pricing', source: 'AiCFO Pricing',
      title: 'Company Registration Pricing Matrix',
      content: `Registration base price S$388 (AI full-auto, 95% automation). Add-ons: Nominee Director S$1,800/yr, Registered Address S$288/yr, Company Secretary S$388/yr. Complexity factors: each additional shareholder +5%, cross-border +25%, industry risk 0-15%.`
    },
    {
      layer: 'L3_pricing', source: 'Competitor Scrape',
      title: 'Competitor Pricing - Osome/Sleek/Counto',
      content: `Osome: Registration S$840, Secretary+Address S$1,200/yr, Bookkeeping from S$150/mo. Sleek: Registration S$800, bundled S$1,500/yr. Counto: Registration S$788, "Complete Pack" S$1,400/yr. 3E Accounting: Registration S$688 entry, many up-sells.`
    },
    {
      layer: 'L2_practice', source: 'SFRS',
      title: 'SFRS 115 - Revenue Recognition',
      content: `Five-step model: (1) Identify contract with customer, (2) Identify performance obligations, (3) Determine transaction price, (4) Allocate price to obligations, (5) Recognize revenue when/as obligations satisfied. Variable consideration estimated using expected value or most likely amount method.`
    }
  ];
  const docStmt = db.prepare(`INSERT OR IGNORE INTO rag_documents
    (id,layer,source,title,content,metadata,chunk_count,status) VALUES (?,?,?,?,?,?,?,?)`);
  const chunkStmt = db.prepare(`INSERT OR IGNORE INTO rag_chunks
    (id,document_id,layer,content,embedding,token_count,chunk_index) VALUES (?,?,?,?,?,?,?)`);

  ragDocs.forEach((d, idx) => {
    const docId = `rag_doc_${idx.toString().padStart(3, '0')}`;
    docStmt.run(docId, d.layer, d.source, d.title, d.content,
      JSON.stringify({ seeded: true }), 1, 'indexed');
    // simple mock embedding: hash-based 16-dim vector
    const vec = mockEmbed(d.content);
    chunkStmt.run(`chunk_${idx.toString().padStart(3, '0')}`, docId, d.layer,
      d.content, JSON.stringify(vec), d.content.split(/\s+/).length, 0);
  });

  // --- Pricing history for RAG L3 ---
  const priceSeed = [
    ['registration', 'local_sg', 1, 0, 50, 'AiCFO', 388],
    ['registration', 'china_outbound', 2, 1, 200, 'AiCFO', 588],
    ['registration', 'web3', 3, 1, 1000, 'Osome', 1200],
    ['bookkeeping_monthly', 'local_sg', 1, 0, 100, 'Counto', 150],
    ['bookkeeping_monthly', 'china_outbound', 2, 1, 500, 'Sleek', 450],
    ['tax_annual', 'local_sg', 1, 0, 50, '3E Accounting', 680],
    ['secretary_annual', 'local_sg', 1, 0, 0, 'AiCFO', 388],
    ['nominee_director', 'china_outbound', 2, 1, 0, 'AiCFO', 1800]
  ];
  const ps = db.prepare(`INSERT OR IGNORE INTO pricing_history
    (id,service,segment,shareholders,cross_border,monthly_txn,competitor,price) VALUES (?,?,?,?,?,?,?,?)`);
  priceSeed.forEach((row, i) => ps.run(`price_${i.toString().padStart(3, '0')}`, ...row));

  // --- Reminders for demo company ---
  const today = new Date();
  const add = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; };
  const rm = db.prepare(`INSERT OR IGNORE INTO reminders (id,company_id,type,due_date,status) VALUES (?,?,?,?,?)`);
  rm.run('rem_001', companyId, 'ECI', add(30), 'pending');
  rm.run('rem_002', companyId, 'AR', add(90), 'pending');
  rm.run('rem_003', companyId, 'GST', add(14), 'pending');

  // --- Sample transactions ---
  const txn = db.prepare(`INSERT OR IGNORE INTO transactions
    (id,company_id,transaction_date,amount,currency,description,counterparty) VALUES (?,?,?,?,?,?,?)`);
  const txnSeed = [
    ['txn_001', '2025-04-02', -1288.50, 'SGD', 'AWS Cloud Services', 'AWS Singapore'],
    ['txn_002', '2025-04-05', 25000, 'SGD', 'Customer Payment INV-0123', 'Acme Corp'],
    ['txn_003', '2025-04-08', -8500, 'SGD', 'April Salary - Staff', 'Payroll'],
    ['txn_004', '2025-04-10', -2180, 'SGD', 'Office Rent', 'CapitaLand'],
    ['txn_005', '2025-04-12', -298, 'SGD', 'Google Workspace', 'Google Asia Pacific'],
    ['txn_006', '2025-04-15', 8800, 'SGD', 'Consulting Fee', 'Nova Ventures'],
    ['txn_007', '2025-04-20', -45.60, 'SGD', 'DBS Service Charges', 'DBS Bank']
  ];
  txnSeed.forEach(r => txn.run(r[0], companyId, ...r.slice(1)));

  // --- Sample invoices ---
  const inv = db.prepare(`INSERT OR IGNORE INTO invoices
    (id,company_id,vendor_name,invoice_number,issue_date,total,gst_amount,currency,ocr_confidence,status) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  inv.run('inv_001', companyId, 'AWS Singapore', 'AWS-2025-0401', '2025-04-01', 1288.50, 106.50, 'SGD', 0.98, 'matched');
  inv.run('inv_002', companyId, 'Google Asia Pacific', 'GW-9900', '2025-04-10', 298, 24.60, 'SGD', 0.95, 'matched');
  inv.run('inv_003', companyId, 'CapitaLand', 'RENT-APR', '2025-04-01', 2180, 180, 'SGD', 0.99, 'matched');

  console.log('[SEED] Completed. Admin/CSP/Demo users + 9 agents + 8 RAG docs + demo transactions loaded.');
}

// Simple deterministic mock embedding (16-dim) for demo.
function mockEmbed(text) {
  const vec = new Array(16).fill(0);
  const clean = text.toLowerCase();
  for (let i = 0; i < clean.length; i++) {
    vec[i % 16] += clean.charCodeAt(i) / 255;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => +(v / norm).toFixed(4));
}

module.exports = { seed, mockEmbed };

if (require.main === module) seed();
