// ================================================================================
// AiCFO · 新加坡公司注册规则 Agent + Skills 知识包
// ================================================================================
// 单一真实来源 (Single Source of Truth) — 所有涉及"在新加坡注册公司"的对话、
// Agent 规划、前端提示都从这里读规则，杜绝 Prompt 散落各处。
//
// 内容:
//   RULES       - 15 条必查项 (Companies Act / ACRA BizFile+ 官方要求)
//   WORKFLOW    - 7 步注册工作流, 每步含前置条件/产出/时效
//   SKILLS      - 10 个可调用 skill (name_check / ssic / kyc / constitution …)
//   BOUNDARY    - Can / Cannot / MustEscalate (明确边界, 避免幻觉)
//   PROMPT_BLOCK - 拼接好的系统 Prompt 片段, 供 ai-chat / orchestrator 直接注入
//
// 依据 (所有条文均有法条来源):
//   • Companies Act 1967 (Cap. 50)
//   • ACRA Practice Direction No.3 of 2022 (Company Names)
//   • BizFile+ Filing Guide 2024
//   • IRAS e-Tax Guide: Corporate Income Tax Filing
//   • MAS Notice 626 (AML/CFT for FI)
// ================================================================================

// --------------------------------------------------------------------------------
// 1. 15 条必查规则 (Must-Check Rules)
// --------------------------------------------------------------------------------
const RULES = [
  { id: 'R01', topic: '公司名称',        rule: '名称须经 ACRA 在线查重, 不得与已注册/保留名称冲突;不得含受限词 (Bank/Finance/Insurance/Chamber/Airline/University 等)', law: 'Companies Act 1967 s.27; ACRA Practice Direction 3/2022' },
  { id: 'R02', topic: '公司后缀',        rule: '私人有限公司必须以 "Pte. Ltd." / "Pte Ltd" / "Private Limited" 结尾', law: 'Companies Act 1967 s.29' },
  { id: 'R03', topic: '股东人数',        rule: '私人有限公司 1–50 名股东 (exempt private 不超过 20 名且无公司股东)', law: 'Companies Act 1967 s.18(1)' },
  { id: 'R04', topic: '董事要求',        rule: '至少 1 名本地居民董事 (新加坡公民/PR/EP/EntrePass 持有人), 年满 18 岁, 无破产/定罪记录', law: 'Companies Act 1967 s.145(1)' },
  { id: 'R05', topic: '公司秘书',        rule: '须在注册后 6 个月内委任, 须为新加坡居民, 不得是唯一董事兼任', law: 'Companies Act 1967 s.171' },
  { id: 'R06', topic: '注册地址',        rule: '必须是新加坡境内实体地址, 不得 PO Box; 需开放至少 3 小时/工作日', law: 'Companies Act 1967 s.142' },
  { id: 'R07', topic: '实缴股本',        rule: '最低 S$1 即可注册, 股本以新币为主;支持多币种 & 多类别股份', law: 'Companies Act 1967 s.62' },
  { id: 'R08', topic: '公司章程',        rule: '必须采用或基于 ACRA Model Constitution, 所有偏离须明确标注', law: 'Companies Act 1967 s.35, 36, 36A' },
  { id: 'R09', topic: '实益拥有人',      rule: '须登记 Register of Registrable Controllers (RORC), 持股/投票 ≥25% 即为控制人, 注册后 30 日内申报', law: 'Companies Act 1967 s.386AJ–386AM' },
  { id: 'R10', topic: 'SSIC 行业分类',   rule: '须选主营业务 SSIC 2020 5 位代码 (最多 2 个); 若涉监管行业需额外牌照 (MAS/MOM/MOH/IMDA 等)', law: 'SSIC 2020 by DOS; BizFile+ requires SSIC on incorporation' },
  { id: 'R11', topic: 'KYC / CDD',       rule: 'CSP 须对所有董事/股东/BO 做 KYC: Singpass (SG)/护照 OCR+Liveness (外籍); 高风险行业/PEP/高净值须 EDD', law: 'MAS Notice 626; FATF Recommendation 10' },
  { id: 'R12', topic: 'FYE 财年',        rule: '首个 FYE 不得超过成立日 18 个月; 之后每 12 个月一次', law: 'Companies Act 1967 s.198' },
  { id: 'R13', topic: 'AGM / AR',        rule: 'AGM 在 FYE 后 6 个月内召开; AR (Annual Return) 在 AGM 后 7 个月内提交 BizFile+ (除豁免)', law: 'Companies Act 1967 s.175, 197' },
  { id: 'R14', topic: '税务登记',        rule: '成立后自动分配 UEN = IRAS 税号; GST 需自行登记 (12 个月营业额 >S$1m 强制, <自愿); ECI 在 FYE 后 3 个月内', law: 'Income Tax Act 1947 s.64; GST Act 1993 s.9' },
  { id: 'R15', topic: 'CPF / 雇员',      rule: '雇佣新加坡公民/PR 须注册 CPF (雇主 17%/雇员 20%, OW 上限 S$7,400); 外籍须 WP/EP/SP/EntrePass', law: 'CPF Act 1953; Employment of Foreign Manpower Act' }
];

