// ================================================================================
// AiCFO 统一 AI 配置中枢 (ai.config.js)
// ================================================================================
// 职责：
//   1. 统一读取 OpenAI 兼容端点（环境变量优先 → ~/.genspark_llm.yaml 回退）
//   2. 定义可用模型列表与场景化默认模型（intent / 生成 / 推理 / 嵌入）
//   3. 定义所有 Agent 的系统 Prompt 元信息与路由表
//   4. 提供 healthCheck() 方法，供启动时探测沙盒 GPT 模型是否可用
//
// 所有 Agent/RAG 模块统一从本文件导入配置，避免硬编码 key / 模型名称。
// ================================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');

// --------------------------------------------------------------------------------
// 1. 凭证解析：ENV → YAML → 空
// --------------------------------------------------------------------------------
function resolveCredentials() {
  let apiKey = process.env.OPENAI_API_KEY || null;
  let baseURL = process.env.OPENAI_BASE_URL || null;
  let source = 'env';

  if (!apiKey) {
    try {
      const yaml = require('js-yaml');
      const cfgPath = path.join(os.homedir(), '.genspark_llm.yaml');
      if (fs.existsSync(cfgPath)) {
        const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {};
        apiKey = cfg.openai && cfg.openai.api_key;
        baseURL = baseURL || (cfg.openai && cfg.openai.base_url);
        source = 'yaml(~/.genspark_llm.yaml)';
      }
    } catch (e) {
      // js-yaml 不可用时忽略
    }
  }

  return { apiKey, baseURL: baseURL || 'https://www.genspark.ai/api/llm_proxy/v1', source };
}

// --------------------------------------------------------------------------------
// 2. 支持的模型 —— 参考 GenSpark LLM 代理文档
// --------------------------------------------------------------------------------
const SUPPORTED_MODELS = [
  'gpt-5', 'gpt-5.1', 'gpt-5.2',
  'gpt-5-mini', 'gpt-5-nano',
  'gpt-5-codex', 'gpt-5.2-codex', 'gpt-5.3-codex'
];

// 场景化默认模型（可用 AICFO_LLM_MODEL_* 环境变量覆盖）
const MODELS = {
  default:   process.env.AICFO_LLM_MODEL          || 'gpt-5-mini',   // 通用默认
  routing:   process.env.AICFO_LLM_MODEL_ROUTING  || 'gpt-5-nano',   // 意图识别（轻量快）
  generate:  process.env.AICFO_LLM_MODEL_GENERATE || 'gpt-5-mini',   // 文档/报表生成
  reasoning: process.env.AICFO_LLM_MODEL_REASON   || 'gpt-5',        // 复杂税务/法务推理
  code:      process.env.AICFO_LLM_MODEL_CODE     || 'gpt-5-codex'   // 代码/XBRL 生成
};

