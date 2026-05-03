// ================================================================================
// AiCFO Agent Orchestrator v2
// ================================================================================
// 读取 config/ai.config.js 的 AGENTS 注册表，加载 agents-new/<type>/service.js，
// 注入 LLM + RAG + 工具依赖，暴露统一的 route() / runAgent() 接口。
// ================================================================================
const path = require('path');
const fs = require('fs');
const { AGENTS } = require('../../config/ai.config');

class Orchestrator {
  constructor({ llm, rag, toolRegistry = {} }) {
    this.llm = llm;
    this.rag = rag;
    this.toolRegistry = toolRegistry;
    this.agents = {};     // type -> 实例
    this._loadAgents();
  }

  _loadAgents() {
    for (const key of Object.keys(AGENTS)) {
      const svcPath = path.join(__dirname, '..', key, 'service.js');
      if (!fs.existsSync(svcPath)) continue;
      try {
        const AgentClass = require(svcPath);
        this.agents[key] = new AgentClass({
          llm: this.llm,
          rag: this.rag,
          toolRegistry: this.toolRegistry
        });
      } catch (e) {
        console.warn(`[Orchestrator] 加载 ${key} 失败:`, e.message);
      }
    }
  }

  /** 路由：根据 intent 选择子 Agent */
  async route({ query, context = {} }) {
    // 1. 先让 master Agent（或 llm intent 分类）决定 intent
    let intent = 'master';
    if (this.llm && typeof this.llm.complete === 'function') {
      try {
        const r = await this.llm.complete(query, 'intent', context);
        if (r && r.intent) intent = r.intent.replace(/_agent$/, '');
      } catch (_) {}
    }
    // map llm 输出到我们的 type（如 registration_agent → registration）
    const type = this.agents[intent] ? intent : 'master';
    return this.runAgent(type, { query, context, intent });
  }

  /** 直接运行指定类型的 Agent */
  async runAgent(type, { query, context = {}, intent = type }) {
    const agent = this.agents[type] || this.agents.master;
    if (!agent) throw new Error(`Agent ${type} 未注册`);
    const out = await agent.run({ query, context });
    return { intent, type: agent.type, ...out };
  }

  listAgents() {
    return Object.entries(this.agents).map(([k, a]) => ({
      key: k, id: a.id, type: a.type, role: a.role, model: a.model, layer: a.layer
    }));
  }
}

module.exports = Orchestrator;
