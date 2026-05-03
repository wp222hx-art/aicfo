#!/usr/bin/env node
// ================================================================================
// AiCFO Agent 代码生成器
// 读取 config/ai.config.js 中的 AGENTS 注册表，为每个 Agent 生成：
//   1) agents-new/<type>/agent.yaml  —— Claude Flow 风格的 Agent 元配置
//   2) agents-new/<type>/service.js  —— 可被后端 orchestrator 调用的服务类
//
// 所有 Agent 都继承统一接口：run({ query, context, rag, llm }) -> Result
// ================================================================================
const fs = require('fs');
const path = require('path');
const { AGENTS, MODELS } = require('../config/ai.config');

const ROOT = path.join(__dirname, '..', 'agents-new');

function yamlEscape(s) { return String(s).replace(/"/g, '\\"'); }

function genYaml(key, a) {
  const refs = (a.regulatory_refs || []).map(r => `  - "${yamlEscape(r)}"`).join('\n') || '  []';
  const tools = (a.tools || []).map(t => `  - ${t}`).join('\n') || '  []';
  return `# AiCFO ${a.role}
# 由 scripts/generate-agents.js 自动生成，基于 Claude Flow YAML Agent 规范
id: ${a.id}
type: ${a.type}
version: "1.0.0"
role: "${yamlEscape(a.role)}"
layer: ${a.layer}
model: ${a.model}
status: active
capabilities:
${tools}
regulatory_refs:
${refs}
optimizations:
  - rag-augmented
  - reflexion-loop
  - json-mode
  - llm-cache
confidence_threshold: 0.70
createdAt: "${new Date().toISOString()}"
system_prompt: |
${a.system_prompt.split('\n').map(l => '  ' + l).join('\n')}
`;
}

function genService(key, a) {
  const className = (key.charAt(0).toUpperCase() + key.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())) + 'Agent';
  return `// ================================================================================
// ${a.role}
// 由 scripts/generate-agents.js 自动生成 —— type: ${a.type}, model: ${a.model}
// 继承 BaseAgent，实现 run() 方法；工具通过 orchestrator 注入
// ================================================================================
const BaseAgent = require('../_base/BaseAgent');
const cfg = require('../../config/ai.config').AGENTS.${key};

class ${className} extends BaseAgent {
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
    const layers = ${JSON.stringify(layersFor(a))};
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

module.exports = ${className};
`;
}

function layersFor(a) {
  // 基础：所有 Agent 都检索 L1（监管）；合规类 + L2（实操）
  const base = ['L1'];
  if (['compliance', 'finance'].includes(a.layer)) base.push('L2');
  if (a.layer === 'commercial') base.push('L3');
  if (a.layer === 'business') base.push('L2');
  return base;
}

// --------------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------------
let count = 0;
for (const [key, a] of Object.entries(AGENTS)) {
  const dir = path.join(ROOT, key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent.yaml'), genYaml(key, a));
  fs.writeFileSync(path.join(dir, 'service.js'), genService(key, a));
  count++;
  console.log(`[生成] ${key.padEnd(16)} → ${a.role}`);
}

console.log(`\n✓ 已生成 ${count} 个 Agent 配置（YAML + Service）到 agents-new/`);
