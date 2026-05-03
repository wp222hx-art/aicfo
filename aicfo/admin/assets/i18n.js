// AiCFO i18n - shared by customer app + admin console
// Usage: t('key') returns current-locale string. Set locale via setLocale('zh'|'en').
(function () {
  const DICT = {
    // ====== Global / Brand ======
    'brand.tag': { en: 'Corporate Brain · Singapore', zh: '企业大脑 · 新加坡' },
    'lang.toggle': { en: '中文', zh: 'EN' },
    'nav.admin': { en: 'Admin →', zh: '管理后台 →' },
    'nav.back_customer': { en: '← Back to Customer App', zh: '← 返回客户端' },
    'common.back': { en: '← Back', zh: '← 返回' },
    'common.continue': { en: 'Continue →', zh: '继续 →' },
    'common.save': { en: '💾 Save Changes', zh: '💾 保存修改' },
    'common.delete': { en: '🗑 Delete', zh: '🗑 删除' },
    'common.approve': { en: '✓ Approve', zh: '✓ 审核通过' },
    'common.view': { en: '👁 View', zh: '👁 查看' },
    'common.loading': { en: 'Loading...', zh: '加载中...' },
    'common.thinking': { en: 'Thinking...', zh: '思考中...' },
    'common.running': { en: 'Running...', zh: '运行中...' },
    'common.drafting': { en: 'Drafting...', zh: '起草中...' },
    'common.computing': { en: 'Computing...', zh: '计算中...' },
    'common.generating': { en: 'Generating... (LLM simulated)', zh: '生成中...（模拟大模型）' },
    'common.send': { en: 'Send', zh: '发送' },
    'common.download_pdf': { en: '📥 Download Draft PDF', zh: '📥 下载草稿 PDF' },
    'common.confidence': { en: 'Confidence', zh: '置信度' },
    'common.source': { en: 'Source', zh: '来源' },
    'common.status': { en: 'Status', zh: '状态' },
    'common.action': { en: 'Action', zh: '操作' },
    'common.date': { en: 'Date', zh: '日期' },
    'common.description': { en: 'Description', zh: '描述' },
    'common.amount': { en: 'Amount', zh: '金额' },
    'common.total': { en: 'Total', zh: '合计' },
    'common.vendor': { en: 'Vendor', zh: '供应商' },
    'common.type': { en: 'Type', zh: '类型' },
    'common.name': { en: 'Name', zh: '名称' },
    'common.model': { en: 'Model', zh: '模型' },
    'common.version': { en: 'Version', zh: '版本' },
    'common.company': { en: 'Company', zh: '公司' },
    'common.score': { en: 'Score', zh: '得分' },

    // ====== Top Nav (customer) ======
    'nav.dashboard': { en: 'Dashboard', zh: '仪表盘' },
    'nav.register': { en: 'Register', zh: '注册公司' },
    'nav.books': { en: 'Books', zh: '记账' },
    'nav.tax': { en: 'Tax', zh: '税务' },
    'nav.secretary': { en: 'Secretary', zh: '公司秘书' },
    'nav.chat': { en: 'AI Chat', zh: 'AI 对话' },
    'nav.pricing': { en: 'Pricing', zh: '报价' },

    // ====== Dashboard ======
    'dash.loading': { en: 'Loading your corporate brain…', zh: '正在加载您的企业大脑…' },
    'dash.welcome': { en: 'Welcome back,', zh: '欢迎回来，' },
    'dash.tagline': { en: 'Your AI-first CFO + Compliance + Secretary — one platform, one button, zero chaos.', zh: '您的 AI 优先 CFO + 合规 + 秘书 —— 一个平台，一键搞定，告别混乱。' },
    'dash.register_cta': { en: '+ Register a Company', zh: '+ 注册公司' },
    'dash.ask_cta': { en: 'Ask AiCFO', zh: '问一问 AiCFO' },
    'dash.books_cta': { en: 'Books & Tax', zh: '记账与税务' },
    'dash.stat.active_companies': { en: 'Active Companies', zh: '活跃公司数' },
    'dash.stat.in_progress': { en: 'in progress', zh: '进行中' },
    'dash.stat.pending_reviews': { en: 'Pending Reviews', zh: '待审核' },
    'dash.stat.needs_attention': { en: 'Needs attention', zh: '需要关注' },
    'dash.stat.agent_runs': { en: 'Agent Runs', zh: '智能体调用数' },
    'dash.stat.avg': { en: 'avg', zh: '平均' },
    'dash.stat.conf': { en: 'conf', zh: '置信度' },
    'dash.stat.txns_processed': { en: 'Transactions Processed', zh: '已处理交易' },
    'dash.stat.invoices_ocred': { en: 'invoices OCR-ed', zh: '张发票已识别' },
    'dash.deadlines': { en: 'Upcoming Deadlines', zh: '临近截止日期' },
    'dash.view_all': { en: 'View all →', zh: '查看全部 →' },
    'dash.no_reminders': { en: 'No reminders', zh: '暂无提醒' },
    'dash.due': { en: 'Due', zh: '截止' },
    'dash.filing': { en: 'Filing', zh: '申报' },
    'dash.orders': { en: 'My Registration Orders', zh: '我的注册订单' },
    'dash.new': { en: '+ New', zh: '+ 新建' },
    'dash.no_orders': { en: 'No orders yet — start your first registration!', zh: '暂无订单 —— 立即开启第一次注册！' },
    'dash.stage': { en: 'Stage', zh: '阶段' },
    'dash.recent_txns': { en: 'Recent Transactions', zh: '近期交易' },
    'dash.no_txns': { en: 'No transactions. Upload a bank statement in Books.', zh: '暂无交易。请到"记账"页上传银行流水。' },
    'dash.posted': { en: 'Posted', zh: '已入账' },
    'dash.uncategorised': { en: 'Uncategorised', zh: '未分类' },

    // ====== Registration ======
    'reg.title': { en: 'Register a Singapore Pte Ltd', zh: '注册新加坡私人有限公司' },
    'reg.sub': { en: 'From "I want to register" to "UEN issued" — fully AI-driven, CSP-licensed review at the last mile.', zh: '从"我想注册"到"UEN 已签发" —— 全程 AI 驱动，最后一公里由持牌 CSP 审核。' },
    'reg.steps.name': { en: 'Name Check', zh: '名称核查' },
    'reg.steps.business': { en: 'Business', zh: '业务' },
    'reg.steps.shareholders': { en: 'Shareholders', zh: '股东' },
    'reg.steps.kyc': { en: 'KYC', zh: '实名认证' },
    'reg.steps.constitution': { en: 'Constitution', zh: '公司章程' },
    'reg.steps.review': { en: 'Review & Pay', zh: '确认并付款' },

    'reg.step1.title': { en: '1. Choose Your Company Name', zh: '1. 选择公司名称' },
    'reg.step1.sub': { en: 'AiCFO checks ACRA registry + Companies Act Section 27 restrictions in <3 seconds.', zh: 'AiCFO 会在 3 秒内检查 ACRA 注册库及《公司法》第 27 条限制。' },
    'reg.step1.proposed': { en: 'Proposed Name', zh: '拟用名称' },
    'reg.step1.placeholder': { en: 'e.g. Skyhawk Innovate', zh: '例如：Skyhawk Innovate' },
    'reg.step1.check': { en: '⚡ Check Availability', zh: '⚡ 核查可用性' },
    'reg.step1.checking': { en: 'Checking ACRA registry...', zh: '正在查询 ACRA 注册库...' },
    'reg.step1.enter_name': { en: 'Enter a name', zh: '请输入名称' },
    'reg.step1.available': { en: '✓ Available', zh: '✓ 可用' },
    'reg.step1.conflict': { en: '✗ Conflict', zh: '✗ 冲突' },
    'reg.step1.needs_approval': { en: '⚠ Needs Approval', zh: '⚠ 需审批' },
    'reg.step1.alternatives': { en: 'AI-suggested alternatives:', zh: 'AI 推荐的替代名称：' },

    'reg.step2.title': { en: '2. What does your company do?', zh: '2. 公司的主营业务是什么？' },
    'reg.step2.sub': { en: 'AiCFO will recommend SSIC codes and drive constitution drafting.', zh: 'AiCFO 将推荐 SSIC 行业代码并起草公司章程。' },
    'reg.step2.desc': { en: 'Business Description', zh: '业务描述' },
    'reg.step2.desc_ph': { en: 'e.g. Cross-border e-commerce, SaaS platform for SMEs, Web3/token issuance...', zh: '例如：跨境电商、面向中小企业的 SaaS 平台、Web3/代币发行...' },
    'reg.step2.capital': { en: 'Paid-up Capital (SGD)', zh: '实缴资本（新币）' },
    'reg.step2.fye': { en: 'Financial Year End', zh: '财年结束日' },

    'reg.step3.title': { en: '3. Shareholders & Directors', zh: '3. 股东与董事' },
    'reg.step3.sub': { en: 'At least 1 director must be ordinarily resident in Singapore (Companies Act s.145).', zh: '至少 1 名董事必须是新加坡常住居民（《公司法》第 145 条）。' },
    'reg.step3.add': { en: '+ Add Shareholder', zh: '+ 添加股东' },
    'reg.step3.total_shares': { en: 'Total Shares', zh: '股份总数' },
    'reg.step3.continue': { en: 'Continue to KYC →', zh: '继续进行实名认证 →' },
    'reg.step3.full_name': { en: 'Full Name', zh: '全名' },
    'reg.step3.id_ph': { en: 'Name as per ID', zh: '与身份证件一致' },
    'reg.step3.nationality': { en: 'Nationality', zh: '国籍' },
    'reg.step3.nric': { en: 'NRIC/FIN / Passport', zh: '身份证/FIN / 护照' },
    'reg.step3.nric_ph': { en: 'S1234567A or passport', zh: 'S1234567A 或护照号' },
    'reg.step3.shares': { en: 'Shares Held', zh: '持股数' },
    'reg.step3.is_director': { en: 'Also a Director', zh: '同时担任董事' },
    'reg.step3.remove': { en: 'Remove', zh: '移除' },

    'reg.step4.title': { en: '4. Identity Verification (KYC)', zh: '4. 身份实名认证 (KYC)' },
    'reg.step4.sub': { en: 'Singpass for SG residents (40+ fields auto-filled via MyInfo), or passport OCR + liveness for foreigners.', zh: '新加坡居民用 Singpass（通过 MyInfo 自动填充 40+ 字段），外籍人士走护照 OCR + 活体检测。' },
    'reg.step4.unnamed': { en: 'Unnamed Shareholder', zh: '未命名股东' },
    'reg.step4.singpass': { en: 'Scan Singpass QR', zh: '扫描 Singpass 二维码' },
    'reg.step4.passport': { en: 'Upload Passport + Liveness', zh: '上传护照 + 活体检测' },
    'reg.step4.initiating': { en: 'Initiating KYC...', zh: '正在发起 KYC...' },
    'reg.step4.passed': { en: '✓ KYC Passed', zh: '✓ KYC 已通过' },
    'reg.step4.liveness': { en: 'Liveness', zh: '活体检测' },

    'reg.step5.title': { en: '5. Constitution (章程) — AI Drafted', zh: '5. 公司章程 —— AI 起草' },
    'reg.step5.sub': { en: 'Based on ACRA Model Constitution + your business profile. 15 sections cited against Companies Act.', zh: '基于 ACRA 示范章程与您的业务资料，共 15 条款，均引用《公司法》条文。' },
    'reg.step5.gen': { en: '🪄 Generate Constitution', zh: '🪄 生成章程' },
    'reg.step5.ai_gen': { en: 'AI Generated', zh: 'AI 已生成' },
    'reg.step5.key_clauses': { en: 'Key clauses to review:', zh: '需重点审阅的条款：' },
    'reg.step5.view_all': { en: 'View all 15 sections', zh: '查看全部 15 个条款' },
    'reg.step5.continue': { en: 'Continue to Review →', zh: '继续确认 →' },

    'reg.step6.title': { en: '6. Review & Pay', zh: '6. 确认并付款' },
    'reg.step6.order_summary': { en: 'Order Summary', zh: '订单摘要' },
    'reg.step6.company_name': { en: 'Company Name', zh: '公司名称' },
    'reg.step6.business': { en: 'Business', zh: '业务' },
    'reg.step6.paid_up': { en: 'Paid-up Capital', zh: '实缴资本' },
    'reg.step6.shareholders_count': { en: 'Shareholders', zh: '股东' },
    'reg.step6.fye': { en: 'FYE', zh: '财年结束' },
    'reg.step6.reg_service': { en: 'Registration Service', zh: '注册服务费' },
    'reg.step6.acra_fee': { en: 'ACRA Government Fee', zh: 'ACRA 政府规费' },
    'reg.step6.after_pay': { en: 'What happens after payment?', zh: '付款后会发生什么？' },
    'reg.step6.timeline': {
      en: ['Payment confirmed', 'Shareholders e-sign constitution', 'CSP licensed reviewer approves (≤30 min)', 'BizFile+ RPA submission', 'ACRA processing (up to 24h)', 'UEN issued → email + SMS'],
      zh: ['付款已确认', '股东电子签署章程', '持牌 CSP 审核（≤30 分钟）', 'BizFile+ RPA 提交', 'ACRA 处理（最长 24 小时）', '签发 UEN → 邮件+短信通知' ]
    },
    'reg.step6.pay_btn': { en: '💳 Pay S$703 & Submit', zh: '💳 支付 S$703 并提交' },
    'reg.step6.success': { en: 'Payment successful! Order {oid} submitted. CSP review in progress...', zh: '支付成功！订单 {oid} 已提交，CSP 审核中...' },

    // ====== Order Detail ======
    'order.progress': { en: 'Progress', zh: '进度' },
    'order.advance': { en: '⏭ Advance (demo)', zh: '⏭ 推进（演示）' },
    'order.details': { en: 'Company Details', zh: '公司信息' },
    'order.uen': { en: 'UEN', zh: '统一编号' },
    'order.uen_pending': { en: '— (pending)', zh: '— (待签发)' },
    'order.capital': { en: 'Capital', zh: '资本金' },
    'order.shareholders_title': { en: 'Shareholders', zh: '股东' },
    'order.kyc_ok': { en: 'KYC ✓', zh: 'KYC ✓' },
    'order.pending': { en: 'pending', zh: '待处理' },

    // ====== Books ======
    'books.title': { en: 'Books', zh: '记账' },
    'books.sub': { en: 'AI-generated journal entries (SFRS compliant). Review what matters; approve the rest in bulk.', zh: 'AI 自动生成会计分录（符合 SFRS）。仅审阅重点项，其余一键批量通过。' },
    'books.no_company': { en: 'No active company. Register one first.', zh: '无活跃公司，请先注册一家。' },
    'books.revenue': { en: 'Revenue (YTD)', zh: '营业收入（年初至今）' },
    'books.expenses': { en: 'Expenses (YTD)', zh: '支出（年初至今）' },
    'books.net_profit': { en: 'Net Profit', zh: '净利润' },
    'books.to_review': { en: 'To Review', zh: '待审核' },
    'books.journals_pending': { en: 'Journals pending', zh: '笔分录待审' },
    'books.quick_actions': { en: 'Quick Actions', zh: '快捷操作' },
    'books.import_demo': { en: '📥 Import Demo Bank Statement', zh: '📥 导入演示银行流水' },
    'books.ocr_invoice': { en: '🧾 OCR an Invoice', zh: '🧾 发票 OCR 识别' },
    'books.auto_journal_all': { en: '⚡ Auto-generate Journals for All', zh: '⚡ 一键为全部交易生成分录' },
    'books.txns_title': { en: 'Transactions', zh: '交易明细' },
    'books.invoices_title': { en: 'Invoices', zh: '发票' },
    'books.journals_title': { en: 'Journal Entries', zh: '会计分录' },
    'books.generate_je': { en: 'Generate JE', zh: '生成分录' },
    'books.imported_msg': { en: 'Imported {n} transactions', zh: '已导入 {n} 笔交易' },
    'books.ocr_msg': { en: 'OCR complete: {v}, S${t} (confidence {c}%)', zh: 'OCR 完成：{v}，S${t}（置信度 {c}%）' },
    'books.je_msg': { en: 'Journal generated (confidence {c}%): {r}', zh: '分录已生成（置信度 {c}%）：{r}' },
    'books.autogen_msg': { en: 'Generated {n} journal entries', zh: '已生成 {n} 笔分录' },
    'books.ref': { en: 'Ref', zh: '编号' },
    'books.lines': { en: 'Lines', zh: '科目' },
    'books.gst': { en: 'GST', zh: '消费税' },

    // ====== Tax ======
    'tax.title': { en: 'Tax Agent — ECI, Form C-S, GST', zh: '税务智能体 —— ECI、Form C-S、GST' },
    'tax.sub': { en: 'Singapore tax framework: 17% corporate rate, SUTR for first 3 YAs, PTE thereafter. CSP licensed reviewer signs off before submission.', zh: '新加坡税制：公司税率 17%，前三个评估年适用 SUTR，之后适用 PTE。提交前由持牌 CSP 审核签字。' },
    'tax.no_deadlines': { en: 'No upcoming deadlines', zh: '近期无截止日期' },
    'tax.eci_calc': { en: 'ECI Calculator', zh: 'ECI 计算器' },
    'tax.eci_sub': { en: 'Estimated Chargeable Income — due within 3 months of FYE (unless waiver applies).', zh: '预估应税收入 —— 财年结束后 3 个月内申报（除非豁免）。' },
    'tax.revenue': { en: 'Annual Revenue (SGD)', zh: '年度营收（新币）' },
    'tax.total_exp': { en: 'Total Expenses (SGD)', zh: '总支出（新币）' },
    'tax.sutr': { en: 'Qualify for Start-Up Tax Exemption (SUTR) — first 3 YAs', zh: '符合初创企业税收豁免（SUTR）—— 前 3 个评估年' },
    'tax.compute_eci': { en: 'Compute ECI', zh: '计算 ECI' },
    'tax.eci_estimate': { en: 'ECI Estimate', zh: 'ECI 预估' },
    'tax.net_profit': { en: 'Net Profit', zh: '净利润' },
    'tax.chargeable': { en: 'Chargeable Income', zh: '应税收入' },
    'tax.exemption': { en: 'Exemption', zh: '免税额' },
    'tax.taxable': { en: 'Taxable Income', zh: '实际应税额' },
    'tax.payable': { en: 'Tax Payable (17%)', zh: '应纳税款（17%）' },
    'tax.eff_rate': { en: 'Effective rate', zh: '实际税率' },
    'tax.deadline': { en: 'Filing deadline', zh: '申报截止日' },
    'tax.ai_conf': { en: 'AI confidence', zh: 'AI 置信度' },
    'tax.form_cs': { en: 'Form C-S Draft', zh: 'Form C-S 草稿' },
    'tax.form_cs_sub': { en: 'Simplified corporate tax return. Eligible: revenue ≤ S$5M, 100% SG-tax resident.', zh: '简化版公司税报表。适用：营收 ≤ S$500 万、100% 新加坡税务居民。' },
    'tax.draft_cs': { en: '🪄 Draft Form C-S', zh: '🪄 起草 Form C-S' },
    'tax.filings': { en: 'Tax Filings History', zh: '历史申报记录' },
    'tax.no_filings': { en: 'No filings yet', zh: '暂无申报记录' },
    'tax.ya': { en: 'YA', zh: '评估年' },

    // ====== Secretary ======
    'sec.title': { en: 'Corporate Secretary', zh: '公司秘书' },
    'sec.sub': { en: 'AGM, Annual Return, board resolutions — handled by Secretary Agent with CSP review.', zh: '股东大会、年度申报、董事会决议 —— 由秘书智能体处理，CSP 审核。' },
    'sec.gen_res': { en: 'Generate Board Resolution', zh: '生成董事会决议' },
    'sec.subject': { en: 'Subject', zh: '议题' },
    'sec.res_options': {
      en: ['Approval of annual financial statements', 'Appointment of new director', 'Change of registered office', 'Declaration of dividend', 'Opening of bank account'],
      zh: ['批准年度财务报表', '任命新董事', '变更注册办公地址', '宣派股息', '开立银行账户']
    },
    'sec.draft_res': { en: '🪄 Draft Resolution', zh: '🪄 起草决议' },
    'sec.ar_status': { en: 'Annual Return Status', zh: '年度申报状态' },
    'sec.last_ar': { en: 'Last AR filed', zh: '最近一次年度申报' },
    'sec.pending_first': { en: 'Pending first filing', zh: '待首次申报' },
    'sec.agm_held': { en: 'AGM held', zh: '已召开股东大会' },
    'sec.not_yet': { en: 'Not yet', zh: '暂未召开' },
    'sec.next_ar': { en: 'Next AR due', zh: '下次年度申报截止' },
    'sec.ar_due': { en: '7 months after FYE', zh: '财年结束后 7 个月内' },
    'sec.prep_ar': { en: '📂 Prepare AR via BizFile+', zh: '📂 通过 BizFile+ 准备 AR' },
    'sec.registers': { en: 'Statutory Registers', zh: '法定登记册' },
    'sec.realtime': { en: 'Maintained in real-time from ACRA data.', zh: '基于 ACRA 数据实时维护。' },

    // ====== Chat ======
    'chat.new': { en: '+ New Chat', zh: '+ 新建对话' },
    'chat.placeholder': { en: 'Ask anything about your Singapore company...', zh: '关于新加坡公司的任何问题都可以问我...' },
    'chat.empty_title': { en: 'How can AiCFO help today?', zh: '今天 AiCFO 能为您做什么？' },
    'chat.no_msgs': { en: 'No messages yet', zh: '暂无消息' },
    'chat.samples': {
      en: [
        { q: 'Can I register "Bank of Skyhawk Pte Ltd"?', icon: '🏢' },
        { q: "What's my ECI for revenue S$500K and expenses S$300K?", icon: '📊' },
        { q: 'OCR my AWS invoice and generate a journal entry', icon: '🧾' },
        { q: 'How much does a Web3 company registration cost?', icon: '💰' }
      ],
      zh: [
        { q: '我可以注册"Bank of Skyhawk Pte Ltd"吗？', icon: '🏢' },
        { q: '营收 S$500K、支出 S$300K 的 ECI 是多少？', icon: '📊' },
        { q: '识别我的 AWS 发票并生成会计分录', icon: '🧾' },
        { q: 'Web3 公司注册的费用是多少？', icon: '💰' }
      ]
    },
    'chat.human_review': { en: 'Human review', zh: '需人工审核' },

    // ====== Pricing ======
    'pricing.title': { en: 'Pricing — Transparent, Dynamic, 70% Lower Than Incumbents', zh: '报价 —— 透明、动态、比同行低 70%' },
    'pricing.sub': { en: 'Pricing Agent uses 4-factor RAG (competitor scrape + historical deals + complexity + region).', zh: '报价智能体采用四因子 RAG（竞品抓取 + 历史成交 + 复杂度 + 区域）。' },
    'pricing.instant': { en: 'Instant Quote', zh: '即时报价' },
    'pricing.segment': { en: 'Segment', zh: '客户分层' },
    'pricing.seg.local': { en: 'Local SG SME', zh: '新加坡本地中小企业' },
    'pricing.seg.cn': { en: 'China Outbound', zh: '中国出海' },
    'pricing.seg.web3': { en: 'Web3 / Crypto', zh: 'Web3 / 加密' },
    'pricing.seg.fo': { en: 'Family Office', zh: '家族办公室' },
    'pricing.shareholders': { en: 'Shareholders', zh: '股东人数' },
    'pricing.monthly_txn': { en: 'Monthly Transactions', zh: '月均交易笔数' },
    'pricing.urgency': { en: 'Urgency', zh: '紧急程度' },
    'pricing.u.std': { en: 'Standard', zh: '标准' },
    'pricing.u.rush': { en: 'Rush', zh: '加急' },
    'pricing.u.exp': { en: 'Express', zh: '特急' },
    'pricing.gen_quote': { en: '🪄 Generate Quote', zh: '🪄 生成报价' },
    'pricing.basic': { en: 'Basic 🚀', zh: '基础版 🚀' },
    'pricing.pro': { en: 'Pro ⭐️', zh: '专业版 ⭐️' },
    'pricing.enterprise': { en: 'Enterprise 👑', zh: '企业版 👑' },
    'pricing.per_year_auto': { en: 'per year · AI full-auto', zh: '每年 · AI 全自动' },
    'pricing.per_year_pro': { en: 'per year · AI + Human review', zh: '每年 · AI + 人工审核' },
    'pricing.per_year_ent': { en: 'per year · White-glove', zh: '每年 · 尊享服务' },
    'pricing.basic_items': {
      en: ['Registration + Secretary', 'Bookkeeping (500 txn/mo)', 'ECI + Form C-S', 'GST quarterly'],
      zh: ['公司注册 + 秘书', '记账（月 500 笔）', 'ECI + Form C-S', 'GST 季度申报']
    },
    'pricing.basic_no': {
      en: ['Web3 handling', 'Dedicated CFO'],
      zh: ['Web3 专项处理', '专属 CFO']
    },
    'pricing.pro_items': {
      en: ['Everything in Basic', 'Quarterly CSP review', 'Tax optimization advice', 'Web3 token accounting', '1h CFO consult/month'],
      zh: ['包含基础版全部', '季度 CSP 审核', '税务优化建议', 'Web3 代币会计', '每月 1 小时 CFO 咨询']
    },
    'pricing.pro_no': { en: ['Unlimited CFO hours'], zh: ['无限 CFO 时长'] },
    'pricing.ent_items': {
      en: ['Everything in Pro', 'Cross-border structuring', 'MAS DPT licence support', '13O/13U family office', 'Unlimited CFO consults', 'DD / audit support'],
      zh: ['包含专业版全部', '跨境架构设计', 'MAS DPT 牌照支持', '13O/13U 家族办公室', '无限 CFO 咨询', '尽调 / 审计支持']
    },
    'pricing.select_basic': { en: 'Select Basic', zh: '选择基础版' },
    'pricing.select_pro': { en: 'Select Pro', zh: '选择专业版' },
    'pricing.contact': { en: 'Contact Sales', zh: '联系销售' },
    'pricing.factors': { en: 'Pricing Factors (transparency)', zh: '定价因子（公开透明）' },
    'pricing.median_base': { en: 'Median base', zh: '中位基础价' },
    'pricing.complexity': { en: 'complexity', zh: '复杂度' },
    'pricing.region': { en: 'region', zh: '区域' },

    // ====== Admin ======
    'admin.brand': { en: 'AiCFO Admin', zh: 'AiCFO 管理后台' },
    'admin.group.overview': { en: 'Overview', zh: '总览' },
    'admin.group.agents': { en: 'Agents', zh: '智能体' },
    'admin.group.rag': { en: 'RAG Knowledge', zh: 'RAG 知识库' },
    'admin.group.ops': { en: 'Operations', zh: '运营' },
    'admin.nav.overview': { en: '📊 Dashboard', zh: '📊 仪表盘' },
    'admin.nav.queue': { en: '📋 Review Queue', zh: '📋 审核队列' },
    'admin.nav.agents': { en: '🤖 Agent Studio', zh: '🤖 智能体工作室' },
    'admin.nav.runs': { en: '🔍 Agent Runs', zh: '🔍 运行记录' },
    'admin.nav.playground': { en: '🎮 Playground', zh: '🎮 调试台' },
    'admin.nav.rag': { en: '📚 Knowledge Base', zh: '📚 知识库' },
    'admin.nav.training': { en: '🎓 Training Jobs', zh: '🎓 训练任务' },
    'admin.nav.retrieval': { en: '🔎 Retrieval Test', zh: '🔎 检索测试' },
    'admin.nav.companies': { en: '🏢 Companies', zh: '🏢 公司' },
    'admin.nav.users': { en: '👤 Users', zh: '👤 用户' },

    'admin.overview.title': { en: 'Admin Overview', zh: '后台总览' },
    'admin.overview.sub': { en: 'Real-time platform health: agents, RAG, orders, reviews.', zh: '平台实时健康度：智能体、RAG、订单、审核。' },
    'admin.overview.total_companies': { en: 'Total Companies', zh: '公司总数' },
    'admin.overview.active': { en: 'active', zh: '活跃' },
    'admin.overview.runs': { en: 'Agent Runs', zh: '智能体调用' },
    'admin.overview.avg_conf': { en: 'avg conf', zh: '平均置信度' },
    'admin.overview.queue': { en: 'Review Queue', zh: '审核队列' },
    'admin.overview.j_pending': { en: 'journals pending', zh: '笔分录待审' },
    'admin.overview.latency': { en: 'Avg Latency', zh: '平均延迟' },
    'admin.overview.p50': { en: 'p50 inference', zh: 'p50 推理时延' },
    'admin.overview.pipeline': { en: 'Registration Pipeline', zh: '注册流水线' },
    'admin.overview.no_orders': { en: 'No orders yet', zh: '暂无订单' },
    'admin.overview.rag_kb': { en: 'RAG Knowledge Base', zh: 'RAG 知识库' },
    'admin.overview.docs': { en: 'docs', zh: '份文档' },
    'admin.overview.chunks': { en: 'chunks', zh: '个切片' },
    'admin.overview.feedback': { en: 'Feedback avg', zh: '反馈均分' },
    'admin.overview.ratings': { en: 'ratings', zh: '条评分' },
    'admin.overview.recent': { en: 'Recent Agent Runs', zh: '近期智能体调用' },

    'admin.queue.title': { en: 'CSP Review Queue', zh: 'CSP 审核队列' },
    'admin.queue.sub': { en: 'Human-in-the-loop: approve AI-generated artefacts before they reach regulators.', zh: '人工介入：在 AI 产物送达监管机构之前先审核签字。' },
    'admin.queue.orders': { en: 'Registration Orders Awaiting Review', zh: '待审核注册订单' },
    'admin.queue.no_orders': { en: 'No orders pending review', zh: '暂无待审订单' },
    'admin.queue.journals': { en: 'Journal Entries Awaiting Approval', zh: '待审核分录' },
    'admin.queue.no_journals': { en: 'All journal entries approved', zh: '全部分录已审核' },
    'admin.queue.tax': { en: 'Tax Drafts', zh: '税务草稿' },
    'admin.queue.no_tax': { en: 'No tax drafts', zh: '暂无税务草稿' },
    'admin.queue.price': { en: 'Price', zh: '价格' },
    'admin.queue.ref': { en: 'Ref', zh: '编号' },
    'admin.queue.lines': { en: 'Lines', zh: '分录' },
    'admin.queue.reason': { en: 'Reason', zh: '原因' },
    'admin.queue.signoff': { en: '✓ Sign Off', zh: '✓ 签字通过' },
    'admin.queue.ai_conf': { en: 'AI Conf', zh: 'AI 置信度' },
    'admin.queue.chargeable': { en: 'Chargeable', zh: '应税' },
    'admin.queue.payable': { en: 'Tax Payable', zh: '应纳税款' },

    'admin.agents.title': { en: 'Agent Studio', zh: '智能体工作室' },
    'admin.agents.sub': { en: 'Create, edit, test and version your AI agents. Hot-swappable system prompts, RAG layer selection, and tool bindings.', zh: '创建、编辑、测试、管理 AI 智能体版本。支持热更系统提示词、RAG 层选择与工具绑定。' },
    'admin.agents.new': { en: '+ New Agent', zh: '+ 新建智能体' },
    'admin.agents.agent_name': { en: 'Agent Name', zh: '智能体名称' },
    'admin.agents.prompt': { en: 'System Prompt (Markdown supported)', zh: '系统提示词（支持 Markdown）' },
    'admin.agents.tools': { en: 'Tools (JSON array)', zh: '工具（JSON 数组）' },
    'admin.agents.rag_layers': { en: 'RAG Layers', zh: 'RAG 知识层' },
    'admin.agents.live_test': { en: '🧪 Live Test', zh: '🧪 在线测试' },
    'admin.agents.test_ph': { en: "Test input, e.g. 'Check if I can register Bank of Skyhawk'", zh: "测试输入，例如'我能否注册 Bank of Skyhawk'" },
    'admin.agents.run_test': { en: '▶ Run Test', zh: '▶ 运行测试' },
    'admin.agents.recent_runs': { en: '📊 Recent Runs', zh: '📊 近期调用' },
    'admin.agents.no_runs': { en: 'No runs yet', zh: '暂无调用' },
    'admin.agents.tool_calls': { en: 'Tool Calls:', zh: '工具调用：' },
    'admin.agents.citations': { en: 'RAG Citations:', zh: 'RAG 引用：' },
    'admin.agents.raw_json': { en: 'Raw JSON', zh: '原始 JSON' },
    'admin.agents.saved': { en: 'Agent saved', zh: '智能体已保存' },
    'admin.agents.confirm_del': { en: 'Delete this agent?', zh: '确认删除此智能体？' },
    'admin.agents.prompt_name': { en: 'Agent name?', zh: '智能体名称？' },
    'admin.agents.prompt_type': { en: 'Agent type (e.g. custom, registration, tax)?', zh: '智能体类型（例如 custom / registration / tax）？' },
    'admin.agents.back': { en: '← Back to Agent Studio', zh: '← 返回工作室' },

    'admin.runs.title': { en: 'Agent Runs (Trace Inspector)', zh: '智能体调用（追踪检视）' },
    'admin.runs.sub': { en: 'Every agent invocation is logged with full trace: intent → RAG → route → tool calls → reflexion.', zh: '每次调用都会记录完整链路：意图识别 → RAG 检索 → 路由 → 工具调用 → 反思。' },
    'admin.runs.when': { en: 'When', zh: '时间' },
    'admin.runs.input': { en: 'Input', zh: '输入' },
    'admin.runs.latency': { en: 'Latency', zh: '延迟' },
    'admin.runs.trace_btn': { en: 'Trace', zh: '链路' },
    'admin.runs.trace': { en: 'Trace', zh: '调用链路' },
    'admin.runs.full_output': { en: 'Full Output', zh: '完整输出' },

    'admin.pg.title': { en: 'Agent Playground', zh: '智能体调试台' },
    'admin.pg.sub': { en: 'Route a query through the Master Agent and watch the full pipeline.', zh: '让查询穿过 Master 智能体，观察完整流水线。' },
    'admin.pg.query': { en: 'Query', zh: '查询' },
    'admin.pg.co_ctx': { en: 'Company Context', zh: '公司上下文' },
    'admin.pg.no_co': { en: 'No company', zh: '不关联公司' },
    'admin.pg.route': { en: '▶ Route via Master', zh: '▶ 通过 Master 路由' },
    'admin.pg.running': { en: 'Pipeline running...', zh: '流水线运行中...' },
    'admin.pg.router': { en: '🧭 Master Router', zh: '🧭 Master 路由' },
    'admin.pg.intent': { en: 'Intent', zh: '意图' },
    'admin.pg.need_human': { en: 'Need Human', zh: '需人工' },
    'admin.pg.routed_to': { en: 'Routed to', zh: '路由至' },
    'admin.pg.grounding': { en: '📚 RAG Grounding', zh: '📚 RAG 溯源' },
    'admin.pg.no_citations': { en: 'No citations', zh: '无引用' },
    'admin.pg.response': { en: '💬 Agent Response', zh: '💬 智能体回复' },
    'admin.pg.next_steps': { en: 'Next Steps:', zh: '下一步：' },
    'admin.pg.full_trace': { en: 'Full Trace JSON', zh: '完整链路 JSON' },

    'admin.rag.title': { en: 'RAG Knowledge Base', zh: 'RAG 知识库' },
    'admin.rag.sub': { en: '4-layer knowledge graph: Regulatory · Practice · Pricing · Customer. Hybrid vector + keyword retrieval.', zh: '四层知识图谱：法规 · 实务 · 定价 · 客户。混合向量 + 关键词检索。' },
    'admin.rag.learn': { en: '🧠 Learn from Feedback', zh: '🧠 从反馈中学习' },
    'admin.rag.add': { en: '+ Add Document', zh: '+ 新增文档' },
    'admin.rag.all': { en: 'All Layers', zh: '全部层级' },
    'admin.rag.layer': { en: 'Layer', zh: '层级' },
    'admin.rag.title_col': { en: 'Title', zh: '标题' },
    'admin.rag.chunks': { en: 'Chunks', zh: '切片数' },
    'admin.rag.ingest_title': { en: 'Ingest New Knowledge Document', zh: '导入新知识文档' },
    'admin.rag.ingest_sub': { en: 'The document will be chunked (~400 chars, 80 char overlap) and embedded (16-dim mock vector). Production uses BGE-M3 + Qdrant.', zh: '文档将被切片（约 400 字符，重叠 80）并嵌入（16 维模拟向量）。生产环境使用 BGE-M3 + Qdrant。' },
    'admin.rag.layer_l1': { en: 'L1 Regulatory (law, statutes)', zh: 'L1 法规（法律、法规条文）' },
    'admin.rag.layer_l2': { en: 'L2 Practice (FAQ, e-Tax Guides, SFRS)', zh: 'L2 实务（FAQ、电子税务指南、SFRS）' },
    'admin.rag.layer_l3': { en: 'L3 Pricing (competitor data, margins)', zh: 'L3 定价（竞品数据、利润率）' },
    'admin.rag.layer_l4': { en: 'L4 Customer (company-specific)', zh: 'L4 客户（公司专属）' },
    'admin.rag.content': { en: 'Content', zh: '内容' },
    'admin.rag.content_ph': { en: 'Paste the full knowledge text here...', zh: '请在此粘贴完整的知识文本...' },
    'admin.rag.metadata': { en: 'Metadata (JSON)', zh: '元数据（JSON）' },
    'admin.rag.ingest_btn': { en: '💾 Ingest & Index', zh: '💾 导入并索引' },
    'admin.rag.ingested_msg': { en: 'Ingested! Created {n} chunks.', zh: '已导入！生成 {n} 个切片。' },
    'admin.rag.learn_msg': { en: 'Reinforcement learning: promoted {n} high-rated feedback entries into L4 Customer layer.', zh: '强化学习：已将 {n} 条高分反馈纳入 L4 客户层。' },
    'admin.rag.confirm_del': { en: 'Delete this document and all its chunks?', zh: '确认删除此文档及其全部切片？' },
    'admin.rag.doc_chunks': { en: 'Chunks', zh: '切片' },
    'admin.rag.tokens': { en: 'tokens', zh: 'tokens' },
    'admin.rag.back': { en: '← Back', zh: '← 返回' },

    'admin.training.title': { en: 'RAG Training Jobs', zh: 'RAG 训练任务' },
    'admin.training.sub': { en: 'Batch-ingest, re-index, and monitor embedding jobs with full logs.', zh: '批量导入、重索引、监控嵌入任务，日志完整可追溯。' },
    'admin.training.launch': { en: '🚀 Launch Training Job', zh: '🚀 启动训练任务' },
    'admin.training.total_jobs': { en: 'Total Jobs', zh: '任务总数' },
    'admin.training.completed': { en: 'Completed', zh: '已完成' },
    'admin.training.tokens_emb': { en: 'Tokens Embedded', zh: '已嵌入 Token 数' },
    'admin.training.job': { en: 'Job', zh: '任务' },
    'admin.training.docs': { en: 'Docs', zh: '文档' },
    'admin.training.duration': { en: 'Duration', zh: '耗时' },
    'admin.training.logs': { en: 'Logs', zh: '日志' },
    'admin.training.logs_for': { en: 'Logs for', zh: '日志：' },
    'admin.training.launch_title': { en: 'Launch Training Job', zh: '启动训练任务' },
    'admin.training.launch_sub': { en: 'Upload or paste multiple documents to batch-embed into a chosen RAG layer.', zh: '上传或粘贴多份文档，将其批量嵌入到所选 RAG 层。' },
    'admin.training.job_name': { en: 'Job Name', zh: '任务名称' },
    'admin.training.target_layer': { en: 'Target Layer', zh: '目标层级' },
    'admin.training.docs_label': { en: 'Documents (JSON array of {source, title, content})', zh: '文档（JSON 数组，格式 {source, title, content}）' },
    'admin.training.run': { en: '🚀 Run Job', zh: '🚀 运行任务' },
    'admin.training.running': { en: 'Running embedding pipeline...', zh: '嵌入流水线运行中...' },
    'admin.training.completed_msg': { en: '✓ Job Completed', zh: '✓ 任务已完成' },
    'admin.training.view_in': { en: 'View in Training Jobs →', zh: '查看训练任务 →' },
    'admin.training.invalid_json': { en: 'Invalid JSON', zh: 'JSON 格式错误' },
    'admin.training.back': { en: '← Back', zh: '← 返回' },

    'admin.retrieval.title': { en: 'Retrieval Playground', zh: '检索调试台' },
    'admin.retrieval.sub': { en: 'Test the hybrid retriever (65% vector + 35% keyword). Compare layers and inspect ranking.', zh: '测试混合检索器（向量 65% + 关键词 35%），比较各层级排序。' },
    'admin.retrieval.layers': { en: 'Layers (comma-separated)', zh: '层级（逗号分隔）' },
    'admin.retrieval.topk': { en: 'Top K', zh: 'Top K' },
    'admin.retrieval.run': { en: '🔎 Retrieve', zh: '🔎 检索' },
    'admin.retrieval.top_results': { en: 'Top', zh: '前' },
    'admin.retrieval.results': { en: 'results', zh: '条结果' },
    'admin.retrieval.no_results': { en: 'No results', zh: '无结果' },
    'admin.retrieval.vector': { en: 'Vector', zh: '向量' },
    'admin.retrieval.keyword': { en: 'Keyword', zh: '关键词' },
    'admin.retrieval.total': { en: 'Total', zh: '综合' },

    'admin.companies.title': { en: 'All Companies', zh: '全部公司' },
    'admin.companies.sub': { en: 'Portfolio view of all companies across the platform.', zh: '查看平台上的全部公司组合。' },
    'admin.companies.segment': { en: 'Segment', zh: '客户分层' },
    'admin.companies.tier': { en: 'Tier', zh: '订阅套餐' },
    'admin.companies.created': { en: 'Created', zh: '创建于' },

    'admin.users.title': { en: 'Users', zh: '用户' },
    'admin.users.sub': { en: 'Platform user directory.', zh: '平台用户目录。' },
    'admin.users.stub': { en: 'Users view — stub. Wire to SELECT id, email, name, role FROM users.', zh: '用户视图 —— 占位。对接 SELECT id, email, name, role FROM users。' },
  };

  const LS_KEY = 'aicfo.locale';
  let _locale = (typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || 'en';

  function t(key, vars) {
    const entry = DICT[key];
    if (!entry) return key; // fallback to key
    let v = entry[_locale];
    if (v === undefined) v = entry.en;
    if (typeof v === 'string' && vars) {
      Object.keys(vars).forEach(k => { v = v.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    }
    return v;
  }

  function getLocale() { return _locale; }
  function setLocale(l) {
    _locale = (l === 'zh' ? 'zh' : 'en');
    try { localStorage.setItem(LS_KEY, _locale); } catch (_) {}
    document.documentElement.lang = (_locale === 'zh' ? 'zh-CN' : 'en');
    // Notify listeners
    window.dispatchEvent(new CustomEvent('localechange', { detail: { locale: _locale } }));
  }
  function toggleLocale() { setLocale(_locale === 'en' ? 'zh' : 'en'); }

  // Apply translations to any element with [data-i18n="key"] and [data-i18n-ph="key"] (placeholder) / [data-i18n-title="key"] (title attr)
  function applyDOM(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      const v = t(k);
      if (typeof v === 'string') el.textContent = v;
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const k = el.getAttribute('data-i18n-ph');
      const v = t(k);
      if (typeof v === 'string') el.setAttribute('placeholder', v);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
      const k = el.getAttribute('data-i18n-title');
      const v = t(k);
      if (typeof v === 'string') el.setAttribute('title', v);
    });
  }

  window.I18N = { t, getLocale, setLocale, toggleLocale, applyDOM, DICT };
  // Initialize <html lang=""> and apply static translations as soon as DOM is ready
  try { document.documentElement.lang = (_locale === 'zh' ? 'zh-CN' : 'en'); } catch (_) {}
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyDOM());
    } else {
      applyDOM();
    }
  }
})();