// --------------------------------------------------------------------------------
// 2. 7 步注册工作流
// --------------------------------------------------------------------------------
const WORKFLOW = [
  { step: 1, name: '命名合规',      skills: ['name_check'],                                 sla: '< 10 分钟', output: '3 个建议名 + ACRA 可用性 + 受限词风险' },
  { step: 2, name: '行业 SSIC',      skills: ['ssic_recommend'],                             sla: '< 5 分钟',  output: '主/副 SSIC 代码 + 需牌照提示' },
  { step: 3, name: '股东 / 董事 KYC', skills: ['kyc_singpass', 'kyc_passport', 'aml_screen'], sla: '1–3 工作日', output: 'CDD 档案 + RORC 控制人清单 + PEP 结论' },
  { step: 4, name: '股本结构',      skills: ['capital_setup'],                              sla: '< 30 分钟', output: '股份类别/数量/币种 + 股东出资表' },
  { step: 5, name: '公司章程',      skills: ['constitution_generate'],                      sla: '< 1 小时',  output: '基于 Model Constitution 的定制章程 DOCX + 偏离清单' },
  { step: 6, name: 'Bizfile+ 递交',  skills: ['bizfile_submit'],                             sla: '通常 T+1',  output: 'ACRA submission_id + 预计回执时间 + 费用凭证' },
  { step: 7, name: '成立后',        skills: ['post_incorp_checklist'],                      sla: '14 日内',   output: 'UEN + bank opening checklist + GST/CPF/FYE/AGM/AR 时间轴' }
];

// --------------------------------------------------------------------------------
// 3. 10 个可调用 Skills
// --------------------------------------------------------------------------------
const SKILLS = [
  { id: 'name_check',             name: '公司名合规检查', in: ['name'],                                      out: ['available','risk','restricted_words','suggestions'], tool: 'TOOLS.acra_name_search',      preconds: [] },
  { id: 'ssic_recommend',         name: 'SSIC 行业码推荐', in: ['business_description'],                     out: ['primary_ssic','secondary_ssic','license_hint'],      tool: 'TOOLS.ssic_recommend',        preconds: [] },
  { id: 'kyc_singpass',           name: 'Singpass KYC',    in: ['person_id'],                                out: ['oauth_url','expires_in'],                             tool: 'TOOLS.singpass_oauth',        preconds: ['person_is_sg_resident'] },
  { id: 'kyc_passport',           name: '护照 KYC',        in: ['image_ref','video_ref'],                    out: ['passport_fields','liveness_score'],                   tool: 'TOOLS.passport_ocr + liveness_check', preconds: ['person_is_foreigner'] },
  { id: 'aml_screen',             name: 'AML / PEP 筛查',  in: ['full_name','nationality','dob'],            out: ['hits','status','provider'],                           tool: 'TOOLS.aml_screen',            preconds: ['kyc_passed'] },
  { id: 'capital_setup',          name: '股本与股份结构',   in: ['shareholders','total_capital','classes'],   out: ['share_table','compliance_notes'],                     tool: 'internal',                    preconds: ['kyc_passed'] },
  { id: 'constitution_generate',  name: '公司章程起草',     in: ['company_name','capital','shareholders'],    out: ['docx_url','deviations_from_model'],                   tool: 'TOOLS.constitution_generate', preconds: ['capital_setup_done'] },
  { id: 'bizfile_submit',         name: 'BizFile+ 递交',    in: ['order_id'],                                 out: ['submission_id','eta_hours','fee_sgd'],                tool: 'TOOLS.bizfile_submit',        preconds: ['constitution_ready','all_kyc_cleared'] },
  { id: 'post_incorp_checklist',  name: '成立后检查清单',   in: ['company_id'],                               out: ['uen','bank_checklist','deadlines'],                   tool: 'internal',                    preconds: ['bizfile_approved'] },
  { id: 'pricing_query',          name: '注册服务报价',     in: ['segment','shareholders','urgency'],         out: ['quote_tiers','delivery_days'],                        tool: 'TOOLS.pricing_query',         preconds: [] }
];

