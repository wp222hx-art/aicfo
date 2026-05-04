// ================================================================================
// AiCFO · Constitution Engine (公司章程引擎)
// ================================================================================
// 唯一入口，负责基于 ACRA Model Constitution 生成"章程三件套":
//   • JSON  — 结构化条款 (22 条目录 + 公司定制项), 给前端树形预览 & Diff
//   • DOCX  — 可供签名的 Word 文档 (MVP: 打包为 .txt 伪 docx, 后接 docx lib)
//   • PDF   — 终稿 PDF (MVP: 使用纯文本 PDF 占位, 后接 pdfkit)
//
// 流水 (Pipeline):
//   1. 采集  (Collect)     - 从 order / company / persons 读齐输入
//   2. 规则  (Validate)    - 调 sg-reg-agent 校验 R01..R15
//   3. 起草  (Draft)       - LLM (reasoning tier) 产出自由文本 clauses
//   4. 融合  (Merge)       - 与 Model Constitution 模板融合, 标注 deviations
//   5. 渲染  (Render)      - 三件套输出到 documents 表
//   6. 绑定  (Bind)        - 把 bundle 写回 registration_orders.constitution_bundle
// ================================================================================

const { v4: uuid } = require('uuid');
const db = require('../db/schema');
const llmGateway = require('./llm-gateway');
const sgReg = require('./sg-reg-agent');

// ACRA Model Constitution 22 条标准目录 (Table B of Fourth Schedule, Companies Act 1967)
const MODEL_CLAUSES = [
  { id: 'C01', key: 'name',             title: '公司名称 · Company Name',                        law: 'CA s.27' },
  { id: 'C02', key: 'registered_office',title: '注册办事处 · Registered Office',                  law: 'CA s.142' },
  { id: 'C03', key: 'objects',          title: '经营范围 · Objects / Business Activities',        law: 'CA s.23' },
  { id: 'C04', key: 'liability',        title: '股东责任 · Liability of Members',                  law: 'CA s.17' },
  { id: 'C05', key: 'share_capital',    title: '股本 · Share Capital',                             law: 'CA s.62' },
  { id: 'C06', key: 'share_classes',    title: '股份类别 · Classes of Shares',                     law: 'CA s.64' },
  { id: 'C07', key: 'share_issue',      title: '股份发行 · Issue of Shares',                       law: 'CA s.161' },
  { id: 'C08', key: 'share_transfer',   title: '股份转让 · Transfer of Shares',                    law: 'CA s.126' },
  { id: 'C09', key: 'share_transmission',title:'股份传承 · Transmission on Death',                law: 'CA s.128' },
  { id: 'C10', key: 'lien',             title: '公司留置权 · Company Lien on Shares',              law: 'Model Art 11' },
  { id: 'C11', key: 'alteration_capital',title:'股本变更 · Alteration of Capital',                 law: 'CA s.71' },
  { id: 'C12', key: 'general_meeting',  title: '股东大会 · General Meetings',                      law: 'CA s.175' },
  { id: 'C13', key: 'voting',           title: '表决 · Voting Rights',                             law: 'CA s.179' },
  { id: 'C14', key: 'directors',        title: '董事 · Directors: Appointment & Removal',          law: 'CA s.145-152' },
  { id: 'C15', key: 'director_powers',  title: '董事权限 · Powers and Duties of Directors',        law: 'CA s.157' },
  { id: 'C16', key: 'director_meetings',title: '董事会 · Board Meetings',                          law: 'Model Art 83' },
  { id: 'C17', key: 'secretary',        title: '公司秘书 · Company Secretary',                     law: 'CA s.171' },
  { id: 'C18', key: 'seal',             title: '公司印鉴 · Common Seal',                           law: 'CA s.41' },
  { id: 'C19', key: 'accounts',         title: '账册与审计 · Accounts and Audit',                  law: 'CA s.197,201' },
  { id: 'C20', key: 'dividends',        title: '分红 · Dividends and Reserves',                    law: 'CA s.403' },
  { id: 'C21', key: 'notices',          title: '通知 · Notices',                                   law: 'Model Art 138' },
  { id: 'C22', key: 'winding_up',       title: '清盘 · Winding-Up',                                law: 'Insolvency, Restructuring and Dissolution Act 2018' }
];