// --------------------------------------------------------------------------------
// 3. Agent 注册表 —— 所有主管 Agent 的元信息 + 系统 Prompt
//    运行时由 agents/supervisors/*.js 加载此配置
// --------------------------------------------------------------------------------
const AGENTS = {
  // —— 主编排 Agent（总控）——
  master: {
    id: 'agent_master',
    type: 'master',
    role: '总控编排官 / Master Orchestrator',
    model: MODELS.reasoning,
    layer: 'orchestration',
    tools: ['route_to_agent', 'rag_search', 'reflexion_check'],
    system_prompt: `你是 AiCFO 平台的总控编排官 (Master Orchestrator)。
职责：
1. 将用户请求路由到正确的专业 Agent
2. 聚合多个 Agent 的结果
3. 通过 Reflexion 循环检测置信度，低于 0.7 时升级至持牌 CSP 人审
输出必须为 JSON：{intent, confidence, sub_agents, reasoning}`
  },

  // —— 9 大业务主管 Agent ——
  registration: {
    id: 'agent_registration',
    type: 'registration',
    role: '注册主管 Agent / Incorporation Supervisor',
    model: MODELS.generate,
    layer: 'business',
    tools: ['acra_name_search', 'ssic_recommend', 'constitution_generate', 'bizfile_submit'],
    regulatory_refs: ['Companies Act 1967', 'ACRA BizFile+', 'SSIC 2020'],
    system_prompt: `你是新加坡公司注册主管 Agent。严格遵循 Companies Act 1967 与 ACRA BizFile+ 流程。
任务：ACRA 名称合规检查、SSIC 行业代码推荐、章程 (Constitution) 起草、BizFile+ 提交包生成。
输出双语 (EN/中文) 结构化 JSON，附监管条款引用与 confidence。`
  },

  kyc: {
    id: 'agent_kyc',
    type: 'kyc',
    role: 'KYC/AML 主管 Agent',
    model: MODELS.reasoning,
    layer: 'compliance',
    tools: ['singpass_oauth', 'myinfo_fetch', 'passport_ocr', 'liveness_check', 'aml_screen'],
    regulatory_refs: ['MAS Notice 626', 'CDSA (Corruption, Drug Trafficking and Other Serious Crimes)', 'FATF Recommendations'],
    system_prompt: `你是 KYC/AML 主管 Agent，遵循 MAS Notice 626 与 FATF 标准。
任务：Singpass MyInfo 身份验证、护照 OCR、活体检测、Dow Jones/World-Check AML 筛查、PEP 风险评级。
对任何命中 (hits>0) 或置信度 <0.85 的案例必须标记 need_human=true。`
  },

  bookkeeping: {
    id: 'agent_bookkeeping',
    type: 'bookkeeping',
    role: '账务主管 Agent / Bookkeeping Supervisor',
    model: MODELS.generate,
    layer: 'finance',
    tools: ['invoice_ocr', 'journal_generate', 'bank_reconcile', 'gst_classify'],
    regulatory_refs: ['SFRS for Small Entities', 'SFRS(I) 15 Revenue', 'IRAS GST Act'],
    system_prompt: `你是账务主管 Agent，严格遵循新加坡 SFRS for Small Entities 准则。
任务：发票 OCR、借贷分录自动生成（含 GST Box 编码）、银行对账、月结。
所有分录必须满足 借 = 贷。GST 税率以 IRAS 最新公告为准（2024-01 起 9%）。`
  },

  tax: {
    id: 'agent_tax',
    type: 'tax',
    role: '税务主管 Agent / Tax Supervisor',
    model: MODELS.reasoning,
    layer: 'finance',
    tools: ['eci_compute', 'form_cs_draft', 'gst_f5_draft', 'withholding_tax_compute'],
    regulatory_refs: ['Income Tax Act 1947', 'GST Act 1993', 'IRAS e-Tax Guides'],
    system_prompt: `你是新加坡税务主管 Agent。
规则：
- 公司所得税率 17%
- SUTE（新创企业免税）：前 3 个 YA，首 10 万应税 75% 免，次 10 万 50% 免
- PTE（部分免税）：首 1 万 75%，次 19 万 50%
- ECI 截止日：FYE 后 3 个月
- GST F5：季度申报，截止日为季末后 1 个月
输出 JSON 必须含 confidence 与法条引用。`
  },

  secretary: {
    id: 'agent_secretary',
    type: 'secretary',
    role: '公司秘书主管 Agent',
    model: MODELS.generate,
    layer: 'compliance',
    tools: ['resolution_draft', 'agm_calendar', 'annual_return_prepare', 'register_of_members'],
    regulatory_refs: ['Companies Act 1967 s.175 (AGM)', 'Companies Act 1967 s.197 (AR)'],
    system_prompt: `你是持牌公司秘书主管 Agent。职责：AGM 召开、Annual Return (AR) 申报、董事会决议起草、成员登记册维护。
AGM 须在 FYE 后 6 个月内召开；AR 须在 AGM 后 30 日内提交 (小公司可豁免)。`
  },

  pricing: {
    id: 'agent_pricing',
    type: 'pricing',
    role: '定价主管 Agent',
    model: MODELS.generate,
    layer: 'commercial',
    tools: ['competitor_scrape', 'historical_deal_query', 'complexity_score', 'region_premium'],
    regulatory_refs: [],
    system_prompt: `你是动态定价主管 Agent。4 因子模型：竞品爬取 + 历史成交 + 复杂度 + 区域溢价。
定价区间须比传统 CSP 低 70%，同时保持 ≥40% 毛利。输出 basic/pro/enterprise 三档报价及因子透明说明。`
  },

  legal: {
    id: 'agent_legal',
    type: 'legal',
    role: '法务主管 Agent',
    model: MODELS.reasoning,
    layer: 'compliance',
    tools: ['contract_draft', 'clause_compare', 'term_sheet_gen'],
    regulatory_refs: ['Contract Act', 'Personal Data Protection Act (PDPA)', 'Employment Act'],
    system_prompt: `你是新加坡法务主管 Agent。起草雇佣合同、股东协议、NDA、SAAS 条款等；必须标注法律不确定性并提示升级至 MAS 持牌律师。`
  },

  audit: {
    id: 'agent_audit',
    type: 'audit',
    role: '审计主管 Agent',
    model: MODELS.reasoning,
    layer: 'finance',
    tools: ['audit_trail_check', 'materiality_test', 'sampling_plan'],
    regulatory_refs: ['SSA (Singapore Standards on Auditing)', 'Companies Act 1967 s.205'],
    system_prompt: `你是审计主管 Agent。对账务 Agent 生成的分录做 Reflexion 审计：重要性测试、抽样测试、审计轨迹核对。输出审计意见草稿供持牌 PA 签字。`
  },

  due_diligence: {
    id: 'agent_dd',
    type: 'due_diligence',
    role: '尽调主管 Agent',
    model: MODELS.reasoning,
    layer: 'compliance',
    tools: ['corporate_structure_map', 'sanction_screen', 'litigation_search'],
    regulatory_refs: ['OFAC', 'UN Sanctions', 'EU Sanctions'],
    system_prompt: `你是并购/投资尽调主管 Agent。输出股权结构图、制裁清单命中、诉讼记录、财务风险四大模块。`
  }
};

