// AiCFO Customer Web App
const API = '/api';
const state = {
  user: null,
  company: null,          // active company (legacy alias)
  companies: [],          // all companies owned by user
  activeCompanyId: null,  // id of the company currently in focus
  route: 'dashboard',
  session_id: null
};
// Restore last selected company
try { state.activeCompanyId = localStorage.getItem('aicfo_active_company') || null; } catch(e) {}
window.state = state;
// i18n shorthand
const t = (k, vars) => (window.I18N ? window.I18N.t(k, vars) : k);

// Re-render current view when locale changes + refresh static nav labels
window.addEventListener('localechange', () => {
  if (window.I18N) window.I18N.applyDOM();
  if (state.route) nav(state.route, state.params || {});
});

// ---------- Helpers ----------
const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'onclick') e.onclick = v;
    else if (k === 'className') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  });
  children.forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
async function api(path, options = {}) {
  const opts = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
const fmt = n => (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Routing ----------
function nav(route, params = {}) {
  state.route = route;
  state.params = params;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  const routes = { dashboard: viewDashboard, register: viewRegister, regFlow: viewRegFlow, books: viewBooks, reports: viewReports, monthly: viewMonthly, tax: viewTax, secretary: viewSecretary, chat: viewChat, pricing: viewPricing, order: viewOrder, signup: viewSignup, plans: viewPlans, wa: viewWaChannel, myArchive: viewMyArchive, myArchiveDetail: viewMyArchiveDetail };
  const fn = routes[route] || viewDashboard;
  fn(params);
  window.scrollTo(0, 0);
}
window.nav = nav;

// ---------- Company Switcher ----------
async function refreshCompanies() {
  try {
    const all = await api('/companies');
    state.companies = all.filter(c => !state.user || c.created_by === state.user.id);
    if (state.companies.length === 0) state.companies = all;
    // resolve active company
    let active = null;
    if (state.activeCompanyId) active = state.companies.find(c => c.id === state.activeCompanyId);
    if (!active) active = state.companies[0] || null;
    state.company = active;
    state.activeCompanyId = active?.id || null;
    try { if (state.activeCompanyId) localStorage.setItem('aicfo_active_company', state.activeCompanyId); } catch(e) {}
    renderCompanySwitcher();
  } catch (e) { console.warn('refreshCompanies failed', e); }
}
window.refreshCompanies = refreshCompanies;

function renderCompanySwitcher() {
  const mount = document.querySelector('#companySwitcher');
  if (!mount) return;
  if (!state.companies || state.companies.length === 0) {
    mount.innerHTML = `<button class="btn btn-sm btn-primary" onclick="nav('register')">${t('switcher.register_first') || '+ 注册第一家公司'}</button>`;
    return;
  }
  const opts = state.companies.map(c => {
    const badge = c.activation_status === 'live'  ? '🟢'
                : c.activation_status === 'paid'  ? '🟡'
                : '⚪';
    const uen = c.uen ? `· ${c.uen}` : '';
    return `<option value="${c.id}" ${c.id===state.activeCompanyId?'selected':''}>${badge} ${esc(c.name)} ${uen}</option>`;
  }).join('');
  mount.innerHTML = `
    <div class="company-switcher">
      <span class="cs-label">🏢</span>
      <select onchange="switchCompany(this.value)" title="切换公司 / Switch company">${opts}</select>
      <button class="btn btn-xs" onclick="nav('register')" title="新注册一家公司">+</button>
    </div>`;
}

window.switchCompany = (id) => {
  state.activeCompanyId = id;
  state.company = state.companies.find(c => c.id === id) || state.company;
  try { localStorage.setItem('aicfo_active_company', id); } catch(e) {}
  // re-render current view
  if (state.route) nav(state.route, state.params || {});
};

// ---------- Init ----------
(async () => {
  try {
    const { user } = await api('/auth/login', { method: 'POST', body: { email: 'james@skyhawk.sg' } });
    state.user = user;
    await refreshCompanies();
    $('#userName').textContent = user.name;
    $('#userRole').textContent = state.company ? state.company.name : 'No company yet';
  } catch (e) {
    console.warn('Auth failed, running anonymously', e);
  }
  // Route from hash (if user opens /#/regFlow?order=xxx)
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash) {
    const [route, qs] = hash.split('?');
    const params = {};
    (qs || '').split('&').filter(Boolean).forEach(kv => { const [k,v] = kv.split('='); params[k] = decodeURIComponent(v || ''); });
    nav(route || 'dashboard', params);
  } else {
    nav('dashboard');
  }
})();

// hashchange support
window.addEventListener('hashchange', () => {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash) return;
  const [route, qs] = hash.split('?');
  const params = {};
  (qs || '').split('&').filter(Boolean).forEach(kv => { const [k,v] = kv.split('='); params[k] = decodeURIComponent(v || ''); });
  nav(route || 'dashboard', params);
});