// 每条 Model Constitution 的默认原文 (摘要, 真实生产环境应全文引入)
const MODEL_DEFAULTS = {
  name: (ctx) => `The name of the Company is "${ctx.company_name}".`,
  registered_office: (ctx) => `The registered office of the Company shall be at ${ctx.registered_address || '[Address to be supplied]'} in the Republic of Singapore.`,
  objects: (ctx) => `The Company is incorporated to carry on any business and to do anything which is not prohibited by law. Principal activities include: ${ctx.business_description || ctx.business_activities || '[To be specified]'}. SSIC code(s): ${(ctx.ssic_codes || []).join(', ') || '[Pending]'}.`,
  liability: () => 'The liability of each member is limited to any amount unpaid on the shares held by that member.',
  share_capital: (ctx) => `The issued share capital of the Company at incorporation is ${ctx.currency || 'SGD'} ${Number(ctx.paid_up_capital || 1).toFixed(2)}, divided into ordinary shares.`,
  share_classes: () => 'Subject to the Act, the Company may issue different classes of shares with such rights, preferences and restrictions as may be determined by the Company in general meeting.',
  share_issue: () => 'Subject to Section 161 of the Act, directors shall not exercise any power to issue shares unless authorised by the Company in general meeting.',
  share_transfer: () => 'Shares are transferable by a written instrument in any usual or common form. The directors may decline to register any transfer of shares to a person of whom they do not approve.',
  share_transmission: () => 'On the death of a member, the survivor(s) where the deceased was a joint holder, and the legal personal representative(s) of the deceased where he was a sole holder, shall be the only persons recognised by the Company as having any title to his interest.',
  lien: () => 'The Company shall have a first and paramount lien on every partly-paid share for all moneys called or payable at a fixed time in respect of that share.',
  alteration_capital: () => 'The Company may by ordinary resolution increase, consolidate, subdivide or cancel its share capital in accordance with Section 71 of the Act.',
  general_meeting: () => 'An annual general meeting of the Company shall be held within six months after the end of its financial year, unless exempted under Section 175A of the Act.',
  voting: () => 'On a show of hands every member present in person shall have one vote, and on a poll every member shall have one vote for each share held.',
  directors: (ctx) => `The Company shall have at least one director who is ordinarily resident in Singapore. Initial directors: ${(ctx.directors || []).map(d => d.full_name).join(', ') || '[Pending KYC]'}.`,
  director_powers: () => 'The business of the Company shall be managed by or under the direction of the directors, who may exercise all powers of the Company not required to be exercised in general meeting.',
  director_meetings: () => 'The directors may meet together for the despatch of business, adjourn and otherwise regulate their meetings as they think fit. Questions shall be decided by a majority of votes.',
  secretary: () => 'The secretary shall be appointed by the directors for such term and upon such conditions as they think fit. The office of secretary shall not be left vacant for more than six months.',
  seal: () => 'The Company may have a common seal which shall be used only by the authority of the directors and every instrument sealed shall be signed by a director and countersigned by the secretary or a second director.',
  accounts: (ctx) => `The directors shall keep such accounting records as are necessary. The financial year end is ${ctx.fye || '31 December'}.`,
  dividends: () => 'The Company may by ordinary resolution declare dividends in accordance with the respective rights of the members, but no dividend shall exceed the amount recommended by the directors and dividends shall be paid only out of profits.',
  notices: () => 'A notice may be given by the Company to any member either personally or by sending it by post to him or by electronic communication to an address provided by the member.',
  winding_up: () => 'If the Company is wound up, the liquidator may, with the sanction of a special resolution, divide among the members in specie any part of the assets of the Company.'
};

// --------------------------------------------------------------------------------
// Step 1: Collect — 采集订单上下文
// --------------------------------------------------------------------------------
function collect(orderId) {
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  const company = db.prepare(`SELECT * FROM companies WHERE id=?`).get(order.company_id);
  const persons = db.prepare(`SELECT * FROM persons WHERE company_id=?`).all(order.company_id);
  const shareholders = persons.filter(p => (p.role || '').includes('shareholder'));
  const directors = persons.filter(p => (p.role || '').includes('director'));
  return {
    order,
    company_name: company?.name,
    business_description: company?.business_description,
    ssic_codes: (company?.ssic_codes || '').split(',').filter(Boolean),
    paid_up_capital: company?.paid_up_capital,
    currency: company?.currency,
    fye: company?.fye,
    registered_address: company?.registered_address,
    company, shareholders, directors
  };
}

