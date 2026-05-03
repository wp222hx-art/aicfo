// AiCFO Database Schema - SQLite (MVP), maps to Postgres DDL in production
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'aicfo.db');
if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
  -- ========= Users & Companies =========
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT,
    role TEXT DEFAULT 'customer', -- customer | csp | admin
    kyc_status TEXT DEFAULT 'pending',
    password_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    uen TEXT UNIQUE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    fye TEXT,
    ssic_codes TEXT,
    paid_up_capital REAL DEFAULT 1000,
    currency TEXT DEFAULT 'SGD',
    registered_address TEXT,
    subscription_tier TEXT DEFAULT 'basic',
    segment TEXT DEFAULT 'local_sg', -- local_sg | china_outbound | web3 | family_office
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- ========= Registration Orders =========
  CREATE TABLE IF NOT EXISTS registration_orders (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    user_id TEXT,
    stage TEXT DEFAULT 'created', -- created|kyc|constitution|signed|reviewing|bizfile|completed
    progress REAL DEFAULT 0,
    price_sgd REAL,
    stripe_payment_intent TEXT,
    bizfile_submission_id TEXT,
    csp_reviewer_id TEXT,
    csp_notes TEXT,
    approved_at TEXT,
    completed_at TEXT,
    timeline TEXT DEFAULT '[]', -- JSON
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- ========= Persons (shareholders / directors) =========
  CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    role TEXT NOT NULL, -- shareholder | director | secretary
    type TEXT DEFAULT 'individual',
    full_name TEXT,
    nric_fin TEXT,
    passport_no TEXT,
    nationality TEXT,
    residential_address TEXT,
    shares_held INTEGER DEFAULT 0,
    kyc_session_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  -- ========= KYC Sessions =========
  CREATE TABLE IF NOT EXISTS kyc_sessions (
    id TEXT PRIMARY KEY,
    person_id TEXT,
    method TEXT, -- singpass | passport_ocr
    myinfo_payload TEXT,
    liveness_score REAL,
    aml_screening_result TEXT,
    status TEXT DEFAULT 'pending', -- pending | passed | failed | manual_review
    reviewed_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    FOREIGN KEY (person_id) REFERENCES persons(id)
  );

  -- ========= Documents =========
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    kind TEXT, -- constitution | resolution | certificate | invoice | tax_draft
    version INTEGER DEFAULT 1,
    file_path TEXT,
    hash_sha256 TEXT,
    blockchain_tx TEXT,
    generated_by_ai INTEGER DEFAULT 0,
    signed_by TEXT,
    content TEXT, -- Inline content for small docs
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Bookkeeping =========
  CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT,
    code TEXT,
    name TEXT,
    type TEXT, -- asset | liability | equity | income | expense
    parent_id INTEGER,
    UNIQUE(company_id, code)
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    bank_code TEXT,
    account_number_masked TEXT,
    currency TEXT DEFAULT 'SGD',
    last_synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    bank_account_id TEXT,
    transaction_date TEXT NOT NULL,
    amount REAL,
    currency TEXT DEFAULT 'SGD',
    description TEXT,
    counterparty TEXT,
    reference TEXT,
    matched_invoice_id TEXT,
    journal_entry_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    vendor_name TEXT,
    invoice_number TEXT,
    issue_date TEXT,
    total REAL,
    gst_amount REAL,
    currency TEXT DEFAULT 'SGD',
    ocr_confidence REAL,
    ocr_raw TEXT,
    image_url TEXT,
    status TEXT DEFAULT 'ocr_done',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    entry_date TEXT,
    reference TEXT,
    ai_generated INTEGER DEFAULT 0,
    ai_confidence REAL,
    review_status TEXT DEFAULT 'pending',
    source_txn_id TEXT,
    source_invoice_id TEXT,
    lines TEXT, -- JSON array of {account_code, debit, credit, memo}
    reasoning TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Tax =========
  CREATE TABLE IF NOT EXISTS tax_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    filing_type TEXT, -- ECI | Form_C_S | GST
    ya INTEGER, -- Year of Assessment
    period_start TEXT,
    period_end TEXT,
    revenue REAL,
    chargeable_income REAL,
    tax_payable REAL,
    exemptions TEXT, -- JSON
    status TEXT DEFAULT 'draft', -- draft | reviewed | submitted
    draft_pdf_path TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Agents System =========
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- master | registration | kyc | bookkeeping | tax | secretary | dd | audit | legal | custom
    description TEXT,
    system_prompt TEXT,
    model TEXT DEFAULT 'aicfo-sim-1',
    temperature REAL DEFAULT 0.2,
    tools TEXT DEFAULT '[]', -- JSON
    rag_layers TEXT DEFAULT '["L1","L2"]',
    status TEXT DEFAULT 'active', -- active | draft | archived
    version TEXT DEFAULT '1.0.0',
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    user_id TEXT,
    company_id TEXT,
    input TEXT,
    output TEXT,
    trace TEXT, -- JSON array of steps
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    latency_ms INTEGER,
    confidence REAL,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    company_id TEXT,
    title TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT, -- user | assistant | system | tool
    content TEXT,
    agent_id TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
  );

  -- ========= RAG Knowledge Base =========
  CREATE TABLE IF NOT EXISTS rag_documents (
    id TEXT PRIMARY KEY,
    layer TEXT NOT NULL, -- L1_regulatory | L2_practice | L3_pricing | L4_customer
    source TEXT,
    title TEXT,
    content TEXT NOT NULL,
    metadata TEXT, -- JSON {section, act, date, tags}
    company_id TEXT, -- only for L4
    chunk_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'indexed', -- draft | indexed | archived
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    layer TEXT,
    content TEXT NOT NULL,
    embedding TEXT, -- JSON array (mock vector)
    token_count INTEGER,
    chunk_index INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES rag_documents(id)
  );

  CREATE TABLE IF NOT EXISTS rag_training_jobs (
    id TEXT PRIMARY KEY,
    name TEXT,
    layer TEXT,
    status TEXT DEFAULT 'pending', -- pending | running | completed | failed
    docs_processed INTEGER DEFAULT 0,
    chunks_created INTEGER DEFAULT 0,
    tokens_embedded INTEGER DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    logs TEXT DEFAULT '[]',
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rag_feedback (
    id TEXT PRIMARY KEY,
    query TEXT,
    answer TEXT,
    chunk_ids TEXT, -- JSON array
    rating INTEGER, -- 1-5
    comment TEXT,
    user_id TEXT,
    used_for_training INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Pricing =========
  CREATE TABLE IF NOT EXISTS pricing_history (
    id TEXT PRIMARY KEY,
    service TEXT,
    segment TEXT,
    shareholders INTEGER,
    cross_border INTEGER,
    monthly_txn INTEGER,
    competitor TEXT,
    price REAL,
    source TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Tasks / Reminders =========
  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    type TEXT, -- ECI | AR | Form_C | GST
    due_date TEXT,
    status TEXT DEFAULT 'pending',
    notified_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Subscription Plans & Payments =========
  CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    company_id TEXT,
    plan_code TEXT,           -- starter | growth | enterprise
    plan_name TEXT,
    price_sgd REAL,
    billing_cycle TEXT DEFAULT 'monthly',
    features TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending_payment',  -- pending_payment | active | cancelled
    paid_at TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    subscription_id TEXT,
    amount_sgd REAL,
    method TEXT DEFAULT 'mock_card',
    status TEXT DEFAULT 'pending',  -- pending | succeeded | failed
    gateway_ref TEXT,
    paid_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= WhatsApp Finance Bot =========
  CREATE TABLE IF NOT EXISTS wa_channels (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    finance_token TEXT UNIQUE NOT NULL,  -- 专属 token, 二维码内容
    qr_payload TEXT,                     -- wa.me/xxx?text=LINK:<token>
    bot_phone TEXT,
    status TEXT DEFAULT 'active',        -- active | revoked
    linked_at TEXT,                      -- 用户首次扫码绑定时间
    wa_phone TEXT,                       -- 用户侧 WhatsApp 号
    last_message_at TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS wa_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT,
    company_id TEXT,
    direction TEXT DEFAULT 'in',         -- in | out
    msg_type TEXT,                       -- text | image | document | audio
    media_url TEXT,
    content TEXT,
    classified_as TEXT,                  -- invoice | bank_txn | report | receipt | other
    linked_entity_type TEXT,             -- invoices | transactions | documents
    linked_entity_id TEXT,
    ai_confidence REAL,
    ai_summary TEXT,
    processed INTEGER DEFAULT 0,
    received_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= System Settings (统一 LLM 网关 / Tokenhot 配置) =========
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS llm_call_logs (
    id TEXT PRIMARY KEY,
    provider TEXT,        -- tokenhot | openai | genspark-proxy | offline
    tier TEXT,            -- reasoning | fast | default
    model TEXT,
    purpose TEXT,         -- chat | agent_plan | ocr | kb_build | journal | ...
    latency_ms INTEGER,
    tokens_in INTEGER,
    tokens_out INTEGER,
    status TEXT,          -- ok | error
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Upload Portal (公共上传链接) =========
  CREATE TABLE IF NOT EXISTS upload_tokens (
    token TEXT PRIMARY KEY,               -- UP-XXXXXXXX
    user_id TEXT NOT NULL,
    company_id TEXT,
    label TEXT,                           -- 给链接起的名字，如"2025 Q1 报销"
    allowed_kinds TEXT DEFAULT 'invoice,receipt,bank_txn,report', -- 逗号分隔
    max_uploads INTEGER DEFAULT 0,        -- 0 = 不限
    uploads_count INTEGER DEFAULT 0,
    expires_at TEXT,                      -- ISO，NULL = 永不过期
    status TEXT DEFAULT 'active',         -- active | revoked
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS upload_submissions (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    user_id TEXT,
    company_id TEXT,
    submitter_name TEXT,                  -- 上传人（自填）
    submitter_phone TEXT,
    file_count INTEGER DEFAULT 0,
    note TEXT,
    classified_as TEXT,                   -- 汇总分类
    linked_entity_ids TEXT,               -- JSON array
    ip TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'processed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Telegram Bot (channels 复用 wa_channels 风格) =========
  CREATE TABLE IF NOT EXISTS telegram_channels (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    finance_token TEXT,                   -- FIN-xxx 同 wa_channels
    tg_chat_id TEXT,                      -- 首次消息绑定
    tg_username TEXT,
    status TEXT DEFAULT 'active',
    message_count INTEGER DEFAULT 0,
    last_message_at TEXT,
    linked_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS telegram_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    tg_chat_id TEXT,
    tg_message_id INTEGER,
    direction TEXT DEFAULT 'in',          -- in | out
    msg_type TEXT,                        -- text | photo | document
    content TEXT,
    file_id TEXT,
    classified_as TEXT,
    linked_entity_type TEXT,
    linked_entity_id TEXT,
    ai_confidence REAL,
    ai_summary TEXT,
    received_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- ========= Unified Finance Archive (用户财务档案) =========
  CREATE TABLE IF NOT EXISTS user_finance_archive (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    archive_date TEXT,                   -- YYYY-MM
    invoice_count INTEGER DEFAULT 0,
    txn_count INTEGER DEFAULT 0,
    receipt_count INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    total_expense REAL DEFAULT 0,
    tags TEXT DEFAULT '[]',
    notes TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_orders_stage ON registration_orders(stage, created_at);
  CREATE INDEX IF NOT EXISTS idx_wa_channels_token ON wa_channels(finance_token);
  CREATE INDEX IF NOT EXISTS idx_wa_channels_user ON wa_channels(user_id);
  CREATE INDEX IF NOT EXISTS idx_wa_messages_channel ON wa_messages(channel_id, received_at);
  CREATE INDEX IF NOT EXISTS idx_archive_user ON user_finance_archive(user_id, archive_date);
  CREATE INDEX IF NOT EXISTS idx_sub_user ON subscription_plans(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, status);
  -- (original index continues below)
  CREATE INDEX IF NOT EXISTS _dummy_orders_stage ON registration_orders(stage, created_at);
  CREATE INDEX IF NOT EXISTS idx_companies_uen ON companies(uen);
  CREATE INDEX IF NOT EXISTS idx_txn_company ON transactions(company_id, transaction_date);
  CREATE INDEX IF NOT EXISTS idx_rag_layer ON rag_chunks(layer);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, created_at);
  `);
  console.log('[DB] Schema initialized at', DB_PATH);
}

init();

module.exports = db;
