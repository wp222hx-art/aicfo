// ================================================================================
// AiCFO Agent 统一注册表 / 调度入口
// ================================================================================
// 作用：
//   • 动态加载 agents-new/<type>/service.js 下的 10 个 Agent
//   • 注入 LLM（llm-real → 自动回落到 sim LLM）
//   • 注入 RAG 引擎
//   • 注入工具注册表（复用 agents/orchestrator.js 的 TOOLS）
//   • 暴露 route() / run() 便于后端 API 与模拟脚本直接调用
// ================================================================================
const path = require('path');
const fs   = require('fs');

const { AGENTS } = require('../config/ai.config');
const rag        = require('../rag/engine');
const llm        = require('../backend/services/llm-real');

// 复用老 orchestrator 已实现的工具函数集合（acra_name_search / journal_generate / eci_compute ...）
let legacyTools = {};
try {
  const legacy = require('../agents/orchestrator');
  if (legacy && legacy.TOOLS) legacyTools = legacy.TOOLS;
  else if (legacy && legacy._TOOLS) legacyTools = legacy._TOOLS;
} catch (e) { /* 优雅降级 */ }

// 兜底工具：即便 legacy 未导出，也保证 Agent 能跑
const fallbackTools = {
  rag_search: async ({ query, layers, k = 3, company_id = null }) =>
    rag.search({ query, layers: layers || ['L1_regulatory','L2_practice'], k, company_id }),
  reflexion_check: async ({ confidence, threshold = 0.7 }) => ({
    ok: Number(confidence) >= threshold,
    need_human: Number(confidence) < threshold,
    threshold
  }),
  route_to_agent: async ({ type }) => ({ routed: type })
};

const TOOLS = { ...fallbackTools, ...legacyTools };

// --------------------------------------------------------------------------------
// 加载 10 个 Agent 服务
// --------------------------------------------------------------------------------
const AGENT_DIR = path.join(__dirname);
const registry = {};

function loadAgents() {
  for (const key of Object.keys(AGENTS)) {
    const file = path.join(AGENT_DIR, key, 'service.js');
    if (!fs.existsSync(file)) {
      console.warn(`[registry] 跳过缺失的 Agent: ${key} (${file})`);
      continue;
    }
    try {
      const AgentClass = require(file);
      const inst = new AgentClass({ llm, rag, toolRegistry: TOOLS });
      registry[key] = inst;
    } catch (e) {
      console.warn(`[registry] 加载 Agent ${key} 失败: ${e.message}`);
    }
  }
  return registry;
}

loadAgents();

// --------------------------------------------------------------------------------
// 简易路由：根据 intent / type 调度到对应 Agent
// --------------------------------------------------------------------------------
async function route({ type, query, context = {} }) {
  const target = registry[type] || registry.master;
  if (!target) throw new Error('无可用 Agent，请检查 agents-new/ 目录');
  return await target.run({ query, context });
}

async function run(type, query, context = {}) {
  return route({ type, query, context });
}

function list() {
  return Object.entries(registry).map(([k, a]) => ({
    key: k, id: a.id, type: a.type, role: a.role, model: a.model, layer: a.layer,
    tools: (a.tools || []).slice(0, 6)
  }));
}

module.exports = { registry, route, run, list, TOOLS, AGENTS };
