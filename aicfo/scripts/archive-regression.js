#!/usr/bin/env node
// ============================================================================
// Company Archive API 回归测试
// 运行: node scripts/archive-regression.js --base=http://localhost:3000
// ============================================================================
const fs = require('fs');
const path = require('path');

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const BASE = argv.base || process.env.BASE || 'http://localhost:3000';
const API = `${BASE}/api`;

const pass = (s) => console.log(`\x1b[32m✓\x1b[0m ${s}`);
const fail = (s) => console.log(`\x1b[31m✗\x1b[0m ${s}`);
const info = (s) => console.log(`\x1b[36m➜\x1b[0m ${s}`);
const line = (t) => console.log(`\n\x1b[1m━━━ ${t} ━━━\x1b[0m`);

async function jget(url) {
  const r = await fetch(API + url);
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return { status: r.status, data };
}
async function jpost(url, body, isForm) {
  const opt = { method: 'POST', headers: {} };
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

  line('A. 档案列表');
  const list = await jget('/admin/archive/companies?limit=20');
  check('GET /admin/archive/companies 200', list.status === 200);
  check('返回 ok=true', list.data.ok === true);
  check('至少返回 1 家公司', Array.isArray(list.data.companies) && list.data.companies.length >= 1, `count=${list.data.companies?.length}`);
  const sample = (list.data.companies || [])[0];
  check('列表项含 stats 聚合', sample && sample.stats && typeof sample.stats.transactions === 'number');
  check('列表项含 last_activity_at', sample && 'last_activity_at' in sample);
  const cid = sample?.id;
  if (!cid) { console.error('no company to test details; abort'); process.exit(1); }

  line('B. 完整档案 (getFullArchive)');
  const full = await jget('/admin/archive/company/' + cid);
  check('GET /admin/archive/company/:id 200', full.status === 200);
  check('返回 ok=true', full.data.ok === true, `error=${full.data.error || '-'}`);
  const a = full.data.archive;
  if (a) {
    check('含 company', !!a.company);
    check('含 owner', 'owner' in a);
    check('含 expenses.transactions', Array.isArray(a.expenses?.transactions));
    check('含 expenses.invoices', Array.isArray(a.expenses?.invoices));
    check('含 expenses.summary', a.expenses?.summary && typeof a.expenses.summary.total_count === 'number');
    check('含 tax.filings/journals/upcoming', a.tax && Array.isArray(a.tax.filings));
    check('含 reports.yearly/monthly', a.reports && Array.isArray(a.reports.yearly));
    check('含 history.documents/wa_messages/uploads', a.history && Array.isArray(a.history.wa_messages));
    check('含 billing.payments/reminders', a.billing && Array.isArray(a.billing.payments));
    check('含 timeline', Array.isArray(a.timeline));
  }

  line('C. 分片端点 (7 个)');
  const parts = ['basic', 'expenses', 'tax', 'reports', 'history', 'billing', 'timeline'];
  for (const p of parts) {
    const r = await jget(`/admin/archive/company/${cid}/${p}`);
    check(`GET /admin/archive/company/:id/${p} → ok`, r.status === 200 && r.data.ok === true, `error=${r.data.error || '-'}`);
  }

  line('D. 档案快照');
  const snap = await jpost(`/admin/archive/company/${cid}/snapshot`, { name: 'regression-test-snapshot', created_by: 'test_runner' });
  check('POST /admin/archive/company/:id/snapshot 200', snap.status === 200);
  check('快照 ok=true', snap.data.ok === true, `doc_id=${snap.data.doc_id || snap.data.data?.id || '-'}`);

  line('E. 上传文件存档（新特性验证）');
  // 先创建 token，再上传一张 1x1 PNG，验证文件能在档案里被看到
  const tk = await jpost('/upload-portal/tokens', { user_id: 'usr_demo_001', label: 'regression-file-preview' });
  check('生成 token 200', tk.status === 200, `token=${tk.data.token}`);
  const tkCode = tk.data.token;
  const cid_target = tk.data.company_id;
  check('token 锁定 company_id', !!cid_target, `company_id=${cid_target}`);

  // 构造 multipart：1x1 PNG
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  const boundary = '----archivetest' + Math.random().toString(16).slice(2);
  const partText = `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nStarbucks receipt 15.00 SGD\r\n`;
  const partFile = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="receipt.png"\r\nContent-Type: image/png\r\n\r\n`;
  const closing = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(partText), Buffer.from(partFile), PNG, Buffer.from(closing)]);
  const upResp = await fetch(`${API}/upload-portal/public/${tkCode}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const upData = await upResp.json();
  check('上传图片 200', upResp.status === 200);
  check('上传 ok=true', upData.ok === true, `cls=${upData.classified_as}`);
  check('返回 linked_entity_ids', Array.isArray(upData.linked_entity_ids) && upData.linked_entity_ids.length > 0);

  // 拉档案的 expenses 并确认 invoice 的 image_url 指向 /api/files/
  const exp = await jget(`/admin/archive/company/${cid_target}/expenses`);
  const withImg = (exp.data?.data?.invoices || []).filter(i => i.image_url && i.image_url.startsWith('/api/files/'));
  check('档案中至少 1 张发票带 image_url', withImg.length > 0, `count=${withImg.length}`);
  // 取最新那张并验证文件可下载
  if (withImg.length) {
    const latest = withImg[0];
    const fr = await fetch(BASE + latest.image_url);
    check('image_url 文件可下载 (200)', fr.status === 200);
    const buf = Buffer.from(await fr.arrayBuffer());
    check('下载的文件内容 = 原 PNG', buf.length === PNG.length && buf.equals(PNG), `size=${buf.length}`);
  }

  // 验证 history.wa_messages 里也有 media_url
  const hist = await jget(`/admin/archive/company/${cid_target}/history`);
  const msgsWithMedia = (hist.data?.data?.wa_messages || []).filter(m => m.media_url && m.media_url.startsWith('/api/files/'));
  check('history.wa_messages 有带文件路径的消息', msgsWithMedia.length > 0, `count=${msgsWithMedia.length}`);

  line('F. 汇总');
  console.log(`总测试: ${results.ok + results.fail}  通过: \x1b[32m${results.ok}\x1b[0m  失败: \x1b[31m${results.fail}\x1b[0m`);
  console.log(`成功率: ${((results.ok / (results.ok + results.fail)) * 100).toFixed(1)}%`);
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'archive-regression-result.json'),
    JSON.stringify({ ...results, base: BASE, timestamp: new Date().toISOString() }, null, 2));
  pass('结果已保存: data/archive-regression-result.json');
  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