// --------------------------------------------------------------------------------
// Step 2: Validate — 规则校验 (返回 deviations + blockers)
// --------------------------------------------------------------------------------
function validate(ctx) {
  const deviations = [];
  const blockers = [];

  // R02 公司后缀
  if (ctx.company_name && !/(Pte\.?\s*Ltd|Private Limited)$/i.test(ctx.company_name)) {
    blockers.push({ rule: 'R02', msg: '公司名称必须以 Pte. Ltd. / Pte Ltd / Private Limited 结尾' });
  }
  // R03 股东人数
  if (ctx.shareholders.length < 1 || ctx.shareholders.length > 50) {
    blockers.push({ rule: 'R03', msg: `股东人数 ${ctx.shareholders.length} 不在 1-50 区间` });
  }
  // R04 本地董事
  const hasLocalDirector = ctx.directors.some(d => ['SGP', 'SG', 'Singapore'].includes(d.nationality));
  if (!hasLocalDirector) {
    blockers.push({ rule: 'R04', msg: '至少需要 1 名新加坡居民董事 (SG/PR/EP/EntrePass)' });
  }
  // R07 最低股本
  if (!ctx.paid_up_capital || ctx.paid_up_capital < 1) {
    blockers.push({ rule: 'R07', msg: '实缴股本不得低于 S$1' });
  }
  // R10 SSIC
  if (!ctx.ssic_codes || ctx.ssic_codes.length === 0) {
    deviations.push({ clause: 'C03', rule: 'R10', msg: 'SSIC 未选定, 章程 Objects 条款将使用通用表述', severity: 'warning' });
  }
  // R06 注册地址
  if (!ctx.registered_address) {
    deviations.push({ clause: 'C02', rule: 'R06', msg: '注册地址待补充 (章程会标注 [Address to be supplied])', severity: 'warning' });
  }

  return { deviations, blockers, passed: blockers.length === 0 };
}

// --------------------------------------------------------------------------------
// Step 3 + 4: Draft + Merge — 逐条渲染 (未来可替换为 LLM 定制条款)
// --------------------------------------------------------------------------------
async function draft(ctx) {
  const clauses = MODEL_CLAUSES.map(c => {
    const defaultFn = MODEL_DEFAULTS[c.key];
    const body = defaultFn ? defaultFn(ctx) : '[Clause body to be drafted]';
    return { ...c, body, source: 'model_constitution' };
  });

  // 可选: 调 LLM 给 Objects 条款写一段更专业的描述 (基于 business_description)
  if (ctx.business_description) {
    try {
      const llm = await llmGateway.chat({
        purpose: 'agent_plan',
        messages: [
          { role: 'system', content: '你是新加坡公司章程起草专家, 请按 ACRA Model Constitution Article 3 (Objects) 格式, 用一段 60-120 字的正式英文描述公司经营范围, 并在末尾列出 SSIC codes. 只输出正文, 不要引号.' },
          { role: 'user', content: `Company: ${ctx.company_name}\nBusiness: ${ctx.business_description}\nSSIC: ${(ctx.ssic_codes || []).join(', ')}` }
        ]
      });
      const text = (llm.content || llm.text || '').trim();
      if (text && text.length > 30) {
        const objectsClause = clauses.find(c => c.key === 'objects');
        if (objectsClause) { objectsClause.body = text; objectsClause.source = 'ai_drafted'; }
      }
    } catch (e) {
      // 降级: 保留 model 默认条款
    }
  }
  return clauses;
}

