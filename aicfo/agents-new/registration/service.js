// ================================================================================
// 注册主管 Agent / Incorporation Supervisor
// 由 scripts/generate-agents.js 自动生成 —— type: registration, model: gpt-5-mini
// 继承 BaseAgent，实现 run() 方法；工具通过 orchestrator 注入
// ================================================================================
const BaseAgent = require('../_base/BaseAgent');
const cfg = require('../../config/ai.config').AGENTS.registration;

class RegistrationAgent extends BaseAgent {
  constructor(deps = {}) {
    super({ ...cfg, ...deps });
    this.tools = cfg.tools || [];
  }

  /**
   * @param {object} input
   * @param {string} input.query     — 用户/上游 Agent 请求
   * @param {object} input.context   — 运行上下文（company_id, user_id, session_id, ...）
   * @returns {Promise<{ok,summary,actions,confidence,citations,trace}>}
   */
  async run({ query, context = {} }) {
    const t0 = Date.now();
    this.log('开始执行', { query: String(query).slice(0, 60), context_keys: Object.keys(context) });

    // 1. RAG 检索（L1 监管 + L2 实操 + 本 Agent 相关层）
    const layers = ["L1","L2"];
    const hits = this.rag ? await this.rag.search({ query, layers, topK: 3 }) : [];

    // 2. LLM 规划：根据检索结果 + Agent 系统 Prompt
    const plan = await this.plan({ query, context, hits });

    // 3. 工具执行：按 plan.tool_calls 依次调用（幂等、带审计轨迹）
    const actions = [];
    for (const tc of plan.tool_calls || []) {
      try {
        const result = await this.invokeTool(tc.tool, tc.args || {});
        actions.push({ tool: tc.tool, args: tc.args, result, status: 'ok' });
      } catch (e) {
        actions.push({ tool: tc.tool, args: tc.args, error: e.message, status: 'error' });
      }
    }

    // 4. 合成输出（含 Reflexion 自检）
    const output = await this.synthesize({ query, plan, actions, hits });
    output.latency_ms = Date.now() - t0;
    output.agent = { id: cfg.id, type: cfg.type, role: cfg.role };
    output.citations = hits.map(h => ({ id: h.id, title: h.title, layer: h.layer, score: h.score }));

    this.log('完成', { latency_ms: output.latency_ms, confidence: output.confidence, tools: actions.length });
    return output;
  }
}

module.exports = RegistrationAgent;
