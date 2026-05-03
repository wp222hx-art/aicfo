#!/usr/bin/env node
// ================================================================================
// 真 Tokenhot.ai Key 活线测试脚本
// ================================================================================
// Plan C: 配真 Key → reasoning/fast tier 活线 ping → 10 个 master agent 端到端活线测试
//
// 覆盖：
//   Phase 0: 将 Tokenhot Key 注入 system_settings
//   Phase 1: reasoning tier 活线 ping
//   Phase 2: fast tier 活线 ping
//   Phase 3: 10 个 master agent (registration/kyc/bookkeeping/tax/secretary/pricing/
//                                 legal/audit/due_diligence/master) 活线调用
//   Phase 4: 汇总：成功率 / 平均延迟 / 每个 agent 输出 JSON 摘要
//
// 用法:
//   TOKENHOT_API_KEY=sk-xxx node scripts/live-tokenhot-test.js --base=http://localhost:3001
// ================================================================================
const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=')[1]
          || process.env.AICFO_BASE || 'http://localhost:3001';

const color = {
  g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
  y: s => `\x1b[33m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`,
  b: s => `\x1b[1m${s}\x1b[0m`,  m: s => `\x1b[35m${s}\x1b[0m`
};

async function call(method, p, body) {
  const url = BASE + '/api' + p;
  const opts = { method, headers: { 'Accept': 'application/json' } };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const t0 = Date.now();
  const resp = await fetch(url, opts);
  const latency = Date.now() - t0;
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: resp.ok, status: resp.status, data, latency };
}

function head(title) { console.log('\n' + color.b(color.c('━━━ ' + title + ' ━━━'))); }