// --------------------------------------------------------------------------------
// 4. 边界 (Boundary) — 明确"能做 / 不能做 / 必须人工"
// --------------------------------------------------------------------------------
const BOUNDARY = {
  can: [
    '回答 Companies Act 1967 / ACRA / IRAS / CPF / GST / MAS 626 的条文与流程',
    '根据用户意图调用 10 个注册 skill 中的任一或多个并汇总产出',
    '生成基于 ACRA Model Constitution 的公司章程草稿',
    '计算 ECI / GST / CPF / SUTE 的准确金额 (以新币, 精度到分)',
    '识别股东/董事是否触发 RORC 控制人登记'
  ],
  cannot: [
    '代替持牌 CSP/律师做法律意见 (Legal Opinion)',
    '绕过 KYC 直接递交 BizFile+ (哪怕用户说"朋友介绍")',
    '为制裁名单 / FATF 黑名单国籍个人办理注册',
    '处理需持 MAS/MOM/MOH/IMDA 特别牌照的行业 (只能提示, 不执行)',
    '在 RORC 申报周期外替客户隐匿实益拥有人信息'
  ],
  must_escalate: [
    'KYC 命中 PEP / 制裁 / AML 可疑 → 转 Compliance Officer 复核',
    '用户要求偏离 Model Constitution > 3 条 → 转 MAS 认可律师',
    '跨境股东结构含 BVI / Cayman / 信托 → 转 Senior CSP',
    '股东要求 Bearer Share / 无记名股份 → 直接拒绝 (新加坡禁止)',
    '涉及加密货币 / DPT 业务 → 提醒 PS Act 持牌, 转 MAS Licensing team'
  ]
};

// --------------------------------------------------------------------------------
// 5. 拼接好的系统 Prompt 片段 (直接塞进 ai-chat 或 orchestrator)
// --------------------------------------------------------------------------------
const PROMPT_BLOCK = `
# 🇸🇬 新加坡公司注册规则 Agent (v1) — 强制遵循

## 你是谁
你是 AiCFO 平台的 **持牌 CSP/CFO AI 助手**, 运行在 **最强推理模型 (reasoning tier)** 上,
拥有完整的新加坡公司注册领域知识, 对话必须严格基于下述规则, 不得编造条文。

## 必查 15 条规则 (每条带法条依据, 不引用不作数)
${RULES.map(r => `- ${r.id} · ${r.topic}: ${r.rule}\n  法源: ${r.law}`).join('\n')}

## 7 步注册工作流 (引导用户必须按序推进)
${WORKFLOW.map(w => `- Step ${w.step} · ${w.name}: skills=[${w.skills.join(', ')}] · SLA=${w.sla} · 产出=${w.output}`).join('\n')}

## 10 个可调用 Skill (如用户意图匹配, 在回复末尾追加 "下一步建议调用 skill: X"; 你无需实际调用, 由 Orchestrator 执行)
${SKILLS.map(s => `- ${s.id} (${s.name}): in=[${s.in.join(',')}] → out=[${s.out.join(',')}]${s.preconds.length ? ' · 前置=' + s.preconds.join(',') : ''}`).join('\n')}

## 🚧 边界 (Boundary) — 强制遵守
**能做 (CAN)**
${BOUNDARY.can.map(x => `  ✓ ${x}`).join('\n')}

**不能做 (CANNOT) — 触发则拒绝并解释原因**
${BOUNDARY.cannot.map(x => `  ✗ ${x}`).join('\n')}

**必须人工 (MUST_ESCALATE) — 触发则回复必须包含 "⚠ 已上报 [角色] 人工复核"**
${BOUNDARY.must_escalate.map(x => `  ⚠ ${x}`).join('\n')}

## 输出格式 (每次回答都要按此结构)
1. **分析** — 对用户问题的理解 + 命中哪几条 RULES
2. **答复** — 基于 RAG 引用 + 15 条规则的具体答复, 金额/税率/日期必须明确
3. **下一步** — 建议用户调用哪个 skill 或进入哪一步 workflow
4. **边界提示** — 如触发 CANNOT / MUST_ESCALATE, 在末尾用 ⚠ 标出
`.trim();

