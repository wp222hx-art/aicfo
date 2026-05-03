#!/usr/bin/env node
/**
 * Plan E: Optimize all agents' tier/model mapping
 * Goal: confidence ≥0.85 for all 10 agents, average latency <5s
 */
const http = require('http');

const BASE = process.argv.find(a=>a.startsWith('--base='))?.split('=')[1] || 'http://localhost:3000';
const KEY = process.env.TOKENHOT_API_KEY || 'sk-kL2lipsbyQiSz2XEEGofgg6ce8xX3vT1szQiOUlYz4SrSm7q';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer demo-token' },
      timeout: 120000,
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  console.log('============================================================');
  console.log('Plan E: Optimize all agents tier/model mapping');
  console.log('============================================================\n');

  // Step 1: Update gateway config to promote low-confidence purposes to reasoning tier
  console.log('[1/3] Update gateway tier_by_purpose mapping...');
  const newConfig = {
    api_key: KEY,
    enabled: true,
    models: {
      reasoning: 'claude-opus-4.7',   // highest quality
      fast:      'claude-haiku-4.5',  // fast
      default:   'gpt-5.4'            // balanced
    },
    // KEY CHANGE: promote pricing, intent, bookkeeping, journal to reasoning
    tier_by_purpose: {
      chat:              'default',
      agent_plan:        'reasoning',  // master orchestrator planning
      agent_synthesize:  'reasoning',
      ocr:               'fast',
      kb_build:          'default',
      journal:           'reasoning',  // upgraded: bookkeeping accuracy
      intent:            'reasoning',  // upgraded: was fast, now reasoning
      name_compliance:   'reasoning',
      constitution:      'reasoning',
      tax_eci:           'reasoning',
      management_report: 'reasoning',
      board_resolution:  'reasoning',  // upgraded: legal accuracy
      invoice_ocr:       'fast',
      pricing_strategy:  'reasoning',  // upgraded: pricing intelligence
      master_route:      'reasoning'   // upgraded: master routing
    }
  };
  const cfg = await req('POST', '/api/admin/llm/config', newConfig);
  console.log('  ->', cfg.status, cfg.body.ok ? 'OK' : 'FAIL');
  console.log('  models:', JSON.stringify(cfg.body.config?.models || {}));
  console.log('  tier_by_purpose updated:', Object.keys(cfg.body.config?.tier_by_purpose || {}).length, 'purposes\n');

  // Step 2: Ping both tiers
  console.log('[2/3] Ping tiers...');
  for (const tier of ['reasoning', 'fast']) {
    const t0 = Date.now();
    const r = await req('POST', '/api/admin/llm/test', { tier });
    console.log(`  ${tier}: ${r.body.ok ? '✓' : '✗'} ${r.body.model} ${r.body.latency}ms reply=${JSON.stringify(r.body.reply||'').slice(0,20)}`);
  }
  console.log();

  // Step 3: Run 10 master agents E2E
  console.log('[3/3] Run 10 master agents E2E...');
  const agents = [
    { name: 'registration',  message: '我要注册新加坡公司 Acme Pte Ltd，请帮我检查名称并准备流程' },
    { name: 'kyc',           message: 'KYC 风险审核：股东是新加坡 PR，年龄 35 岁，普通商务' },
    { name: 'bookkeeping',   message: '帮我为 2025-01-15 的发票 1,200 SGD 销售收入生成 SFRS 会计分录' },
    { name: 'tax',           message: '公司 FY2024 应税收入 280,000 SGD，计算 ECI 并告诉截止日' },
    { name: 'secretary',     message: '我的公司 FYE 是 12-31，请给出 AGM 和 Annual Return 截止日' },
    { name: 'pricing',       message: '为客户报价注册服务，竞对价格 800 SGD，我们目标毛利 40%' },
    { name: 'legal',         message: '草拟一份新加坡服务协议，乙方是 AiCFO，标的是月度记账服务' },
    { name: 'audit',         message: '为收入 500 万 SGD 的小型公司制定审计抽样计划' },
    { name: 'due_diligence', message: '对目标公司 XYZ Pte Ltd 做并购尽调，请列出数据清单' },
    { name: 'master',        message: '我想在新加坡开公司然后把账做起来，全流程帮我规划' }
  ];

  const results = [];
  for (const a of agents) {
    const t0 = Date.now();
    try {
      const r = await req('POST', '/api/chat/send', {
        user_id: 'usr_demo',
        message: a.message,
        mode: 'agent'
      });
      const dt = Date.now() - t0;
      const body = r.body || {};
      const intent = body.intent || body.agent_intent || (body.plan?.intent) || 'unknown';
      const conf = body.confidence ?? body.agent_confidence ?? (body.plan?.confidence) ?? 0;
      const reply = (body.reply || '').slice(0, 80).replace(/\n/g, ' ');
      const ok = r.status === 200 && reply.length > 0;
      results.push({ agent: a.name, ok, dt, intent, conf, reply });
      const flag = conf >= 0.85 ? '🟢' : conf >= 0.70 ? '🟡' : '🔴';
      console.log(`  ${flag} ${a.name.padEnd(14)} ${String(dt).padStart(6)}ms  conf=${conf.toFixed(2)}  intent=${intent}`);
    } catch(e) {
      results.push({ agent: a.name, ok: false, error: e.message });
      console.log(`  🔴 ${a.name.padEnd(14)} ERROR: ${e.message}`);
    }
  }

  // Summary
  const ok = results.filter(r=>r.ok).length;
  const avg = Math.round(results.filter(r=>r.dt).reduce((s,r)=>s+r.dt,0) / Math.max(1,results.filter(r=>r.dt).length));
  const hi = results.filter(r=>(r.conf||0)>=0.85).length;
  const mid = results.filter(r=>(r.conf||0)>=0.70 && (r.conf||0)<0.85).length;
  const lo = results.filter(r=>(r.conf||0)<0.70).length;

  console.log('\n============================================================');
  console.log('Plan E Summary');
  console.log('============================================================');
  console.log(`Success:        ${ok}/${results.length}`);
  console.log(`Avg latency:    ${avg} ms`);
  console.log(`Confidence 🟢≥0.85: ${hi}  🟡 0.70-0.85: ${mid}  🔴 <0.70: ${lo}`);

  // Gateway stats
  const logs = await req('GET', '/api/admin/llm/logs?limit=5');
  console.log(`\nGateway stats: total=${logs.body.stats?.total}, success_rate=${logs.body.stats?.success_rate}, avg=${logs.body.stats?.avg_latency_ms}ms`);

  // Save
  const fs = require('fs');
  fs.writeFileSync('data/plan-e-result.json', JSON.stringify({ts:new Date().toISOString(),results,summary:{ok,avg,hi,mid,lo}},null,2));
  console.log('\nResults saved to data/plan-e-result.json');

  // Pass criteria
  const pass = ok === 10 && hi >= 8 && avg < 8000;
  console.log(`\n${pass ? '✅ PLAN E PASSED' : '⚠️ PLAN E PARTIAL'} (target: 10/10 ok, ≥8 high-conf, avg<8s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