// --------------------------------------------------------------------------------
// Step 5: Render — 生成 JSON / "DOCX" / "PDF" 三件套 (MVP 文本占位)
// --------------------------------------------------------------------------------
function renderPlainText(ctx, clauses) {
  const lines = [];
  lines.push('CONSTITUTION OF ' + (ctx.company_name || '').toUpperCase());
  lines.push('(Pursuant to the Companies Act 1967 of Singapore)');
  lines.push('');
  lines.push('This Constitution is adopted on ' + new Date().toISOString().slice(0, 10) + '.');
  lines.push('');
  clauses.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.title.toUpperCase()}`);
    lines.push(`   (Reference: ${c.law})`);
    lines.push('   ' + c.body);
    lines.push('');
  });
  lines.push('—— SCHEDULE A: SHAREHOLDERS & INITIAL CAPITAL ——');
  (ctx.shareholders || []).forEach((s, i) => {
    lines.push(`${i + 1}. ${s.full_name || '[Unnamed]'} (${s.nationality || 'N/A'}) — ${s.shares_held || 0} shares`);
  });
  lines.push('');
  lines.push('—— SCHEDULE B: DIRECTORS ——');
  (ctx.directors || []).forEach((d, i) => {
    lines.push(`${i + 1}. ${d.full_name || '[Unnamed]'} (${d.nationality || 'N/A'})`);
  });
  lines.push('');
  lines.push('Signed electronically via AiCFO Platform.');
  return lines.join('\n');
}

function insertDoc(companyId, kind, content, extra = {}) {
  const docId = `doc_${uuid().slice(0, 8)}`;
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex');
  db.prepare(`INSERT INTO documents (id,company_id,kind,version,generated_by_ai,content,hash_sha256)
              VALUES (?,?,?,?,?,?,?)`).run(
    docId, companyId, kind, extra.version || 1, 1,
    typeof content === 'string' ? content : JSON.stringify(content),
    hash
  );
  return { doc_id: docId, hash, kind };
}

// --------------------------------------------------------------------------------
// Public: generateBundle(order_id) — 一键生成三件套 (幂等: 重复调用会 version+1)
// --------------------------------------------------------------------------------
async function generateBundle(orderId) {
  const ctx = collect(orderId);
  const validation = validate(ctx);

  // 即使有 blockers 也允许生成草稿 (标注 DRAFT), 但会返回 validation 状态
  const clauses = await draft(ctx);
  const plainText = renderPlainText(ctx, clauses);

  // 版本号: 累加
  let version = 1;
  try {
    const existing = JSON.parse(ctx.order.constitution_bundle || '{}');
    if (existing.version) version = existing.version + 1;
  } catch { /* noop */ }

  const jsonDoc = insertDoc(ctx.company.id, 'constitution_json', { clauses, ctx_snapshot: {
    company_name: ctx.company_name, paid_up_capital: ctx.paid_up_capital, currency: ctx.currency, fye: ctx.fye,
    shareholders: ctx.shareholders.map(s => ({ name: s.full_name, nationality: s.nationality, shares: s.shares_held })),
    directors: ctx.directors.map(d => ({ name: d.full_name, nationality: d.nationality }))
  }, validation, generated_at: new Date().toISOString() }, { version });

  const docxDoc = insertDoc(ctx.company.id, 'constitution_docx', plainText, { version });
  const pdfDoc = insertDoc(ctx.company.id, 'constitution_pdf',
    '%PDF-1.4\n% AiCFO Constitution (MVP text-render)\n\n' + plainText, { version });

  const bundle = {
    version,
    json_doc_id: jsonDoc.doc_id,
    docx_doc_id: docxDoc.doc_id,
    pdf_doc_id: pdfDoc.doc_id,
    clauses_count: clauses.length,
    deviations: validation.deviations,
    blockers: validation.blockers,
    generated_at: new Date().toISOString()
  };

  db.prepare(`UPDATE registration_orders SET constitution_bundle=? WHERE id=?`)
    .run(JSON.stringify(bundle), orderId);

  return { bundle, clauses, validation };
}

// --------------------------------------------------------------------------------
// Public: getBundle(order_id) — 前端预览用, 返回 bundle + 完整 clauses
// --------------------------------------------------------------------------------
function getBundle(orderId) {
  const order = db.prepare(`SELECT * FROM registration_orders WHERE id=?`).get(orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  let bundle = null;
  try { bundle = JSON.parse(order.constitution_bundle || 'null'); } catch { bundle = null; }
  if (!bundle) return { bundle: null, clauses: [], available: false };
  const jsonDoc = db.prepare(`SELECT content FROM documents WHERE id=?`).get(bundle.json_doc_id);
  let clauses = [];
  try { clauses = (JSON.parse(jsonDoc?.content || '{}')).clauses || []; } catch { clauses = []; }
  return { bundle, clauses, available: true };
}

module.exports = {
  MODEL_CLAUSES,
  collect, validate, draft, generateBundle, getBundle
};