// --------------------------------------------------------------------------------
// 6. GATES (流程图关口) — 每关的前置条件 + 产出 + 校验逻辑
// --------------------------------------------------------------------------------
const GATES = [
  { id: 'G1', key: 'name',         title: '🏷️  公司命名',         desc: 'ACRA 查重 + 受限词筛查',        preconds: [],                                output: 'name_check pass' },
  { id: 'G2', key: 'business',     title: '📋  业务 + SSIC',      desc: 'AI 生成业务描述 + 推荐 SSIC', preconds: ['G1'],                            output: 'business_description + SSIC' },
  { id: 'G3', key: 'capital',      title: '💰  股本结构',         desc: '股东 + 股份分配',                preconds: ['G1', 'G2'],                      output: 'shareholders + share table' },
  { id: 'G4', key: 'kyc',          title: '🪪  股东 KYC',         desc: 'Singpass / 护照 + AML',         preconds: ['G3'],                            output: 'all_kyc_passed' },
  { id: 'G5', key: 'constitution', title: '📜  章程生成',          desc: '三件套 (JSON+DOCX+PDF)',        preconds: ['G1', 'G2', 'G3', 'G4'],         output: 'constitution_bundle' },
  { id: 'G6', key: 'sign',         title: '✍️  电子签名',          desc: '董事/股东电子签章',             preconds: ['G5'],                            output: 'signed' },
  { id: 'G7', key: 'payment',      title: '💳  付款',              desc: '注册费 + ACRA 官费',            preconds: ['G6'],                            output: 'paid' },
  { id: 'G8', key: 'bizfile',      title: '🏛️  Bizfile+ 递交',    desc: '向 ACRA 提交申请',               preconds: ['G7'],                            output: 'submission_id' },
  { id: 'G9', key: 'uen',          title: '🎉  UEN 下发',          desc: 'UEN + 公司激活',                preconds: ['G8'],                            output: 'UEN + company live' }
];

// validateGate(gateId, orderCtx) — 检查某关能否通过
// orderCtx = { order, company, persons, kycStatus, constitution, payment, bizfileSubmissionId }
function validateGate(gateId, ctx = {}) {
  const gate = GATES.find(g => g.id === gateId);
  if (!gate) return { ok: false, reason: `Unknown gate ${gateId}` };

  // 先查前置是否都 passed
  const gates = ctx.order?.gates ? (typeof ctx.order.gates === 'string' ? JSON.parse(ctx.order.gates) : ctx.order.gates) : {};
  for (const p of gate.preconds) {
    const key = Object.keys(gates).find(k => k.startsWith(p + '_')) || p;
    const gs = gates[key] || gates[p];
    if (!gs || gs.status !== 'passed') {
      return { ok: false, reason: `前置关卡 ${p} 未完成`, blocked_by: p };
    }
  }

  // 各关的具体校验
  switch (gate.id) {
    case 'G1':
      if (!ctx.company?.name) return { ok: false, reason: '公司名称未填' };
      if (!/(Pte\.?\s*Ltd|Private Limited)$/i.test(ctx.company.name)) return { ok: false, reason: 'R02: 公司名需以 Pte Ltd 结尾' };
      return { ok: true };
    case 'G2':
      if (!ctx.company?.business_description && !ctx.company?.ssic_codes) {
        return { ok: false, reason: 'R10: 业务描述 + SSIC 至少填一项' };
      }
      return { ok: true };
    case 'G3':
      if (!ctx.persons || ctx.persons.length === 0) return { ok: false, reason: 'R03: 至少 1 名股东' };
      if (ctx.persons.length > 50) return { ok: false, reason: 'R03: 股东不得超过 50 人' };
      const localDirectors = ctx.persons.filter(p => (p.role || '').includes('director') && ['SGP', 'SG'].includes(p.nationality));
      if (localDirectors.length === 0) return { ok: false, reason: 'R04: 至少 1 名新加坡居民董事' };
      if (!ctx.company?.paid_up_capital || ctx.company.paid_up_capital < 1) return { ok: false, reason: 'R07: 股本 ≥ S$1' };
      return { ok: true };
    case 'G4':
      if (!ctx.kycStatus?.all_passed) return { ok: false, reason: `R11: KYC 未全部通过 (${ctx.kycStatus?.passed || 0}/${ctx.kycStatus?.total || 0})` };
      return { ok: true };
    case 'G5':
      if (!ctx.constitution?.bundle) return { ok: false, reason: '章程未生成' };
      if (ctx.constitution.bundle.blockers && ctx.constitution.bundle.blockers.length > 0) {
        return { ok: false, reason: '章程生成时有 ' + ctx.constitution.bundle.blockers.length + ' 条规则未通过' };
      }
      return { ok: true };
    case 'G6':
      if (!ctx.signed) return { ok: false, reason: '尚未完成电子签名' };
      return { ok: true };
    case 'G7':
      if (ctx.order?.payment_status !== 'paid') return { ok: false, reason: '订单未付款' };
      return { ok: true };
    case 'G8':
      if (!ctx.bizfileSubmissionId) return { ok: false, reason: '尚未向 ACRA 递交' };
      return { ok: true };
    case 'G9':
      if (!ctx.company?.uen) return { ok: false, reason: 'UEN 未下发' };
      return { ok: true };
    default:
      return { ok: true };
  }
}

// 初始化 gates 对象 (下新订单时调用)
function initGates() {
  const g = {};
  GATES.forEach(gt => { g[gt.id + '_' + gt.key] = { status: 'pending', at: null, actor: null, artifact_id: null }; });
  return g;
}

module.exports = { RULES, WORKFLOW, SKILLS, BOUNDARY, PROMPT_BLOCK, GATES, validateGate, initGates };