// --------------------------------------------------------------------------------
// 4. 运行参数
// --------------------------------------------------------------------------------
const RUNTIME = {
  timeout_ms:          Number(process.env.AICFO_LLM_TIMEOUT_MS)   || 30000,
  retry_max:           Number(process.env.AICFO_LLM_RETRY_MAX)    || 2,
  confidence_threshold: Number(process.env.AICFO_CONF_THRESHOLD)  || 0.70,
  human_escalation:    (process.env.AICFO_HUMAN_ESCALATION || 'true') === 'true',
  cache_ttl_ms:        Number(process.env.AICFO_CACHE_TTL_MS)     || 5 * 60 * 1000
};

// --------------------------------------------------------------------------------
// 5. 健康检测：探测沙盒 GPT 模型是否可用
// --------------------------------------------------------------------------------
async function healthCheck({ verbose = true } = {}) {
  const creds = resolveCredentials();
  const result = {
    timestamp: new Date().toISOString(),
    credentials: {
      has_api_key: !!creds.apiKey,
      base_url: creds.baseURL,
      source: creds.source
    },
    models: {},
    overall: 'unknown'
  };

  if (!creds.apiKey) {
    result.overall = 'missing_credentials';
    if (verbose) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║  AiCFO AI 健康检测                                                ║');
      console.log('╠════════════════════════════════════════════════════════════════════╣');
      console.log('║  ⚠ 未检测到 API Key（将回退到 simulated LLM 模式）              ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝');
    }
    return result;
  }

  let OpenAI;
  try { OpenAI = require('openai'); }
  catch (e) {
    result.overall = 'sdk_missing';
    if (verbose) console.log('⚠ openai SDK 未安装：请 npm install openai');
    return result;
  }

  const client = new OpenAI({ apiKey: creds.apiKey, baseURL: creds.baseURL });
  const testSet = Array.from(new Set([MODELS.default, MODELS.routing, MODELS.reasoning]));

  if (verbose) {
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║  AiCFO AI 健康检测                                                ║');
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    console.log(`║  凭证来源 : ${creds.source.padEnd(54)}║`);
    console.log(`║  BaseURL  : ${creds.baseURL.slice(0, 54).padEnd(54)}║`);
    console.log('╠════════════════════════════════════════════════════════════════════╣');
  }

  let allOk = true;
  for (const model of testSet) {
    const t0 = Date.now();
    try {
      const resp = await Promise.race([
        client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: 'Reply with a JSON object: {"ok":true,"model":"<model-name>"}' },
            { role: 'user', content: 'ping' }
          ],
          response_format: { type: 'json_object' }
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), RUNTIME.timeout_ms))
      ]);
      const ms = Date.now() - t0;
      const content = resp.choices?.[0]?.message?.content || '';
      result.models[model] = { ok: true, latency_ms: ms, sample: content.slice(0, 80) };
      if (verbose) console.log(`║  ✓ ${model.padEnd(15)} ${(ms + 'ms').padStart(8)}  ${content.slice(0, 30).padEnd(32)}║`);
    } catch (e) {
      result.models[model] = { ok: false, error: e.message };
      allOk = false;
      if (verbose) console.log(`║  ✗ ${model.padEnd(15)} FAIL      ${e.message.slice(0, 32).padEnd(32)}║`);
    }
  }

  result.overall = allOk ? 'healthy' : 'degraded';
  if (verbose) {
    console.log('╠════════════════════════════════════════════════════════════════════╣');
    console.log(`║  总体状态 : ${result.overall.padEnd(54)}║`);
    console.log(`║  已注册 Agent 数: ${String(Object.keys(AGENTS).length).padEnd(48)}║`);
    console.log('╚════════════════════════════════════════════════════════════════════╝');
  }
  return result;
}

module.exports = {
  SUPPORTED_MODELS,
  MODELS,
  AGENTS,
  RUNTIME,
  resolveCredentials,
  healthCheck
};
