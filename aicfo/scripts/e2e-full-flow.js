#!/usr/bin/env node
// ================================================================================
// AiCFO 端到端完整闭环联调脚本
// ================================================================================
// 跑完整个「注册 → 选套餐 → 支付 → 扫码 → 通过 WA webhook 上传 Invoice」流程，
// 并验证每一步的数据库落库和跨模块数据一致性。
//
// 用法:
//   node scripts/e2e-full-flow.js
//   node scripts/e2e-full-flow.js --base http://localhost:3000
//   AICFO_LLM_OFFLINE=1 node scripts/e2e-full-flow.js    # 无 Tokenhot Key 也能跑
// ================================================================================
const fs = require('fs');
const path = require('path');

const BASE = (process.argv.find(a => a.startsWith('--base=')) || '').split('=')[1]
          || process.env.AICFO_BASE || 'http://localhost:3000';

const color = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
                y: s => `\x1b[33m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m`,
                b: s => `\x1b[1m${s}\x1b[0m` };

async function call(method, p, body, form) {
  const url = BASE + '/api' + p;
  const opts = { method, headers: { 'Accept': 'application/json' } };
  if (form) {
    opts.body = form;                       // FormData 自带 boundary
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const t0 = Date.now();
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  const latency = Date.now() - t0;
  const tag = resp.ok ? color.g(`✓ ${resp.status}`) : color.r(`✗ ${resp.status}`);
  console.log(`  ${tag} ${method.padEnd(4)} ${p}  ${color.y(latency+'ms')}`);
  if (!resp.ok) {
    console.log(color.r('    ERR: ') + JSON.stringify(data).slice(0, 300));
    throw new Error(`${method} ${p} failed: ${resp.status}`);
  }
  return data;
}

function step(n, title) { console.log('\n' + color.b(color.c(`━━━ STEP ${n}: ${title} ━━━`))); }
function assert(cond, msg) {
  if (!cond) { console.log(color.r('  ✗ ASSERT FAIL: ') + msg); throw new Error(msg); }
  console.log(color.g('  ✓ ') + msg);
}

(async () => {
  console.log(color.b(color.c('\n████████ AiCFO 端到端联调 ████████')));
  console.log(`Base: ${BASE}`);

  // ================================================================================
  step(0, 'Health & Gateway Config');
  // ================================================================================
  const h = await call('GET', '/health');
  assert(h.status === 'ok', 'health status=ok');

  const gw = await call('GET', '/admin/llm/config');
  console.log(`    gateway provider = ${color.y(gw.config.provider)}`);
  console.log(`    api_key_set = ${gw.config.api_key_set ? color.g('✓') : color.r('✗ (offline 模式)')}`);
  console.log(`    models.reasoning = ${color.y(gw.config.models.reasoning)}`);
  console.log(`    models.fast      = ${color.y(gw.config.models.fast)}`);

  const reg = await call('GET', '/admin/registry/config');
  console.log(`    sg-registry mode = ${color.y(reg.config.mode)}`);

  // ================================================================================
  step(1, '多用户注册 (user A + user B)');
  // ================================================================================
  const ts = Date.now();
  const ua = await call('POST', '/auth/register', {
    email: `alice_${ts}@example.com`,
    name: 'Alice Tan',
    phone: '+6591111111',
    country: 'SG',
    segment: 'local_sg',
    company_name: `Alice Digital ${ts}`
  });
  assert(ua.ok && ua.user?.id, `user A 创建: ${ua.user.id}`);
  assert(ua.company_id, `company A 创建: ${ua.company_id}`);

  const ub = await call('POST', '/auth/register', {
    email: `bob_${ts}@example.com`,
    name: 'Bob Lim',
    phone: '+6592222222',
    country: 'SG',
    segment: 'china_outbound',
    company_name: `Bob Crossborder ${ts}`
  });
  assert(ub.ok, `user B 创建: ${ub.user.id}`);

  // 重复注册应 409
  const dup = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `alice_${ts}@example.com`, name: 'x' })
  });
  assert(dup.status === 409, '重复邮箱返回 409');

  // ================================================================================
  step(2, 'ACRA 公司名可用性 + SSIC 查询 + UEN 核验');
  // ================================================================================
  const nc = await call('POST', '/registration/name-check', {
    proposed_name: `Alice AI Ventures ${ts}`, suffix: 'Pte Ltd'
  });
  assert(nc.available !== undefined, `名称检查返回 available=${nc.available}`);
  assert(nc.registry, `registry 字段已注入 (source=${nc.registry.source})`);
  console.log(`    LLM verdict = ${color.y(nc.verdict)} · ACRA = ${color.y(nc.registry.source)}`);

  const ncBad = await call('POST', '/registration/name-check', {
    proposed_name: 'Singapore Government Bank', suffix: 'Pte Ltd'
  });
  assert(ncBad.available === false, '黑名单词（Government/Bank）被拒');

  const ssic = await call('POST', '/registry/ssic/lookup', { keyword: 'computer' });
  assert(Array.isArray(ssic.matches) && ssic.matches.length > 0, `SSIC 查到 ${ssic.matches.length} 条`);

  const uen = await call('POST', '/registry/uen/verify', { uen: '202012345K' });
  assert(uen.valid === true, `UEN 202012345K 核验通过 (${uen.entity?.name})`);

  // ================================================================================
  step(3, '公司注册下单 → 章程 → 推进流程 → 提交 ACRA');
  // ================================================================================
  const order = await call('POST', '/registration/orders', {
    user_id: ua.user.id,
    company_name: `Alice AI Ventures ${ts} Pte Ltd`,
    financial_year_end: '12-31',
    ssic_codes: ['62010', '62020'],
    paid_up_capital: { amount: 10000, currency: 'SGD' },
    segment: 'local_sg',
    shareholders: [
      { name: 'Alice Tan', type: 'individual', nric_fin: 'S1234567A',
        nationality: 'SGP', is_director: true, shares: 10000 }
    ],
    price: 388
  });
  assert(order.order_id, `下单成功 order=${order.order_id}, company=${order.company_id}`);

  const adv1 = await call('POST', `/registration/orders/${order.order_id}/advance`, { next_stage: 'kyc' });
  assert(adv1.stage === 'kyc', 'advance → kyc');

  const cons = await call('POST', `/registration/orders/${order.order_id}/constitution`, {});
  assert(cons.document_id, `章程已生成 doc=${cons.document_id}`);

  const acra = await call('POST', `/registration/orders/${order.order_id}/submit-to-acra`, {});
  assert(acra.ok && acra.submission?.uen, `ACRA 提交通过 UEN=${acra.submission.uen}`);

  // ================================================================================
  step(4, '套餐 + Mock 支付 + 自动生成 WA 财务二维码');
  // ================================================================================
  const plans = await call('GET', '/plans');
  assert(plans.plans.length >= 3, `${plans.plans.length} 个套餐就绪`);

  const sub = await call('POST', '/subscriptions', {
    user_id: ua.user.id, company_id: ua.company_id, plan_code: 'growth'
  });
  assert(sub.ok, `订阅 pending_payment id=${sub.subscription_id}`);

  const pay = await call('POST', '/payments/pay', {
    user_id: ua.user.id, subscription_id: sub.subscription_id,
    method: 'mock_card', card_last4: '4242'
  });
  assert(pay.ok && pay.payment.payment_id, `支付成功 pay=${pay.payment.payment_id}`);
  assert(pay.payment.subscription.status === 'active', '订阅已激活');
  assert(pay.finance_channel?.finance_token, `专属二维码 token=${pay.finance_channel.finance_token}`);
  assert(pay.finance_channel.qr_data_url?.startsWith('data:image/png'), 'QR code base64 已生成');

  const channel = pay.finance_channel;
  console.log(`    QR payload: ${color.y(channel.qr_payload)}`);
  console.log(`    Bot phone:  ${color.y(channel.bot_phone)}`);

  // 保存二维码到文件供人工扫码验证
  const qrPath = path.join(__dirname, `../data/qr_${ua.user.id}.png`);
  fs.writeFileSync(qrPath, Buffer.from(channel.qr_data_url.split(',')[1], 'base64'));
  console.log(`    💾 QR 已保存: ${qrPath}  (可直接扫码测试)`);

  // ================================================================================
  step(5, 'WhatsApp Webhook 模拟扫码绑定');
  // ================================================================================
  const link = await call('POST', '/wa/webhook/link', {
    token: channel.finance_token, wa_phone: '+6593333333'
  });
  assert(link.ok && link.channel_id === channel.id, `扫码绑定 channel=${link.channel_id}`);
  assert(link.user_id === ua.user.id, '反向匹配到 user_id');

  // ================================================================================
  step(6, '模拟 WhatsApp 上传 Invoice (文本 + 图片/PDF)');
  // ================================================================================
  // 6a. 纯文本发票
  const txtMsg = await call('POST', '/wa/webhook/message', {
    token: channel.finance_token, wa_phone: '+6593333333',
    text: 'Invoice from Starbucks Raffles Place, total 12.50 SGD, GST included',
    msg_type: 'text'
  });
  assert(txtMsg.ok && txtMsg.classified_as === 'invoice', `纯文本分类=invoice conf=${txtMsg.confidence}`);
  assert(txtMsg.linked_entity_id?.startsWith('inv_'), `已落 invoices 表: ${txtMsg.linked_entity_id}`);

  // 6b. 图片发票（模拟 PNG）
  const pngBuf = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d494441547801636000000000500001' +
    'f60f01000000004945e426420826082',
    'hex'
  );
  const form1 = new FormData();
  form1.append('token', channel.finance_token);
  form1.append('text', 'Invoice attached');
  form1.append('wa_phone', '+6593333333');
  form1.append('media', new Blob([pngBuf], { type: 'image/png' }), 'invoice_001.png');
  const imgMsg = await call('POST', '/wa/webhook/message', null, form1);
  assert(imgMsg.ok && imgMsg.classified_as === 'invoice', `图片分类=invoice`);

  // 6c. CSV 银行流水
  const csv = 'date,amount,description\n2026-04-15,-120.00,"Cloud hosting Jan"\n2026-04-18,3500.00,"Client payment ACME"\n';
  const form2 = new FormData();
  form2.append('token', channel.finance_token);
  form2.append('text', 'April transactions');
  form2.append('media', new Blob([csv], { type: 'text/csv' }), 'bank_apr.csv');
  const csvMsg = await call('POST', '/wa/webhook/message', null, form2);
  assert(csvMsg.ok && csvMsg.classified_as === 'bank_txn', `CSV 分类=bank_txn`);

  // ================================================================================
  step(7, '验证机器人准确接收 (消息/发票/流水/档案四表)');
  // ================================================================================
  const msgs = await call('GET', `/wa/messages?user_id=${ua.user.id}&limit=10`);
  assert(msgs.messages.length >= 3, `wa_messages 落库 ${msgs.messages.length} 条`);

  const archive = await call('GET', `/archive/user?user_id=${ua.user.id}`);
  assert(archive.ok, '用户财务档案可查');
  assert(archive.invoices.length >= 1, `invoices 表关联 ${archive.invoices.length} 条`);
  console.log(`    月份档案: invoice=${archive.archives[0]?.invoice_count} txn=${archive.archives[0]?.txn_count}`);

  // ================================================================================
  step(8, 'AI 聊天 (RAG) + Agent 模式');
  // ================================================================================
  const chat1 = await call('POST', '/chat/send', {
    user_id: ua.user.id, company_id: ua.company_id,
    message: '我刚注册了公司，下一步要做什么？GST 什么时候要注册？',
    mode: 'ai'
  });
  assert(chat1.reply?.length > 10, `AI 回复 ${chat1.reply.length} 字, model=${chat1.model}`);
  console.log(`    citations: ${chat1.citations?.length || 0} 条`);

  // ================================================================================
  step(9, '管理后台接口健康检查');
  // ================================================================================
  const stats = await call('GET', '/admin/stats');
  assert(stats, 'admin stats OK');
  const archives = await call('GET', '/admin/archives');
  assert(archives.archives.length >= 1, `admin archives: ${archives.archives.length} 条用户档案`);
  const waList = await call('GET', '/admin/wa/channels');
  assert(waList.channels.length >= 1, `admin wa channels: ${waList.channels.length} 条`);
  const llmLogs = await call('GET', '/admin/llm/logs?limit=5');
  console.log(`    LLM 调用日志: ${llmLogs.logs.length} 条 · 总调用=${llmLogs.stats.total_calls}`);

  // ================================================================================
  console.log('\n' + color.b(color.g('████ ALL E2E CHECKS PASSED ████')));
  console.log(color.c('\n摘要:'));
  console.log(`  👤 users:     A=${ua.user.id}  B=${ub.user.id}`);
  console.log(`  🏢 companies: ${ua.company_id} (UEN=${acra.submission.uen})`);
  console.log(`  💳 payment:   ${pay.payment.payment_id}  subscription=active`);
  console.log(`  📱 WA token:  ${channel.finance_token}  messages=${msgs.messages.length}`);
  console.log(`  🧾 invoices:  ${archive.invoices.length} 条已归档`);
  console.log(`  🤖 LLM gw:    provider=${gw.config.provider} model=${gw.config.models.default}`);
  console.log(`\n🔗 扫码测试: open ${qrPath}`);
})().catch(e => {
  console.error('\n' + color.r('❌ E2E FAILED: ') + e.message);
  console.error(e.stack);
  process.exit(1);
});
