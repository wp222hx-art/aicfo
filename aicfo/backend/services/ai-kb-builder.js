// ================================================================================
// AiCFO AI 知识库自动构建服务
// ================================================================================
// 让 GPT 模型围绕"新加坡公司注册 / 法律法规 / 审计 / 报税"的主题，
// 结构化生成每个子主题的权威条款式内容，并通过 rag.ingest() 批量导入到 RAG 库。
//
// 导出:
//   • buildAll({onProgress}) -> 汇总统计
//   • TOPICS (只读)
// ================================================================================
const rag = require('../../rag/engine');
const gateway = require('./llm-gateway');

function client() {
  if (process.env.AICFO_LLM_OFFLINE === '1') return null;
  return gateway.getClient();
}

// --------------------------------------------------------------------------------
// 4 层知识库主题定义（覆盖注册 / 法律 / 审计 / 报税的"全部分类"）
// --------------------------------------------------------------------------------
const TOPICS = [
  // L1 监管层 — 核心法规与通告
  { layer: 'L1_regulatory', slug: 'companies_act_1967_full',         title: '《公司法 1967》完整分类' },
  { layer: 'L1_regulatory', slug: 'income_tax_act_1947_full',        title: '《所得税法 1947》完整分类' },
  { layer: 'L1_regulatory', slug: 'gst_act_1993_full',               title: '《商品与服务税法 1993》完整分类' },
  { layer: 'L1_regulatory', slug: 'cpf_act_full',                    title: '《公积金法》完整分类' },
  { layer: 'L1_regulatory', slug: 'mas_notice_626_aml',              title: 'MAS Notice 626 反洗钱指引' },
  { layer: 'L1_regulatory', slug: 'acra_bizfile_filing_rules',       title: 'ACRA BizFile+ 全部申报类别与费用' },
  { layer: 'L1_regulatory', slug: 'pdpa_2012',                       title: '《个人资料保护法 2012》' },
  { layer: 'L1_regulatory', slug: 'employment_act',                  title: '《雇佣法》核心条款' },
  { layer: 'L1_regulatory', slug: 'limited_partnership_act',         title: '《有限责任合伙法》' },
  { layer: 'L1_regulatory', slug: 'vcc_act_2018',                    title: '《可变资本公司法 2018》VCC' },
  { layer: 'L1_regulatory', slug: 'sfrs_for_se_standard',            title: 'SFRS for Small Entities 小型实体准则' },
  { layer: 'L1_regulatory', slug: 'ssa_audit_standards',             title: 'SSA 新加坡审计准则概览' },
  { layer: 'L1_regulatory', slug: 'iras_withholding_tax',            title: 'IRAS 预提税 (Section 45) 全部情形' },
  { layer: 'L1_regulatory', slug: 'iras_transfer_pricing',           title: 'IRAS 转让定价指引' },
  { layer: 'L1_regulatory', slug: 'iras_gst_e_tax_guide',            title: 'IRAS GST e-Tax Guide 重点摘要' },

  // L2 实操层 — SOP / 清单 / 模板
  { layer: 'L2_practice', slug: 'incorporation_sop_full',            title: '注册公司完整 SOP（外资 + 本地 + VCC）' },
  { layer: 'L2_practice', slug: 'nominee_director_sop',              title: '提名董事 SOP 与风险控制' },
  { layer: 'L2_practice', slug: 'bookkeeping_month_end_sop',         title: '月结 SOP 与科目映射表' },
  { layer: 'L2_practice', slug: 'bank_reconciliation_sop',           title: '银行对账 SOP（DBS / OCBC / UOB）' },
  { layer: 'L2_practice', slug: 'ar_ap_ageing_sop',                  title: '应收应付账龄管理 SOP' },
  { layer: 'L2_practice', slug: 'payroll_cpf_monthly_sop',           title: '薪资 + CPF 月度处理 SOP' },
  { layer: 'L2_practice', slug: 'ir8a_ir21_annual_sop',              title: 'IR8A / IR21 年度员工报税 SOP' },
  { layer: 'L2_practice', slug: 'eci_form_cs_sop',                   title: 'ECI + Form C-S 申报 SOP' },
  { layer: 'L2_practice', slug: 'gst_f5_quarterly_sop',              title: 'GST F5 季度申报 SOP + Box 解释' },
  { layer: 'L2_practice', slug: 'annual_return_xbrl_sop',            title: 'Annual Return + Simplified XBRL SOP' },
  { layer: 'L2_practice', slug: 'audit_engagement_sop',              title: '审计承接与独立性测试 SOP' },
  { layer: 'L2_practice', slug: 'audit_sampling_materiality',        title: '审计抽样 + 重要性水平确定 SOP' },
  { layer: 'L2_practice', slug: 'fs_generation_sfrs_se_sop',         title: 'SFRS for SE 财务报表生成 SOP' },
  { layer: 'L2_practice', slug: 'invoice_ocr_gst_classify_sop',      title: '发票 OCR + GST Box 自动分类 SOP' },
  { layer: 'L2_practice', slug: 'agm_resolution_templates',          title: 'AGM / 董事会决议模板全集' },

  // L3 定价层
  { layer: 'L3_pricing', slug: 'csp_services_market_pricing_2025',   title: 'CSP 全品类服务 2025 定价基准' },
  { layer: 'L3_pricing', slug: 'audit_fee_benchmark_2025',           title: '审计费基准（按营收分层）2025' },
  { layer: 'L3_pricing', slug: 'tax_services_pricing_matrix',        title: '税务服务价格矩阵 (ECI/C-S/GST/WHT)' }
];