(async () => {
  console.log(color.b(color.m('\n██████ AiCFO Tokenhot 活线测试 (Plan C) ██████')));
  console.log(`Base: ${BASE}`);

  const results = { ping: {}, agents: [], summary: {} };

  // ================================================================================
  head('Phase 0: 注入 Tokenhot Key');
  // ================================================================================
  const key = process.env.TOKENHOT_API_KEY;
  if (!key) { console.log(color.r('  ✗ 缺少 TOKENHOT_API_KEY 环境变量')); process.exit(1); }

  const cfg = await call('POST', '/admin/llm/config', {
    provider: 'tokenhot',
    base_url: 'https://api.tokenhot.ai/v1',
    api_key: key,
    enabled: true
  });
  if (!cfg.ok) { console.log(color.r('  ✗ 配置注入失败: ') + JSON.stringify(cfg.data)); process.exit(1); }
  const maskedKey = cfg.data.config.api_key_preview;
  console.log(color.g(`  ✓ Key 注入成功: ${maskedKey}`));
  console.log(`    provider = ${color.y(cfg.data.config.provider)}`);
  console.log(`    base_url = ${color.y(cfg.data.config.base_url)}`);
  console.log(`    model.reasoning = ${color.y(cfg.data.config.models.reasoning)}`);
  console.log(`    model.fast      = ${color.y(cfg.data.config.models.fast)}`);
  console.log(`    model.default   = ${color.y(cfg.data.config.models.default)}`);

  // ================================================================================
  head('Phase 1: reasoning tier 活线 ping');
  // ================================================================================
  const pingR = await call('POST', '/admin/llm/test', { tier: 'reasoning' });
  results.ping.reasoning = pingR.data;
  if (pingR.data.ok) {
    console.log(color.g(`  ✓ reasoning ping 成功`));
    console.log(`    model:   ${color.y(pingR.data.model)}`);
    console.log(`    latency: ${color.y(pingR.data.latency_ms + 'ms')}`);
    console.log(`    reply:   ${color.c(JSON.stringify(pingR.data.reply))}`);
  } else {
    console.log(color.r(`  ✗ reasoning ping 失败: ${pingR.data.error}`));
  }

  // ================================================================================
  head('Phase 2: fast tier 活线 ping');
  // ================================================================================
  const pingF = await call('POST', '/admin/llm/test', { tier: 'fast' });
  results.ping.fast = pingF.data;
  if (pingF.data.ok) {
    console.log(color.g(`  ✓ fast ping 成功`));
    console.log(`    model:   ${color.y(pingF.data.model)}`);
    console.log(`    latency: ${color.y(pingF.data.latency_ms + 'ms')}`);
    console.log(`    reply:   ${color.c(JSON.stringify(pingF.data.reply))}`);
  } else {
    console.log(color.r(`  ✗ fast ping 失败: ${pingF.data.error}`));
  }

  // ================================================================================
  head('Phase 3: 10 个 master agent 端到端活线测试');
  // ================================================================================
  // 每个 agent 用 chat/send (mode=agent) 触发真实 LLM + RAG + 工具链
  const agentQueries = [
    { agent: 'registration',  tier: 'reasoning', q: '帮我检查 "AiCFO Tech Pte Ltd" 是否可用作新加坡公司名，并推荐 SSIC 代码' },
    { agent: 'kyc',           tier: 'reasoning', q: '对新客户 Alice Tan（NRIC S1234567A）做 MAS Notice 626 KYC/AML 风险评级' },
    { agent: 'bookkeeping',   tier: 'default',   q: '本月有一张 Starbucks 发票 12.50 SGD，请按 SFRS 生成借贷分录，GST 税率 9%' },
    { agent: 'tax',           tier: 'reasoning', q: '某新加坡公司 YA 2025 应税收入 150,000 SGD，首次申报，算 ECI 并说明 SUTE 豁免' },
    { agent: 'secretary',     tier: 'default',   q: 'FYE 是 12-31，下一次 AGM 和 Annual Return 的截止日分别是什么时候？' },
    { agent: 'pricing',       tier: 'default',   q: '为一家跨境电商 SaaS 公司报价（员工 15 人，月交易 500 笔），出 basic/pro/enterprise 三档' },
    { agent: 'legal',         tier: 'reasoning', q: '起草一份新加坡雇佣合同关键条款清单（Employment Act 2019 + PDPA 合规）' },
    { agent: 'audit',         tier: 'reasoning', q: '对一家 revenue 200 万 SGD 的小公司做重要性测试，列出抽样计划' },
    { agent: 'due_diligence', tier: 'reasoning', q: '对目标公司 Target Pte Ltd 做 M&A 尽调，列出股权结构、制裁筛查、诉讼四大模块' },
    { agent: 'master',        tier: 'reasoning', q: '我是初创公司，想在新加坡注册+每月记账+年底报税，帮我规划完整路径并路由给对应 Agent' }
  ];

  for (const { agent, tier, q } of agentQueries) {
    process.stdout.write(`  ${color.c('◌')} ${agent.padEnd(14)} [${tier.padEnd(9)}] ... `);
    const t0 = Date.now();
    const r = await call('POST', '/chat/send', {
      user_id: 'usr_live_test',
      message: q,
      mode: 'agent'
    });
    const elapsed = Date.now() - t0;

    const entry = {
      agent, tier, query: q.slice(0, 60),
      ok: r.ok,
      status: r.status,
      latency_ms: elapsed,
      model: r.data.model,
      intent: r.data.intent,
      confidence: r.data.confidence,
      need_human: r.data.need_human,
      routed_agent: r.data.agent,
      reply_preview: (r.data.reply || '').slice(0, 140).replace(/\n/g, ' '),
      citations: (r.data.citations || []).length,
      error: r.ok ? null : (r.data.error || r.data.raw || 'unknown')
    };
    results.agents.push(entry);

    if (r.ok) {
      console.log(color.g(`✓ ${elapsed}ms`) + `  intent=${color.y(entry.intent || '-')} conf=${color.y(entry.confidence ?? '-')} cites=${entry.citations}`);
      if (entry.reply_preview) console.log(`      ${color.c('↳')} ${entry.reply_preview}${entry.reply_preview.length >= 140 ? '…' : ''}`);
    } else {
      console.log(color.r(`✗ ${r.status}`) + `  ${entry.error?.slice(0,100)}`);
    }
  }

  // ================================================================================
  head('Phase 4: 汇总统计');
  // ================================================================================
  const logs = await call('GET', '/admin/llm/logs?limit=50');
  const stats = logs.data.stats || {};
  const okCount = results.agents.filter(a => a.ok).length;
  const avgLat = results.agents.filter(a => a.ok).reduce((s,a) => s+a.latency_ms, 0) / (okCount||1);
  const highConf = results.agents.filter(a => a.ok && Number(a.confidence) >= 0.7).length;
  const needHuman = results.agents.filter(a => a.need_human).length;

  results.summary = {
    ping_reasoning_ok: results.ping.reasoning?.ok,
    ping_reasoning_latency: results.ping.reasoning?.latency_ms,
    ping_fast_ok: results.ping.fast?.ok,
    ping_fast_latency: results.ping.fast?.latency_ms,
    agents_total: results.agents.length,
    agents_ok: okCount,
    agents_failed: results.agents.length - okCount,
    avg_agent_latency_ms: Math.round(avgLat),
    high_confidence_count: highConf,
    need_human_count: needHuman,
    llm_gateway_total_calls: stats.total_calls,
    llm_gateway_success_rate: stats.success_rate,
    llm_gateway_avg_latency: stats.avg_latency_ms
  };

  console.log('');
  console.log(`  ${color.c('Ping:')}`);
  console.log(`    reasoning: ${results.ping.reasoning?.ok ? color.g('✓') : color.r('✗')} ${results.ping.reasoning?.latency_ms || '-'}ms  (${results.ping.reasoning?.model || '-'})`);
  console.log(`    fast:      ${results.ping.fast?.ok      ? color.g('✓') : color.r('✗')} ${results.ping.fast?.latency_ms      || '-'}ms  (${results.ping.fast?.model      || '-'})`);
  console.log(`  ${color.c('Agents:')}`);
  console.log(`    成功:         ${color.g(okCount)} / ${results.agents.length}`);
  console.log(`    平均延迟:     ${color.y(Math.round(avgLat) + 'ms')}`);
  console.log(`    高置信 ≥0.7:  ${color.g(highConf)}`);
  console.log(`    需人审:       ${color.y(needHuman)}`);
  console.log(`  ${color.c('Gateway 累计:')}`);
  console.log(`    total=${stats.total_calls}  succ=${stats.success_rate}%  avg=${stats.avg_latency_ms}ms`);

  // ================================================================================
  console.log('\n' + color.b(
    (okCount === results.agents.length && results.ping.reasoning?.ok && results.ping.fast?.ok)
      ? color.g('████ ALL LIVE TESTS PASSED ████')
      : color.y('████ LIVE TESTS DONE (有失败项) ████')
  ));

  // JSON 输出便于 CI 消费
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '../data/live-tokenhot-result.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(color.c(`\n📄 详细结果: ${outPath}`));
})().catch(e => {
  console.error('\n' + color.r('❌ FATAL: ') + e.message);
  console.error(e.stack);
  process.exit(1);
});
