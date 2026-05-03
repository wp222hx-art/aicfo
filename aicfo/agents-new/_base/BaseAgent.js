// ================================================================================
// BaseAgent —— 所有 AiCFO 主管 Agent 的通用基类
// ================================================================================
// 提供：
//   • plan()       —— 基于系统 Prompt + RAG 结果进行 LLM 规划（输出 tool_calls）
//   • invokeTool() —— 统一的工具调用入口（从 orchestrator 注入的 toolRegistry）
//   • synthesize() —— 合成最终输出（含 Reflexion 置信度自检）
//   • log()        —— 结构化日志（注入 runId 便于追踪）
// ================================================================================
const { RUNTIME } = require('../../config/ai.config');

class BaseAgent {
  constructor(cfg = {}) {
    this.id     = cfg.id;
    this.type   = cfg.type;
    this.role   = cfg.role;
    this.model  = cfg.model;
    this.layer  = cfg.layer;
    this.system_prompt = cfg.system_prompt;
    this.confidence_threshold = cfg.confidence_threshold || RUNTIME.confidence_threshold;

    // 依赖注入（由 orchestrator 或 MasterAgent 传入）
    this.llm          = cfg.llm || null;          // LLM 客户端（chatJSON / complete）
    this.rag          = cfg.rag || null;          // RAG 引擎
    this.toolRegistry = cfg.toolRegistry || {};   // 工具函数映射表
    this.runId        = cfg.runId || null;
  }

  /**
   * 规划阶段：读取 RAG 结果 + 用户请求，LLM 输出 {thought, tool_calls[], next}
   */
  async plan({ query, context, hits }) {
    if (!this.llm || typeof this.llm.complete !== 'function') {
      // 无 LLM 时返回一个最小 plan，便于离线/降级运行
      return { thought: '(no-llm) default plan', tool_calls: [], next: 'synthesize' };
    }
    const ragSnippets = (hits || []).map((h, i) =>
      `[${i + 1}] (${h.layer}) ${h.title}\n${(h.content || '').slice(0, 240)}`
    ).join('\n\n');

    try {
      const out = await this.llm.complete('agent_plan', 'agent_plan', {
        agent_role: this.role,
        system_prompt: this.system_prompt,
        user_query: query,
        rag_context: ragSnippets,
        available_tools: Object.keys(this.toolRegistry),
        business_context: context
      });
      if (out && (out.tool_calls || out.thought)) return out;
    } catch (e) {
      this.log('plan 失败，降级', { error: e.message });
    }
    return { thought: 'fallback plan', tool_calls: [], next: 'synthesize' };
  }

  /**
   * 调用工具 —— 从 toolRegistry 查找，不存在则抛错
   */
  async invokeTool(name, args) {
    const fn = this.toolRegistry[name];
    if (!fn) throw new Error(`Tool not found: ${name}`);
    return await Promise.resolve(fn(args));
  }

  /**
   * 合成阶段：将工具输出整合为 Agent 的最终回复，并做 Reflexion 置信度检测
   */
  async synthesize({ query, plan, actions, hits }) {
    let summary = plan.thought || '任务已执行';
    let confidence = 0.85;

    // 若工具中有主要结果对象（含 confidence），采用其置信度
    const first = actions.find(a => a.status === 'ok' && a.result);
    if (first && first.result.confidence != null) confidence = first.result.confidence;

    // 若任一工具失败，降低置信度
    if (actions.some(a => a.status === 'error')) confidence = Math.min(confidence, 0.5);

    // 若有 LLM，调用它做更好的自然语言合成
    if (this.llm && typeof this.llm.complete === 'function') {
      try {
        const r = await this.llm.complete('agent_synthesize', 'agent_synthesize', {
          agent_role: this.role,
          user_query: query,
          tool_results: actions.slice(0, 5),
          rag_context: (hits || []).slice(0, 3).map(h => h.title)
        });
        if (r && r.summary) summary = r.summary;
        if (r && r.confidence != null) confidence = r.confidence;
      } catch (_) { /* 保持 fallback */ }
    }

    const need_human = confidence < this.confidence_threshold;

    return {
      ok: true,
      summary,
      actions,
      confidence: +confidence.toFixed(3),
      need_human,
      escalation_reason: need_human ? `置信度 ${confidence.toFixed(2)} 低于阈值 ${this.confidence_threshold}` : null,
      trace: {
        plan: { thought: plan.thought, tool_calls: plan.tool_calls },
        rag_hits: (hits || []).length
      }
    };
  }

  log(msg, meta = {}) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${this.type}] ${msg}`, meta);
  }
}

module.exports = BaseAgent;
