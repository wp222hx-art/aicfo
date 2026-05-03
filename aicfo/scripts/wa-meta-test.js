#!/usr/bin/env node
/**
 * WhatsApp Meta Cloud API 联调脚本
 * ---------------------------------------------------------------
 * 在不依赖真实 Meta 后台的情况下，完整模拟：
 *   1. Meta GET /wa/webhook/meta 验证握手
 *   2. Meta POST /wa/webhook/meta 推送真实格式的入站消息
 *   3. 检验 wa_messages / invoices / transactions 是否正确入库
 *   4. 如已配置真 token，调用 /admin/wa/test 查真实 graph.facebook.com
 *
 * 用法:
 *   node scripts/wa-meta-test.js [--base=http://localhost:3000]
 */
const http = require('http');

const BASE = process.argv.find(a=>a.startsWith('--base='))?.split('=')[1] || 'http://localhost:3000';

function req(method, path, body, rawResponse = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (rawResponse) return resolve({ status: res.statusCode, body: data });
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

function log(s) { console.log(s); }

async function main() {
  log('============================================================');
  log('WhatsApp Meta Cloud API 联调');
  log('============================================================\n');

  // ---- [1/6] 读配置 ----
  log('[1/6] 读当前 Meta 配置…');
  const c1 = await req('GET', '/api/admin/wa/config');
  const cfg = c1.body.config || {};
  log(`  configured=${cfg.configured}  enabled=${cfg.enabled}  token_set=${cfg.access_token_set}`);
  log(`  verify_token=${cfg.verify_token}\n`);

  // ---- [2/6] 写入测试配置（如果未配） ----
  log('[2/6] 设置测试配置（保留已有 access_token）…');
  const patch = {
    phone_number_id: cfg.phone_number_id || '000000000000000',
    verify_token:    'aicfo-verify-2026',
    enabled:         true,
    auto_reply:      false, // 避免联调时尝试向不存在的手机号发消息
  };
  const c2 = await req('POST', '/api/admin/wa/config', patch);
  log(`  -> status=${c2.status} ok=${c2.body.ok}\n`);

  // ---- [3/6] Meta webhook 验证握手 ----
  log('[3/6] Meta GET webhook 验证握手…');
  const challenge = 'test_challenge_' + Date.now();
  const v = await req('GET', `/api/wa/webhook/meta?hub.mode=subscribe&hub.verify_token=aicfo-verify-2026&hub.challenge=${challenge}`, null, true);
  const vOk = v.status === 200 && v.body === challenge;
  log(`  status=${v.status}  body=${v.body.slice(0,30)}…  ${vOk ? '✓' : '✗'}`);

  const vFail = await req('GET', `/api/wa/webhook/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`, null, true);
  log(`  (error token) status=${vFail.status}  ${vFail.status === 403 ? '✓ 拒绝正确' : '✗'}\n`);

  // ---- [4/6] 准备一个 channel 用于绑定 ----
  log('[4/6] 准备测试 channel…');
  const reg = await req('POST', '/api/auth/register', {
    email: `wa-meta-test-${Date.now()}@example.com`,
    name:  'WA Meta Tester', phone: '6591234567'
  });
  const uid = reg.body.user_id || reg.body.user?.id;
  log(`  user_id=${uid}`);

  // 给用户创建 WA channel（直接调 wa/channel/create）
  const chResp = await req('POST', '/api/wa/channel/create', { user_id: uid, company_id: null });
  const chToken = chResp.body.channel?.finance_token;
  log(`  channel_token=${chToken}\n`);

  // ---- [5/6] 模拟 Meta 推送消息 ----
  const MY_PHONE = '6591234567'; // 模拟用户手机号
  log('[5/6] 模拟 Meta 推送 3 条入站消息…');

  // 5.1 绑定消息 (LINK:xxx)
  const p1 = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'biz1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000000', phone_number_id: '000000000000000' },
      contacts: [{ profile: { name: 'WA Meta Tester' }, wa_id: MY_PHONE }],
      messages: [{ from: MY_PHONE, id: 'wamid.test1', timestamp: String(Math.floor(Date.now()/1000)),
        type: 'text', text: { body: `LINK:${chToken}` } }]
    }}]}]
  };
  const r1 = await req('POST', '/api/wa/webhook/meta', p1);
  log(`  5.1 绑定消息 → status=${r1.status}  ${r1.status === 200 ? '✓' : '✗'}`);

  await new Promise(r => setTimeout(r, 300));

  // 5.2 发票文字消息
  const p2 = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'biz1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000000', phone_number_id: '000000000000000' },
      contacts: [{ profile: { name: 'WA Meta Tester' }, wa_id: MY_PHONE }],
      messages: [{ from: MY_PHONE, id: 'wamid.test2', timestamp: String(Math.floor(Date.now()/1000)),
        type: 'text', text: { body: 'Starbucks Raffles Place invoice total 12.50 SGD' } }]
    }}]}]
  };
  const r2 = await req('POST', '/api/wa/webhook/meta', p2);
  log(`  5.2 发票文字 → status=${r2.status}  ${r2.status === 200 ? '✓' : '✗'}`);

  await new Promise(r => setTimeout(r, 300));

  // 5.3 图片消息 (带 caption)
  const p3 = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'biz1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '15550000000', phone_number_id: '000000000000000' },
      contacts: [{ profile: { name: 'WA Meta Tester' }, wa_id: MY_PHONE }],
      messages: [{ from: MY_PHONE, id: 'wamid.test3', timestamp: String(Math.floor(Date.now()/1000)),
        type: 'image', image: { id: 'fake-media-id-001', mime_type: 'image/jpeg',
          sha256: 'deadbeef', caption: 'invoice NTUC 45.80 SGD' } }]
    }}]}]
  };
  const r3 = await req('POST', '/api/wa/webhook/meta', p3);
  log(`  5.3 图片发票 → status=${r3.status}  ${r3.status === 200 ? '✓' : '✗'}\n`);

  // ---- [6/6] 验证数据入库 ----
  await new Promise(r => setTimeout(r, 1000)); // 等异步处理
  log('[6/6] 验证数据入库…');
  const arc = await req('GET', `/api/archive/user?user_id=${uid}`);
  const msgs = arc.body.recent_messages || [];
  const invs = arc.body.invoices || [];
  log(`  wa_messages=${msgs.length}  invoices=${invs.length}  channel_bound=${!!arc.body.channel?.wa_phone}`);
  for (const m of msgs.slice(0, 5)) {
    log(`    · [${m.classified_as || 'n/a'}] ${(m.content || '').slice(0, 50)}  conf=${m.ai_confidence}`);
  }

  // ---- 真连通测试 (若已配 token) ----
  log('\n[extra] 真 Meta 连通测试 (/admin/wa/test)…');
  const test = await req('POST', '/api/admin/wa/test', {});
  if (test.body.ok) {
    log(`  ✓ 真连通成功 display=${test.body.display_phone_number} name=${test.body.verified_name}`);
  } else {
    log(`  ℹ 未配置或连通失败: ${test.body.error || 'n/a'}`);
    log(`    (这是预期的 —— 填入真实 phone_number_id + access_token 后即可通过)`);
  }

  // ---- 汇总 ----
  log('\n============================================================');
  const pass = vOk && r1.status === 200 && r2.status === 200 && r3.status === 200 &&
               msgs.length >= 2 && invs.length >= 1 && arc.body.channel?.wa_phone === MY_PHONE;
  log(pass ? '✅ WA Meta 联调 PASSED (4/4 webhook + 2+ msgs 入库 + channel 已绑定)'
           : '⚠️  WA Meta 联调 PARTIAL，请查上方日志');
  log('============================================================');

  // 落盘
  const fs = require('fs');
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/wa-meta-test-result.json', JSON.stringify({
    ts: new Date().toISOString(), pass, uid, chToken,
    verify_handshake: vOk, webhook_results: [r1.status, r2.status, r3.status],
    messages: msgs, invoices: invs, real_connection: test.body,
  }, null, 2));
  log('\nResults → data/wa-meta-test-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
