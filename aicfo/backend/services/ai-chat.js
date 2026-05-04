// ================================================================================
// AiCFO 真实 AI 对话服务
// ================================================================================
// 基于 OpenAI 兼容 SDK + GenSpark 代理，打通真实 GPT 模型，带 RAG 引用
// 导出：
//   • chatWithRAG({message, company_id, history, layers}) -> {reply, citations, model, latency_ms}
//   • chatStream(...)  -> 流式（可选）
//   • isReady() -> boolean
// ================================================================================
const gateway = require('./llm-gateway');
const rag = require('../../rag/engine');
const sgReg = require('./sg-reg-agent');

function client() {
  if (process.env.AICFO_LLM_OFFLINE === '1') return null;
  return gateway.getClient();
}

function isReady() { return gateway.isReady(); }

const BASE_SYSTEM_PROMPT = `你是 AiCFO（新加坡企业大脑）的持牌 CSP/CFO 助手，运行在 **最强推理 (reasoning)** 模型上。
回答必须严格基于新加坡本地法规：
- Companies Act 1967（注册、AGM、AR、决议、章程）
- Income Tax Act 1947（公司税率 17%、SUTE 首 3 年免税：首 10 万 75% 免 + 次 10 万 50% 免；PTE 首 1 万 75% + 次 19 万 50%；ECI 截止 FYE+3 个月；Form C-S 截止 11/30）
- GST Act 1993（税率 9% 自 2024-01；F5 季度申报，季末+1 个月截止；Box 1/4/5/6/7/8/13）
- CPF Act（OW 上限 S$7,400/月；雇主 17%/雇员 20%；PR Y1 5%/4%、Y2 15%/9%；SDL 0.25% 上限 S$11.25）
- SFRS for Small Entities（P&L / BS / CF / SOCE / Notes / Simplified XBRL）
- MAS Notice 626（KYC/AML、FATF 标准）

行文风格：
1. 如果问题是中文，用中文回答；是英文用英文；混用默认中文。
2. 每条关键结论后用【引用 N】标注 RAG 来源。
3. 涉及金额、税率、截止日必须明确数字。
4. 涉及法律不确定性或跨境复杂问题，在末尾添加一行：
   "⚠ 建议升级至持牌 CSP / MAS 认可律师复核（置信度 <0.8）。"
5. 回答长度控制在 6 段以内，重点列表化。`;

// 合并基础 Prompt + 新加坡注册规则 Agent (15 规则 + 7 步工作流 + 10 skills + 边界)
const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}\n\n${sgReg.PROMPT_BLOCK}`;

/**
 * 带 RAG 检索的对话
 * @param {object} opts
 * @param {string} opts.message    - 用户本轮消息
 * @param {string} opts.company_id - 可选，用于 L4 客户层检索
 * @param {Array}  opts.history    - 可选，[{role, content}]
 * @param {Array}  opts.layers     - 默认 4 层全检索
 * @param {string} opts.model      - 默认 gpt-5-mini
 */
async function chatWithRAG({ message, company_id = null, history = [], layers, model } = {}) {
  const t0 = Date.now();
  const c = client();

  // 1. 先做 RAG 检索，把引用贴进系统 Prompt
  const useLayers = layers || ['L1_regulatory', 'L2_practice', 'L3_pricing', 'L4_customer'];
  let hits = [];
  try { hits = rag.search({ query: message, layers: useLayers, k: 4, company_id }) || []; }
  catch (_) { hits = []; }

  const citationsBlock = hits.length
    ? hits.map((h, i) =>
        `【引用 ${i + 1}】层级=${h.layer} | 标题=${h.title} | 相似度=${(h.score || 0).toFixed(3)}\n${(h.content || '').slice(0, 320)}`
      ).join('\n\n')
    : '（未检索到相关 RAG 引用，回答时请如实告知并给出最佳判断）';

  const systemWithCtx = `${SYSTEM_PROMPT}\n\n# 检索到的知识库引用\n${citationsBlock}`;

  if (!c) {
    // 无真实 LLM 时用 RAG 首段兜底
    const reply = hits.length
      ? `根据知识库：${(hits[0].content || '').slice(0, 280)}\n\n⚠ 当前运行在离线模式，未调用 GPT；已返回本地 RAG 最相关片段。`
      : '⚠ 当前运行在离线模式，且 RAG 未命中相关文档，请先通过"AI 建库"按钮生成知识库。';
    return { reply, citations: hits, model: 'offline', latency_ms: Date.now() - t0 };
  }

  // 2. 组装消息，带最近 6 轮历史
  const msgs = [{ role: 'system', content: systemWithCtx }];
  (history || []).slice(-6).forEach(h => {
    if (h && h.role && h.content) msgs.push({ role: h.role, content: h.content });
  });
  msgs.push({ role: 'user', content: message });

  // 3. 调真实模型（通过统一网关 → Tokenhot / OpenAI 兼容后端）
  //    强制走 reasoning tier (最强推理) — 装载了完整 SG 注册规则 Agent 和 10 个 skill，必须用最强模型
  const forcedTier = arguments[0]?.tier || 'reasoning';
  const r = await gateway.chat({
    messages: msgs,
    purpose: 'chat',
    model,          // 上游显式指定时优先
    tier: forcedTier
  });
  const reply = r.content || '（无返回内容）';

  return {
    reply,
    citations: hits.map(h => ({ id: h.chunk_id, title: h.title, layer: h.layer, score: h.score })),
    model: r.model,
    latency_ms: Date.now() - t0
  };
}

// 暴露给前端/管理端的清单，用来在对话入口显示 "⚡ 引擎 / 📚 规则 / 🛠 skills / 🚧 边界"
function getManifest() {
  const cfg = gateway.getConfig();
  const tier = (cfg.tier_by_purpose && cfg.tier_by_purpose.chat) || 'reasoning';
  const model = (cfg.models || {})[tier] || null;
  return {
    ready: gateway.isReady(),
    engine: {
      provider: cfg.provider,
      tier,                               // 预期 'reasoning'
      model,                              // 例如 'claude-opus-4.7'
      purpose: 'chat',
      forced_min_tier: 'reasoning'
    },
    domain: {
      name: 'SG Company Registration Agent',
      version: 'v1',
      rules_count:    sgReg.RULES.length,
      workflow_steps: sgReg.WORKFLOW.length,
      skills_count:   sgReg.SKILLS.length
    },
    rules:    sgReg.RULES,
    workflow: sgReg.WORKFLOW,
    skills:   sgReg.SKILLS,
    boundary: sgReg.BOUNDARY
  };
}

module.exports = { chatWithRAG, isReady, getManifest };
