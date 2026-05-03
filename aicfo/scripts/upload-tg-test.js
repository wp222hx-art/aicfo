#!/usr/bin/env node
// ============================================================================
// Upload Portal + Telegram Bot — 端到端联调脚本
// 运行: node scripts/upload-tg-test.js --base=http://localhost:3000
// ============================================================================
const fs = require('fs');
const path = require('path');

const argv = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const BASE = argv.base || process.env.BASE || 'http://localhost:3000';
const API = `${BASE}/api`;

const pass = (s) => console.log(`\x1b[32m✓\x1b[0m ${s}`);
const fail = (s) => console.log(`\x1b[31m✗\x1b[0m ${s}`);
const info = (s) => console.log(`\x1b[36m➜\x1b[0m ${s}`);
const line = (t) => console.log(`\n\x1b[1m━━━ ${t} ━━━\x1b[0m`);

async function j(method, url, body, isForm) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) opt.body = body;
    else { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  }
  const r = await fetch(API + url, opt);
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return { status: r.status, data };
}

async function main() {
  const results = { ok: 0, fail: 0, tests: [] };
  function check(name, cond, extra) {
    if (cond) { pass(name + (extra ? ` · ${extra}` : '')); results.ok++; }
    else       { fail(name + (extra ? ` · ${extra}` : '')); results.fail++; }
    results.tests.push({ name, ok: !!cond, extra });
  }

  // ==== A. Upload Portal ====
  line('A. Upload Portal (方案 A)');

  // 1. 使用 seed 固定的 demo 用户 id
  info('1. 使用固定 demo 用户 (seed)');
  const USER_ID = 'usr_demo_001';
  const COMPANY_ID = null; // seed 中 demo 用户可能未绑公司
  pass(`demo user_id=${USER_ID}`);

  // 2. 生成 token
  info('2. 生成上传链接 token');
  const tr = await j('POST', '/upload-portal/tokens', {
    user_id: USER_ID, company_id: COMPANY_ID, label: '2026 报销', expires_days: 30,
  });
  check('POST /upload-portal/tokens 200', tr.status === 200, `status=${tr.status}`);
  check('返回 token UP-xxxx',            /^UP-/.test(tr.data.token || ''), `token=${tr.data.token}`);
  check('返回完整 URL',                  !!tr.data.url, `url=${tr.data.url}`);
  check('返回二维码 DataURL',            (tr.data.qr_data_url || '').startsWith('data:image/'));
  const TOKEN = tr.data.token;

  // 3. 公共元信息 (上传页会调用)
  info('3. 查链接公共元信息');
  const meta = await j('GET', `/upload-portal/public/${TOKEN}`);
  check('GET /upload-portal/public/:token → ok', meta.data.ok === true);
  check('元信息含 company_name',         !!meta.data.company_name);
  check('元信息含 label = "2026 报销"',  meta.data.label === '2026 报销');

  // 4. 提交文字 submission（无文件）
  info('4. 提交纯文字备注');
  const form1 = new FormData();
  form1.append('text', '2026-05-03 Starbucks Raffles Place 咖啡 SGD 8.50');
  form1.append('submitter_name', 'E2E Tester');
  const sub1 = await j('POST', `/upload-portal/public/${TOKEN}/submit`, form1, true);
  check('纯文字提交 200',               sub1.status === 200, `status=${sub1.status}`);
  check('提交返回 ok',                  sub1.data.ok === true, sub1.data.error || '');
  check('返回 classified_as',           !!sub1.data.classified_as, `cls=${sub1.data.classified_as}`);
  check('返回 submission_id',           /^us_/.test(sub1.data.submission_id || ''));

  // 5. 提交图片（内存伪造一张 PNG）
  info('5. 提交假发票图片');
  // 1x1 png
  const pngBuf = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500012B0E7F270000000049454E44AE426082', 'hex');
  const form2 = new FormData();
  form2.append('files', new Blob([pngBuf], { type: 'image/png' }), 'fake-invoice.png');
  form2.append('text', 'NTUC FairPrice 发票 $45.80');
  const sub2 = await j('POST', `/upload-portal/public/${TOKEN}/submit`, form2, true);
  check('图片提交 200',                  sub2.status === 200, `status=${sub2.status}`);
  check('图片提交 ok',                   sub2.data.ok === true, sub2.data.error || '');
  check('file_count = 1',                sub2.data.file_count === 1, `file_count=${sub2.data.file_count}`);

  // 6. uploads_count 增加
  info('6. 验证 uploads_count 增加');
  const meta2 = await j('GET', `/upload-portal/public/${TOKEN}`);
  check('uploads_count ≥ 2',             meta2.data.uploads_count >= 2, `count=${meta2.data.uploads_count}`);

  // 7. 列表
  info('7. 列出我的链接');
  const listRes = await j('GET', `/upload-portal/tokens?user_id=${USER_ID}`);
  check('列表 200',                      listRes.status === 200);
  check('列表含刚创建的 token',          (listRes.data.tokens || []).some(t => t.token === TOKEN));

  // 8. 撤销
  info('8. 撤销测试');
  const rev = await j('POST', `/upload-portal/tokens/${TOKEN}/revoke`);
  check('撤销 ok',                       rev.data.ok === true);
  const meta3 = await j('GET', `/upload-portal/public/${TOKEN}`);
  check('撤销后 ok=false',               meta3.data.ok === false, meta3.data.error || '');

  // ==== B. Telegram Bot ====
  line('B. Telegram Bot (方案 C)');

  // 1. 配置读取
  info('1. 读取默认配置');
  const tgCfg = await j('GET', '/admin/telegram/config');
  check('GET /admin/telegram/config 200', tgCfg.status === 200);
  check('configured 初始为 false',       tgCfg.data.config.configured === false, `bot_token_set=${tgCfg.data.config.bot_token_set}`);

  // 2. 写一个假 token 做本地测试
  info('2. 配置测试 bot_token');
  const tgUpd = await j('POST', '/admin/telegram/config', {
    bot_token: '1234567890:TEST-fake-token-for-e2e',
    bot_username: 'AiCFO_Test_Bot',
    webhook_secret: 'aicfo-e2e-secret',
    enabled: true,
    auto_reply: false, // 测试时关掉，防止真的调用 Telegram API
  });
  check('POST /admin/telegram/config 200', tgUpd.status === 200);
  check('bot_token 已脱敏',               /\*\*\*\*/.test(tgUpd.data.config.bot_token || ''));

  // 3. Webhook 校验：缺 secret → 403
  info('3. webhook secret 校验');
  const wh1 = await j('POST', '/telegram/webhook', { update_id: 1, message: { message_id: 1, chat: { id: 999 }, text: 'test' } });
  check('无 secret → 403',                wh1.status === 403, `status=${wh1.status}`);

  // 4. 带 secret 的 webhook (无 channel → 应该提示绑定)
  info('4. 未绑定 chat 收消息');
  const wh2r = await fetch(`${API}/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'aicfo-e2e-secret' },
    body: JSON.stringify({
      update_id: 100,
      message: { message_id: 100, date: Math.floor(Date.now()/1000),
        chat: { id: 888888, type: 'private' },
        from: { id: 888888, first_name: 'TgUser', username: 'tguser' },
        text: 'hello' }
    }),
  });
  const wh2 = await wh2r.json();
  check('未绑定消息 200',                 wh2r.status === 200);
  check('返回 handled.error=unbound',     (wh2.handled?.error || '') === 'unbound', `error=${wh2.handled?.error}`);

  // 5. /start FIN-xxxxx 绑定
  info('5. /start 绑定（使用一个有效 FIN token，先从 wa 创建）');
  // 先给 demo 用户建一个 wa_channel，会生成 FIN-xxx
  const waCh = await j('POST', '/wa/channel/create', { user_id: USER_ID });
  const FIN_TOKEN = waCh.data?.channel?.finance_token || waCh.data?.finance_token;
  if (FIN_TOKEN) {
    pass(`拿到 FIN token = ${FIN_TOKEN}`);
    const wh3r = await fetch(`${API}/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'aicfo-e2e-secret' },
      body: JSON.stringify({
        update_id: 101,
        message: { message_id: 101, date: Math.floor(Date.now()/1000),
          chat: { id: 777777, type: 'private' },
          from: { id: 777777, first_name: 'TgU2', username: 'tgu2' },
          text: `/start ${FIN_TOKEN}` }
      }),
    });
    const wh3 = await wh3r.json();
    check('绑定消息 200',                   wh3r.status === 200);
    check('绑定成功 linked=true',           wh3.handled?.linked === true, JSON.stringify(wh3.handled));

    // 6. 发一条发票消息
    info('6. 绑定后发文字发票');
    const wh4r = await fetch(`${API}/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'aicfo-e2e-secret' },
      body: JSON.stringify({
        update_id: 102,
        message: { message_id: 102, date: Math.floor(Date.now()/1000),
          chat: { id: 777777, type: 'private' },
          from: { id: 777777, first_name: 'TgU2' },
          text: 'Starbucks 发票 12.50 SGD' }
      }),
    });
    const wh4 = await wh4r.json();
    check('发票消息 200',                   wh4r.status === 200);
    check('返回 handled.ok',                wh4.handled?.ok === true, JSON.stringify(wh4.handled).slice(0,120));
    check('classified_as 可能为 invoice',   ['invoice', 'other'].includes(wh4.handled?.classified_as || ''), `cls=${wh4.handled?.classified_as}`);
  } else {
    fail('未能拿到 FIN token，跳过绑定/消息测试');
  }

  // 7. 列出 channels
  info('7. TG channels 列表');
  const chList = await j('GET', '/admin/telegram/channels');
  check('GET /admin/telegram/channels 200', chList.status === 200);
  check('列表 ≥ 1',                        (chList.data.channels || []).length >= 1, `count=${(chList.data.channels || []).length}`);

  // 8. testConnection（预期失败，因为是假 token）
  info('8. testConnection（假 token 应该返回 401/404）');
  const tgTest = await j('POST', '/admin/telegram/test');
  check('testConnection 可调用',           tgTest.status === 200, `status=${tgTest.status}`);
  check('假 token 返回 ok=false',          tgTest.data.ok === false, `error=${(tgTest.data.error || '').slice(0,60)}`);

  // ==== Summary ====
  line('汇总');
  console.log(`总测试: ${results.ok + results.fail}  通过: \x1b[32m${results.ok}\x1b[0m  失败: \x1b[31m${results.fail}\x1b[0m`);
  const pct = ((results.ok / (results.ok + results.fail)) * 100).toFixed(1);
  console.log(`成功率: ${pct}%`);

  // 写结果
  try {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, '..', 'data', 'upload-tg-test-result.json'),
      JSON.stringify({ ts: new Date().toISOString(), base: BASE, results }, null, 2)
    );
    pass('结果已保存: data/upload-tg-test-result.json');
  } catch (e) { fail('写文件失败: ' + e.message); }

  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