// --------------------------------------------------------------------------------
// Prompt：让 GPT 生成可以直接入库的结构化 Markdown
// --------------------------------------------------------------------------------
function buildPrompt(topic) {
  return `请针对主题「${topic.title}」(layer=${topic.layer}) 生成一份新加坡合规知识条目。
要求：
1. 必须使用中文，标题用 "# " 一级标题。
2. 条款化、小节化；每小节一个 H2（## ）并控制在 120~200 字。
3. 明确引用具体法条 / 章节号 / 金额 / 税率 / 截止日。
4. 包含"自动化要点"小节说明 AI Agent 如何使用本条目。
5. 包含"引用来源"小节（ACRA / IRAS / MAS / CPF / ISCA 的具体页面或 e-Tax Guide 名称）。
6. 总长 900~1500 字；确保所有数字与 2025 年现行规定一致（GST 9%、CIT 17%、OW 上限 S$7,400）。
7. 只输出 Markdown，不要 JSON 或代码块包裹。`;
}

async function generateOne(topic, model) {
  if (!gateway.isReady()) throw new Error('LLM 不可用（AICFO_LLM_OFFLINE=1 或未配置 Tokenhot API Key）');
  const r = await gateway.chat({
    system: '你是新加坡企业合规专家，熟悉 ACRA / IRAS / MAS / CPF 全部条款。',
    user: buildPrompt(topic),
    purpose: 'kb_build',
    model  // 显式传 model 时优先（例如后台单次测试）
  });
  return r.content || '';
}

async function buildAll({ onProgress, concurrency = 3, model, skipExisting = true } = {}) {
  const results = [];
  const errors = [];
  const db = require('../db/schema');

  // 并发分批生成
  let idx = 0;
  async function worker() {
    while (idx < TOPICS.length) {
      const my = idx++; const t = TOPICS[my];
      const source = `ai-generated/${t.layer}/${t.slug}.md`;
      try {
        if (skipExisting) {
          const exist = db.prepare('SELECT id FROM rag_documents WHERE source=?').get(source);
          if (exist) {
            results.push({ ...t, doc_id: exist.id, chunks: 0, skipped: true });
            if (onProgress) onProgress({ done: results.length + errors.length, total: TOPICS.length, topic: t, skipped: true });
            continue;
          }
        }
        const content = await generateOne(t, model);
        const r = rag.ingest({
          layer: t.layer, source, title: t.title, content,
          metadata: { generator: 'ai-kb-builder', model, at: new Date().toISOString() }
        });
        results.push({ ...t, ...r });
        if (onProgress) onProgress({ done: results.length + errors.length, total: TOPICS.length, topic: t });
      } catch (e) {
        errors.push({ topic: t, error: e.message });
        if (onProgress) onProgress({ done: results.length + errors.length, total: TOPICS.length, topic: t, error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    topics_total: TOPICS.length,
    ingested: results.filter(r => !r.skipped).length,
    skipped:  results.filter(r =>  r.skipped).length,
    errors:   errors.length,
    details:  results,
    errors_detail: errors
  };
}

module.exports = { buildAll, TOPICS, generateOne };