// ================================================================================
// DASHBOARD
// ================================================================================
async function viewDashboard() {
  $('#view').innerHTML = `<div class="hero"><h1>${t('dash.loading')}</h1></div>`;
  const cid = state.company?.id;
  const [stats, reminders, recentTxns, orders] = await Promise.all([
    api('/admin/stats'),
    cid ? api('/tax/reminders?company_id=' + cid) : Promise.resolve([]),
    cid ? api('/books/transactions?company_id=' + cid + '&limit=6') : Promise.resolve([]),
    api('/registration/orders?user_id=' + (state.user?.id || 'usr_demo_001'))
  ]);

  $('#view').innerHTML = `
    <section class="hero">
      <h1>${t('dash.welcome')} ${esc(state.user?.name || 'Founder')}</h1>
      <p>${t('dash.tagline')}</p>
      <div class="hero-actions">
        <button class="btn btn-primary" onclick="nav('register')">${t('dash.register_cta')}</button>
        <button class="btn" onclick="nav('chat')">${t('dash.ask_cta')}</button>
        <button class="btn" onclick="nav('books')">${t('dash.books_cta')}</button>
      </div>
    </section>

    <div class="grid grid-4 mb-20">
      <div class="card stat-card">
        <div class="stat-label">${t('dash.stat.active_companies')}</div>
        <div class="stat-value">${stats.active_companies}</div>
        <div class="stat-delta">+${stats.companies - stats.active_companies} ${t('dash.stat.in_progress')}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t('dash.stat.pending_reviews')}</div>
        <div class="stat-value">${stats.pending_reviews}</div>
        <div class="stat-delta down">${t('dash.stat.needs_attention')}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t('dash.stat.agent_runs')}</div>
        <div class="stat-value">${stats.agent_runs.total}</div>
        <div class="stat-delta">${t('dash.stat.avg')} ${stats.agent_runs.avg_latency_ms}ms · ${t('dash.stat.conf')} ${stats.agent_runs.avg_confidence}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t('dash.stat.txns_processed')}</div>
        <div class="stat-value">${stats.transactions}</div>
        <div class="stat-delta">${stats.invoices} ${t('dash.stat.invoices_ocred')}</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="flex-between mb-12">
          <h2>${t('dash.deadlines')}</h2>
          <a onclick="nav('tax')">${t('dash.view_all')}</a>
        </div>
        ${reminders.length === 0 ? `<div class="empty">${t('dash.no_reminders')}</div>` :
          reminders.map(r => `
          <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-weight:600">${r.type} ${t('dash.filing')}</div>
              <div class="muted small">${t('dash.due')} ${r.due_date}</div>
            </div>
            <span class="badge badge-${r.status === 'pending' ? 'warning' : 'success'}">${r.status}</span>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="flex-between mb-12">
          <h2>${t('dash.orders')}</h2>
          <a onclick="nav('register')">${t('dash.new')}</a>
        </div>
        ${orders.length === 0 ? `<div class="empty">${t('dash.no_orders')}</div>` :
          orders.slice(0, 5).map(o => `
          <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="nav('order',{id:'${o.id}'})">
            <div>
              <div style="font-weight:600">${esc(o.company_name || 'Unnamed')}</div>
              <div class="muted small">${t('dash.stage')}: ${o.stage} · S$${fmt(o.price_sgd)}</div>
            </div>
            <div style="min-width:120px">
              <div class="progress"><div class="bar" style="width:${(o.progress * 100).toFixed(0)}%"></div></div>
              <div class="small muted mt-8">${(o.progress * 100).toFixed(0)}%</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card mt-20">
      <div class="flex-between mb-12">
        <h2>${t('dash.recent_txns')}</h2>
        <a onclick="nav('books')">${t('dash.view_all')}</a>
      </div>
      ${recentTxns.length === 0 ? `<div class="empty">${t('dash.no_txns')}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>${t('common.date')}</th><th>${t('common.description')}</th><th>${t('common.amount')} (SGD)</th><th>${t('common.status')}</th></tr></thead>
        <tbody>${recentTxns.map(tx => `
          <tr>
            <td class="mono">${tx.transaction_date}</td>
            <td>${esc(tx.description)}</td>
            <td class="mono" style="color:${tx.amount < 0 ? 'var(--danger)' : 'var(--success)'}">${tx.amount < 0 ? '-' : '+'}S$${fmt(Math.abs(tx.amount))}</td>
            <td>${tx.journal_entry_id ? `<span class="badge badge-success">${t('dash.posted')}</span>` : `<span class="badge badge-warning">${t('dash.uncategorised')}</span>`}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>
  `;
}

// ================================================================================
// REGISTRATION WIZARD
// ================================================================================
const registerState = { step: 0, name: '', business: '', shareholders: [{ name: '', nationality: 'SGP', nric_fin: '', shares: 1000, is_director: true }], check: null, order: null };

function viewRegister() {
  $('#view').innerHTML = `
    <h1 class="view-title">${t('reg.title')}</h1>
    <p class="view-sub">${t('reg.sub')}</p>
    <div id="wizard"></div>
  `;
  renderWizard();
}

function renderWizard() {
  const steps = [t('reg.steps.name'), t('reg.steps.business'), t('reg.steps.shareholders'), t('reg.steps.kyc'), t('reg.steps.constitution'), t('reg.steps.review')];
  const html = `
    <div class="wizard-steps">
      ${steps.map((s, i) => `
        <div class="wizard-step ${i === registerState.step ? 'active' : ''} ${i < registerState.step ? 'done' : ''}">
          <div class="num">${i < registerState.step ? '✓' : i + 1}</div>
          <div class="label">${s}</div>
          ${i < steps.length - 1 ? '<div class="line"></div>' : ''}
        </div>`).join('')}
    </div>
    <div id="wizardBody" class="card"></div>
  `;
  $('#wizard').innerHTML = html;
  const bodies = [step1Name, step2Business, step3Shareholders, step4KYC, step5Constitution, step6Review];
  bodies[registerState.step]();
}

function step1Name() {
  $('#wizardBody').innerHTML = `
    <h2>${t('reg.step1.title')}</h2>
    <p class="muted mb-16">${t('reg.step1.sub')}</p>
    <div class="form-row">
      <label>${t('reg.step1.proposed')}</label>
      <div class="inline-row">
        <input id="propName" placeholder="${t('reg.step1.placeholder')}" value="${registerState.name || ''}" />
        <select id="suffix" style="max-width:160px">
          <option value="Pte Ltd">Pte Ltd</option>
          <option value="Private Limited">Private Limited</option>
        </select>
      </div>
    </div>
    <button class="btn btn-primary" onclick="doNameCheck()">${t('reg.step1.check')}</button>
    <div id="nameResult" class="mt-16"></div>
  `;
}
window.doNameCheck = async () => {
  const name = $('#propName').value.trim();
  if (!name) return alert(t('reg.step1.enter_name'));
  $('#nameResult').innerHTML = `<div class="muted">${t('reg.step1.checking')}</div>`;
  const r = await api('/registration/name-check', { method: 'POST', body: { proposed_name: name, suffix: $('#suffix').value } });
  registerState.name = r.proposed_name;
  registerState.check = r;
  const verdictBadge = {
    pass: `<span class="badge badge-success">${t('reg.step1.available')}</span>`,
    fail: `<span class="badge badge-danger">${t('reg.step1.conflict')}</span>`,
    needs_approval: `<span class="badge badge-warning">${t('reg.step1.needs_approval')}</span>`
  }[r.verdict];
  $('#nameResult').innerHTML = `
    <div class="card" style="background:var(--surface-2)">
      <div class="flex-between mb-8"><strong>${esc(r.proposed_name)}</strong>${verdictBadge}</div>
      <div class="small mb-8"><strong>EN:</strong> ${esc(r.reasoning)}</div>
      <div class="small mb-8"><strong>中文:</strong> ${esc(r.reasoning_cn)}</div>
      <div class="muted small">${t('common.confidence')}: ${(r.confidence * 100).toFixed(0)}% · Refs: ${r.regulatory_refs.join(', ')}</div>
      ${r.alternatives && r.alternatives.length ? `
        <div class="mt-12"><strong>${t('reg.step1.alternatives')}</strong>
          <div class="pill-group mt-8">${r.alternatives.map(a => `<span class="pill" onclick="pickAlt('${esc(a)}')">${esc(a)}</span>`).join('')}</div>
        </div>` : ''}
      ${r.verdict === 'pass' ? `<button class="btn btn-primary mt-16" onclick="registerState.step=1;renderWizard()">${t('common.continue')}</button>` : ''}
    </div>`;
};
window.pickAlt = (n) => { $('#propName').value = n.replace(/\s+(Pte Ltd|Private Limited)$/i, ''); doNameCheck(); };

function step2Business() {
  $('#wizardBody').innerHTML = `
    <h2>${t('reg.step2.title')}</h2>
    <p class="muted mb-16">${t('reg.step2.sub')}</p>

    <div class="ai-assist-box">
      <div class="ai-assist-head">
        <span class="ai-badge">✨ AI 业务描述生成器</span>
        <span class="muted small">输入关键词 → AI 自动生成 3 段描述 + 推荐 SSIC</span>
      </div>
      <div class="inline-row">
        <input id="bizKeywords" placeholder="例：跨境电商 · 东南亚 · 服装批发" />
        <button class="btn btn-primary" onclick="aiGenBizDesc()">🪄 一键生成</button>
      </div>
      <div id="aiBizOut" class="mt-12"></div>
    </div>

    <div class="form-row mt-16">
      <label>${t('reg.step2.desc')}</label>
      <textarea id="bizDesc" rows="5" placeholder="${t('reg.step2.desc_ph')}">${registerState.business || ''}</textarea>
      <div class="muted small mt-4">将作为章程 Objects 条款与 ACRA 业务描述提交</div>
    </div>
    <div class="inline-row">
      <div class="form-row">
        <label>${t('reg.step2.capital')} (SGD)</label>
        <input id="capital" type="number" value="${registerState.capital || 1000}" min="1" />
      </div>
      <div class="form-row">
        <label>${t('reg.step2.fye')}</label>
        <select id="fye">
          <option value="12-31">31 December</option>
          <option value="03-31">31 March</option>
          <option value="06-30">30 June</option>
        </select>
      </div>
    </div>
    <div id="ssicSuggestOut"></div>
    <div class="flex mt-16">
      <button class="btn" onclick="registerState.step=0;renderWizard()">${t('common.back')}</button>
      <button class="btn btn-primary" onclick="saveBusiness()">${t('common.continue')}</button>
    </div>`;
}
window.aiGenBizDesc = async () => {
  const kw = ($('#bizKeywords').value || '').trim();
  if (!kw || kw.length < 2) return alert('请至少输入 2 个字符的关键词');
  const out = $('#aiBizOut');
  out.innerHTML = '<div class="spinner-row"><span class="spinner"></span> AI 正在分析关键词 & 生成 3 段描述... (reasoning tier, 5-15 秒)</div>';
  try {
    const r = await api('/registration/ai/business-desc', {
      method: 'POST', body: { keywords: kw, segment: registerState.segment || 'local_sg' }
    });
    if (!r.ok) throw new Error(r.error || 'AI failed');
    registerState.aiDesc = r;
    out.innerHTML = `
      <div class="ai-variants">
        <div class="variant" onclick="pickBizDesc('short')">
          <div class="v-head"><strong>简短版</strong><span class="badge badge-info">~50字</span></div>
          <div class="v-body">${esc(r.short || '')}</div>
        </div>
        <div class="variant selected" onclick="pickBizDesc('medium')">
          <div class="v-head"><strong>标准版 · 推荐</strong><span class="badge badge-success">~100字</span></div>
          <div class="v-body">${esc(r.medium || '')}</div>
        </div>
        <div class="variant" onclick="pickBizDesc('detailed')">
          <div class="v-head"><strong>详细版</strong><span class="badge badge-info">~220字</span></div>
          <div class="v-body">${esc(r.detailed || '')}</div>
        </div>
      </div>
      <div class="muted small mt-8">点击任一段 → 写入下方 "业务描述" 文本框。Powered by ${esc(r.model || 'AI')}</div>`;
    // default pick medium
    pickBizDesc('medium');
    // render ssic suggestions
    if (r.ssic_suggestions && r.ssic_suggestions.length) {
      $('#ssicSuggestOut').innerHTML = `
        <div class="ssic-suggest mt-16">
          <div class="small mb-8"><strong>🏷️ 推荐 SSIC (SSIC 2020 · 5 位代码)</strong></div>
          <div class="pill-group">
            ${r.ssic_suggestions.map((s,i) => `
              <div class="ssic-pill ${i===0?'primary':''}" onclick="pickSSIC('${esc(s.code)}','${esc(s.title||'')}')">
                <span class="ssic-code">${esc(s.code)}</span>
                <span class="ssic-title">${esc(s.title || '')}</span>
                ${i===0?'<span class="pill-badge">主营</span>':''}
              </div>`).join('')}
          </div>
        </div>`;
    }
  } catch(e) {
    out.innerHTML = `<div class="badge badge-danger">AI 生成失败：${esc(e.message)}</div>`;
  }
};
window.pickBizDesc = (which) => {
  const r = registerState.aiDesc || {};
  $('#bizDesc').value = r[which] || '';
  document.querySelectorAll('.ai-variants .variant').forEach((el, i) => {
    el.classList.toggle('selected', ['short','medium','detailed'][i] === which);
  });
};
window.pickSSIC = (code, title) => {
  registerState.ssic_primary = { code, title };
  document.querySelectorAll('.ssic-pill').forEach(el => el.classList.remove('selected'));
  event?.currentTarget?.classList.add('selected');
};
window.saveBusiness = () => {
  registerState.business = $('#bizDesc').value;
  registerState.capital = parseInt($('#capital').value);
  registerState.fye = $('#fye').value;
  registerState.step = 2;
  renderWizard();
};

function step3Shareholders() {
  const total = registerState.shareholders.reduce((s, x) => s + (+x.shares || 0), 0);
  $('#wizardBody').innerHTML = `
    <h2>${t('reg.step3.title')}</h2>
    <p class="muted mb-16">${t('reg.step3.sub')}</p>
    <div id="shList">${registerState.shareholders.map((s, i) => renderShRow(s, i)).join('')}</div>
    <button class="btn btn-sm mt-8" onclick="addShareholder()">${t('reg.step3.add')}</button>
    <div class="mt-16"><strong>${t('reg.step3.total_shares')}: ${total}</strong></div>
    <div class="flex mt-16">
      <button class="btn" onclick="registerState.step=1;renderWizard()">${t('common.back')}</button>
      <button class="btn btn-primary" onclick="registerState.step=3;renderWizard()">${t('reg.step3.continue')}</button>
    </div>`;
}
function renderShRow(s, i) {
  return `
    <div class="card" style="background:var(--surface-2);margin-bottom:10px">
      <div class="inline-row">
        <div class="form-row"><label>${t('reg.step3.full_name')}</label><input onchange="updateSh(${i},'name',this.value)" value="${esc(s.name)}" placeholder="${t('reg.step3.id_ph')}"/></div>
        <div class="form-row"><label>${t('reg.step3.nationality')}</label>
          <select onchange="updateSh(${i},'nationality',this.value)">
            <option value="SGP" ${s.nationality === 'SGP' ? 'selected' : ''}>Singapore</option>
            <option value="CHN" ${s.nationality === 'CHN' ? 'selected' : ''}>China</option>
            <option value="IDN" ${s.nationality === 'IDN' ? 'selected' : ''}>Indonesia</option>
            <option value="MYS" ${s.nationality === 'MYS' ? 'selected' : ''}>Malaysia</option>
            <option value="OTH" ${s.nationality === 'OTH' ? 'selected' : ''}>Other</option>
          </select>
        </div>
      </div>
      <div class="inline-row">
        <div class="form-row"><label>${t('reg.step3.nric')}</label><input onchange="updateSh(${i},'nric_fin',this.value)" value="${esc(s.nric_fin)}" placeholder="${t('reg.step3.nric_ph')}"/></div>
        <div class="form-row"><label>${t('reg.step3.shares')}</label><input type="number" onchange="updateSh(${i},'shares',+this.value)" value="${s.shares}" /></div>
      </div>
      <div class="flex-between">
        <label><input type="checkbox" ${s.is_director ? 'checked' : ''} onchange="updateSh(${i},'is_director',this.checked)"/> ${t('reg.step3.is_director')}</label>
        ${registerState.shareholders.length > 1 ? `<button class="btn btn-sm btn-danger" onclick="rmSh(${i})">${t('reg.step3.remove')}</button>` : ''}
      </div>
    </div>`;
}
window.updateSh = (i, k, v) => { registerState.shareholders[i][k] = v; };
window.addShareholder = () => { registerState.shareholders.push({ name: '', nationality: 'SGP', nric_fin: '', shares: 0, is_director: false }); renderWizard(); };
window.rmSh = (i) => { registerState.shareholders.splice(i, 1); renderWizard(); };

function step4KYC() {
  $('#wizardBody').innerHTML = `
    <h2>${t('reg.step4.title')}</h2>
    <p class="muted mb-16">${t('reg.step4.sub')}</p>
    <div class="grid grid-2">
      ${registerState.shareholders.map((s, i) => `
        <div class="card" style="background:var(--surface-2)">
          <h3>${esc(s.name || t('reg.step4.unnamed') + ' ' + (i + 1))}</h3>
          <div class="muted small mb-12">${t('reg.step3.nationality')}: ${s.nationality}</div>
          ${s.nationality === 'SGP' ?
            `<button class="btn btn-primary" onclick="doKYC(${i},'singpass')">${t('reg.step4.singpass')}</button>` :
            `<button class="btn btn-primary" onclick="doKYC(${i},'passport_ocr')">${t('reg.step4.passport')}</button>`}
          <div id="kyc-${i}" class="mt-12"></div>
        </div>`).join('')}
    </div>
    <div class="flex mt-16">
      <button class="btn" onclick="registerState.step=2;renderWizard()">${t('common.back')}</button>
      <button class="btn btn-primary" onclick="registerState.step=4;renderWizard()">${t('common.continue')}</button>
    </div>`;
}
window.doKYC = async (i, method) => {
  $(`#kyc-${i}`).innerHTML = `<div class="muted">${t('reg.step4.initiating')}</div>`;
  // Simulate: create person + session + complete
  const init = await api('/kyc/initiate', { method: 'POST', body: { person_id: `per_demo_${i}`, method } });
  setTimeout(async () => {
    const done = await api('/kyc/complete', { method: 'POST', body: { kyc_session_id: init.kyc_session_id } });
    $(`#kyc-${i}`).innerHTML = `
      <div class="badge badge-success">${t('reg.step4.passed')}</div>
      <div class="small mt-8">${t('reg.step4.liveness')} ${(done.liveness_score * 100).toFixed(0)}% · AML: ${done.aml.status}</div>`;
    registerState.shareholders[i].kyc_done = true;
  }, 1500);
};

function step5Constitution() {
  $('#wizardBody').innerHTML = `
    <h2>${t('reg.step5.title')}</h2>
    <p class="muted mb-16">${t('reg.step5.sub')}</p>
    <div class="constitution-intro">
      <div class="ci-card"><div class="ci-icon">📄</div><div><strong>JSON 结构化</strong><div class="muted small">22 条 clauses + 偏离清单</div></div></div>
      <div class="ci-card"><div class="ci-icon">📝</div><div><strong>DOCX 可签署</strong><div class="muted small">Word 文档供电子签名</div></div></div>
      <div class="ci-card"><div class="ci-icon">📑</div><div><strong>PDF 终稿</strong><div class="muted small">提交 ACRA 的终稿</div></div></div>
    </div>
    <button class="btn btn-primary mt-16" onclick="genConstitution()">🪄 ${t('reg.step5.gen')}</button>
    <div id="constOut" class="mt-16"></div>
  `;
}
window.genConstitution = async () => {
  $('#constOut').innerHTML = `<div class="spinner-row"><span class="spinner"></span> AI 正在调用 Constitution Engine (章程引擎)：采集 → 校验 R01..R15 → 起草 → 融合 Model Constitution → 三件套渲染 ...</div>`;
  // Create order first if not yet
  if (!registerState.order) {
    const r = await api('/registration/orders', {
      method: 'POST',
      body: {
        company_name: registerState.name,
        business_activities: [registerState.business],
        business_description: registerState.business,
        ssic_codes: registerState.ssic_primary ? [registerState.ssic_primary.code] : ['62019'],
        financial_year_end: registerState.fye,
        paid_up_capital: { amount: registerState.capital, currency: 'SGD' },
        shareholders: registerState.shareholders,
        user_id: state.user?.id
      }
    });
    registerState.order = r;
  }
  // Call new constitution-bundle endpoint
  const r2 = await api('/registration/orders/' + registerState.order.order_id + '/constitution-bundle', { method: 'POST' });
  renderConstitutionBundle(r2, registerState.order.order_id);
  return;
};

// Render constitution bundle (shared with flow page)
function renderConstitutionBundle(r2, orderId) {
  const b = r2.bundle || {};
  const clauses = r2.clauses || [];
  const validation = r2.validation || { deviations: [], blockers: [] };
  const deviations = b.deviations || validation.deviations || [];
  const blockers = b.blockers || validation.blockers || [];
  const treeHtml = clauses.map((c, i) => `
    <div class="clause-row" onclick="document.getElementById('clause-${c.id}').scrollIntoView({behavior:'smooth',block:'center'})">
      <span class="clause-idx">${String(i+1).padStart(2,'0')}</span>
      <span class="clause-title">${esc(c.title)}</span>
      ${c.source==='ai_drafted'?'<span class="badge badge-info">AI</span>':''}
    </div>`).join('');
  const bodyHtml = clauses.map((c, i) => `
    <div class="clause-detail" id="clause-${c.id}">
      <div class="cd-head"><span class="cd-idx">${i+1}.</span><strong>${esc(c.title)}</strong>
        <span class="muted small">· ${esc(c.law)}</span>
        ${c.source==='ai_drafted'?'<span class="badge badge-info ml-8">AI 起草</span>':'<span class="badge ml-8">Model</span>'}
      </div>
      <div class="cd-body">${esc(c.body)}</div>
    </div>`).join('');

  $('#constOut').innerHTML = `
    <div class="constitution-bundle">
      <div class="cb-head">
        <div><strong>Constitution of ${esc(registerState.name || '—')}</strong>
          <div class="muted small">版本 v${b.version || 1} · 生成于 ${b.generated_at ? new Date(b.generated_at).toLocaleString() : '—'} · 22 条款</div>
        </div>
        <div class="cb-downloads">
          <a class="btn btn-sm" href="/api/documents/${b.json_doc_id}/download" download>📄 JSON</a>
          <a class="btn btn-sm" href="/api/documents/${b.docx_doc_id}/download" download>📝 DOCX</a>
          <a class="btn btn-sm" href="/api/documents/${b.pdf_doc_id}/download" download>📑 PDF</a>
        </div>
      </div>
      ${blockers.length ? `
        <div class="alert alert-danger mt-12">
          <strong>⛔ ${blockers.length} 条合规阻断</strong>
          <ul>${blockers.map(x => `<li>[${x.rule}] ${esc(x.msg)}</li>`).join('')}</ul>
        </div>` : ''}
      ${deviations.length ? `
        <div class="alert alert-warning mt-12">
          <strong>⚠ ${deviations.length} 处偏离 Model Constitution (可继续)</strong>
          <ul>${deviations.map(x => `<li>[${x.rule}/${x.clause}] ${esc(x.msg)}</li>`).join('')}</ul>
        </div>` : ''}
      <div class="cb-layout mt-12">
        <aside class="cb-tree">
          <div class="cb-tree-title">章程目录 (22)</div>
          ${treeHtml}
        </aside>
        <section class="cb-content">${bodyHtml}</section>
      </div>
      <div class="flex mt-16">
        <button class="btn" onclick="registerState.step=4;renderWizard()">${t('common.back')}</button>
        <button class="btn btn-primary" onclick="registerState.step=5;renderWizard()">${t('reg.step5.continue')}</button>
        ${orderId ? `<button class="btn btn-outline" onclick="nav('regFlow',{order:'${orderId}'})">🗺️ 进入完整流程图</button>` : ''}
      </div>
    </div>`;
}
window.renderConstitutionBundle = renderConstitutionBundle;

// ================================================================================
// REG FLOW · 完整流程图页 (垂直流程图 + 9 关门禁 + AI 助手 + 付费 + 三件套)
// ================================================================================
async function viewRegFlow(params = {}) {
  const orderId = params.order || registerState.order?.order_id;
  $('#view').innerHTML = `
    <div class="flow-head">
      <a onclick="nav('dashboard')" class="back-link">← Dashboard</a>
      <h1 class="view-title">🗺️ 注册流程图 <span class="muted">/ Registration Roadmap</span></h1>
      <p class="view-sub">每一关都有前置条件，完成后自动解锁下一关。所有工件 (章程、KYC、付款收据、UEN) 都挂载到此订单下，形成独立公司档案。</p>
    </div>
    <div id="flowBody">
      <div class="empty-state">
        <p class="muted">${orderId ? '正在加载订单 <code>'+esc(orderId)+'</code> 的流程状态...' : '请先在 <b>注册向导</b> 完成命名+业务+股东, 订单创建后会自动跳转到本页。'}</p>
        ${!orderId ? `<button class="btn btn-primary" onclick="nav('register')">🏷️ 开始注册向导</button>` : ''}
      </div>
    </div>`;
  if (!orderId) return;
  try {
    const flow = await api('/registration/orders/' + orderId + '/flow');
    renderFlowBody(flow, orderId);
  } catch (e) {
    $('#flowBody').innerHTML = `<div class="alert alert-danger">加载失败: ${esc(e.message)}</div>`;
  }
}

function renderFlowBody(flow, orderId) {
  const gates = flow.gates || [];
  const company = flow.company || {};
  const persons = flow.persons || [];
  const activation = flow.activation_status || 'draft';
  const payment = flow.payment_status || 'unpaid';
  const uen = company.uen;

  // 左侧信息 + 右侧流程图
  const activationBadge = activation === 'live'
    ? '<span class="badge badge-success">🟢 Live (UEN 已下发)</span>'
    : activation === 'paid'
      ? '<span class="badge badge-warning">🟡 Paid (记账解锁)</span>'
      : '<span class="badge">⚪ Draft (注册中)</span>';

  const passedCount = gates.filter(g => g.status === 'passed').length;
  const percent = Math.round((passedCount / gates.length) * 100);

  $('#flowBody').innerHTML = `
    <div class="flow-layout">
      <aside class="flow-sidebar">
        <div class="card">
          <div class="small muted">公司实体 · Entity</div>
          <h2 style="margin:4px 0 8px">${esc(company.name || '—')}</h2>
          <div class="flex-between mb-8"><span class="muted">状态</span>${activationBadge}</div>
          <div class="flex-between mb-8"><span class="muted">UEN</span><strong class="mono">${uen || '—'}</strong></div>
          <div class="flex-between mb-8"><span class="muted">FYE</span><span>${company.fye || '—'}</span></div>
          <div class="flex-between mb-8"><span class="muted">股本</span><span>${company.currency || 'SGD'} ${Number(company.paid_up_capital||0).toLocaleString()}</span></div>
          <div class="flex-between mb-8"><span class="muted">订单</span><code class="mono small">${esc(orderId)}</code></div>
          <div class="divider"></div>
          <div class="flex-between mb-4"><span class="muted small">流程进度</span><strong>${passedCount}/${gates.length}</strong></div>
          <div class="progress"><div class="bar" style="width:${percent}%"></div></div>
          <div class="muted small mt-4">${percent}% 完成</div>
        </div>
        <div class="card mt-12">
          <h3>💳 付款状态</h3>
          <div class="flex-between mb-8"><span class="muted">订单付款</span>
            <span class="badge badge-${payment==='paid'?'success':payment==='processing'?'warning':'muted'}">${payment}</span>
          </div>
          ${flow.paid_at ? `<div class="muted small">${new Date(flow.paid_at).toLocaleString()}</div>` : ''}
          <div class="divider"></div>
          <div class="small">
            <div class="${activation!=='draft'?'ok':''}">${activation!=='draft'?'✅':'🔒'} 记账 · Bookkeeping</div>
            <div class="${activation==='live'?'ok':''}">${activation==='live'?'✅':'🔒'} 税务 · Tax (ECI/Form C-S/GST)</div>
            <div class="${activation==='live'?'ok':''}">${activation==='live'?'✅':'🔒'} 薪酬 · Payroll/CPF</div>
          </div>
        </div>
        <div class="card mt-12">
          <h3>👥 股东 &amp; 董事 (${persons.length})</h3>
          ${persons.map(p => {
            const kyc = (flow.kyc?.rows || []).find(r => r.person_id === p.id);
            const kycBadge = kyc?.kyc_status === 'passed'
              ? '<span class="badge badge-success">KYC ✓</span>'
              : `<span class="badge">${kyc?.kyc_status || 'not_started'}</span>`;
            return `<div class="flex-between mb-8"><div>
              <div>${esc(p.full_name || '—')}</div>
              <div class="muted small">${p.nationality} · ${p.shares_held||0} shares · ${esc(p.role)}</div>
            </div>${kycBadge}</div>`;
          }).join('') || '<div class="muted small">尚未添加股东</div>'}
        </div>
      </aside>
      <section class="flow-track">
        ${gates.map((g, i) => renderGateCard(g, i, gates.length, orderId, flow)).join('')}
        ${activation === 'live' ? `
          <div class="gate-celebrate">
            <div class="gc-icon">🎉</div>
            <h2>公司注册完成！</h2>
            <p class="muted">UEN <strong class="mono">${uen}</strong> 已下发 · 所有财务/税务功能已解锁</p>
            <div class="flex mt-16">
              <button class="btn btn-primary" onclick="nav('books')">💼 进入记账</button>
              <button class="btn" onclick="nav('tax')">💰 税务中心</button>
              <button class="btn" onclick="nav('myArchive')">📂 公司档案</button>
            </div>
          </div>` : ''}
      </section>
    </div>
  `;
}

function renderGateCard(g, idx, total, orderId, flow) {
  const isPassed = g.status === 'passed';
  const isCurrent = !isPassed && g.can_advance;
  const isLocked  = !isPassed && !g.can_advance;
  const cls = isPassed ? 'passed' : isCurrent ? 'current' : 'locked';
  const iconState = isPassed ? '✓' : isCurrent ? '➜' : '🔒';

  let actionHtml = '';
  if (isPassed) {
    actionHtml = `<div class="gate-artifact">
      <span class="muted small">完成于 ${g.at ? new Date(g.at).toLocaleString() : '—'}</span>
      ${g.artifact_id ? `<code class="mono small">${esc(g.artifact_id)}</code>` : ''}
    </div>`;
  } else if (isCurrent) {
    actionHtml = renderGateAction(g, orderId, flow);
  } else {
    actionHtml = `<div class="gate-locked-reason">🔒 前置未完成: <em>${esc(g.blocked_reason || '')}</em></div>`;
  }

  return `
    <div class="gate-card ${cls}" data-gate="${g.id}">
      <div class="gate-rail">
        <div class="gate-dot">${iconState}</div>
        ${idx < total - 1 ? '<div class="gate-line"></div>' : ''}
      </div>
      <div class="gate-body">
        <div class="gate-head">
          <div class="gate-title">
            <span class="gate-step">第 ${idx+1} 关</span>
            <h3>${esc(g.title)}</h3>
          </div>
          <span class="badge badge-${isPassed?'success':isCurrent?'warning':'muted'}">${isPassed?'已完成':isCurrent?'进行中':'已锁定'}</span>
        </div>
        <p class="gate-desc">${esc(g.desc)} · <span class="muted">产出: ${esc(g.output)}</span></p>
        <div class="gate-action">${actionHtml}</div>
      </div>
    </div>`;
}

function renderGateAction(g, orderId, flow) {
  switch (g.id) {
    case 'G2':
      return `<button class="btn btn-primary" onclick="flowEditBusiness('${orderId}')">📋 补充业务描述 + SSIC (AI 生成)</button>`;
    case 'G3':
      return `<button class="btn btn-primary" onclick="flowMarkGate('${orderId}','G3')">✅ 确认股东 &amp; 股本结构</button>`;
    case 'G4':
      return `<button class="btn btn-primary" onclick="flowRunAllKyc('${orderId}')">🪪 为所有股东发起 KYC</button>
        <div class="muted small mt-8">已通过 ${flow.kyc?.passed||0} / ${flow.kyc?.total||0}</div>`;
    case 'G5':
      return `<button class="btn btn-primary" onclick="flowGenConstitution('${orderId}')">📜 生成章程三件套 (JSON+DOCX+PDF)</button>`;
    case 'G6':
      return `<button class="btn btn-primary" onclick="flowSign('${orderId}')">✍️ 发起电子签名</button>`;
    case 'G7':
      return `<button class="btn btn-primary" onclick="flowCheckout('${orderId}')">💳 进入付款 (S$${flow.price_sgd || 388})</button>
        <div class="muted small mt-8">付款成功 → 自动解锁 G8 并激活记账功能</div>`;
    case 'G8':
      return `<button class="btn btn-primary" onclick="flowBizfile('${orderId}')">🏛️ 提交 ACRA Bizfile+</button>`;
    case 'G9':
      return `<button class="btn btn-primary" onclick="flowIssueUEN('${orderId}')">🎉 等待 UEN 下发 (模拟)</button>`;
    default:
      return '<div class="muted">—</div>';
  }
}

// ---- Flow actions ----
window.flowEditBusiness = async (orderId) => {
  const kw = prompt('业务关键词 (AI 会生成 3 段描述 + 推荐 SSIC):', '');
  if (!kw) return;
  try {
    const ai = await api('/registration/ai/business-desc', { method: 'POST', body: { keywords: kw } });
    const desc = ai.medium || ai.short || '';
    const ssic = ai.ssic_suggestions?.[0]?.code || '62019';
    // Update company business_description + ssic_codes via raw update
    const order = await api('/registration/orders/' + orderId);
    await api('/companies/' + order.company_id, { method: 'PATCH', body: { business_description: desc, ssic_codes: ssic } }).catch(()=>null);
    // Fallback: call advance gate directly
    await api('/registration/orders/' + orderId + '/gate/G2/advance', { method: 'POST', body: { actor: 'user', artifact_id: ssic } });
    alert('✅ 业务描述 + SSIC 已生成：\n\n' + desc.slice(0,140) + '...\n\nSSIC: ' + ssic);
    viewRegFlow({ order: orderId });
  } catch (e) { alert('失败: ' + e.message); }
};
window.flowMarkGate = async (orderId, gateId) => {
  try {
    await api('/registration/orders/' + orderId + '/gate/' + gateId + '/advance', { method: 'POST', body: { actor: 'user' } });
    viewRegFlow({ order: orderId });
  } catch(e) { alert('Gate 推进失败: ' + (e.message||e)); }
};
window.flowRunAllKyc = async (orderId) => {
  const flow = await api('/registration/orders/' + orderId + '/flow');
  const pending = (flow.kyc?.rows || []).filter(r => r.kyc_status !== 'passed');
  if (pending.length === 0) return viewRegFlow({ order: orderId });
  for (const row of pending) {
    const method = row.nationality === 'SGP' ? 'singpass' : 'passport_ocr';
    const init = await api('/kyc/v2/initiate', { method: 'POST', body: { person_id: row.person_id, method } });
    await api('/kyc/v2/complete', { method: 'POST', body: { session_id: init.session_id, payload: { name: row.full_name, nationality: row.nationality } } });
  }
  // Now try to advance G4
  try { await api('/registration/orders/' + orderId + '/gate/G4/advance', { method: 'POST', body: { actor: 'user' } }); } catch {}
  viewRegFlow({ order: orderId });
};
window.flowGenConstitution = async (orderId) => {
  const body = $('#flowBody');
  body.insertAdjacentHTML('beforeend', '<div id="flowBusy" class="flow-busy"><span class="spinner"></span> 🪄 正在生成章程三件套 (5-15 秒, reasoning tier)...</div>');
  try {
    const r = await api('/registration/orders/' + orderId + '/constitution-bundle', { method: 'POST' });
    $('#flowBusy')?.remove();
    // 用 modal 显示三件套预览
    const panel = document.createElement('div');
    panel.className = 'modal-overlay';
    panel.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h2>📜 章程三件套已生成</h2>
          <button class="btn btn-sm" onclick="this.closest('.modal-overlay').remove();viewRegFlow({order:'${orderId}'})">✕ 关闭并刷新流程</button>
        </div>
        <div class="modal-body"><div id="constOut"></div></div>
      </div>`;
    document.body.appendChild(panel);
    renderConstitutionBundle(r, orderId);
  } catch (e) {
    $('#flowBusy')?.remove();
    alert('章程生成失败: ' + e.message);
  }
};
window.flowSign = async (orderId) => {
  if (!confirm('模拟电子签名：所有董事/股东将对章程逐条签章，继续？')) return;
  try {
    await api('/registration/orders/' + orderId + '/gate/G6/advance', { method: 'POST', body: { signed: true, actor: 'user' } });
    viewRegFlow({ order: orderId });
  } catch (e) { alert('签名失败: ' + e.message); }
};
window.flowCheckout = async (orderId) => {
  try {
    const r = await api('/billing/orders/' + orderId + '/checkout', { method: 'POST' });
    if (r.already_paid) { alert('已付款'); return viewRegFlow({ order: orderId }); }
    // MVP: open mock checkout dialog
    if (confirm('💳 Mock 付款 — 金额 ' + r.currency + ' ' + r.amount + '\n点击「确定」立刻标记为已付款（正式环境会跳 Stripe Checkout）')) {
      await api('/billing/orders/' + orderId + '/mock-pay', { method: 'POST' });
      alert('✅ 付款成功！记账功能已解锁');
      viewRegFlow({ order: orderId });
    }
  } catch (e) { alert('付款失败: ' + e.message); }
};
window.flowBizfile = async (orderId) => {
  try {
    // Use legacy advance (stage based)
    await api('/registration/orders/' + orderId + '/advance', { method: 'POST', body: { next_stage: 'bizfile' } });
    const subId = 'BF-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    await api('/registration/orders/' + orderId + '/gate/G8/advance', { method: 'POST', body: { actor: 'acra', artifact_id: subId, bizfile_submission_id: subId } });
    alert('✅ Bizfile+ 已递交, submission id = ' + subId);
    viewRegFlow({ order: orderId });
  } catch (e) { alert('递交失败: ' + e.message); }
};
window.flowIssueUEN = async (orderId) => {
  try {
    // legacy "completed" stage triggers UEN auto-issuance + company activation_status=live
    await api('/registration/orders/' + orderId + '/advance', { method: 'POST', body: { next_stage: 'completed' } });
    refreshCompanies();
    viewRegFlow({ order: orderId });
  } catch (e) { alert('UEN 下发失败: ' + e.message); }
};

function step6Review() {
  const total = registerState.shareholders.reduce((s, x) => s + (+x.shares || 0), 0);
  const timelineSteps = t('reg.step6.timeline');
  $('#wizardBody').innerHTML = `
    <h2>${t('reg.step6.title')}</h2>
    <div class="grid grid-2">
      <div class="card" style="background:var(--surface-2)">
        <h3>${t('reg.step6.order_summary')}</h3>
        <div class="flex-between mb-8"><span class="muted">${t('reg.step6.company_name')}</span><strong>${esc(registerState.name)}</strong></div>
        <div class="flex-between mb-8"><span class="muted">${t('reg.step6.business')}</span><span>${esc(registerState.business.slice(0, 40))}...</span></div>
        <div class="flex-between mb-8"><span class="muted">${t('reg.step6.paid_up')}</span><strong>S$${fmt(registerState.capital)}</strong></div>
        <div class="flex-between mb-8"><span class="muted">${t('reg.step6.shareholders_count')}</span><strong>${registerState.shareholders.length} (${total} ${t('reg.step3.shares').toLowerCase()})</strong></div>
        <div class="flex-between mb-8"><span class="muted">${t('reg.step6.fye')}</span><strong>${registerState.fye}</strong></div>
        <div class="divider"></div>
        <div class="flex-between"><span>${t('reg.step6.reg_service')}</span><span>S$388.00</span></div>
        <div class="flex-between"><span>${t('reg.step6.acra_fee')}</span><span>S$315.00</span></div>
        <div class="divider"></div>
        <div class="flex-between" style="font-size:18px"><strong>${t('common.total')}</strong><strong>S$703.00</strong></div>
      </div>
      <div class="card">
        <h3>${t('reg.step6.after_pay')}</h3>
        <div class="timeline">
          ${timelineSteps.map((s, i) =>
            `<div class="timeline-step ${i === 0 ? 'in_progress' : ''}"><div class="dot">${i + 1}</div><div><div class="step-title">${s}</div></div></div>`
          ).join('')}
        </div>
        <button class="btn btn-primary mt-16" style="width:100%;padding:14px" onclick="submitOrder()">${t('reg.step6.pay_btn')}</button>
      </div>
    </div>
    <div class="flex mt-16">
      <button class="btn" onclick="registerState.step=4;renderWizard()">${t('common.back')}</button>
    </div>`;
}
window.submitOrder = async () => {
  if (!registerState.order) {
    const r = await api('/registration/orders', {
      method: 'POST',
      body: {
        company_name: registerState.name,
        business_activities: [registerState.business],
        business_description: registerState.business,
        ssic_codes: registerState.ssic_primary ? [registerState.ssic_primary.code] : ['62019'],
        financial_year_end: registerState.fye,
        paid_up_capital: { amount: registerState.capital, currency: 'SGD' },
        shareholders: registerState.shareholders,
        user_id: state.user?.id
      }
    });
    registerState.order = r;
  }
  const oid = registerState.order.order_id;
  // 跳转到新流程图页, 让用户按 9 关逐关推进 (新架构的核心)
  if (state.activeCompanyId !== registerState.order.company_id) {
    state.activeCompanyId = registerState.order.company_id;
    try { localStorage.setItem('aicfo_active_company', state.activeCompanyId); } catch(e) {}
  }
  await refreshCompanies();
  nav('regFlow', { order: oid });
};

// ================================================================================
// ORDER DETAIL
// ================================================================================
async function viewOrder({ id }) {
  const o = await api('/registration/orders/' + id);
  $('#view').innerHTML = `
    <a onclick="nav('dashboard')">← Back to Dashboard</a>
    <h1 class="view-title mt-8">${esc(o.company?.name || 'Order')}</h1>
    <p class="view-sub">Order ${o.id} · Created ${o.created_at}</p>
    <div class="grid grid-2">
      <div class="card">
        <h2>Progress</h2>
        <div class="progress mb-12"><div class="bar" style="width:${(o.progress * 100).toFixed(0)}%"></div></div>
        <div class="timeline">
          ${o.timeline.map(t => `
            <div class="timeline-step ${t.status}">
              <div class="dot">${t.status === 'done' ? '✓' : t.status === 'in_progress' ? '●' : ''}</div>
              <div>
                <div class="step-title">${t.stage.replace(/_/g, ' ')}</div>
                <div class="step-desc">${t.at ? new Date(t.at).toLocaleString() : '—'}</div>
              </div>
            </div>`).join('')}
        </div>
        ${o.stage !== 'completed' ? `<button class="btn mt-16" onclick="advanceOrder('${o.id}')">⏭ Advance (demo)</button>` : ''}
      </div>
      <div class="card">
        <h2>Company Details</h2>
        <div class="flex-between mb-8"><span class="muted">UEN</span><strong class="mono">${o.company?.uen || '— (pending)'}</strong></div>
        <div class="flex-between mb-8"><span class="muted">Status</span><span class="badge badge-${o.company?.status === 'active' ? 'success' : 'warning'}">${o.company?.status}</span></div>
        <div class="flex-between mb-8"><span class="muted">FYE</span><span>${o.company?.fye}</span></div>
        <div class="flex-between mb-8"><span class="muted">Capital</span><span>S$${fmt(o.company?.paid_up_capital)}</span></div>
        <div class="divider"></div>
        <h3>Shareholders</h3>
        ${o.persons.map(p => `
          <div class="flex-between mb-8">
            <div>
              <div>${esc(p.full_name)}</div>
              <div class="muted small">${p.nationality} · ${p.shares_held} shares</div>
            </div>
            <span class="badge badge-${p.kyc_session_id ? 'success' : 'warning'}">${p.kyc_session_id ? 'KYC ✓' : 'pending'}</span>
          </div>`).join('')}
      </div>
    </div>`;
}
window.advanceOrder = async (id) => {
  await api('/registration/orders/' + id + '/advance', { method: 'POST', body: {} });
  nav('order', { id });
};

// ================================================================================
// BOOKS
// ================================================================================
async function viewBooks() {
  const cid = state.company?.id;
  if (!cid) { $('#view').innerHTML = '<div class="empty">No active company. Register one first.</div>'; return; }
  const [txns, invoices, journals, coa] = await Promise.all([
    api('/books/transactions?company_id=' + cid),
    api('/books/invoices?company_id=' + cid),
    api('/books/journals?company_id=' + cid),
    api('/books/chart-of-accounts?company_id=' + cid)
  ]);
  const revenue = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const expenses = -txns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const pendingJ = journals.filter(j => j.review_status === 'pending').length;

  $('#view').innerHTML = `
    <h1 class="view-title">Books — ${esc(state.company.name)}</h1>
    <p class="view-sub">AI-generated journal entries (SFRS compliant). Review what matters; approve the rest in bulk.</p>

    <div class="grid grid-4 mb-20">
      <div class="card stat-card"><div class="stat-label">Revenue (YTD)</div><div class="stat-value">S$${fmt(revenue)}</div></div>
      <div class="card stat-card"><div class="stat-label">Expenses (YTD)</div><div class="stat-value">S$${fmt(expenses)}</div></div>
      <div class="card stat-card"><div class="stat-label">Net Profit</div><div class="stat-value" style="color:${revenue - expenses > 0 ? 'var(--success)' : 'var(--danger)'}">S$${fmt(revenue - expenses)}</div></div>
      <div class="card stat-card"><div class="stat-label">To Review</div><div class="stat-value">${pendingJ}</div><div class="stat-delta down">Journals pending</div></div>
    </div>

    <div class="card mb-20">
      <div class="flex-between mb-12">
        <h2>Quick Actions</h2>
      </div>
      <div class="flex">
        <button class="btn btn-primary" onclick="importDemoTxns()">📥 Import Demo Bank Statement</button>
        <button class="btn" onclick="uploadInvoice()">🧾 OCR an Invoice (Demo)</button>
        <button class="btn" onclick="autoJournalAll()">⚡ Auto-generate Journals for All</button>
        <button class="btn btn-success" onclick="runAllFlow()">🚀 一键生成全部报表 (TB/PL/BS/CF/SOCE/Notes/XBRL/ECI/CPF/GST)</button>
      </div>
    </div>

    <div class="card mb-20">
      <div class="flex-between mb-12">
        <h2>📤 本地文件上传 (AI 自动解析)</h2>
        <span class="small muted">支持 CSV / Excel / PDF / 图片 / TXT / MD · 最大 10MB</span>
      </div>
      <div class="grid grid-4">
        <div class="form-row"><label>文件类型</label>
          <select id="upKind">
            <option value="bank">🏦 银行流水 (CSV/Excel → transactions)</option>
            <option value="invoice">🧾 税务发票 (PDF/图片 → invoices)</option>
            <option value="rag">📚 知识文档 (PDF/MD/TXT → RAG)</option>
            <option value="report">📊 财务报表 (Excel/PDF → 参考)</option>
          </select>
        </div>
        <div class="form-row"><label>RAG 分层 (仅 rag 类型)</label>
          <select id="upLayer">
            <option value="L4_customer">L4_customer (客户专属)</option>
            <option value="L1_regulatory">L1_regulatory (法规)</option>
            <option value="L2_practice">L2_practice (实操 SOP)</option>
            <option value="L3_pricing">L3_pricing (定价)</option>
          </select>
        </div>
        <div class="form-row"><label>选择文件</label><input type="file" id="upFile" accept=".csv,.xlsx,.xls,.pdf,.txt,.md,.json,.png,.jpg,.jpeg" /></div>
        <div class="form-row"><label>&nbsp;</label><button class="btn btn-primary" onclick="uploadLocalFile()">⬆️ 上传并 AI 解析</button></div>
      </div>
      <div id="upResult" class="mt-12"></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>Transactions (${txns.length})</h2>
        <div class="table-wrap" style="max-height:420px;overflow:auto"><table>
          <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Action</th></tr></thead>
          <tbody>${txns.slice(0, 30).map(t => `
            <tr>
              <td class="mono small">${t.transaction_date}</td>
              <td class="small">${esc(t.description.slice(0, 30))}</td>
              <td class="mono small" style="color:${t.amount < 0 ? 'var(--danger)' : 'var(--success)'}">${t.amount < 0 ? '-' : '+'}${fmt(Math.abs(t.amount))}</td>
              <td>${t.journal_entry_id ?
                '<span class="badge badge-success">Posted</span>' :
                `<button class="btn btn-sm btn-primary" onclick="genJournal('${t.id}')">Generate JE</button>`}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <h2>Invoices (${invoices.length})</h2>
        <div class="table-wrap" style="max-height:420px;overflow:auto"><table>
          <thead><tr><th>Vendor</th><th>Total</th><th>GST</th><th>Confidence</th></tr></thead>
          <tbody>${invoices.map(i => `
            <tr>
              <td class="small">${esc(i.vendor_name)}</td>
              <td class="mono small">S$${fmt(i.total)}</td>
              <td class="mono small">S$${fmt(i.gst_amount)}</td>
              <td>${((i.ocr_confidence || 0) * 100).toFixed(0)}%</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>

    <div class="card mt-20">
      <h2>Journal Entries (${journals.length})</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Ref</th><th>Lines</th><th>Confidence</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${journals.slice(0, 15).map(j => `
          <tr>
            <td class="mono small">${j.entry_date}</td>
            <td class="mono small">${esc(j.reference)}</td>
            <td class="small">${j.lines.map(l => `${l.account_code}: ${l.debit ? 'Dr ' + fmt(l.debit) : 'Cr ' + fmt(l.credit)}`).join(' · ')}</td>
            <td>${((j.ai_confidence || 0) * 100).toFixed(0)}%</td>
            <td><span class="badge badge-${j.review_status === 'approved' ? 'success' : 'warning'}">${j.review_status}</span></td>
            <td>${j.review_status === 'pending' ? `<button class="btn btn-sm" onclick="approveJ('${j.id}')">Approve</button>` : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
}
window.importDemoTxns = async () => {
  const fd = new FormData();
  fd.append('company_id', state.company.id);
  fd.append('bank_code', 'DBS');
  const r = await fetch('/api/books/transactions/import', { method: 'POST', body: fd });
  const j = await r.json();
  alert(`Imported ${j.imported} transactions`);
  viewBooks();
};
window.uploadInvoice = async () => {
  const r = await api('/books/invoices/ocr', { method: 'POST', body: { company_id: state.company.id } });
  alert(`OCR complete: ${r.vendor_name}, S$${r.total} (confidence ${(r.confidence * 100).toFixed(0)}%)`);
  viewBooks();
};
window.genJournal = async (tid) => {
  const r = await api('/books/journals/auto', { method: 'POST', body: { company_id: state.company.id, transaction_id: tid } });
  alert(`Journal generated (confidence ${(r.confidence * 100).toFixed(0)}%): ${r.reasoning}`);
  viewBooks();
};
window.uploadLocalFile = async () => {
  const fileEl = document.getElementById('upFile');
  const f = fileEl?.files?.[0];
  if (!f) { alert('请先选择文件'); return; }
  const kind = document.getElementById('upKind').value;
  const layer = document.getElementById('upLayer').value;
  const box = document.getElementById('upResult');
  box.innerHTML = `<div class="muted small">⏳ 正在上传并 AI 解析 <b>${esc(f.name)}</b> (${(f.size/1024).toFixed(1)} KB)...</div>`;
  const fd = new FormData();
  fd.append('file', f);
  fd.append('kind', kind);
  fd.append('layer', layer);
  fd.append('company_id', state.company.id);
  try {
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) { box.innerHTML = `<div class="badge badge-danger">❌ ${esc(j.error || '上传失败')}</div>`; return; }
    let html = `<div class="badge badge-success">✅ 上传成功</div> <span class="small mono">${esc(f.name)} · ${j.file?.format || ''}</span>`;
    if (kind === 'bank') html += `<div class="mt-8 small">📥 入账 <b>${j.imported}</b> 笔交易，示例：<code class="mono small">${esc(JSON.stringify(j.sample?.slice(0,3) || []))}</code></div>`;
    if (kind === 'invoice') html += `<div class="mt-8 small">🧾 发票识别：供应商 <b>${esc(j.invoice?.vendor_name || '-')}</b>，金额 S$${fmt(j.invoice?.total || 0)}，GST S$${fmt(j.invoice?.gst_amount || 0)}，置信度 ${((j.invoice?.confidence || 0)*100).toFixed(0)}%</div>`;
    if (kind === 'rag') html += `<div class="mt-8 small">📚 已入库到 <b>${esc(layer)}</b>，docId=<code class="mono">${esc(j.docId || '')}</code>，切分 ${j.chunks || 0} chunks / ${j.chars || 0} 字符</div>`;
    if (kind === 'report') html += `<div class="mt-8 small">📊 报表已解析：${j.rows || 0} 行 · ${j.sheets || 0} sheet</div>`;
    box.innerHTML = html;
    if (kind === 'bank' || kind === 'invoice') setTimeout(() => viewBooks(), 1500);
  } catch (e) { box.innerHTML = `<div class="badge badge-danger">❌ ${esc(e.message)}</div>`; }
};
window.runAllFlow = async () => {
  if (!confirm('将运行全部 11 步：自动过账 → TB → P&L → BS → CF → SOCE → Notes → XBRL → ECI → CPF → GST F5\n继续？')) return;
  const btn = event.target; btn.disabled = true; btn.textContent = '⏳ 生成中...';
  try {
    const today = new Date().toISOString().slice(0,10);
    const r = await api('/flow/run-all', { method: 'POST', body: { company_id: state.company.id, from: '2025-01-01', to: today } });
    if (!r.ok) { alert('❌ 失败: ' + (r.error || '未知错误')); return; }
    const s = r.summary || {};
    const trace = (r.trace || []).map(t => `${t.ok ? '✅' : '❌'} ${t.step}`).join(' · ');
    alert(`🚀 全流程完成 (${r.latency_ms || 0}ms)\n\n` +
      `📊 新增分录: ${s.journals_posted || 0}\n` +
      `⚖️ TB 平衡: ${s.tb_balanced ? '✓' : '✗'} | BS 平衡: ${s.bs_balanced ? '✓' : '✗'}\n` +
      `💰 营收: S$${fmt(s.revenue || 0)} | 净利: S$${fmt(s.net_profit || 0)}\n` +
      `🏦 资产: S$${fmt(s.total_assets || 0)} | 期末现金: S$${fmt(s.cash_at_end || 0)}\n` +
      `📁 XBRL: ${s.xbrl_elements || 0} 元素\n` +
      `💸 ECI 应纳税: S$${fmt(s.eci_tax_payable || 0)}\n` +
      `👥 CPF 月度: S$${fmt(s.cpf_total || 0)}\n` +
      `🧾 GST F5 净应付: S$${fmt(s.gst_net || 0)}\n\n` +
      `执行轨迹:\n${trace}`);
    viewBooks();
  } catch (e) { alert('❌ ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '🚀 一键生成全部报表 (TB/PL/BS/CF/SOCE/Notes/XBRL/ECI/CPF/GST)'; }
};
window.autoJournalAll = async () => {
  const txns = await api('/books/transactions?company_id=' + state.company.id);
  const uncategorised = txns.filter(t => !t.journal_entry_id).slice(0, 10);
  for (const t of uncategorised) {
    await api('/books/journals/auto', { method: 'POST', body: { company_id: state.company.id, transaction_id: t.id } });
  }
  alert(`Generated ${uncategorised.length} journal entries`);
  viewBooks();
};
window.approveJ = async (id) => { await api('/books/journals/' + id + '/approve', { method: 'POST', body: {} }); viewBooks(); };

// ================================================================================
// TAX
// ================================================================================
async function viewTax() {
  const cid = state.company?.id;
  const [reminders, filings] = await Promise.all([
    api('/tax/reminders?company_id=' + (cid || '')),
    api('/tax/filings?company_id=' + (cid || ''))
  ]);

  $('#view').innerHTML = `
    <h1 class="view-title">Tax Agent — ECI, Form C-S, GST</h1>
    <p class="view-sub">Singapore tax framework: 17% corporate rate, SUTR for first 3 YAs, PTE thereafter. CSP licensed reviewer signs off before submission.</p>

    <div class="grid grid-3 mb-20">
      ${reminders.map(r => {
        const due = new Date(r.due_date);
        const days = Math.ceil((due - new Date()) / (1000 * 86400));
        return `<div class="card" style="border-left:4px solid ${days < 14 ? 'var(--danger)' : 'var(--warning)'}">
          <div class="flex-between">
            <h3>${r.type} Filing</h3>
            <span class="badge badge-${days < 14 ? 'danger' : 'warning'}">D-${days}</span>
          </div>
          <div class="muted small">Due ${r.due_date}</div>
        </div>`;
      }).join('') || '<div class="card empty">No upcoming deadlines</div>'}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>ECI Calculator</h2>
        <p class="muted small mb-16">Estimated Chargeable Income — due within 3 months of FYE (unless waiver applies).</p>
        <div class="form-row"><label>Annual Revenue (SGD)</label><input id="revenue" type="number" value="500000" /></div>
        <div class="form-row"><label>Total Expenses (SGD)</label><input id="expenses" type="number" value="300000" /></div>
        <div class="form-row"><label><input id="sutr" type="checkbox" checked /> Qualify for Start-Up Tax Exemption (SUTR) — first 3 YAs</label></div>
        <button class="btn btn-primary" onclick="computeECI()">Compute ECI</button>
        <div id="eciResult" class="mt-16"></div>
      </div>
      <div class="card">
        <h2>Form C-S Draft</h2>
        <p class="muted small mb-16">Simplified corporate tax return. Eligible: revenue ≤ S$5M, 100% SG-tax resident.</p>
        <button class="btn btn-primary" onclick="draftFormCS()">🪄 Draft Form C-S</button>
        <div id="formCSResult" class="mt-16"></div>
      </div>
    </div>

    <div class="card mt-20">
      <h2>Tax Filings History</h2>
      ${filings.length === 0 ? '<div class="empty">No filings yet</div>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>YA</th><th>Revenue</th><th>Chargeable</th><th>Tax Payable</th><th>Status</th></tr></thead>
        <tbody>${filings.map(f => `
          <tr>
            <td><strong>${f.filing_type}</strong></td>
            <td>${f.ya}</td>
            <td class="mono small">S$${fmt(f.revenue)}</td>
            <td class="mono small">S$${fmt(f.chargeable_income)}</td>
            <td class="mono small" style="color:var(--danger)">S$${fmt(f.tax_payable)}</td>
            <td><span class="badge badge-${f.status === 'submitted' ? 'success' : 'warning'}">${f.status}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>`;
}
window.computeECI = async () => {
  $('#eciResult').innerHTML = '<div class="muted">Computing...</div>';
  const r = await api('/tax/eci/compute', {
    method: 'POST',
    body: {
      company_id: state.company?.id,
      revenue: +$('#revenue').value,
      expenses: +$('#expenses').value,
      sutr_eligible: $('#sutr').checked
    }
  });
  $('#eciResult').innerHTML = `
    <div class="card" style="background:var(--surface-2)">
      <div class="flex-between mb-8"><strong>ECI Estimate</strong><span class="badge badge-info">${r.scheme}</span></div>
      <div class="flex-between mb-8"><span>Net Profit</span><strong>S$${fmt(r.net_profit)}</strong></div>
      <div class="flex-between mb-8"><span>Chargeable Income</span><strong>S$${fmt(r.chargeable_income)}</strong></div>
      <div class="flex-between mb-8"><span>Exemption</span><strong style="color:var(--success)">-S$${fmt(r.exempt_amount)}</strong></div>
      <div class="flex-between mb-8"><span>Taxable Income</span><strong>S$${fmt(r.taxable_income)}</strong></div>
      <div class="flex-between" style="font-size:18px"><strong>Tax Payable (17%)</strong><strong style="color:var(--danger)">S$${fmt(r.tax_payable)}</strong></div>
      <div class="divider"></div>
      <div class="small muted">Effective rate: ${r.effective_rate}% · Filing deadline: ${r.deadline} · AI confidence: ${(r.confidence * 100).toFixed(0)}%</div>
    </div>`;
};
window.draftFormCS = async () => {
  $('#formCSResult').innerHTML = '<div class="muted">Drafting...</div>';
  const r = await api('/tax/form-cs/draft', { method: 'POST', body: { company_id: state.company?.id, ya: new Date().getFullYear() + 1 } });
  $('#formCSResult').innerHTML = `
    <div class="card" style="background:var(--surface-2)">
      <div class="flex-between mb-8"><strong>${r.form_type} — ${esc(r.company || 'Company')}</strong><span class="badge badge-${r.eligibility === 'Eligible' ? 'success' : 'warning'}">${r.eligibility}</span></div>
      <div class="small muted mb-8">YA ${r.ya}</div>
      <div class="flex-between mb-8"><span>Revenue</span><strong>S$${fmt(r.revenue)}</strong></div>
      <div class="flex-between mb-8"><span>Chargeable Income</span><strong>S$${fmt(r.chargeable_income)}</strong></div>
      <div class="flex-between"><span>Tax Payable</span><strong>S$${fmt(r.tax_payable)}</strong></div>
      <button class="btn btn-primary mt-12">📥 Download Draft PDF</button>
    </div>`;
};

// ================================================================================
// SECRETARY
// ================================================================================
async function viewSecretary() {
  $('#view').innerHTML = `
    <h1 class="view-title">Corporate Secretary</h1>
    <p class="view-sub">AGM, Annual Return, board resolutions — handled by Secretary Agent with CSP review.</p>
    <div class="grid grid-2">
      <div class="card">
        <h2>Generate Board Resolution</h2>
        <div class="form-row"><label>Subject</label>
          <select id="resSubject">
            <option>Approval of annual financial statements</option>
            <option>Appointment of new director</option>
            <option>Change of registered office</option>
            <option>Declaration of dividend</option>
            <option>Opening of bank account</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="genResolution()">🪄 Draft Resolution</button>
        <div id="resOut" class="mt-16"></div>
      </div>
      <div class="card">
        <h2>Annual Return Status</h2>
        <div class="flex-between mb-8"><span>Last AR filed</span><strong>Pending first filing</strong></div>
        <div class="flex-between mb-8"><span>AGM held</span><span class="badge badge-warning">Not yet</span></div>
        <div class="flex-between mb-8"><span>FYE</span><strong>${state.company?.fye || 'N/A'}</strong></div>
        <div class="flex-between mb-16"><span>Next AR due</span><strong>7 months after FYE</strong></div>
        <button class="btn btn-primary">📂 Prepare AR via BizFile+</button>
      </div>
    </div>
    <div class="card mt-20">
      <h2>Statutory Registers</h2>
      <div class="grid grid-3">
        ${['Register of Members (ROM)', 'Register of Directors (ROD)', 'Register of Controllers (ROC)'].map(r => `
          <div class="card" style="background:var(--surface-2)">
            <h3>${r}</h3>
            <div class="muted small mb-12">Maintained in real-time from ACRA data.</div>
            <button class="btn btn-sm">View</button>
          </div>`).join('')}
      </div>
    </div>`;
}
window.genResolution = async () => {
  const subject = $('#resSubject').value;
  $('#resOut').innerHTML = '<div class="muted">Drafting...</div>';
  const r = await api('/chat/send', {
    method: 'POST',
    body: { message: `Draft a board resolution: ${subject}`, company_id: state.company?.id, user_id: state.user?.id }
  });
  const action = (r.response.actions || []).find(a => a.tool === 'resolution_draft');
  if (action) {
    const res = action.result;
    $('#resOut').innerHTML = `
      <div class="card" style="background:var(--surface-2)">
        <strong>${esc(res.title)}</strong>
        <div class="small mt-8">${esc(res.body)}</div>
        <div class="divider"></div>
        <div class="small muted">Date: ${res.date} · Signatories: ${res.signatories.join(', ')}</div>
      </div>`;
  } else {
    $('#resOut').innerHTML = `<div class="card">${esc(r.response.summary || '')}</div>`;
  }
};

// ================================================================================
// CHAT
// ================================================================================
async function viewChat() {
  const sessions = await api('/chat/sessions?user_id=' + (state.user?.id || 'usr_demo_001'));
  $('#view').innerHTML = `
    <div class="chat-wrap">
      <aside class="chat-sidebar">
        <button class="btn btn-primary" style="width:100%" onclick="newChat()">+ New Chat</button>
        <div class="divider"></div>
        <div id="sessList">
          ${sessions.map(s => `<div class="chat-session-item ${s.id === state.session_id ? 'active' : ''}" onclick="loadSess('${s.id}')">${esc(s.title || s.id)}</div>`).join('')}
        </div>
      </aside>
      <section class="chat-main">
        <div class="flex-between" style="padding:8px 12px;border-bottom:1px solid var(--border,#eee);background:#fafafa">
          <div class="small muted">💬 真实 GPT 对话 · 自动引用 4 层 RAG 知识库 · 新加坡合规法规精准回答</div>
          <label class="small" style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="chatAiMode" checked /> 🤖 AI 模式 (gpt-5-mini)
          </label>
        </div>
        <div id="chatMessages" class="chat-messages"></div>
        <div class="chat-input">
          <input id="chatBox" placeholder="问我任何新加坡公司问题：注册、税务、CPF、GST、审计、法规..." onkeydown="if(event.key==='Enter')sendChat()"/>
          <button class="btn btn-primary" onclick="sendChat()">Send</button>
        </div>
      </section>
    </div>`;
  if (!state.session_id && sessions.length) loadSess(sessions[0].id);
  else renderChatEmpty();
}
function renderChatEmpty() {
  $('#chatMessages').innerHTML = `
    <div class="empty">
      <h2 style="margin-bottom:12px">How can AiCFO help today?</h2>
      <div class="grid grid-2" style="text-align:left;margin-top:20px">
        ${[
          { q: 'Can I register "Bank of Skyhawk Pte Ltd"?', icon: '🏢' },
          { q: 'What\'s my ECI for revenue S$500K and expenses S$300K?', icon: '📊' },
          { q: 'OCR my AWS invoice and generate a journal entry', icon: '🧾' },
          { q: 'How much does a Web3 company registration cost?', icon: '💰' }
        ].map(e => `
          <div class="card" style="cursor:pointer" onclick="document.getElementById('chatBox').value='${esc(e.q)}';sendChat()">
            <div style="font-size:22px;margin-bottom:6px">${e.icon}</div>
            <div class="small">${esc(e.q)}</div>
          </div>`).join('')}
      </div>
    </div>`;
}
window.newChat = async () => {
  const r = await api('/chat/sessions', { method: 'POST', body: { user_id: state.user?.id, company_id: state.company?.id, title: 'New Chat' } });
  state.session_id = r.session_id;
  viewChat();
};
window.loadSess = async (sid) => {
  state.session_id = sid;
  const msgs = await api('/chat/sessions/' + sid + '/messages');
  document.querySelectorAll('.chat-session-item').forEach(e => e.classList.remove('active'));
  $('#chatMessages').innerHTML = msgs.map(renderMsg).join('') || '<div class="empty">No messages yet</div>';
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
};
function renderMsg(m) {
  const meta = m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : {};
  const actions = (meta.actions || []).map(a => `<div class="tool-call">🔧 <strong>${a.tool}</strong> · ${esc(JSON.stringify(a.result).slice(0, 100))}...</div>`).join('');
  const cits = (meta.rag_citations || []).slice(0, 2).map(c => `<div class="citation">📚 ${esc(c.title)} (${c.source}) · score ${c.score.toFixed(2)}</div>`).join('');
  return `
    <div class="msg ${m.role}">
      <div class="avatar">${m.role === 'user' ? 'U' : 'AI'}</div>
      <div class="body">
        <div class="bubble">${esc(m.content)}</div>
        ${actions ? `<div class="actions">${actions}</div>` : ''}
        ${cits}
        ${meta.intent ? `<div class="meta"><span class="badge badge-info">${meta.intent}</span>${meta.confidence ? `<span>conf ${(meta.confidence * 100).toFixed(0)}%</span>` : ''}${meta.need_human ? '<span class="badge badge-warning">Human review</span>' : ''}</div>` : ''}
      </div>
    </div>`;
}
window.sendChat = async () => {
  const msg = $('#chatBox').value.trim();
  if (!msg) return;
  $('#chatBox').value = '';
  $('#chatMessages').innerHTML += `<div class="msg user"><div class="avatar">U</div><div class="body"><div class="bubble">${esc(msg)}</div></div></div>`;
  $('#chatMessages').innerHTML += `<div class="msg assistant" id="thinking"><div class="avatar">AI</div><div class="body"><div class="bubble muted">Thinking...</div></div></div>`;
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  const useAI = document.getElementById('chatAiMode')?.checked !== false;
  const r = await api('/chat/send', { method: 'POST', body: { session_id: state.session_id, message: msg, user_id: state.user?.id, company_id: state.company?.id, mode: useAI ? 'ai' : 'orchestrator' } });
  state.session_id = r.session_id;
  document.getElementById('thinking')?.remove();
  // AI 模式: { reply, citations, model, latency_ms }
  // orchestrator 模式: { response: { summary, actions }, intent, confidence, need_human, rag_citations }
  const content = r.reply || (typeof r.response === 'string' ? r.response : (r.response?.summary || r.response?.content || 'Done.'));
  const cits = r.citations || r.rag_citations || r.response?.citations || [];
  const meta = {
    intent: r.intent || r.mode || (useAI ? 'ai_chat' : 'orchestrator'),
    confidence: r.confidence,
    need_human: r.need_human,
    rag_citations: cits,
    actions: r.response?.actions || r.actions,
    model: r.model,
    latency_ms: r.latency_ms
  };
  $('#chatMessages').innerHTML += renderMsg({ role: 'assistant', content, metadata: meta });
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
};

// ================================================================================
// PRICING
// ================================================================================
async function viewPricing() {
  $('#view').innerHTML = `
    <h1 class="view-title">Pricing — Transparent, Dynamic, 70% Lower Than Incumbents</h1>
    <p class="view-sub">Pricing Agent uses 4-factor RAG (competitor scrape + historical deals + complexity + region).</p>

    <div class="card mb-20">
      <h2>Instant Quote</h2>
      <div class="grid grid-4">
        <div class="form-row"><label>Segment</label>
          <select id="pricingSegment">
            <option value="local_sg">Local SG SME</option>
            <option value="china_outbound">China Outbound</option>
            <option value="web3">Web3 / Crypto</option>
            <option value="family_office">Family Office</option>
          </select>
        </div>
        <div class="form-row"><label>Shareholders</label><input id="pricingSh" type="number" value="2" /></div>
        <div class="form-row"><label>Monthly Transactions</label><input id="pricingTxn" type="number" value="200" /></div>
        <div class="form-row"><label>Urgency</label>
          <select id="pricingUrgency">
            <option value="standard">Standard</option>
            <option value="rush">Rush</option>
            <option value="express">Express</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" onclick="genQuote()">🪄 Generate Quote</button>
    </div>

    <div id="quoteOut"></div>
  `;
  genQuote();
}
window.genQuote = async () => {
  const r = await api('/pricing/quote', {
    method: 'POST',
    body: {
      service: 'registration',
      segment: $('#pricingSegment').value,
      shareholders: +$('#pricingSh').value,
      cross_border: $('#pricingSegment').value !== 'local_sg' ? 1 : 0,
      monthly_txn: +$('#pricingTxn').value,
      urgency: $('#pricingUrgency').value
    }
  });
  $('#quoteOut').innerHTML = `
    <div class="grid grid-3">
      <div class="price-card">
        <div class="tier-name">Basic 🚀</div>
        <div class="price"><span class="currency">S$</span>${fmt(r.basic)}</div>
        <div class="price-period">per year · AI full-auto</div>
        <ul>
          <li>Registration + Secretary</li>
          <li>Bookkeeping (500 txn/mo)</li>
          <li>ECI + Form C-S</li>
          <li>GST quarterly</li>
          <li class="no">Web3 handling</li>
          <li class="no">Dedicated CFO</li>
        </ul>
        <button class="btn" style="width:100%">Select Basic</button>
      </div>
      <div class="price-card featured">
        <div class="tier-name">Pro ⭐️</div>
        <div class="price"><span class="currency">S$</span>${fmt(r.pro)}</div>
        <div class="price-period">per year · AI + Human review</div>
        <ul>
          <li>Everything in Basic</li>
          <li>Quarterly CSP review</li>
          <li>Tax optimization advice</li>
          <li>Web3 token accounting</li>
          <li>1h CFO consult/month</li>
          <li class="no">Unlimited CFO hours</li>
        </ul>
        <button class="btn btn-primary" style="width:100%">Select Pro</button>
      </div>
      <div class="price-card">
        <div class="tier-name">Enterprise 👑</div>
        <div class="price"><span class="currency">S$</span>${fmt(r.enterprise)}</div>
        <div class="price-period">per year · White-glove</div>
        <ul>
          <li>Everything in Pro</li>
          <li>Cross-border structuring</li>
          <li>MAS DPT licence support</li>
          <li>13O/13U family office</li>
          <li>Unlimited CFO consults</li>
          <li>DD / audit support</li>
        </ul>
        <button class="btn" style="width:100%">Contact Sales</button>
      </div>
    </div>
    <div class="card mt-20">
      <h3>Pricing Factors (transparency)</h3>
      <div class="small mono muted">Median base: S$${fmt(r.factors.median)} × complexity ${r.factors.multiplier.toFixed(2)} × region ${r.factors.regionPremium.toFixed(2)} × urgency ${r.factors.urgencyPremium.toFixed(2)}</div>
    </div>`;
};

// ================================================================================
// FINANCIAL REPORTS — Full SFRS package viewer
// ================================================================================
const reportsState = { from: '2025-01-01', to: '2025-11-30', pack: null, tab: 'pnl' };

async function viewReports() {
  const cid = state.company?.id;
  if (!cid) { $('#view').innerHTML = '<div class="empty">No active company.</div>'; return; }
  $('#view').innerHTML = `
    <h1 class="view-title">${t('reports.title')}</h1>
    <p class="view-sub">${t('reports.sub')}</p>

    <div class="card mb-20">
      <div class="grid grid-4">
        <div class="form-row"><label>${t('reports.from')}</label><input id="repFrom" type="date" value="${reportsState.from}"/></div>
        <div class="form-row"><label>${t('reports.to')}</label><input id="repTo" type="date" value="${reportsState.to}"/></div>
        <div class="form-row"><label>&nbsp;</label><button class="btn btn-primary" onclick="loadReports()">${t('reports.generate')}</button></div>
        <div class="form-row"><label>&nbsp;</label><button class="btn" onclick="seedYTD()">${t('reports.seed')}</button></div>
      </div>
    </div>

    <div id="repTabs" class="flex mb-16" style="gap:6px;flex-wrap:wrap"></div>
    <div id="repBody">
      <div class="card empty">${t('common.loading')}</div>
    </div>
  `;
  loadReports();
}

window.seedYTD = async () => {
  const btn = event.target; const orig = btn.textContent; btn.textContent = '⏳ ' + t('common.loading'); btn.disabled = true;
  try {
    const r = await api('/simulation/seed-ytd', { method: 'POST', body: { company_id: state.company.id, year: 2025, end_month: 11 } });
    await api('/finance/post-journals?company_id=' + state.company.id, { method: 'POST', body: {} });
    alert(`✓ Seeded ${r.inserted_transactions} txns, ${r.inserted_invoices} invoices · Rev S$${fmt(r.preview.revenue)}`);
    loadReports();
  } catch (e) { alert('Seed failed: ' + e.message); }
  btn.textContent = orig; btn.disabled = false;
};

window.loadReports = async () => {
  reportsState.from = $('#repFrom')?.value || reportsState.from;
  reportsState.to = $('#repTo')?.value || reportsState.to;
  $('#repBody').innerHTML = `<div class="card empty">${t('common.loading')}</div>`;
  const pack = await api(`/finance/full-package?company_id=${state.company.id}&from=${reportsState.from}&to=${reportsState.to}`);
  reportsState.pack = pack;
  const tabs = [
    { k: 'pnl', label: t('reports.tab_pnl') },
    { k: 'bs', label: t('reports.tab_bs') },
    { k: 'cf', label: t('reports.tab_cf') },
    { k: 'soce', label: t('reports.tab_soce') },
    { k: 'tb', label: t('reports.tab_tb') },
    { k: 'notes', label: t('reports.tab_notes') },
    { k: 'xbrl', label: t('reports.tab_xbrl') }
  ];
  $('#repTabs').innerHTML = tabs.map(tb =>
    `<button class="btn btn-sm ${reportsState.tab === tb.k ? 'btn-primary' : ''}" onclick="switchRepTab('${tb.k}')">${tb.label}</button>`
  ).join('');
  renderRepTab();
};

window.switchRepTab = (k) => { reportsState.tab = k; loadReports(); };

function renderRepTab() {
  const p = reportsState.pack; if (!p) return;
  const body = {
    pnl: renderPnL, bs: renderBS, cf: renderCF, soce: renderSoCE, tb: renderTB, notes: renderNotes, xbrl: renderXBRL
  }[reportsState.tab]();
  $('#repBody').innerHTML = body;
}

function renderPnL() {
  const p = reportsState.pack.profit_and_loss;
  const row = (lbl, amt, bold, color) => `<tr style="${bold ? 'font-weight:700;border-top:1px solid var(--border)' : ''}"><td>${lbl}</td><td class="mono" style="text-align:right;color:${color || 'inherit'}">${amt >= 0 ? '' : '-'}S$${fmt(Math.abs(amt))}</td></tr>`;
  const rb = p.revenue_breakdown.map(r => `<tr><td class="muted small" style="padding-left:20px">${esc(r.account)}</td><td class="mono small" style="text-align:right">S$${fmt(r.amount)}</td></tr>`).join('');
  const eb = p.expense_breakdown.map(r => `<tr><td class="muted small" style="padding-left:20px">${esc(r.account)}</td><td class="mono small" style="text-align:right">S$${fmt(r.amount)}</td></tr>`).join('');
  return `
    <div class="card">
      <div class="flex-between mb-12"><h2>${t('reports.tab_pnl')} · ${reportsState.from} → ${reportsState.to}</h2>
        <span class="badge badge-info">SFRS-SE</span></div>
      <table style="width:100%"><tbody>
        ${row(t('reports.revenue'), p.revenue, true)} ${rb}
        ${row(t('reports.cogs'), -p.cogs)}
        ${row(t('reports.gross_profit'), p.gross_profit, true, 'var(--success)')}
        <tr><td class="muted small">${t('reports.gross_margin')}</td><td class="mono small" style="text-align:right">${p.gross_margin}%</td></tr>
        ${row(t('reports.staff'), -p.staff_costs)}
        ${row(t('reports.opex'), -p.other_operating_expenses)} ${eb}
        ${row(t('reports.op_profit'), p.operating_profit, true)}
        ${row(t('reports.pbt'), p.profit_before_tax, true)}
        ${row(t('reports.tax'), -(p.tax_expense || 0))}
        ${row(t('reports.net_profit'), p.net_profit_after_tax, true, p.net_profit_after_tax > 0 ? 'var(--success)' : 'var(--danger)')}
        <tr><td class="muted small">${t('reports.net_margin')}</td><td class="mono small" style="text-align:right">${p.net_margin}%</td></tr>
      </tbody></table>
    </div>`;
}

function renderBS() {
  const b = reportsState.pack.balance_sheet;
  const list = (arr) => arr.map(a => `<tr><td class="muted small" style="padding-left:20px">${a.code} ${esc(a.name)}</td><td class="mono small" style="text-align:right">S$${fmt(a.amount)}</td></tr>`).join('');
  return `
    <div class="grid grid-2">
      <div class="card">
        <h2>${t('reports.tab_bs')} · as of ${reportsState.to}</h2>
        <h3 class="mt-12">${t('reports.current_assets')}</h3>
        <table style="width:100%"><tbody>${list(b.current_assets)}</tbody></table>
        <h3 class="mt-12">${t('reports.non_current_assets')}</h3>
        <table style="width:100%"><tbody>${list(b.non_current_assets)}</tbody></table>
        <div class="divider"></div>
        <div class="flex-between"><strong>${t('reports.total_assets')}</strong><strong class="mono">S$${fmt(b.totals.total_assets)}</strong></div>
      </div>
      <div class="card">
        <h3>${t('reports.current_liab')}</h3>
        <table style="width:100%"><tbody>${list(b.current_liabilities)}</tbody></table>
        <h3 class="mt-12">${t('reports.non_current_liab')}</h3>
        <table style="width:100%"><tbody>${list(b.non_current_liabilities)}</tbody></table>
        <div class="flex-between mt-8"><strong>${t('reports.total_liab')}</strong><strong class="mono">S$${fmt(b.totals.total_liabilities)}</strong></div>
        <h3 class="mt-12">${t('reports.equity')}</h3>
        <table style="width:100%"><tbody>${list(b.equity)}</tbody></table>
        <div class="flex-between mt-8"><strong>${t('reports.total_equity')}</strong><strong class="mono">S$${fmt(b.totals.total_equity)}</strong></div>
        <div class="divider"></div>
        <div class="flex-between"><span class="badge badge-${Math.abs((b.totals.total_assets||0) - (b.totals.total_liabilities_and_equity||((b.totals.total_liabilities||0)+(b.totals.total_equity||0)))) < 0.5 ? 'success' : 'danger'}">${Math.abs((b.totals.total_assets||0) - (b.totals.total_liabilities_and_equity||((b.totals.total_liabilities||0)+(b.totals.total_equity||0)))) < 0.5 ? t('reports.balanced') : '⚠ Unbalanced'}</span></div>
        <div class="grid grid-2 mt-12">
          <div class="stat-card"><div class="stat-label">${t('reports.current_ratio')}</div><div class="stat-value">${b.ratios.current_ratio}</div></div>
          <div class="stat-card"><div class="stat-label">${t('reports.debt_equity')}</div><div class="stat-value">${b.ratios.debt_to_equity}</div></div>
        </div>
      </div>
    </div>`;
}

function renderCF() {
  const cf = reportsState.pack.cash_flow_statement;
  const line = (a) => `<tr><td class="muted small" style="padding-left:20px">${esc(a.label)}</td><td class="mono small" style="text-align:right">${a.amount >= 0 ? '' : '-'}S$${fmt(Math.abs(a.amount))}</td></tr>`;
  return `
    <div class="card">
      <h2>${t('reports.tab_cf')} · ${reportsState.from} → ${reportsState.to}</h2>
      <h3 class="mt-12">${t('reports.op_activities')}</h3>
      <table style="width:100%"><tbody>${(cf.operating_activities || []).map(line).join('')}</tbody></table>
      <h3 class="mt-12">${t('reports.inv_activities')}</h3>
      <table style="width:100%"><tbody>${(cf.investing_activities || []).map(line).join('')}</tbody></table>
      <h3 class="mt-12">${t('reports.fin_activities')}</h3>
      <table style="width:100%"><tbody>${(cf.financing_activities || []).map(line).join('')}</tbody></table>
      <div class="divider"></div>
      <div class="flex-between"><strong>${t('reports.net_cash')}</strong><strong class="mono">S$${fmt(cf.net_change_in_cash || 0)}</strong></div>
      <div class="flex-between mt-8"><span class="muted small">Opening Cash</span><span class="mono small">S$${fmt(cf.cash_at_beginning || cf.opening_cash || 0)}</span></div>
      <div class="flex-between"><span class="muted small">Closing Cash</span><span class="mono small">S$${fmt(cf.cash_at_end || cf.closing_cash || 0)}</span></div>
    </div>`;
}

function renderSoCE() {
  const s = reportsState.pack.statement_of_changes_in_equity;
  return `
    <div class="card">
      <h2>${t('reports.tab_soce')}</h2>
      <table style="width:100%"><thead><tr><th></th><th style="text-align:right">Share Capital</th><th style="text-align:right">Retained Earnings</th><th style="text-align:right">${t('common.total')}</th></tr></thead>
      <tbody>
        ${(s.rows || []).map(r => `<tr><td>${esc(r.label)}</td><td class="mono small" style="text-align:right">S$${fmt(r.share_capital)}</td><td class="mono small" style="text-align:right">S$${fmt(r.retained_earnings)}</td><td class="mono" style="text-align:right"><strong>S$${fmt(r.total)}</strong></td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

function renderTB() {
  const tb = reportsState.pack.trial_balance;
  return `
    <div class="card">
      <h2>${t('reports.tab_tb')} · ${reportsState.from} → ${reportsState.to}</h2>
      <table style="width:100%"><thead><tr><th>Code</th><th>Account</th><th style="text-align:right">${t('reports.debit')}</th><th style="text-align:right">${t('reports.credit')}</th><th style="text-align:right">Net</th></tr></thead>
      <tbody>${(tb.rows || []).map(r => `
        <tr><td class="mono small">${r.code}</td><td class="small">${esc(r.name)}</td>
        <td class="mono small" style="text-align:right">${r.debit ? 'S$' + fmt(r.debit) : '—'}</td>
        <td class="mono small" style="text-align:right">${r.credit ? 'S$' + fmt(r.credit) : '—'}</td>
        <td class="mono small" style="text-align:right">${r.net >= 0 ? '' : '-'}S$${fmt(Math.abs(r.net))}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr style="font-weight:700;border-top:2px solid var(--border)"><td colspan="2">${t('common.total')}</td>
        <td class="mono" style="text-align:right">S$${fmt(tb.totals?.debit || 0)}</td>
        <td class="mono" style="text-align:right">S$${fmt(tb.totals?.credit || 0)}</td>
        <td><span class="badge badge-${tb.totals?.balanced ? 'success' : 'danger'}">${tb.totals?.balanced ? '✓' : '⚠'}</span></td></tr></tfoot>
      </table>
    </div>`;
}

function renderNotes() {
  const n = reportsState.pack.notes_to_financial_statements;
  const arr = Array.isArray(n) ? n : (n.notes || []);
  const lang = (window.I18N && window.I18N.getLocale && window.I18N.getLocale() === 'zh') ? 'cn' : 'en';
  return `
    <div class="card">
      <h2>${t('reports.tab_notes')}</h2>
      ${arr.map((nt, i) => {
        const num = nt.num || nt.number || (i + 1);
        const title = lang === 'cn' && nt.title_cn ? nt.title_cn : nt.title;
        const body = lang === 'cn' && nt.body_cn ? nt.body_cn : (nt.body || nt.content || '');
        return `<details ${i < 2 ? 'open' : ''} class="mb-8" style="background:var(--surface-2);padding:12px;border-radius:8px">
          <summary style="cursor:pointer;font-weight:600">Note ${num}. ${esc(title)}</summary>
          <div class="small mt-8">${esc(body)}</div>
        </details>`;
      }).join('')}
    </div>`;
}

function renderXBRL() {
  const x = reportsState.pack.xbrl_simplified;
  const entries = Object.entries(x.elements || x.tags || x);
  return `
    <div class="card">
      <div class="flex-between mb-12"><h2>${t('reports.tab_xbrl')} · ACRA Simplified</h2>
        <button class="btn btn-sm" onclick="downloadJSON('xbrl-${state.company.id}.json', JSON.stringify(reportsState.pack.xbrl_simplified, null, 2))">${t('reports.download_xbrl')}</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tag</th><th style="text-align:right">Value</th></tr></thead>
        <tbody>${entries.slice(0, 40).map(([k, v]) => `<tr><td class="mono small">${esc(k)}</td><td class="mono small" style="text-align:right">${typeof v === 'number' ? 'S$' + fmt(v) : esc(String(v))}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

window.downloadJSON = (name, body) => {
  const blob = new Blob([body], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
};

// ================================================================================
// MONTHLY REPORT CENTRE — end-of-month executive pack
// ================================================================================
const monthlyState = { month: '2025-11', pack: null };

async function viewMonthly() {
  const cid = state.company?.id;
  if (!cid) { $('#view').innerHTML = '<div class="empty">No active company.</div>'; return; }
  $('#view').innerHTML = `
    <h1 class="view-title">${t('monthly.title')}</h1>
    <p class="view-sub">${t('monthly.sub')}</p>
    <div class="card mb-20">
      <div class="grid grid-4">
        <div class="form-row"><label>${t('monthly.pick_month')}</label>
          <select id="mthPick">
            ${['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12'].map(m => `<option value="${m}" ${m === monthlyState.month ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><label>&nbsp;</label><button class="btn btn-primary" onclick="loadMonthly()">${t('monthly.generate')}</button></div>
      </div>
    </div>
    <div id="mthBody"><div class="card empty">${t('common.loading')}</div></div>
  `;
  loadMonthly();
}

window.loadMonthly = async () => {
  monthlyState.month = $('#mthPick')?.value || monthlyState.month;
  $('#mthBody').innerHTML = `<div class="card empty">${t('common.loading')}</div>`;
  const p = await api(`/finance/monthly-pack?company_id=${state.company.id}&month=${monthlyState.month}`);
  monthlyState.pack = p;
  const s = p.executive_summary;
  const lang = (window.I18N && window.I18N.getLocale && window.I18N.getLocale() === 'zh') ? 'cn' : 'en';
  const summary = s['executive_summary_' + lang] || s.executive_summary_en || '';
  const kpiCards = (s.kpis || []).map(k => `
    <div class="card stat-card" style="border-left:4px solid ${k.status === 'good' ? 'var(--success)' : k.status === 'warn' ? 'var(--warning)' : 'var(--primary)'}">
      <div class="stat-label">${lang === 'cn' && k.label_cn ? k.label_cn : k.label}</div>
      <div class="stat-value">${esc(k.value)}</div>
      <div class="stat-delta">${esc(k.delta || '')}</div>
    </div>`).join('');

  $('#mthBody').innerHTML = `
    <div class="card mb-20" style="background:linear-gradient(135deg,#0f1f3d,#1a3565);color:#fff">
      <div class="flex-between mb-12">
        <h2 style="color:#fff;margin:0">${t('monthly.exec_summary')} · ${monthlyState.month}</h2>
        <span class="badge badge-info">${esc(p.company?.name || '')}</span>
      </div>
      <div style="line-height:1.6">${esc(summary)}</div>
    </div>

    <h2>${t('monthly.kpis')}</h2>
    <div class="grid grid-3 mb-20">${kpiCards}</div>

    <div class="grid grid-2 mb-20">
      <div class="card">
        <h3>${t('monthly.highlights')}</h3>
        <ul style="margin-left:18px;line-height:1.8">${(s.highlights || []).map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <h3>${t('monthly.risks')}</h3>
        <table style="width:100%"><thead><tr><th>${t('monthly.severity')}</th><th>Issue</th><th>${t('monthly.mitigation')}</th></tr></thead>
          <tbody>${(s.risks || []).map(r => `<tr><td><span class="badge badge-${r.severity === 'high' ? 'danger' : 'warning'}">${r.severity}</span></td><td class="small">${esc(r.title)}</td><td class="small muted">${esc(r.mitigation || '')}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>

    <div class="grid grid-2 mb-20">
      <div class="card">
        <h3>📊 ${t('monthly.mtd')} P&L</h3>
        <div class="flex-between"><span class="muted">${t('reports.revenue')}</span><strong class="mono">S$${fmt(p.monthly_pnl.revenue)}</strong></div>
        <div class="flex-between"><span class="muted">${t('reports.op_profit')}</span><strong class="mono">S$${fmt(p.monthly_pnl.operating_profit)}</strong></div>
        <div class="flex-between"><span class="muted">${t('reports.net_profit')}</span><strong class="mono" style="color:var(--success)">S$${fmt(p.monthly_pnl.net_profit_after_tax)}</strong></div>
        <div class="flex-between"><span class="muted">${t('reports.net_margin')}</span><strong>${p.monthly_pnl.net_margin}%</strong></div>
      </div>
      <div class="card">
        <h3>📈 ${t('monthly.ytd')} P&L</h3>
        <div class="flex-between"><span class="muted">${t('reports.revenue')}</span><strong class="mono">S$${fmt(p.ytd_pnl.revenue)}</strong></div>
        <div class="flex-between"><span class="muted">${t('reports.op_profit')}</span><strong class="mono">S$${fmt(p.ytd_pnl.operating_profit)}</strong></div>
        <div class="flex-between"><span class="muted">${t('reports.net_profit')}</span><strong class="mono" style="color:var(--success)">S$${fmt(p.ytd_pnl.net_profit_after_tax)}</strong></div>
        <div class="flex-between"><span class="muted">${t('reports.net_margin')}</span><strong>${p.ytd_pnl.net_margin}%</strong></div>
      </div>
    </div>

    <div class="grid grid-2 mb-20">
      <div class="card">
        <h3>👥 ${t('monthly.cpf_title')}</h3>
        <div class="flex-between"><span class="muted">Employees</span><strong>${(p.payroll_cpf.rows || []).length}</strong></div>
        <div class="flex-between"><span class="muted">Total Gross Wages</span><strong class="mono">S$${fmt(p.payroll_cpf.totals.gross_wages)}</strong></div>
        <div class="flex-between"><span class="muted">Employer CPF</span><strong class="mono">S$${fmt(p.payroll_cpf.totals.employer_cpf)}</strong></div>
        <div class="flex-between"><span class="muted">Employee CPF</span><strong class="mono">S$${fmt(p.payroll_cpf.totals.employee_cpf)}</strong></div>
        <div class="flex-between"><span class="muted">SDL</span><strong class="mono">S$${fmt(p.payroll_cpf.totals.sdl)}</strong></div>
        <div class="divider"></div>
        <div class="flex-between"><strong>${t('common.total')} CPF</strong><strong class="mono" style="color:var(--danger)">S$${fmt(p.payroll_cpf.totals.total_cpf)}</strong></div>
        <div class="small muted mt-8">${t('monthly.deadline')}: <strong>${p.payroll_cpf.deadline}</strong> · ${t('monthly.channel')}: CPF EZPay</div>
      </div>
      <div class="card">
        <h3>🧾 ${t('monthly.gst_title')}</h3>
        <div class="flex-between"><span class="muted">Standard-Rated Supplies</span><strong class="mono">S$${fmt(p.gst_interim.standard_rated_supplies)}</strong></div>
        <div class="flex-between"><span class="muted">Taxable Purchases</span><strong class="mono">S$${fmt(p.gst_interim.taxable_purchases)}</strong></div>
        <div class="flex-between"><span class="muted">Output Tax</span><strong class="mono">S$${fmt(p.gst_interim.output_tax_due)}</strong></div>
        <div class="flex-between"><span class="muted">Input Tax</span><strong class="mono">S$${fmt(p.gst_interim.input_tax_claimed)}</strong></div>
        <div class="divider"></div>
        <div class="flex-between"><strong>Net GST ${p.gst_interim.net_gst_payable_or_refundable >= 0 ? 'Payable' : 'Refundable'}</strong><strong class="mono" style="color:${p.gst_interim.net_gst_payable_or_refundable >= 0 ? 'var(--danger)' : 'var(--success)'}">S$${fmt(Math.abs(p.gst_interim.net_gst_payable_or_refundable))}</strong></div>
        <div class="small muted mt-8">${t('monthly.deadline')}: <strong>${p.gst_interim.filing_deadline}</strong> · ${t('monthly.channel')}: IRAS myTax Portal</div>
      </div>
    </div>

    <div class="card mb-20">
      <h3>✅ ${t('monthly.filings')}</h3>
      <table style="width:100%"><thead><tr><th>Item</th><th>${t('monthly.deadline')}</th><th>${t('monthly.channel')}</th><th style="text-align:right">${t('common.amount')}</th><th>${t('common.status')}</th></tr></thead>
      <tbody>${p.filings_checklist.map(f => `
        <tr><td>${esc(f.item)}</td><td class="mono small">${f.deadline}</td><td class="small muted">${esc(f.channel)}</td>
        <td class="mono small" style="text-align:right">${f.amount_sgd != null ? 'S$' + fmt(f.amount_sgd) : '—'}</td>
        <td><span class="badge badge-${f.status === 'pending' ? 'warning' : 'info'}">${f.status}</span></td></tr>`).join('')}
      </tbody></table>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h3>📅 ${t('monthly.calendar')}</h3>
        <table style="width:100%"><tbody>${(s.tax_calendar_next_30d || []).map(c => `<tr><td class="small">${esc(c.event)}</td><td class="mono small" style="text-align:right"><span class="badge badge-warning">${c.due_date}</span></td></tr>`).join('')}</tbody></table>
      </div>
      <div class="card">
        <h3>📝 ${t('monthly.actions')}</h3>
        <table style="width:100%"><thead><tr><th>${t('monthly.owner')}</th><th>${t('monthly.task')}</th><th>${t('monthly.due')}</th></tr></thead>
          <tbody>${(s.action_items || []).map(a => `<tr><td><strong>${esc(a.owner)}</strong></td><td class="small">${esc(a.task)}</td><td class="mono small">${a.due}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
};

// ================================================================================
// SIGNUP — 开放用户注册
// ================================================================================
async function viewSignup() {
  $('#view').innerHTML = `
    <h1 class="view-title">🚀 注册 AiCFO 账户</h1>
    <p class="view-sub">填写基本信息 → 选择套餐 → 支付 → 领取专属 WhatsApp 财务二维码</p>
    <div class="card" style="max-width:640px;margin:0 auto">
      <div class="grid grid-2">
        <div class="form-row"><label>邮箱 *</label><input id="su_email" placeholder="you@company.com" /></div>
        <div class="form-row"><label>姓名 *</label><input id="su_name" placeholder="Jane Tan" /></div>
        <div class="form-row"><label>手机号 (带国家码)</label><input id="su_phone" placeholder="+6598761234" /></div>
        <div class="form-row"><label>公司名 (已有/拟注册)</label><input id="su_company" placeholder="Skyhawk Pte Ltd" /></div>
        <div class="form-row"><label>国家</label>
          <select id="su_country"><option value="SG">🇸🇬 Singapore</option><option value="CN">🇨🇳 China</option><option value="HK">🇭🇰 Hong Kong</option><option value="MY">🇲🇾 Malaysia</option><option value="OTHER">其他</option></select>
        </div>
        <div class="form-row"><label>业务类型</label>
          <select id="su_segment">
            <option value="local_sg">本地 SG SME</option>
            <option value="china_outbound">中国出海</option>
            <option value="web3">Web3 / 加密</option>
            <option value="family_office">家办 / 投资</option>
          </select>
        </div>
      </div>
      <div class="mt-12">
        <button class="btn btn-primary" onclick="doSignup()">📝 注册账户 → 下一步选套餐</button>
        <span class="small muted" style="margin-left:12px">已有账户? <a onclick="nav('dashboard')">登录进入 Demo</a></span>
      </div>
      <div id="suResult" class="mt-12"></div>
    </div>`;
}
window.doSignup = async () => {
  const body = {
    email: $('#su_email').value.trim(),
    name: $('#su_name').value.trim(),
    phone: $('#su_phone').value.trim(),
    country: $('#su_country').value,
    segment: $('#su_segment').value,
    company_name: $('#su_company').value.trim()
  };
  if (!body.email || !body.name) { alert('请填写邮箱和姓名'); return; }
  const box = document.getElementById('suResult');
  box.innerHTML = '<div class="muted small">⏳ 注册中...</div>';
  try {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) { box.innerHTML = `<div class="badge badge-danger">❌ ${esc(j.error)}</div>`; return; }
    // 保存用户态
    state.user = j.user; state.user.id = j.user.id;
    state.company = { id: j.company_id, name: body.company_name };
    $('#userName').textContent = j.user.name;
    $('#userRole').textContent = body.company_name || '待注册公司';
    box.innerHTML = `<div class="badge badge-success">✅ 注册成功! user_id: <span class="mono">${esc(j.user.id)}</span></div>
      <div class="mt-8"><button class="btn btn-primary" onclick="nav('plans')">下一步: 选择套餐 →</button></div>`;
  } catch (e) { box.innerHTML = `<div class="badge badge-danger">❌ ${esc(e.message)}</div>`; }
};

// ================================================================================
// PLANS — 套餐筛选 + 支付
// ================================================================================
async function viewPlans() {
  const { plans } = await api('/plans');
  if (!state.user) { $('#view').innerHTML = '<div class="card"><h2>请先注册</h2><button class="btn btn-primary" onclick="nav(\'signup\')">📝 去注册</button></div>'; return; }
  $('#view').innerHTML = `
    <h1 class="view-title">💳 选择套餐</h1>
    <p class="view-sub">登录账户: <b>${esc(state.user.name)}</b> (${esc(state.user.email)}) · 选择套餐并支付后即获专属 WhatsApp 财务二维码</p>
    <div class="grid grid-3">
      ${plans.map(p => `
        <div class="card" style="border:2px solid ${p.code==='growth'?'var(--primary)':'var(--border,#eee)'}">
          ${p.code==='growth'?'<div class="badge badge-info" style="margin-bottom:8px">🔥 最受欢迎</div>':''}
          <h2>${esc(p.name)}</h2>
          <div style="font-size:36px;font-weight:bold;margin:12px 0">S$${p.price_sgd}<span class="small muted">/${p.billing_cycle==='monthly'?'月':'年'}</span></div>
          <ul class="small" style="padding-left:18px;line-height:1.8">
            ${p.features.map(f => `<li>${esc(f)}</li>`).join('')}
          </ul>
          <button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="selectPlan('${p.code}')">选此套餐 →</button>
        </div>`).join('')}
    </div>
    <div id="payBox" class="mt-20"></div>`;
}
window.selectPlan = async (plan_code) => {
  const payBox = document.getElementById('payBox');
  payBox.innerHTML = '<div class="muted small">⏳ 创建订阅订单...</div>';
  try {
    const sub = await api('/subscriptions', { method: 'POST', body: { user_id: state.user.id, company_id: state.company?.id, plan_code } });
    if (!sub.ok) { payBox.innerHTML = `<div class="badge badge-danger">${esc(sub.error)}</div>`; return; }
    payBox.innerHTML = `
      <div class="card" style="max-width:520px;margin:0 auto">
        <h2>💳 支付订单</h2>
        <div class="mt-8 small">套餐: <b>${esc(sub.plan.name)}</b> · 金额 <b>S$${sub.plan.price_sgd}/${sub.plan.billing_cycle==='monthly'?'月':'年'}</b></div>
        <div class="mt-8 small muted">订阅号: <span class="mono">${esc(sub.subscription_id)}</span></div>
        <div class="grid grid-2 mt-12">
          <div class="form-row"><label>卡号 (模拟)</label><input id="pay_card" value="4242 4242 4242 4242" /></div>
          <div class="form-row"><label>CVV</label><input id="pay_cvv" value="123" /></div>
        </div>
        <button class="btn btn-success" style="width:100%" onclick="doPay('${sub.subscription_id}',${sub.plan.price_sgd})">✅ 确认支付 S$${sub.plan.price_sgd}</button>
      </div>
      <div id="payResult" class="mt-12"></div>`;
  } catch (e) { payBox.innerHTML = `<div class="badge badge-danger">${esc(e.message)}</div>`; }
};
window.doPay = async (subscription_id, amount) => {
  const box = document.getElementById('payResult');
  box.innerHTML = '<div class="muted small">⏳ 连接支付网关 (mock) ...</div>';
  try {
    const card = ($('#pay_card').value || '').replace(/\s/g, '');
    const last4 = card.slice(-4);
    const r = await api('/payments/pay', { method: 'POST', body: { user_id: state.user.id, subscription_id, method: 'mock_card', card_last4: last4 } });
    if (!r.ok) { box.innerHTML = `<div class="badge badge-danger">${esc(r.error)}</div>`; return; }
    const ch = r.finance_channel;
    box.innerHTML = `
      <div class="card" style="text-align:center;max-width:520px;margin:0 auto;border:2px solid var(--success,#22c55e)">
        <div class="badge badge-success" style="font-size:14px">✅ 支付成功! S$${amount}</div>
        <div class="small muted mt-8">交易号: <span class="mono">${esc(r.payment.gateway_ref)}</span></div>
        <h2 class="mt-12">🎉 您的专属财务二维码</h2>
        <img src="${ch.qr_data_url}" style="width:260px;height:260px;margin:12px auto;display:block;border:1px solid var(--border)" />
        <div class="small">Finance Token: <span class="mono"><b>${esc(ch.finance_token)}</b></span></div>
        <div class="small muted mt-8">WhatsApp 机器人号码: <b>+${esc(ch.bot_phone)}</b></div>
        <div class="mt-12"><button class="btn btn-primary" onclick="nav('wa')">📱 进入我的 WhatsApp 财务渠道 →</button></div>
      </div>`;
  } catch (e) { box.innerHTML = `<div class="badge badge-danger">${esc(e.message)}</div>`; }
};

// ================================================================================
// WA CHANNEL — 专属二维码 + 模拟 WhatsApp 对话 + 档案
// ================================================================================
async function viewWaChannel() {
  if (!state.user) { $('#view').innerHTML = '<div class="card"><h2>请先注册并完成支付</h2><button class="btn btn-primary" onclick="nav(\'signup\')">📝 去注册</button></div>'; return; }
  try {
    const r = await api('/archive/user?user_id=' + state.user.id);
    const ch = r.channel;
    const a = (r.archives || [])[0] || {};
    if (!ch) { $('#view').innerHTML = `<div class="card"><h2>尚未生成财务渠道</h2><p>请先购买套餐。</p><button class="btn btn-primary" onclick="nav('plans')">💳 选择套餐</button></div>`; return; }
    // 取二维码
    const qrR = await api('/wa/channel?user_id=' + state.user.id);
    const qrUrl = qrR.channel?.qr_data_url;

    $('#view').innerHTML = `
      <h1 class="view-title">📱 我的 WhatsApp 财务渠道</h1>
      <p class="view-sub">扫码添加专属财务 Bot · 日常发送发票/流水/报表 · AI 自动归档到您的档案</p>
      <div class="grid grid-2">
        <div class="card" style="text-align:center">
          <h2>📲 专属二维码</h2>
          <img src="${qrUrl}" style="width:240px;height:240px;margin:12px auto;display:block;border:1px solid var(--border)" />
          <div class="small">Token: <span class="mono"><b>${esc(ch.finance_token)}</b></span></div>
          <div class="small muted mt-8">Bot: <b>+${esc(ch.bot_phone)}</b> · 已绑定: <b>${esc(ch.wa_phone || '未绑定')}</b></div>
          <a class="small" href="${esc(ch.qr_payload)}" target="_blank">🔗 直接打开 WhatsApp 对话</a>
          <div class="mt-12 small muted" style="text-align:left;background:var(--surface-2,#f9f9f9);padding:12px;border-radius:8px">
            <b>使用说明:</b><br>
            1️⃣ WhatsApp 扫码 / 点击上方链接 → 系统自动 LINK 绑定<br>
            2️⃣ 每日发送 <code>发票</code>/<code>流水</code>/<code>报表</code> 文字或图片/PDF/CSV 附件<br>
            3️⃣ AI 自动分类并写入您的账本 (invoices/transactions/documents)<br>
            4️⃣ 月度自动生成 P&L/BS/CF/GST F5 — 后台可查看完整档案
          </div>
        </div>
        <div class="card">
          <h2>📊 本月档案 (${esc(a.archive_date || '-')})</h2>
          <div class="grid grid-2 mt-12">
            <div class="stat-card"><div class="stat-label">发票数</div><div class="stat-value">${a.invoice_count || 0}</div></div>
            <div class="stat-card"><div class="stat-label">流水笔数</div><div class="stat-value">${a.txn_count || 0}</div></div>
            <div class="stat-card"><div class="stat-label">收入</div><div class="stat-value" style="color:var(--success)">S$${fmt(a.total_revenue || 0)}</div></div>
            <div class="stat-card"><div class="stat-label">支出</div><div class="stat-value" style="color:var(--danger)">S$${fmt(a.total_expense || 0)}</div></div>
          </div>
          <div class="mt-12">
            <h3>🧪 模拟 WhatsApp 发送</h3>
            <div class="form-row"><label>消息内容</label><textarea id="wa_text" rows="2" placeholder="例如: AWS 发票 1662.25 GST / 客户付款 +8500 流水">AWS Singapore 发票 金额 1662.25 GST included</textarea></div>
            <div class="form-row"><label>附件 (可选)</label><input id="wa_file" type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.txt" /></div>
            <button class="btn btn-primary" onclick="sendWaMsg('${esc(ch.finance_token)}','${esc(ch.wa_phone || '+6598761234')}')">📤 模拟发送</button>
            <div id="waMsgResult" class="mt-8"></div>
          </div>
        </div>
      </div>

      <div class="card mt-20">
        <h2>🕐 最近消息 (${(r.recent_messages || []).length})</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>时间</th><th>类型</th><th>内容</th><th>分类</th><th>置信度</th><th>业务实体</th></tr></thead>
          <tbody>${(r.recent_messages || []).slice(0, 30).map(m => `
            <tr>
              <td class="mono small">${esc((m.received_at||'').slice(5, 16))}</td>
              <td><span class="badge badge-info">${esc(m.msg_type)}</span></td>
              <td class="small">${esc((m.content || '').slice(0, 50))}</td>
              <td><span class="badge badge-${m.classified_as==='invoice'?'success':m.classified_as==='bank_txn'?'info':'warning'}">${esc(m.classified_as)}</span></td>
              <td>${((m.ai_confidence || 0) * 100).toFixed(0)}%</td>
              <td class="mono small">${esc(m.linked_entity_id || '-')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted small">暂无消息, 请通过 WhatsApp 发送或用左侧模拟发送</td></tr>'}
          </tbody>
        </table></div>
      </div>

      <div class="grid grid-2 mt-20">
        <div class="card">
          <h3>🧾 发票档案 (${(r.invoices || []).length})</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>供应商</th><th>日期</th><th>金额</th><th>GST</th></tr></thead>
            <tbody>${(r.invoices || []).slice(0, 20).map(i => `
              <tr><td class="small">${esc(i.vendor_name)}</td><td class="mono small">${esc(i.issue_date)}</td><td class="mono small">S$${fmt(i.total)}</td><td class="mono small">S$${fmt(i.gst_amount)}</td></tr>
            `).join('') || '<tr><td colspan="4" class="muted small">暂无</td></tr>'}
            </tbody>
          </table></div>
        </div>
        <div class="card">
          <h3>🏦 流水档案 (${(r.transactions || []).length})</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>日期</th><th>金额</th><th>描述</th></tr></thead>
            <tbody>${(r.transactions || []).slice(0, 20).map(t => `
              <tr><td class="mono small">${esc(t.transaction_date)}</td><td class="mono small" style="color:${t.amount<0?'var(--danger)':'var(--success)'}">${t.amount<0?'-':'+'}${fmt(Math.abs(t.amount))}</td><td class="small">${esc((t.description||'').slice(0,40))}</td></tr>
            `).join('') || '<tr><td colspan="3" class="muted small">暂无</td></tr>'}
            </tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) { $('#view').innerHTML = `<div class="card"><div class="badge badge-danger">加载失败: ${esc(e.message)}</div></div>`; }
}
window.sendWaMsg = async (token, wa_phone) => {
  const text = $('#wa_text').value.trim();
  const file = document.getElementById('wa_file').files[0];
  if (!text && !file) { alert('请输入文字或选择文件'); return; }
  const box = document.getElementById('waMsgResult');
  box.innerHTML = '<div class="muted small">⏳ 发送中...</div>';
  try {
    const fd = new FormData();
    fd.append('token', token); fd.append('wa_phone', wa_phone);
    if (text) fd.append('text', text);
    if (file) fd.append('media', file);
    const r = await fetch('/api/wa/webhook/message', { method: 'POST', body: fd });
    const j = await r.json();
    if (!j.ok) { box.innerHTML = `<div class="badge badge-danger">${esc(j.error)}</div>`; return; }
    box.innerHTML = `<div class="badge badge-success">✅ ${esc(j.classified_as)} (${((j.confidence||0)*100).toFixed(0)}%)</div>
      <div class="small mt-8">${esc(j.ai_summary)}</div>
      <div class="small muted mt-4">→ 挂钩: <span class="mono">${esc(j.linked_entity_id || '-')}</span></div>
      <div class="mt-8"><code class="small">${esc((j.reply||'').slice(0,200))}</code></div>`;
    setTimeout(() => viewWaChannel(), 1500);
  } catch (e) { box.innerHTML = `<div class="badge badge-danger">${esc(e.message)}</div>`; }
};

// ================================================================================
// MY COMPANY ARCHIVE (客户端：我的企业档案库)
// ================================================================================
async function viewMyArchive() {
  $('#view').innerHTML = `<div class="hero"><h1>📚 我的企业档案库</h1><p>每家已创建的企业都有独立档案库，记录上传的文件、消费、报税、财报、历史留痕。</p></div>
    <div id="myArcList"><p>加载中...</p></div>`;
  const uid = state.user?.id || 'usr_demo_001';
  try {
    // 拉我的所有公司 + 每家公司用 admin/archive 接口取 summary
    const all = await fetch('/api/admin/archive/companies?limit=500').then(r => r.json());
    const mine = (all.companies || []).filter(c => !state.user || true); // 管理员视图下全部可见；普通用户只看到自己的
    // 如果有 user 上下文，尝试过滤 created_by=uid；admin/archive/companies 返回里没带 created_by，可以用 /companies
    let myCompanies = [];
    try {
      const cs = await api('/companies');
      myCompanies = cs.filter(c => c.created_by === uid).map(c => c.id);
    } catch (_) {}
    const filtered = myCompanies.length ? mine.filter(c => myCompanies.includes(c.id)) : mine;

    $('#myArcList').innerHTML = `
      <div class="grid grid-2 mb-20">
        <div class="card stat-card"><div class="stat-label">我的企业</div><div class="stat-value">${filtered.length}</div></div>
        <div class="card stat-card"><div class="stat-label">合计发票额</div><div class="stat-value">S$ ${filtered.reduce((s,c)=>s+(c.stats?.invoice_total||0),0).toFixed(2)}</div></div>
      </div>
      <div class="card">
        ${filtered.length ? `<table class="table">
          <thead><tr><th>公司</th><th>UEN</th><th>状态</th><th>交易</th><th>发票</th><th>文档</th><th>上传</th><th>最近活动</th><th></th></tr></thead>
          <tbody>${filtered.map(c => `<tr>
            <td><b>${esc(c.name)}</b><div class="small muted">${esc(c.segment || '')} · ${esc(c.subscription_tier || '')}</div></td>
            <td class="mono small">${esc(c.uen || '-')}</td>
            <td><span class="badge">${esc(c.status)}</span></td>
            <td>${c.stats.transactions}</td>
            <td>${c.stats.invoices} · S$${(c.stats.invoice_total||0).toFixed(2)}</td>
            <td>${c.stats.documents}</td>
            <td>${c.stats.upload_submissions}</td>
            <td class="small">${esc((c.last_activity_at || '').slice(0,16))}</td>
            <td><button class="btn btn-sm btn-primary" onclick="nav('myArchiveDetail',{id:'${esc(c.id)}'})">📂 打开</button></td>
          </tr>`).join('')}</tbody>
        </table>` : `<p class="muted">还没有企业档案。先在"Register"或"注册"里创建企业，档案会自动生成。</p>`}
      </div>`;
  } catch (e) {
    $('#myArcList').innerHTML = `<div class="card"><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
  }
}

async function viewMyArchiveDetail({ id } = {}) {
  if (!id) { nav('myArchive'); return; }
  $('#view').innerHTML = `<div class="hero"><h1>📂 企业档案详情</h1><p>加载中...</p></div>`;
  try {
    const res = await fetch('/api/admin/archive/company/' + id).then(r => r.json());
    if (!res.ok) { $('#view').innerHTML = `<div class="card"><p style="color:#ef4444">${esc(res.error || '未找到')}</p><button class="btn" onclick="nav('myArchive')">← 返回</button></div>`; return; }
    const a = res.archive;
    const c = a.company;
    $('#view').innerHTML = `
      <div class="hero">
        <a onclick="nav('myArchive')" style="color:rgba(255,255,255,0.9);cursor:pointer">← 返回列表</a>
        <h1>🏢 ${esc(c.name)}</h1>
        <p>UEN: <code>${esc(c.uen || '-')}</code> · 状态: <b>${esc(c.status)}</b> · 订阅: ${esc(c.subscription_tier || 'basic')} · 细分: ${esc(c.segment || '')}</p>
      </div>

      <div class="grid grid-4 mb-20">
        <div class="card stat-card"><div class="stat-label">交易流水</div><div class="stat-value">${a.expenses.transactions.length}</div><div class="stat-delta">净现金流 S$ ${(a.expenses.summary.net_cashflow||0).toFixed(2)}</div></div>
        <div class="card stat-card"><div class="stat-label">发票</div><div class="stat-value">${a.expenses.invoices.length}</div><div class="stat-delta">S$ ${(a.expenses.summary.total_invoice_amount||0).toFixed(2)}</div></div>
        <div class="card stat-card"><div class="stat-label">文档</div><div class="stat-value">${a.history.documents.length}</div><div class="stat-delta">税务 ${a.tax.filings.length} 条</div></div>
        <div class="card stat-card"><div class="stat-label">上传次数</div><div class="stat-value">${a.history.uploads.length}</div><div class="stat-delta">WA ${a.history.wa_messages.length} · Agent ${a.history.agent_runs.length}</div></div>
      </div>

      <div class="card mb-20">
        <h2>🧾 最近发票（含上传原件）</h2>
        ${a.expenses.invoices.length ? `<table class="table">
          <thead><tr><th style="width:80px">原件</th><th>发票号</th><th>供应商</th><th>日期</th><th>金额</th><th>GST</th><th>状态</th></tr></thead>
          <tbody>${a.expenses.invoices.slice(0,20).map(i => `<tr>
            <td>${renderClientFile(i.image_url)}</td>
            <td class="mono small">${esc(i.invoice_number || i.id.slice(-8))}</td>
            <td>${esc(i.vendor_name || '-')}</td>
            <td class="small">${esc(i.issue_date || '-')}</td>
            <td><b>${esc(i.currency || 'SGD')} ${(i.total||0).toFixed(2)}</b></td>
            <td>${(i.gst_amount||0).toFixed(2)}</td>
            <td><span class="badge">${esc(i.status)}</span></td>
          </tr>`).join('')}</tbody>
        </table>` : `<p class="muted">还没有发票。扫描企业专属上传链接的二维码上传一张试试。</p>`}
      </div>

      <div class="card mb-20">
        <h2>📤 最近上传（点图片预览）</h2>
        ${a.history.wa_messages.length ? `<table class="table">
          <thead><tr><th style="width:80px">预览</th><th>类型</th><th>内容</th><th>AI 分类</th><th>置信度</th><th>时间</th></tr></thead>
          <tbody>${a.history.wa_messages.slice(0,20).map(m => `<tr>
            <td>${renderClientFile(m.media_url, m.msg_type === 'image' ? 'image/*' : '')}</td>
            <td>${esc(m.msg_type || 'text')}</td>
            <td class="small" style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc((m.content || '').slice(0,80))}</td>
            <td>${esc(m.classified_as || '-')}</td>
            <td>${m.ai_confidence != null ? (m.ai_confidence*100).toFixed(0)+'%' : '-'}</td>
            <td class="small">${esc((m.received_at || '').slice(0,16))}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<p class="muted">还没有上传记录。</p>`}
      </div>

      <div class="card mb-20">
        <h2>⏰ 统一时间线</h2>
        ${a.timeline && a.timeline.length ? `<div style="max-height:400px;overflow-y:auto">
          ${a.timeline.slice(0,50).map(e => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div style="font-size:22px;width:30px">${e.icon || '•'}</div>
            <div style="flex:1">
              <div><b>${esc(e.title || '')}</b></div>
              <div class="small muted">${esc(e.detail || '')} · ${esc((e.ts || '').slice(0,16))}</div>
            </div>
          </div>`).join('')}
        </div>` : `<p class="muted">暂无历史事件。</p>`}
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn-primary" href="/api/admin/archive/company/${esc(c.id)}/export.html" target="_blank">🖨️ 打印 / 保存 PDF</a>
        <a class="btn" href="/api/admin/archive/company/${esc(c.id)}/export.csv" target="_blank">📊 导出 CSV</a>
        <a class="btn" href="/api/admin/archive/company/${esc(c.id)}" target="_blank">⬇️ 原始 JSON</a>
        <button class="btn" onclick="nav('myArchive')">← 返回列表</button>
      </div>
    `;
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><p style="color:#ef4444">${esc(e.message)}</p></div>`;
  }
}

// 客户端文件预览工具（与 admin 端 arcRenderFile 对齐）
function renderClientFile(url, mime) {
  if (!url) return '<span class="muted">-</span>';
  const u = String(url);
  const isImg = /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(u) || /^image\//.test(mime || '');
  const isPdf = /\.pdf$/i.test(u) || (mime || '').includes('pdf');
  const abs = u.startsWith('/') ? u : (u.startsWith('http') ? u : '');
  if (!abs) return `<code class="small">${esc(u.slice(0, 30))}</code>`;
  if (isImg) {
    return `<a href="${abs}" target="_blank" title="点击查看原图">
      <img src="${abs}" style="width:56px;height:56px;object-fit:cover;border:1px solid #e5e7eb;border-radius:6px">
    </a>`;
  }
  const icon = isPdf ? '📄' : '📎';
  return `<a href="${abs}" target="_blank">${icon} ${esc(u.split('/').pop().slice(0,20))}</a>`;
}
