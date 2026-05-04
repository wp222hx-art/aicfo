// AiCFO Admin Console
const API = '/api';
const astate = { route: 'overview', current_agent: null, current_doc: null };

const $ = sel => document.querySelector(sel);
async function api(path, options = {}) {
  const opts = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// i18n shorthand
const t = (k, vars) => (window.I18N ? window.I18N.t(k, vars) : k);

// Re-render current view when locale changes + refresh static sidebar labels
window.addEventListener('localechange', () => {
  if (window.I18N) window.I18N.applyDOM();
  if (astate.route) anav(astate.route, astate.params || {});
});

function anav(route, params = {}) {
  astate.route = route;
  astate.params = params;
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.route === route));
  const routes = { overview, queue, agents, runs, playground, rag, training, retrieval, companies, users, archives, waChannels, llmGateway, waConfig, uploadPortal, tgConfig, companyArchive, companyArchiveDetail };
  (routes[route] || overview)(params);
  window.scrollTo(0, 0);
}
window.anav = anav;
anav('overview');

// ================================================================================
// OVERVIEW
// ================================================================================
async function overview() {
  $('#av').innerHTML = `<div class="empty">${t('common.loading')}</div>`;
  const [stats, ragStats, runsList] = await Promise.all([
    api('/admin/stats'), api('/rag/stats'), api('/agents/runs/recent')
  ]);
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.overview.title')}</h1>
    <p class="view-sub">${t('admin.overview.sub')}</p>

    <div class="grid grid-4 mb-20">
      <div class="card stat-card"><div class="stat-label">${t('admin.overview.total_companies')}</div><div class="stat-value">${stats.companies}</div><div class="stat-delta">${stats.active_companies} ${t('admin.overview.active')}</div></div>
      <div class="card stat-card"><div class="stat-label">${t('admin.overview.runs')}</div><div class="stat-value">${stats.agent_runs.total}</div><div class="stat-delta">${t('admin.overview.avg_conf')} ${stats.agent_runs.avg_confidence}</div></div>
      <div class="card stat-card"><div class="stat-label">${t('admin.overview.queue')}</div><div class="stat-value" style="color:var(--warning)">${stats.pending_reviews}</div><div class="stat-delta down">${t('admin.overview.j_pending')}</div></div>
      <div class="card stat-card"><div class="stat-label">${t('admin.overview.latency')}</div><div class="stat-value">${stats.agent_runs.avg_latency_ms}ms</div><div class="stat-delta">${t('admin.overview.p50')}</div></div>
    </div>

    <div class="grid grid-2 mb-20">
      <div class="card">
        <h2>${t('admin.overview.pipeline')}</h2>
        ${stats.orders_by_stage.length === 0 ? `<div class="empty">${t('admin.overview.no_orders')}</div>` :
          stats.orders_by_stage.map(s => `
            <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
              <span class="badge badge-info">${s.stage}</span>
              <strong>${s.n}</strong>
            </div>`).join('')}
      </div>
      <div class="card">
        <h2>${t('admin.overview.rag_kb')}</h2>
        ${(ragStats.layers || []).map(l => {
          const chunks = (ragStats.chunks || []).find(c => c.layer === l.layer)?.chunks || 0;
          return `
          <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div>
              <strong>${l.layer.replace('_', ' ').toUpperCase()}</strong>
              <div class="muted small">${l.docs} ${t('admin.overview.docs')} · ${chunks} ${t('admin.overview.chunks')}</div>
            </div>
            <a onclick="anav('rag',{layer:'${l.layer}'})">${t('common.view')} →</a>
          </div>`;
        }).join('')}
        <div class="mt-12 small muted">${t('admin.overview.feedback')}: ${ragStats.feedback?.avg_rating?.toFixed(2) || 'n/a'} / 5 (${ragStats.feedback?.n || 0} ${t('admin.overview.ratings')})</div>
      </div>
    </div>

    <div class="card">
      <div class="flex-between mb-12">
        <h2>${t('admin.overview.recent')}</h2>
        <a onclick="anav('runs')">${t('dash.view_all')}</a>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>${t('admin.runs.when')}</th><th>Agent</th><th>${t('admin.runs.input')}</th><th>${t('common.confidence')}</th><th>${t('admin.runs.latency')}</th></tr></thead>
        <tbody>${runsList.slice(0, 10).map(r => `
          <tr>
            <td class="small muted">${new Date(r.created_at).toLocaleString()}</td>
            <td><strong>${esc(r.agent_name || '—')}</strong></td>
            <td class="small">${esc((r.input || '').slice(0, 60))}...</td>
            <td>${((r.confidence || 0) * 100).toFixed(0)}%</td>
            <td>${r.latency_ms}ms</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}

// ================================================================================
// REVIEW QUEUE
// ================================================================================
async function queue() {
  $('#av').innerHTML = `<div class="empty">${t('common.loading')}</div>`;
  const q = await api('/admin/review-queue');
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.queue.title')}</h1>
    <p class="view-sub">${t('admin.queue.sub')}</p>

    <div class="card mb-20">
      <h2>${t('admin.queue.orders')} (${q.orders.length})</h2>
      ${q.orders.length === 0 ? `<div class="empty">${t('admin.queue.no_orders')}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>${t('common.company')}</th><th>${t('dash.stage')}</th><th>${t('admin.queue.price')}</th><th>${t('common.action')}</th></tr></thead>
        <tbody>${q.orders.map(o => `
          <tr>
            <td class="mono small">${o.id}</td>
            <td><strong>${esc(o.company_name)}</strong></td>
            <td><span class="badge badge-info">${o.stage}</span></td>
            <td class="mono">S$${fmt(o.price_sgd)}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="approveOrder('${o.id}')">${t('common.approve')}</button>
              <button class="btn btn-sm">${t('common.view')}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="card mb-20">
      <h2>${t('admin.queue.journals')} (${q.journals.length})</h2>
      ${q.journals.length === 0 ? `<div class="empty">${t('admin.queue.no_journals')}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>${t('common.date')}</th><th>${t('common.company')}</th><th>${t('admin.queue.ref')}</th><th>${t('admin.queue.lines')}</th><th>${t('admin.queue.ai_conf')}</th><th>${t('admin.queue.reason')}</th><th>${t('common.action')}</th></tr></thead>
        <tbody>${q.journals.map(j => `
          <tr>
            <td class="mono small">${j.entry_date}</td>
            <td>${esc(j.company_name || '—')}</td>
            <td class="mono small">${esc(j.reference)}</td>
            <td class="small">${j.lines.map(l => `${l.account_code} ${l.debit ? 'Dr' : 'Cr'} ${fmt(l.debit || l.credit)}`).join(' · ')}</td>
            <td>${((j.ai_confidence || 0) * 100).toFixed(0)}%</td>
            <td class="small muted">${esc((j.reasoning || '').slice(0, 60))}...</td>
            <td><button class="btn btn-sm btn-primary" onclick="approveJournal('${j.id}')">✓</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>

    <div class="card">
      <h2>${t('admin.queue.tax')} (${q.tax.length})</h2>
      ${q.tax.length === 0 ? `<div class="empty">${t('admin.queue.no_tax')}</div>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>${t('common.type')}</th><th>YA</th><th>${t('admin.queue.chargeable')}</th><th>${t('admin.queue.payable')}</th><th>${t('common.action')}</th></tr></thead>
        <tbody>${q.tax.map(tx => `
          <tr>
            <td><strong>${tx.filing_type}</strong></td>
            <td>${tx.ya}</td>
            <td class="mono">S$${fmt(tx.chargeable_income)}</td>
            <td class="mono" style="color:var(--danger)">S$${fmt(tx.tax_payable)}</td>
            <td><button class="btn btn-sm btn-primary">${t('admin.queue.signoff')}</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}
window.approveOrder = async (id) => {
  await api('/admin/orders/' + id + '/approve', { method: 'POST', body: { reviewer_id: 'usr_csp_001', notes: 'Approved via admin console' } });
  await api('/registration/orders/' + id + '/advance', { method: 'POST', body: { next_stage: 'uen_issued' } });
  await api('/registration/orders/' + id + '/advance', { method: 'POST', body: { next_stage: 'completed' } });
  queue();
};
window.approveJournal = async (id) => {
  await api('/books/journals/' + id + '/approve', { method: 'POST', body: {} });
  queue();
};

// ================================================================================
// AGENT STUDIO
// ================================================================================
async function agents() {
  const list = await api('/agents');
  $('#av').innerHTML = `
    <div class="flex-between mb-20">
      <div>
        <h1 class="view-title">${t('admin.agents.title')}</h1>
        <p class="view-sub">${t('admin.agents.sub')}</p>
      </div>
      <button class="btn btn-primary" onclick="createAgent()">${t('admin.agents.new')}</button>
    </div>
    <div class="grid grid-3" id="agentGrid">
      ${list.map(a => `
        <div class="card" style="cursor:pointer" onclick="editAgent('${a.id}')">
          <div class="flex-between mb-8">
            <strong>${esc(a.name)}</strong>
            <span class="badge badge-${a.status === 'active' ? 'success' : 'warning'}">${a.status}</span>
          </div>
          <div class="muted small mb-8">${esc(a.type)} · v${a.version}</div>
          <div class="small" style="min-height:40px">${esc((a.description || '').slice(0, 100))}</div>
          <div class="divider"></div>
          <div class="flex-between small muted">
            <span>${t('common.model')}: ${esc(a.model)}</span>
            <span>T=${a.temperature}</span>
          </div>
        </div>`).join('')}
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}

async function editAgent(id) {
  const a = await api('/agents/' + id);
  const tools = JSON.parse(a.tools || '[]');
  const rag = JSON.parse(a.rag_layers || '[]');
  $('#av').innerHTML = `
    <a onclick="anav('agents')">${t('admin.agents.back')}</a>
    <h1 class="view-title mt-8">${esc(a.name)}</h1>
    <p class="view-sub">Agent ID: ${a.id} · ${t('common.type')}: ${a.type} · ${t('common.version')} ${a.version}</p>

    <div class="grid" style="grid-template-columns: 2fr 1fr; gap:20px;">
      <div>
        <div class="card mb-16">
          <div class="form-row"><label>${t('admin.agents.agent_name')}</label><input id="ed_name" value="${esc(a.name)}" /></div>
          <div class="form-row"><label>${t('common.description')}</label><input id="ed_desc" value="${esc(a.description)}" /></div>
          <div class="inline-row">
            <div class="form-row"><label>${t('common.model')}</label>
              <select id="ed_model">
                <option ${a.model === 'aicfo-sim-1' ? 'selected' : ''}>aicfo-sim-1</option>
                <option ${a.model === 'gpt-5' ? 'selected' : ''}>gpt-5</option>
                <option ${a.model === 'claude-4.5-sonnet' ? 'selected' : ''}>claude-4.5-sonnet</option>
                <option ${a.model === 'gemini-2.5-pro' ? 'selected' : ''}>gemini-2.5-pro</option>
                <option ${a.model === 'qwen3-sg-tax' ? 'selected' : ''}>qwen3-sg-tax (fine-tuned)</option>
              </select>
            </div>
            <div class="form-row"><label>Temperature</label><input id="ed_temp" type="number" step="0.1" min="0" max="2" value="${a.temperature}" /></div>
            <div class="form-row"><label>${t('common.version')}</label><input id="ed_ver" value="${esc(a.version)}" /></div>
            <div class="form-row"><label>${t('common.status')}</label>
              <select id="ed_status">
                <option ${a.status === 'active' ? 'selected' : ''}>active</option>
                <option ${a.status === 'draft' ? 'selected' : ''}>draft</option>
                <option ${a.status === 'archived' ? 'selected' : ''}>archived</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <label>${t('admin.agents.prompt')}</label>
            <textarea id="ed_prompt" class="code-editor" rows="20">${esc(a.system_prompt)}</textarea>
          </div>
          <div class="inline-row">
            <div class="form-row"><label>${t('admin.agents.tools')}</label>
              <input id="ed_tools" value='${esc(JSON.stringify(tools))}' />
            </div>
            <div class="form-row"><label>${t('admin.agents.rag_layers')}</label>
              <input id="ed_rag" value='${esc(JSON.stringify(rag))}' />
            </div>
          </div>
          <div class="flex">
            <button class="btn btn-primary" onclick="saveAgent('${a.id}')">${t('common.save')}</button>
            <button class="btn btn-danger" onclick="deleteAgent('${a.id}')">${t('common.delete')}</button>
          </div>
        </div>
      </div>

      <div>
        <div class="card mb-16">
          <h2>${t('admin.agents.live_test')}</h2>
          <div class="form-row">
            <textarea id="test_input" rows="4" placeholder="${t('admin.agents.test_ph')}">Draft a board resolution for dividend declaration</textarea>
          </div>
          <button class="btn btn-primary" onclick="testAgent('${a.id}')">${t('admin.agents.run_test')}</button>
          <div id="testOut" class="mt-12"></div>
        </div>
        <div class="card">
          <h3>${t('admin.agents.recent_runs')}</h3>
          <div id="agentRuns" class="small muted">${t('common.loading')}</div>
        </div>
      </div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
  // Load runs for this agent
  const runsList = await api('/agents/runs/recent');
  const mine = runsList.filter(r => r.agent_id === a.id).slice(0, 5);
  $('#agentRuns').innerHTML = mine.length ? mine.map(r => `
    <div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div class="small">${esc((r.input || '').slice(0, 80))}</div>
      <div class="muted small">${t('common.confidence')} ${((r.confidence || 0) * 100).toFixed(0)}% · ${r.latency_ms}ms · ${new Date(r.created_at).toLocaleString()}</div>
    </div>`).join('') : `<div class="empty small">${t('admin.agents.no_runs')}</div>`;
}
window.editAgent = editAgent;

async function saveAgent(id) {
  const body = {
    name: $('#ed_name').value,
    description: $('#ed_desc').value,
    model: $('#ed_model').value,
    temperature: +$('#ed_temp').value,
    version: $('#ed_ver').value,
    status: $('#ed_status').value,
    system_prompt: $('#ed_prompt').value,
    tools: $('#ed_tools').value,
    rag_layers: $('#ed_rag').value
  };
  await api('/agents/' + id, { method: 'PUT', body });
  alert(t('admin.agents.saved'));
  editAgent(id);
}
window.saveAgent = saveAgent;

async function deleteAgent(id) {
  if (!confirm(t('admin.agents.confirm_del'))) return;
  await api('/agents/' + id, { method: 'DELETE' });
  anav('agents');
}
window.deleteAgent = deleteAgent;

async function testAgent(id) {
  const input = $('#test_input').value;
  $('#testOut').innerHTML = `<div class="muted">${t('common.running')}</div>`;
  const r = await api('/agents/' + id + '/test', { method: 'POST', body: { input, company_id: 'co_skyhawk_001' } });
  $('#testOut').innerHTML = `
    <div class="card" style="background:var(--surface-2)">
      <strong>${esc(r.response.summary || 'Done')}</strong>
      ${(r.response.actions || []).length ? `
        <div class="mt-8"><strong class="small">${t('admin.agents.tool_calls')}</strong></div>
        ${r.response.actions.map(a => `<div class="tool-call">🔧 ${esc(a.tool)}</div>`).join('')}
      ` : ''}
      ${r.rag_citations.length ? `
        <div class="mt-8"><strong class="small">${t('admin.agents.citations')}</strong></div>
        ${r.rag_citations.map(c => `<div class="citation">📚 ${esc(c.title)} (${t('common.score')} ${c.score.toFixed(2)})</div>`).join('')}
      ` : ''}
      <div class="divider"></div>
      <details><summary class="small muted" style="cursor:pointer">${t('admin.agents.raw_json')}</summary>
        <div class="json-box mt-8">${esc(JSON.stringify(r.response, null, 2))}</div>
      </details>
    </div>`;
}
window.testAgent = testAgent;

async function createAgent() {
  const name = prompt(t('admin.agents.prompt_name')); if (!name) return;
  const type = prompt(t('admin.agents.prompt_type'), 'custom') || 'custom';
  const r = await api('/agents', { method: 'POST', body: {
    name, type, description: 'New custom agent',
    system_prompt: 'You are a helpful assistant.', model: 'aicfo-sim-1',
    temperature: 0.2, tools: [], rag_layers: ['L1', 'L2'], status: 'draft'
  }});
  editAgent(r.id);
}
window.createAgent = createAgent;

// ================================================================================
// AGENT RUNS
// ================================================================================
async function runs() {
  const list = await api('/agents/runs/recent');
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.runs.title')}</h1>
    <p class="view-sub">${t('admin.runs.sub')}</p>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>${t('admin.runs.when')}</th><th>Agent</th><th>${t('admin.runs.input')}</th><th>${t('common.confidence')}</th><th>${t('admin.runs.latency')}</th><th>${t('common.status')}</th><th></th></tr></thead>
        <tbody>${list.map(r => `
          <tr>
            <td class="small">${new Date(r.created_at).toLocaleString()}</td>
            <td><strong>${esc(r.agent_name || '—')}</strong></td>
            <td class="small">${esc((r.input || '').slice(0, 80))}</td>
            <td>${((r.confidence || 0) * 100).toFixed(0)}%</td>
            <td>${r.latency_ms}ms</td>
            <td><span class="badge badge-${r.status === 'completed' ? 'success' : 'warning'}">${r.status}</span></td>
            <td><button class="btn btn-sm" onclick='showTrace(${JSON.stringify(JSON.stringify(r)).replace(/'/g, "&apos;")})'>${t('admin.runs.trace_btn')}</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <div id="traceOut"></div>`;
  if (window.I18N) window.I18N.applyDOM();
}

window.showTrace = function(json) {
  const r = JSON.parse(json);
  const trace = r.trace || [];
  $('#traceOut').innerHTML = `
    <div class="card mt-20">
      <h2>${t('admin.runs.trace')}: ${r.id}</h2>
      <div class="flex mb-12">
        <span class="badge badge-info">${r.agent_name}</span>
        <span>${t('common.confidence')} ${((r.confidence || 0) * 100).toFixed(0)}%</span>
        <span>${r.latency_ms}ms</span>
      </div>
      <div class="timeline">
        ${trace.map((s, i) => `
          <div class="timeline-step done">
            <div class="dot">${i + 1}</div>
            <div>
              <div class="step-title">${s.step}</div>
              <div class="json-box mt-8" style="max-height:200px">${esc(JSON.stringify(s.output || s, null, 2).slice(0, 1000))}</div>
            </div>
          </div>`).join('')}
      </div>
      <details class="mt-12"><summary class="small muted" style="cursor:pointer">${t('admin.runs.full_output')}</summary>
        <div class="json-box mt-8">${esc(JSON.stringify(r.output, null, 2))}</div>
      </details>
    </div>`;
};

// ================================================================================
// PLAYGROUND
// ================================================================================
async function playground() {
  await api('/agents'); // warm up
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.pg.title')}</h1>
    <p class="view-sub">${t('admin.pg.sub')}</p>
    <div class="card">
      <div class="inline-row">
        <div class="form-row"><label>${t('admin.pg.query')}</label>
          <textarea id="pg_q" rows="3">What's my ECI for revenue S$500,000 and expenses S$320,000 under SUTR?</textarea>
        </div>
        <div class="form-row" style="max-width:200px">
          <label>${t('admin.pg.co_ctx')}</label>
          <select id="pg_co">
            <option value="co_skyhawk_001">Skyhawk Innovate Pte Ltd</option>
            <option value="">${t('admin.pg.no_co')}</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" onclick="pgRun()">${t('admin.pg.route')}</button>
      <div id="pgOut" class="mt-16"></div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}
window.pgRun = async () => {
  $('#pgOut').innerHTML = `<div class="muted">${t('admin.pg.running')}</div>`;
  const r = await api('/chat/send', { method: 'POST', body: { message: $('#pg_q').value, company_id: $('#pg_co').value, user_id: 'usr_admin_001' } });
  $('#pgOut').innerHTML = `
    <div class="grid grid-2 mt-12">
      <div class="card" style="background:var(--surface-2)">
        <h3>${t('admin.pg.router')}</h3>
        <div class="flex mb-8">
          <span class="badge badge-info">${t('admin.pg.intent')}: ${r.intent}</span>
          <span>${t('common.confidence')} ${(r.confidence * 100).toFixed(0)}%</span>
          ${r.need_human ? `<span class="badge badge-warning">${t('admin.pg.need_human')}</span>` : ''}
        </div>
        <div class="small"><strong>${t('admin.pg.routed_to')}:</strong> ${esc(r.agent.name)} (${r.agent.type})</div>
      </div>
      <div class="card" style="background:var(--surface-2)">
        <h3>${t('admin.pg.grounding')}</h3>
        ${(r.rag_citations || []).map(c => `
          <div class="citation">${esc(c.title)} · ${c.source} · ${c.score.toFixed(2)}</div>
        `).join('') || `<div class="muted small">${t('admin.pg.no_citations')}</div>`}
      </div>
    </div>
    <div class="card mt-16">
      <h3>${t('admin.pg.response')}</h3>
      <div class="mb-12"><strong>${esc(r.response.summary || '')}</strong></div>
      ${(r.response.next_steps || []).length ? `
        <div class="mb-12"><strong class="small">${t('admin.pg.next_steps')}</strong>
          <ul style="margin-left:18px">${r.response.next_steps.map(s => `<li class="small">${esc(s)}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${(r.response.actions || []).length ? `
        <div class="mb-12"><strong class="small">${t('admin.agents.tool_calls')}</strong></div>
        ${r.response.actions.map(a => `
          <div class="json-box mb-8">🔧 ${esc(a.tool)}
${esc(JSON.stringify(a.result, null, 2).slice(0, 600))}</div>
        `).join('')}
      ` : ''}
    </div>
    <details class="mt-16"><summary style="cursor:pointer">${t('admin.pg.full_trace')}</summary>
      <div class="json-box mt-8">${esc(JSON.stringify(r.trace, null, 2))}</div>
    </details>`;
};

// ================================================================================
// RAG KNOWLEDGE BASE
// ================================================================================
async function rag(params = {}) {
  const layer = params.layer || null;
  const list = await api('/rag/documents' + (layer ? '?layer=' + layer : ''));
  const stats = await api('/rag/stats');
  const layers = ['L1_regulatory', 'L2_practice', 'L3_pricing', 'L4_customer'];
  $('#av').innerHTML = `
    <div class="flex-between mb-20">
      <div>
        <h1 class="view-title">${t('admin.rag.title')}</h1>
        <p class="view-sub">${t('admin.rag.sub')}</p>
      </div>
      <div class="flex">
        <button class="btn" onclick="learnFeedback()">${t('admin.rag.learn')}</button>
        <button class="btn btn-primary" onclick="addDoc()">${t('admin.rag.add')}</button>
        <button class="btn btn-success" onclick="aiBuildKB()">🤖 AI 一键建库 (33 主题)</button>
        <button class="btn" onclick="aiBuildStatus()">📊 建库状态</button>
      </div>
    </div>
    <div id="aiBuildPanel"></div>

    <div class="pill-group mb-20">
      <span class="pill ${!layer ? 'active' : ''}" onclick="anav('rag')">${t('admin.rag.all')}</span>
      ${layers.map(l => {
        const s = stats.layers.find(x => x.layer === l);
        return `<span class="pill ${layer === l ? 'active' : ''}" onclick="anav('rag',{layer:'${l}'})">${l.replace('_', ' ')} (${s?.docs || 0})</span>`;
      }).join('')}
    </div>

    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>${t('admin.rag.layer')}</th><th>${t('common.source')}</th><th>${t('admin.rag.title_col')}</th><th>${t('admin.rag.chunks')}</th><th>${t('common.status')}</th><th></th></tr></thead>
        <tbody>${list.map(d => `
          <tr>
            <td><span class="badge badge-info">${d.layer.split('_')[0]}</span></td>
            <td class="small">${esc(d.source)}</td>
            <td><strong>${esc(d.title)}</strong><div class="muted small">${esc((d.preview || '').slice(0, 80))}...</div></td>
            <td>${d.chunk_count}</td>
            <td><span class="badge badge-${d.status === 'indexed' ? 'success' : 'warning'}">${d.status}</span></td>
            <td>
              <button class="btn btn-sm" onclick="viewDoc('${d.id}')">👁</button>
              <button class="btn btn-sm btn-danger" onclick="rmDoc('${d.id}')">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
    <div id="docView"></div>`;
  if (window.I18N) window.I18N.applyDOM();
}

window.viewDoc = async (id) => {
  const d = await api('/rag/documents/' + id);
  $('#docView').innerHTML = `
    <div class="card mt-20">
      <div class="flex-between mb-12">
        <h2>${esc(d.title)}</h2>
        <span class="badge badge-info">${d.layer}</span>
      </div>
      <div class="small muted mb-12">${t('common.source')}: ${esc(d.source)} · ${d.chunks.length} ${t('admin.rag.doc_chunks')} · ${t('common.status')}: ${d.status}</div>
      <div style="max-height:400px;overflow:auto;background:var(--surface-2);padding:14px;border-radius:8px">
        <div class="small">${esc(d.content)}</div>
      </div>
      <div class="mt-16">
        <h3>${t('admin.rag.doc_chunks')} (${d.chunks.length})</h3>
        ${d.chunks.slice(0, 10).map(c => `
          <div class="card mb-8" style="background:var(--surface-2)">
            <div class="muted small">Chunk #${c.chunk_index} · ${c.token_count} ${t('admin.rag.tokens')}</div>
            <div class="small">${esc(c.content.slice(0, 200))}...</div>
          </div>`).join('')}
      </div>
    </div>`;
};

window.rmDoc = async (id) => {
  if (!confirm(t('admin.rag.confirm_del'))) return;
  await api('/rag/documents/' + id, { method: 'DELETE' });
  anav('rag');
};

window.addDoc = () => {
  $('#av').innerHTML = `
    <a onclick="anav('rag')">${t('admin.rag.back')}</a>
    <h1 class="view-title mt-8">${t('admin.rag.ingest_title')}</h1>
    <p class="view-sub">${t('admin.rag.ingest_sub')}</p>
    <div class="card">
      <div class="inline-row">
        <div class="form-row"><label>${t('admin.rag.layer')}</label>
          <select id="nd_layer">
            <option value="L1_regulatory">${t('admin.rag.layer_l1')}</option>
            <option value="L2_practice">${t('admin.rag.layer_l2')}</option>
            <option value="L3_pricing">${t('admin.rag.layer_l3')}</option>
            <option value="L4_customer">${t('admin.rag.layer_l4')}</option>
          </select>
        </div>
        <div class="form-row"><label>${t('common.source')}</label><input id="nd_src" placeholder="e.g. IRAS e-Tax Guide" /></div>
      </div>
      <div class="form-row"><label>${t('admin.rag.title_col')}</label><input id="nd_title" placeholder="e.g. Section 10 - Chargeable Income" /></div>
      <div class="form-row"><label>${t('admin.rag.content')}</label><textarea id="nd_content" rows="14" placeholder="${t('admin.rag.content_ph')}"></textarea></div>
      <div class="form-row"><label>${t('admin.rag.metadata')}</label><input id="nd_meta" placeholder='{"effective_date":"2024-01-01"}' value='{}' /></div>
      <button class="btn btn-primary" onclick="submitDoc()">${t('admin.rag.ingest_btn')}</button>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
};

window.submitDoc = async () => {
  let meta = {};
  try { meta = JSON.parse($('#nd_meta').value || '{}'); } catch (e) {}
  const r = await api('/rag/ingest', { method: 'POST', body: {
    layer: $('#nd_layer').value, source: $('#nd_src').value,
    title: $('#nd_title').value, content: $('#nd_content').value, metadata: meta
  }});
  alert(t('admin.rag.ingested_msg', { n: r.chunks }));
  anav('rag');
};

window.learnFeedback = async () => {
  const r = await api('/rag/learn', { method: 'POST', body: {} });
  alert(t('admin.rag.learn_msg', { n: r.promoted }));
};

window.aiBuildKB = async () => {
  if (!confirm('将调用 GPT 自动生成 33 篇新加坡合规主题知识库(覆盖注册/法律/审计/报税),写入 L1/L2/L3 RAG 层。\n预计 5 分钟,期间请勿刷新。\n继续?')) return;
  const panel = document.getElementById('aiBuildPanel');
  panel.innerHTML = '<div class="card mt-20"><div class="muted">⏳ GPT 正在批量生成知识文档 (concurrency=3, skip_existing=true)...</div></div>';
  try {
    const r = await api('/rag/ai-build/run', { method: 'POST', body: { concurrency: 3, skip_existing: true } });
    if (!r.ok) { panel.innerHTML = `<div class="card mt-20"><div class="badge badge-danger">❌ ${esc(r.error || '失败')}</div></div>`; return; }
    panel.innerHTML = `<div class="card mt-20">
      <div class="badge badge-success">✅ AI 建库完成</div>
      <div class="grid grid-4 mt-12">
        <div class="stat-card"><div class="stat-label">总主题</div><div class="stat-value">${r.total || 33}</div></div>
        <div class="stat-card"><div class="stat-label">已入库</div><div class="stat-value" style="color:var(--success)">${r.ingested || 0}</div></div>
        <div class="stat-card"><div class="stat-label">跳过</div><div class="stat-value">${r.skipped || 0}</div></div>
        <div class="stat-card"><div class="stat-label">失败</div><div class="stat-value" style="color:var(--danger)">${r.errors || 0}</div></div>
      </div>
      <div class="mt-12 small muted">耗时 ${((r.latency_ms || 0)/1000).toFixed(1)}s · 下方列表已更新</div>
    </div>`;
    setTimeout(() => anav('rag'), 2000);
  } catch (e) { panel.innerHTML = `<div class="card mt-20"><div class="badge badge-danger">❌ ${esc(e.message)}</div></div>`; }
};

window.aiBuildStatus = async () => {
  const panel = document.getElementById('aiBuildPanel');
  try {
    const r = await api('/rag/ai-build/status');
    const layers = (r.rag?.by_layer || []).map(l => `${l.layer}: ${l.docs}`).join(' · ');
    panel.innerHTML = `<div class="card mt-20">
      <h3>📊 AI 建库状态</h3>
      <div class="grid grid-4 mt-12">
        <div class="stat-card"><div class="stat-label">RAG 总文档</div><div class="stat-value">${r.rag?.total_docs || 0}</div></div>
        <div class="stat-card"><div class="stat-label">AI 生成</div><div class="stat-value" style="color:var(--primary)">${r.ai_generated || 0}</div></div>
        <div class="stat-card"><div class="stat-label">用户上传</div><div class="stat-value">${r.uploaded || 0}</div></div>
        <div class="stat-card"><div class="stat-label">候选主题</div><div class="stat-value">${r.total_topics || 33}</div></div>
      </div>
      <div class="mt-12 small muted">分层: ${esc(layers)}</div>
      <div class="mt-8 small">✓ ai_chat_ready: ${r.ai_chat_ready ? '✅' : '❌'} · kb_builder_ready: ${r.kb_builder_ready ? '✅' : '❌'} · file_ingest_ready: ${r.file_ingest_ready ? '✅' : '❌'}</div>
    </div>`;
  } catch (e) { panel.innerHTML = `<div class="card mt-20"><div class="badge badge-danger">❌ ${esc(e.message)}</div></div>`; }
};

// ================================================================================
// TRAINING JOBS
// ================================================================================
async function training() {
  const jobs = await api('/rag/training/jobs');
  $('#av').innerHTML = `
    <div class="flex-between mb-20">
      <div>
        <h1 class="view-title">${t('admin.training.title')}</h1>
        <p class="view-sub">${t('admin.training.sub')}</p>
      </div>
      <button class="btn btn-primary" onclick="launchJob()">${t('admin.training.launch')}</button>
    </div>

    <div class="grid grid-3 mb-20">
      <div class="card stat-card"><div class="stat-label">${t('admin.training.total_jobs')}</div><div class="stat-value">${jobs.length}</div></div>
      <div class="card stat-card"><div class="stat-label">${t('admin.training.completed')}</div><div class="stat-value">${jobs.filter(j => j.status === 'completed').length}</div></div>
      <div class="card stat-card"><div class="stat-label">${t('admin.training.tokens_emb')}</div><div class="stat-value">${jobs.reduce((s, j) => s + (j.tokens_embedded || 0), 0).toLocaleString()}</div></div>
    </div>

    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>${t('admin.training.job')}</th><th>${t('admin.rag.layer')}</th><th>${t('admin.training.docs')}</th><th>${t('admin.rag.chunks')}</th><th>Tokens</th><th>${t('common.status')}</th><th>${t('admin.training.duration')}</th><th></th></tr></thead>
        <tbody>${jobs.map(j => {
          const dur = j.finished_at && j.started_at ? ((new Date(j.finished_at) - new Date(j.started_at)) / 1000).toFixed(1) + 's' : '—';
          return `
          <tr>
            <td><strong>${esc(j.name)}</strong><div class="muted small">${j.id}</div></td>
            <td><span class="badge badge-info">${j.layer}</span></td>
            <td>${j.docs_processed}</td>
            <td>${j.chunks_created}</td>
            <td>${(j.tokens_embedded || 0).toLocaleString()}</td>
            <td><span class="badge badge-${j.status === 'completed' ? 'success' : (j.status === 'failed' ? 'danger' : 'warning')}">${j.status}</span></td>
            <td class="small">${dur}</td>
            <td><button class="btn btn-sm" onclick="viewJob('${j.id}')">${t('admin.training.logs')}</button></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table></div>
    </div>
    <div id="jobLogs"></div>`;
  if (window.I18N) window.I18N.applyDOM();
}

window.viewJob = (id) => {
  api('/rag/training/jobs').then(jobs => {
    const j = jobs.find(x => x.id === id);
    $('#jobLogs').innerHTML = `
      <div class="card mt-20">
        <h2>${t('admin.training.logs_for')} ${esc(j.name)}</h2>
        <div class="json-box">${j.logs.map(l => `[${new Date(l.ts).toLocaleTimeString()}] ${esc(l.msg)}`).join('\n')}</div>
      </div>`;
  });
};

window.launchJob = () => {
  $('#av').innerHTML = `
    <a onclick="anav('training')">${t('admin.training.back')}</a>
    <h1 class="view-title mt-8">${t('admin.training.launch_title')}</h1>
    <p class="view-sub">${t('admin.training.launch_sub')}</p>
    <div class="card">
      <div class="inline-row">
        <div class="form-row"><label>${t('admin.training.job_name')}</label><input id="tj_name" value="IRAS Tax Updates 2025" /></div>
        <div class="form-row"><label>${t('admin.training.target_layer')}</label>
          <select id="tj_layer">
            <option value="L1_regulatory">L1 Regulatory</option>
            <option value="L2_practice" selected>L2 Practice</option>
            <option value="L3_pricing">L3 Pricing</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <label>${t('admin.training.docs_label')}</label>
        <textarea id="tj_docs" class="code-editor" rows="14">[
  {
    "source": "IRAS e-Tax Guide",
    "title": "Income Tax Treatment of Foreign-Sourced Income",
    "content": "Foreign-sourced income received in Singapore by a company is exempt from tax under Section 13(8) if the following conditions are met: (1) headline tax rate in foreign jurisdiction is at least 15%, (2) foreign income has been subjected to tax in that jurisdiction, (3) Comptroller is satisfied the exemption is beneficial to the person."
  },
  {
    "source": "ACRA Notice",
    "title": "Small Company Audit Exemption Criteria 2024",
    "content": "A company is a 'small company' and exempt from audit if it meets at least 2 of 3 criteria: (1) total annual revenue <= S$10 million, (2) total assets <= S$10 million, (3) number of employees <= 50. This applies for 2 consecutive financial years."
  }
]</textarea>
      </div>
      <button class="btn btn-primary" onclick="runJob()">${t('admin.training.run')}</button>
      <div id="jobOut" class="mt-12"></div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
};

window.runJob = async () => {
  let docs;
  try { docs = JSON.parse($('#tj_docs').value); } catch (e) { return alert(t('admin.training.invalid_json')); }
  $('#jobOut').innerHTML = `<div class="muted">${t('admin.training.running')}</div>`;
  const r = await api('/rag/training/run', { method: 'POST', body: {
    name: $('#tj_name').value, layer: $('#tj_layer').value, docs, user_id: 'usr_admin_001'
  }});
  $('#jobOut').innerHTML = `
    <div class="card" style="background:var(--surface-2)">
      <strong>${t('admin.training.completed_msg')}</strong>
      <div class="small mt-8">${t('admin.training.docs')}: ${r.docs_processed} · ${t('admin.rag.chunks')}: ${r.chunks_created} · Tokens: ${r.tokens_embedded.toLocaleString()}</div>
      <button class="btn mt-12" onclick="anav('training')">${t('admin.training.view_in')}</button>
    </div>`;
};

// ================================================================================
// RETRIEVAL TEST
// ================================================================================
async function retrieval() {
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.retrieval.title')}</h1>
    <p class="view-sub">${t('admin.retrieval.sub')}</p>
    <div class="card">
      <div class="form-row">
        <label>${t('admin.pg.query')}</label>
        <input id="rt_q" value="What's the corporate tax rate and SUTR eligibility?" />
      </div>
      <div class="inline-row">
        <div class="form-row"><label>${t('admin.retrieval.layers')}</label>
          <input id="rt_layers" value="L1_regulatory,L2_practice,L3_pricing,L4_customer" />
        </div>
        <div class="form-row"><label>${t('admin.retrieval.topk')}</label><input id="rt_k" type="number" value="5" /></div>
      </div>
      <button class="btn btn-primary" onclick="doRetrieve()">${t('admin.retrieval.run')}</button>
      <div id="retrieveOut" class="mt-16"></div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}
window.doRetrieve = async () => {
  const r = await api('/rag/search', { method: 'POST', body: {
    query: $('#rt_q').value,
    layers: $('#rt_layers').value.split(',').map(s => s.trim()).filter(Boolean),
    k: +$('#rt_k').value
  }});
  $('#retrieveOut').innerHTML = `
    <h3>${t('admin.retrieval.top_results')} ${r.hits.length} ${t('admin.retrieval.results')}</h3>
    ${r.hits.map((h, i) => `
      <div class="card mb-8" style="background:var(--surface-2)">
        <div class="flex-between mb-8">
          <strong>#${i + 1} · ${esc(h.title)}</strong>
          <span class="badge badge-info">${h.layer.split('_')[0]}</span>
        </div>
        <div class="small mb-8">${esc(h.content.slice(0, 250))}...</div>
        <div class="muted small">
          ${t('common.source')}: ${esc(h.source)} · ${t('admin.retrieval.total')}: <strong>${h.score.toFixed(3)}</strong> · ${t('admin.retrieval.vector')}: ${h.vectorScore.toFixed(3)} · ${t('admin.retrieval.keyword')}: ${h.kwScore.toFixed(3)}
        </div>
      </div>`).join('') || `<div class="empty">${t('admin.retrieval.no_results')}</div>`}`;
};

// ================================================================================
// COMPANIES
// ================================================================================
async function companies() {
  const list = await api('/companies');
  const activationBadge = (s) => {
    const m = { draft: ['warning', '草稿'], paid: ['info', '已付费'], live: ['success', '运营中'] };
    const [cls, label] = m[s] || ['secondary', s || '—'];
    return `<span class="badge badge-${cls}">${label}</span>`;
  };
  const stageBadge = (s) => {
    if (!s) return '<span class="muted small">—</span>';
    const m = {
      created: ['secondary', '🆕 创建'],
      kyc: ['info', '🧪 KYC'],
      constitution: ['info', '📜 章程'],
      signed: ['info', '✍️ 已签'],
      reviewing: ['warning', '👁️ 审核'],
      paid: ['info', '💳 已付'],
      bizfile: ['warning', '📤 Bizfile'],
      completed: ['success', '✅ 完成']
    };
    const [cls, label] = m[s] || ['secondary', s];
    return `<span class="badge badge-${cls}">${label}</span>`;
  };
  $('#av').innerHTML = `
    <div class="flex-between mb-20">
      <div>
        <h1 class="view-title">🏢 实体总览 (Entity Overview)</h1>
        <p class="view-sub">每家公司作为独立实体：注册阶段 → 付费状态 → 记账/税务/归档进度统一可视</p>
      </div>
      <button class="btn" onclick="anav('companies')">🔄 刷新</button>
    </div>

    <div class="grid grid-4 mb-20">
      <div class="card stat-card"><div class="stat-label">公司总数</div><div class="stat-value">${list.length}</div></div>
      <div class="card stat-card"><div class="stat-label">已激活 (Live)</div><div class="stat-value" style="color:var(--success)">${list.filter(c => c.activation_status === 'live').length}</div></div>
      <div class="card stat-card"><div class="stat-label">已付费待激活</div><div class="stat-value" style="color:var(--info)">${list.filter(c => c.activation_status === 'paid').length}</div></div>
      <div class="card stat-card"><div class="stat-label">注册中 (Draft)</div><div class="stat-value" style="color:var(--warning)">${list.filter(c => (c.activation_status || 'draft') === 'draft').length}</div></div>
    </div>

    <div class="card">
      <div class="flex-between mb-12">
        <h2 style="margin:0">📋 实体清单</h2>
        <div class="small muted">每行代表一家独立运营的公司实体</div>
      </div>
      <div class="table-wrap"><table>
        <thead>
          <tr>
            <th>公司 / UEN</th>
            <th>激活状态</th>
            <th>注册阶段</th>
            <th>付款</th>
            <th>章程</th>
            <th>记账</th>
            <th>税务</th>
            <th>套餐</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>${(list || []).map(c => {
          const paid = c.payment_status === 'succeeded' ? '<span class="badge badge-success">已付</span>' :
                       c.payment_status === 'pending' ? '<span class="badge badge-warning">待付</span>' :
                       '<span class="muted small">—</span>';
          const consti = (c.documents_count || 0) > 0
            ? `<span class="badge badge-info">${c.documents_count} 份</span>`
            : '<span class="muted small">—</span>';
          const books = (c.transactions_count || 0) > 0
            ? `<span class="badge badge-success">${c.transactions_count} 笔</span>`
            : '<span class="muted small">—</span>';
          const tax = (c.tax_filings_count || 0) > 0
            ? `<span class="badge badge-info">${c.tax_filings_count} 份</span>`
            : '<span class="muted small">—</span>';
          return `
            <tr>
              <td>
                <div><strong>${esc(c.name)}</strong></div>
                <div class="mono small muted">${c.uen || '未分配'}</div>
              </td>
              <td>${activationBadge(c.activation_status || 'draft')}</td>
              <td>${stageBadge(c.latest_stage)}</td>
              <td>${paid}</td>
              <td>${consti}</td>
              <td>${books}</td>
              <td>${tax}</td>
              <td>${c.subscription_tier || 'basic'}</td>
              <td class="small muted">${new Date(c.created_at).toLocaleDateString()}</td>
            </tr>`;
        }).join('')}
        </tbody>
      </table></div>
    </div>

    <div class="card mt-20">
      <h3 style="margin-top:0">🔄 逻辑说明</h3>
      <div class="small muted" style="line-height:1.8">
        <div>• <strong>Draft</strong>：已创建订单，但尚未完成付款，仅可走注册流程图的各个 Gate（命名 → SSIC → 股本 → KYC → 章程 → 签名）</div>
        <div>• <strong>Paid</strong>：Stripe 付款成功后进入，解锁记账 / 税务 / 报表模块，同时继续走 Bizfile 提交流程</div>
        <div>• <strong>Live</strong>：ACRA 通过、UEN 下发后自动激活，所有模块可全功能使用</div>
      </div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}

// ================================================================================
// USERS
// ================================================================================
async function users() {
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.users.title')}</h1>
    <p class="view-sub">${t('admin.users.sub')}</p>
    <div class="card">
      <div class="empty">${t('admin.users.stub')}</div>
    </div>`;
  if (window.I18N) window.I18N.applyDOM();
}

// ================================================================================
// USER FINANCE ARCHIVES — 用户财务档案统一管理
// ================================================================================
async function archives() {
  const { archives: list = [] } = await api('/admin/archives');
  $('#av').innerHTML = `
    <div class="flex-between mb-20">
      <div>
        <h1 class="view-title">📁 用户财务档案</h1>
        <p class="view-sub">付费用户通过 WhatsApp 上传的发票/流水/报表统一归档（按用户/月维度聚合）</p>
      </div>
      <button class="btn" onclick="anav('archives')">🔄 刷新</button>
    </div>

    <div class="grid grid-4 mb-20">
      <div class="card stat-card"><div class="stat-label">档案总数</div><div class="stat-value">${list.length}</div></div>
      <div class="card stat-card"><div class="stat-label">累计发票</div><div class="stat-value">${list.reduce((s, a) => s + (a.invoice_count||0), 0)}</div></div>
      <div class="card stat-card"><div class="stat-label">累计流水</div><div class="stat-value">${list.reduce((s, a) => s + (a.txn_count||0), 0)}</div></div>
      <div class="card stat-card"><div class="stat-label">累计收入</div><div class="stat-value">S$${fmt(list.reduce((s, a) => s + (a.total_revenue||0), 0))}</div></div>
    </div>

    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>用户</th><th>公司</th><th>月份</th>
          <th>发票</th><th>流水</th><th>收据</th>
          <th>收入</th><th>支出</th>
          <th>WhatsApp</th><th>消息数</th><th>最近活动</th><th></th>
        </tr></thead>
        <tbody>${list.map(a => `
          <tr>
            <td>
              <div><b>${esc(a.name || '-')}</b></div>
              <div class="small muted">${esc(a.email || '')}</div>
              <div class="small muted mono">${esc(a.user_id)}</div>
            </td>
            <td>
              <div class="small">${esc(a.company_name || '-')}</div>
              <div class="small muted mono">${esc(a.uen || a.company_id || '-')}</div>
            </td>
            <td class="mono small">${esc(a.archive_date || '-')}</td>
            <td><span class="badge badge-info">${a.invoice_count || 0}</span></td>
            <td><span class="badge badge-info">${a.txn_count || 0}</span></td>
            <td>${a.receipt_count || 0}</td>
            <td class="mono small" style="color:var(--success)">S$${fmt(a.total_revenue || 0)}</td>
            <td class="mono small" style="color:var(--danger)">S$${fmt(a.total_expense || 0)}</td>
            <td class="small mono">${esc(a.wa_phone || '未绑定')}</td>
            <td>${a.message_count || 0}</td>
            <td class="mono small">${esc((a.last_message_at || '').slice(5, 16) || '-')}</td>
            <td><button class="btn btn-sm" onclick="viewUserArchive('${esc(a.user_id)}')">👁 详情</button></td>
          </tr>`).join('') || '<tr><td colspan="12" class="empty">暂无用户档案</td></tr>'}
        </tbody>
      </table></div>
    </div>
    <div id="userArchiveDetail" class="mt-20"></div>`;
}

window.viewUserArchive = async (user_id) => {
  const r = await api('/archive/user?user_id=' + user_id);
  const ch = r.channel || {};
  const recent = r.recent_messages || [];
  $('#userArchiveDetail').innerHTML = `
    <div class="card">
      <div class="flex-between mb-12">
        <h2>👤 用户档案详情</h2>
        <button class="btn btn-sm" onclick="document.getElementById('userArchiveDetail').innerHTML=''">✖ 关闭</button>
      </div>
      <div class="grid grid-3 mb-12">
        <div><div class="small muted">user_id</div><div class="mono">${esc(user_id)}</div></div>
        <div><div class="small muted">Finance Token</div><div class="mono">${esc(ch.finance_token || '-')}</div></div>
        <div><div class="small muted">Bound WhatsApp</div><div class="mono">${esc(ch.wa_phone || '-')}</div></div>
      </div>

      <div class="grid grid-2">
        <div>
          <h3>🕐 最近 WhatsApp 消息 (${recent.length})</h3>
          <div class="table-wrap" style="max-height:360px;overflow:auto"><table>
            <thead><tr><th>时间</th><th>类型</th><th>内容</th><th>分类</th><th>挂钩</th></tr></thead>
            <tbody>${recent.map(m => `
              <tr>
                <td class="mono small">${esc((m.received_at||'').slice(5,16))}</td>
                <td><span class="badge badge-info">${esc(m.msg_type)}</span></td>
                <td class="small">${esc((m.content||'').slice(0,40))}</td>
                <td><span class="badge badge-${m.classified_as==='invoice'?'success':m.classified_as==='bank_txn'?'info':'warning'}">${esc(m.classified_as)}</span></td>
                <td class="mono small">${esc(m.linked_entity_id || '-')}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted small">暂无</td></tr>'}
            </tbody>
          </table></div>
        </div>
        <div>
          <h3>🧾 发票 (${(r.invoices||[]).length}) + 🏦 流水 (${(r.transactions||[]).length})</h3>
          <div class="table-wrap" style="max-height:360px;overflow:auto"><table>
            <thead><tr><th>类型</th><th>日期</th><th>金额</th><th>说明</th></tr></thead>
            <tbody>
              ${(r.invoices||[]).map(i => `<tr><td>🧾</td><td class="mono small">${esc(i.issue_date)}</td><td class="mono small">S$${fmt(i.total)}</td><td class="small">${esc(i.vendor_name)}</td></tr>`).join('')}
              ${(r.transactions||[]).map(t => `<tr><td>🏦</td><td class="mono small">${esc(t.transaction_date)}</td><td class="mono small" style="color:${t.amount<0?'var(--danger)':'var(--success)'}">${t.amount<0?'-':'+'}${fmt(Math.abs(t.amount))}</td><td class="small">${esc((t.description||'').slice(0,40))}</td></tr>`).join('')}
              ${((r.invoices||[]).length + (r.transactions||[]).length === 0) ? '<tr><td colspan="4" class="muted small">暂无数据</td></tr>' : ''}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>`;
};

// ================================================================================
// WHATSAPP CHANNELS — WhatsApp 渠道列表
// ================================================================================
async function waChannels() {
  const { channels = [] } = await api('/admin/wa/channels');
  $('#av').innerHTML = `
    <div class="flex-between mb-20">
      <div>
        <h1 class="view-title">📱 WhatsApp 财务渠道</h1>
        <p class="view-sub">每个付费用户自动生成专属 finance_token, 绑定 WhatsApp 号, 接收财务物料</p>
      </div>
      <button class="btn" onclick="anav('waChannels')">🔄 刷新</button>
    </div>

    <div class="grid grid-4 mb-20">
      <div class="card stat-card"><div class="stat-label">渠道总数</div><div class="stat-value">${channels.length}</div></div>
      <div class="card stat-card"><div class="stat-label">已绑定</div><div class="stat-value" style="color:var(--success)">${channels.filter(c=>c.wa_phone).length}</div></div>
      <div class="card stat-card"><div class="stat-label">累计消息</div><div class="stat-value">${channels.reduce((s,c)=>s+(c.message_count||0),0)}</div></div>
      <div class="card stat-card"><div class="stat-label">Active</div><div class="stat-value">${channels.filter(c=>c.status==='active').length}</div></div>
    </div>

    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>用户</th><th>公司</th><th>Finance Token</th>
          <th>Bot</th><th>已绑定号码</th><th>状态</th>
          <th>消息数</th><th>最近消息</th><th>创建</th><th></th>
        </tr></thead>
        <tbody>${channels.map(c => `
          <tr>
            <td>
              <div><b>${esc(c.name || '-')}</b></div>
              <div class="small muted">${esc(c.email || '')}</div>
            </td>
            <td class="small">${esc(c.company_name || '-')}</td>
            <td class="mono small"><b>${esc(c.finance_token)}</b></td>
            <td class="mono small">+${esc(c.bot_phone)}</td>
            <td class="mono small">${esc(c.wa_phone || '未绑定')}</td>
            <td><span class="badge badge-${c.status==='active'?'success':'warning'}">${esc(c.status)}</span></td>
            <td>${c.message_count || 0}</td>
            <td class="mono small">${esc((c.last_message_at||'').slice(5,16) || '-')}</td>
            <td class="mono small">${esc((c.created_at||'').slice(5,16))}</td>
            <td><button class="btn btn-sm" onclick="viewUserArchive('${esc(c.user_id)}')">👁</button></td>
          </tr>`).join('') || '<tr><td colspan="10" class="empty">暂无 WhatsApp 渠道</td></tr>'}
        </tbody>
      </table></div>
    </div>
    <div id="userArchiveDetail" class="mt-20"></div>`;
}

// ================================================================================
// ⚡ 模型网关 (Tokenhot.ai 统一 API)
// ================================================================================
async function llmGateway() {
  const app = document.getElementById('av');
  if (!app) { console.error('[llmGateway] #av container not found'); return; }
  app.innerHTML = `<div class="card"><h3>⚡ 模型网关 (Tokenhot.ai)</h3>
    <p class="muted">⏳ 加载中 · 正在并发检测账号下可用模型与三个 tier 连通状态…</p>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <span class="badge">读取配置</span><span class="badge">/v1/models 发现</span><span class="badge">三 tier 自动探测</span>
    </div></div>`;

  // 并发：配置 + 日志 + 发现可用模型 + 三 tier 自动探测（进入页面自动检测）
  let cfg = {};
  let logsResp = { stats: {}, logs: [] };
  let discover = { ok: false, models: [] };
  let probe    = { ok: false, results: [] };
  try {
    const [r1, r2, r3, r4] = await Promise.allSettled([
      api('/admin/llm/config'),
      api('/admin/llm/logs?limit=30'),
      api('/admin/llm/models/discover'),
      api('/admin/llm/probe', { method: 'POST' })
    ]);
    if (r1.status === 'fulfilled') cfg      = r1.value.config || {};
    if (r2.status === 'fulfilled') logsResp = r2.value || logsResp;
    if (r3.status === 'fulfilled') discover = r3.value || discover;
    if (r4.status === 'fulfilled') probe    = r4.value || probe;
    if (r1.status !== 'fulfilled') throw r1.reason || new Error('config failed');
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>⚡ 模型网关</h3><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
    return;
  }

  const stats = logsResp.stats || {};
  const logs  = logsResp.logs  || [];
  const models = cfg.models || {};
  const avail  = cfg.available_models || { reasoning: [], fast: [], default: [] };
  const tierMap = cfg.tier_by_purpose || {};

  // 账号下真实可用的模型（由 /admin/llm/models/discover 返回）
  const liveModels = Array.isArray(discover.models) ? discover.models : [];
  const liveSet    = new Set(liveModels);

  // 三 tier 自动探测结果 (由 /admin/llm/probe 返回)
  const probeMap = {};
  (probe.results || []).forEach(r => { probeMap[r.tier] = r; });

  function modelSelect(tier, selected) {
    // 若发现到真实模型列表，则合并 (白名单 ∪ 实际可用)；否则退回到配置里的白名单
    const combined = liveModels.length
      ? Array.from(new Set([...(avail[tier] || []), ...liveModels])).sort()
      : (avail[tier] || []);
    const opts = combined.map(m => {
      const live = liveSet.has(m) ? ' · ✓' : ' · ⚠︎';
      const tag  = liveModels.length ? live : '';
      return `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}${tag}</option>`;
    }).join('');
    return `<select id="model_${tier}" class="input" style="min-width:240px">${opts}</select>`;
  }

  function tierSelect(purpose, selected) {
    return `<select data-purpose="${esc(purpose)}" class="input tier-select">
      <option value="reasoning" ${selected === 'reasoning' ? 'selected' : ''}>reasoning (最强推理)</option>
      <option value="fast"      ${selected === 'fast'      ? 'selected' : ''}>fast (快速分析)</option>
      <option value="default"   ${selected === 'default'   ? 'selected' : ''}>default (日常)</option>
    </select>`;
  }

  const purposeRows = Object.keys(tierMap).map(p => `
    <tr>
      <td style="font-family:monospace;font-size:12px">${esc(p)}</td>
      <td>${tierSelect(p, tierMap[p])}</td>
    </tr>`).join('');

  const logRows = logs.map(l => `
    <tr>
      <td style="font-size:11px;color:#64748b">${esc((l.created_at || '').replace('T',' ').slice(0,19))}</td>
      <td><span class="badge">${esc(l.tier || '-')}</span></td>
      <td style="font-family:monospace;font-size:11px">${esc(l.model || '-')}</td>
      <td style="font-size:11px">${esc(l.purpose || '-')}</td>
      <td style="text-align:right">${l.latency_ms || 0} ms</td>
      <td style="text-align:right">${(l.tokens_in||0)+'/'+(l.tokens_out||0)}</td>
      <td>${l.status === 'ok'
          ? '<span style="color:#10b981">✓ ok</span>'
          : `<span style="color:#ef4444" title="${esc(l.error||'')}">✗ err</span>`}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">暂无调用日志</td></tr>';


  // 🔍 自动检测看板：发现 + 三 tier 连通状态
  const probeCards = ['reasoning','fast','default'].map(tier => {
    const r = probeMap[tier] || { ok:false, skipped:true, model: models[tier] };
    const color = r.skipped ? '#94a3b8' : (r.ok ? '#10b981' : '#ef4444');
    const bg    = r.skipped ? '#f8fafc' : (r.ok ? '#ecfdf5' : '#fef2f2');
    const label = r.skipped ? '⚪ 跳过' : (r.ok ? '🟢 可用' : '🔴 失败');
    const sub   = r.skipped ? (r.reason || 'gateway 未就绪')
                : r.ok ? `${r.latency_ms||0} ms · reply=${esc((r.reply||'').slice(0,24))}`
                       : esc((r.error || 'error').slice(0,80));
    return `<div class="kv" style="background:${bg};border-left:4px solid ${color};padding:12px;border-radius:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <b style="color:${color}">${label}</b>
        <span class="badge" style="background:#fff;border:1px solid #e5e7eb">${esc(tier)}</span>
      </div>
      <div style="font-family:monospace;font-size:12px;color:#0f172a;margin-bottom:2px">${esc(r.model || '-')}</div>
      <div class="muted" style="font-size:11px">${sub}</div>
    </div>`;
  }).join('');

  const discoverBadge = discover.ok
    ? `<span style="color:#10b981">🟢 已发现 <b>${discover.count || liveModels.length}</b> 个真实可用模型</span>
       · <span class="muted" style="font-size:11px">latency ${discover.latency_ms||0} ms</span>`
    : (discover.ready === false
       ? `<span style="color:#94a3b8">⚪ 未配置 API Key，跳过发现</span>`
       : `<span style="color:#ef4444">🔴 发现失败</span>
          <span class="muted" style="font-size:11px">· ${esc((discover.error||'unknown').slice(0,80))}</span>`);

  const top20 = liveModels.slice(0, 20).map(m =>
    `<code style="background:#f1f5f9;border:1px solid #e2e8f0;padding:2px 6px;border-radius:4px;font-size:11px;margin:2px;display:inline-block">${esc(m)}</code>`
  ).join('');

  app.innerHTML = `
    <!-- 🔍 自动检测看板（进入页面自动触发） -->
    <div class="card" style="border:2px solid #0ea5e9;background:linear-gradient(180deg,#f0f9ff 0%,#fff 40%)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0">🔍 自动检测结果 <span class="muted" style="font-size:12px;font-weight:normal">(每次进入页面自动跑)</span></h3>
        <button class="btn btn-sm" onclick="anav('llmGateway')">🔄 重新检测</button>
      </div>

      <div style="margin:10px 0 14px">${discoverBadge}</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:14px">
        ${probeCards}
      </div>

      ${liveModels.length ? `
      <details style="margin-top:8px">
        <summary style="cursor:pointer;color:#0284c7;font-size:13px">
          📋 展开账号全部 ${liveModels.length} 个可用模型
        </summary>
        <div style="padding:10px 0 4px;line-height:1.9">${top20}
          ${liveModels.length > 20 ? `<span class="muted" style="font-size:11px"> … 及其他 ${liveModels.length - 20} 个</span>` : ''}
        </div>
      </details>` : ''}
    </div>

    <div class="card mt-20">
      <h3>⚡ 模型网关 (Tokenhot.ai 统一 API)</h3>
      <p class="muted">
        一个 API Key 即可调用 100+ 模型（GPT-5.2 / Claude Opus 4.6 / Gemini 3 Pro / DeepSeek V3.2 …）。
        所有后端 Agent / RAG / OCR / 记账调用全部经此网关出口，支持按 <b>tier</b> 切换模型
        （<code>reasoning</code> = 最强推理，<code>fast</code> = 快速分析，<code>default</code> = 日常）。
      </p>

      <div class="kv-grid" style="margin:10px 0 20px">
        <div class="kv"><span class="muted">Provider</span><b>${esc(cfg.provider || '-')}</b></div>
        <div class="kv"><span class="muted">API Key</span><b>${cfg.api_key_set ? '✓ '+esc(cfg.api_key_preview) : '<span style=\"color:#ef4444\">未配置</span>'}</b></div>
        <div class="kv"><span class="muted">Enabled</span><b>${cfg.enabled ? '✓' : '✗'}</b></div>
        <div class="kv"><span class="muted">总调用</span><b>${stats.total_calls || 0}</b></div>
        <div class="kv"><span class="muted">成功率</span><b>${stats.success_rate || 0}%</b></div>
        <div class="kv"><span class="muted">平均延迟</span><b>${stats.avg_latency_ms || 0} ms</b></div>
      </div>

      <h4>🔑 凭证与端点</h4>
      <div class="form-grid">
        <label>Provider
          <select id="gw_provider" class="input">
            <option value="tokenhot"       ${cfg.provider==='tokenhot'      ?'selected':''}>tokenhot (推荐)</option>
            <option value="openai"         ${cfg.provider==='openai'        ?'selected':''}>openai (官方)</option>
            <option value="genspark-proxy" ${cfg.provider==='genspark-proxy'?'selected':''}>genspark-proxy</option>
            <option value="custom"         ${cfg.provider==='custom'        ?'selected':''}>custom</option>
          </select>
        </label>
        <label>Base URL
          <input id="gw_base_url" class="input" value="${esc(cfg.base_url || '')}" placeholder="https://api.tokenhot.ai/v1" />
        </label>
        <label>API Key <span class="muted">(留空保留原值)</span>
          <input id="gw_api_key" class="input" type="password" placeholder="sk-xxxxxxxx (留空不变)" autocomplete="new-password" />
        </label>
        <label>启用
          <select id="gw_enabled" class="input">
            <option value="1" ${cfg.enabled?'selected':''}>✓ 启用</option>
            <option value="0" ${!cfg.enabled?'selected':''}>✗ 停用 (走 offline 模拟)</option>
          </select>
        </label>
      </div>

      <h4 class="mt-20">🎯 Tier → 模型路由</h4>
      <div class="form-grid">
        <label><b style="color:#0ea5e9">reasoning</b> 最强推理
          ${modelSelect('reasoning', models.reasoning)}
        </label>
        <label><b style="color:#10b981">fast</b> 快速分析
          ${modelSelect('fast', models.fast)}
        </label>
        <label><b>default</b> 日常核心
          ${modelSelect('default', models.default)}
        </label>
      </div>

      <h4 class="mt-20">🧩 用途 → Tier 映射（各 Agent 默认走哪个 tier）</h4>
      <div class="table-wrap" style="max-width:640px">
        <table class="table"><thead>
          <tr><th>用途 (purpose)</th><th>Tier</th></tr>
        </thead><tbody>${purposeRows}</tbody></table>
      </div>

      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveLlmGateway(this)">💾 保存配置</button>
        <button class="btn" onclick="testLlmGateway('fast',this)">⚡ 测试连通 (fast)</button>
        <button class="btn" onclick="testLlmGateway('reasoning',this)">🧠 测试连通 (reasoning)</button>
        <button class="btn" onclick="anav('llmGateway')">🔄 刷新</button>
      </div>
      <div id="gw_test_result" class="mt-20"></div>
    </div>

    <div class="card mt-20">
      <h3>📜 最近调用日志</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th>时间</th><th>Tier</th><th>模型</th><th>用途</th>
          <th style="text-align:right">延迟</th><th style="text-align:right">tok in/out</th><th>状态</th>
        </tr></thead>
        <tbody>${logRows}</tbody>
      </table></div>
    </div>`;
}

// Lightweight toast (fixed top-right, auto-dismiss 3s)
window.gwToast = function (msg, type = 'ok') {
  let box = document.getElementById('gw_toast_box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'gw_toast_box';
    box.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  const color = type === 'ok' ? '#10b981' : type === 'err' ? '#ef4444' : '#0ea5e9';
  el.style.cssText = `background:#fff;border-left:4px solid ${color};padding:12px 18px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:13px;max-width:420px;animation:slideIn .3s ease`;
  el.innerHTML = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3000);
};

window.saveLlmGateway = async function (btn) {
  const button = btn || event?.target;
  const origText = button ? button.innerHTML : '';
  if (button) { button.disabled = true; button.innerHTML = '⏳ 保存中…'; }

  const patch = {
    provider: document.getElementById('gw_provider').value,
    base_url: document.getElementById('gw_base_url').value.trim(),
    enabled:  document.getElementById('gw_enabled').value === '1',
    models: {
      reasoning: document.getElementById('model_reasoning').value,
      fast:      document.getElementById('model_fast').value,
      default:   document.getElementById('model_default').value
    },
    tier_by_purpose: {}
  };
  document.querySelectorAll('.tier-select').forEach(s => {
    patch.tier_by_purpose[s.dataset.purpose] = s.value;
  });
  const k = document.getElementById('gw_api_key').value.trim();
  if (k) patch.api_key = k;

  try {
    const r = await api('/admin/llm/config', { method: 'POST', body: JSON.stringify(patch) });
    if (button) { button.innerHTML = '✓ 已保存'; button.style.background = '#10b981'; }
    window.gwToast(`✓ 配置已保存 · provider=<b>${esc(r.config?.provider || '-')}</b> · ${k ? 'API Key 已更新' : 'API Key 未变'}`, 'ok');
    setTimeout(() => anav('llmGateway'), 800);
  } catch (e) {
    if (button) { button.disabled = false; button.innerHTML = origText; }
    window.gwToast(`✗ 保存失败：${esc(e.message)}`, 'err');
  }
};

window.testLlmGateway = async function (tier, btn) {
  const button = btn || event?.target;
  const origText = button ? button.innerHTML : '';
  if (button) { button.disabled = true; button.innerHTML = `⏳ ${tier} 测试中…`; }

  const box = document.getElementById('gw_test_result');
  const t0 = Date.now();
  box.innerHTML = `
    <div class="alert" style="background:#eff6ff;border-left:4px solid #0ea5e9;padding:12px">
      <b style="color:#075985">⏳ 正在向 <code>${esc(tier)}</code> tier 发送 ping…</b><br/>
      <span class="muted" style="font-size:12px">真实调用 Tokenhot.ai，通常需要 2-5 秒，请稍候…</span>
      <div id="gw_test_timer" class="muted" style="font-size:11px;margin-top:4px">已用时 0s</div>
    </div>`;
  const timer = setInterval(() => {
    const el = document.getElementById('gw_test_timer');
    if (el) el.textContent = `已用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`;
  }, 100);

  try {
    const r = await api('/admin/llm/test', { method: 'POST', body: JSON.stringify({ tier }) });
    clearInterval(timer);
    const latency = r.latency_ms ?? r.latency ?? (Date.now() - t0);
    if (r.ok) {
      box.innerHTML = `
        <div class="alert" style="background:#ecfdf5;border-left:4px solid #10b981;padding:12px">
          <b style="color:#065f46">✓ 连通成功</b> · tier=<code>${esc(tier)}</code><br/>
          provider=<code>${esc(r.provider || '-')}</code> ·
          model=<code>${esc(r.model || '-')}</code> ·
          latency=<b>${latency} ms</b><br/>
          reply: <code style="background:#fff;padding:2px 6px;border-radius:3px">${esc(r.reply || '')}</code>
        </div>`;
      window.gwToast(`✓ ${tier} 连通成功 · ${latency}ms · ${esc(r.model)}`, 'ok');
    } else {
      box.innerHTML = `
        <div class="alert" style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px">
          <b style="color:#991b1b">✗ 连通失败</b><br/>
          ${esc(r.error || 'unknown error')}
        </div>`;
      window.gwToast(`✗ ${tier} 连通失败`, 'err');
    }
  } catch (e) {
    clearInterval(timer);
    box.innerHTML = `<div style="color:#ef4444;padding:12px;background:#fef2f2;border-left:4px solid #ef4444">请求失败：${esc(e.message)}</div>`;
    window.gwToast(`✗ 请求失败：${esc(e.message)}`, 'err');
  } finally {
    if (button) { button.disabled = false; button.innerHTML = origText; }
  }
};

// ================================================================================
// 💬 WhatsApp Cloud API 配置页
// ================================================================================
async function waConfig() {
  const app = document.getElementById('av');
  if (!app) return;
  app.innerHTML = `<div class="card"><h3>💬 WhatsApp Cloud API</h3><p class="muted">加载中…</p></div>`;

  let cfg = {};
  try {
    const r = await api('/admin/wa/config');
    cfg = r.config || {};
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>💬 WhatsApp</h3><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
    return;
  }

  // 计算 webhook URL（基于当前浏览器地址）
  const webhookUrl = `${location.origin}/api/wa/webhook/meta`;

  app.innerHTML = `
    <div class="card">
      <h3>💬 WhatsApp Cloud API (Meta 官方)</h3>
      <p class="muted">接入 Meta WhatsApp Cloud API，用户可直接用手机 WhatsApp 上传发票，AI 自动识别并归档，机器人自动回复处理结果。</p>

      <div class="kv-grid" style="margin:10px 0 20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">
        <div class="kv" style="padding:10px;background:#f8fafc;border-radius:8px">
          <div class="muted" style="font-size:11px">配置状态</div>
          <b>${cfg.configured ? '<span style="color:#10b981">✓ 已完成</span>' : '<span style="color:#f59e0b">⚠ 未完成</span>'}</b>
        </div>
        <div class="kv" style="padding:10px;background:#f8fafc;border-radius:8px">
          <div class="muted" style="font-size:11px">启用状态</div>
          <b>${cfg.enabled ? '<span style="color:#10b981">✓ 启用</span>' : '<span style="color:#94a3b8">✗ 未启用</span>'}</b>
        </div>
        <div class="kv" style="padding:10px;background:#f8fafc;border-radius:8px">
          <div class="muted" style="font-size:11px">Access Token</div>
          <b>${cfg.access_token_set ? `✓ ${esc(cfg.access_token)}` : '<span style="color:#ef4444">未配置</span>'}</b>
        </div>
        <div class="kv" style="padding:10px;background:#f8fafc;border-radius:8px">
          <div class="muted" style="font-size:11px">自动回复</div>
          <b>${cfg.auto_reply ? '✓ 开启' : '✗ 关闭'}</b>
        </div>
      </div>

      <h4>📌 Meta 配置指引（4 步）</h4>
      <ol style="line-height:1.9;background:#f8fafc;padding:14px 14px 14px 34px;border-radius:8px;font-size:13px">
        <li>去 <a href="https://developers.facebook.com/apps/" target="_blank">developers.facebook.com/apps</a> 创建 App（选 <b>Business</b>），添加产品 <b>WhatsApp</b></li>
        <li>在 WhatsApp → Getting Started 页面拿到 <b>Phone Number ID</b> 和 24h 临时 <b>Access Token</b>，填入下方</li>
        <li>在 <b>Configuration → Webhook</b> 填：
          <ul style="margin:4px 0 0 0">
            <li>Callback URL: <code style="background:#eff6ff;padding:2px 6px;border-radius:3px">${webhookUrl}</code>
              <button class="btn btn-sm" style="margin-left:6px" onclick="navigator.clipboard.writeText('${webhookUrl}');gwToast('✓ URL 已复制','ok')">📋 复制</button></li>
            <li>Verify Token: 和下方"Verify Token"字段保持一致（默认 <code>${esc(cfg.verify_token || 'aicfo-verify-2026')}</code>）</li>
          </ul>
        </li>
        <li>在 WhatsApp → API Setup 添加你自己的手机号到测试白名单，就能用手机 WhatsApp 给 Meta 测试号发消息了</li>
      </ol>

      <h4 class="mt-20">🔑 凭证配置</h4>
      <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:8px">
        <label>Phone Number ID <span class="muted" style="font-size:11px">(Meta 测试号的 15 位数字 ID)</span>
          <input id="wa_phone_number_id" class="input" value="${esc(cfg.phone_number_id || '')}" placeholder="123456789012345" />
        </label>
        <label>Access Token <span class="muted" style="font-size:11px">(EAAxx... 留空保留原值)</span>
          <input id="wa_access_token" class="input" type="password" placeholder="${cfg.access_token_set ? '留空不变，已配置' : 'EAAxxxxxxxxxx...'}" autocomplete="new-password" />
        </label>
        <label>Verify Token <span class="muted" style="font-size:11px">(自定义字符串，须和 Meta 后台一致)</span>
          <input id="wa_verify_token" class="input" value="${esc(cfg.verify_token || '')}" placeholder="aicfo-verify-2026" />
        </label>
        <label>Bot 显示名
          <input id="wa_bot_display_name" class="input" value="${esc(cfg.bot_display_name || 'AiCFO Finance Bot')}" />
        </label>
        <label>启用
          <select id="wa_enabled" class="input">
            <option value="1" ${cfg.enabled ? 'selected' : ''}>✓ 启用 (真实发送/接收)</option>
            <option value="0" ${!cfg.enabled ? 'selected' : ''}>✗ 停用 (仅接收解析，不主动发)</option>
          </select>
        </label>
        <label>收到消息后自动回复
          <select id="wa_auto_reply" class="input">
            <option value="1" ${cfg.auto_reply ? 'selected' : ''}>✓ 自动回复处理结果</option>
            <option value="0" ${!cfg.auto_reply ? 'selected' : ''}>✗ 静默模式</option>
          </select>
        </label>
      </div>

      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveWaConfig(this)">💾 保存配置</button>
        <button class="btn" onclick="testWaConnection(this)">🔗 测试连通 (graph.facebook.com)</button>
        <button class="btn" onclick="openWaSendDialog()">✉️ 主动发送测试消息</button>
        <button class="btn" onclick="anav('waConfig')">🔄 刷新</button>
      </div>

      <div id="wa_test_result" class="mt-20"></div>
    </div>

    <div class="card mt-20">
      <h3>📥 Webhook 入站流程图</h3>
      <pre style="background:#0f172a;color:#86efac;padding:16px;border-radius:8px;font-size:12px;overflow:auto;line-height:1.6">
  ① 用户手机 WhatsApp 发送图片/文字
         ↓
  ② Meta Cloud API (graph.facebook.com) 推送到
     ${webhookUrl}
         ↓
  ③ parseInboundPayload() 解析 from / text / media_id
         ↓
  ④ 按 wa_phone 找 channel (首次则识别 LINK:xxx 自动绑定)
         ↓
  ⑤ 有图片 → downloadMedia() 下载原图 → OCR
         ↓
  ⑥ waBot.handleIncoming() 分类入库 (invoices/transactions/wa_messages)
         ↓
  ⑦ auto_reply=on → sendText() 发"✓ 已记录 S$12.50"回用户手机</pre>
    </div>`;
}

window.saveWaConfig = async function(btn) {
  const button = btn || event?.target;
  const orig = button ? button.innerHTML : '';
  if (button) { button.disabled = true; button.innerHTML = '⏳ 保存中…'; }
  const patch = {
    phone_number_id:  document.getElementById('wa_phone_number_id').value.trim(),
    verify_token:     document.getElementById('wa_verify_token').value.trim(),
    bot_display_name: document.getElementById('wa_bot_display_name').value.trim(),
    enabled:          document.getElementById('wa_enabled').value === '1',
    auto_reply:       document.getElementById('wa_auto_reply').value === '1',
  };
  const tok = document.getElementById('wa_access_token').value.trim();
  if (tok) patch.access_token = tok;
  try {
    const r = await api('/admin/wa/config', { method:'POST', body: JSON.stringify(patch) });
    gwToast('✓ WhatsApp 配置已保存', 'ok');
    if (button) { button.innerHTML = '✓ 已保存'; button.style.background = '#10b981'; }
    setTimeout(() => anav('waConfig'), 800);
  } catch(e) {
    if (button) { button.disabled = false; button.innerHTML = orig; }
    gwToast(`✗ 保存失败：${esc(e.message)}`, 'err');
  }
};

window.testWaConnection = async function(btn) {
  const button = btn || event?.target;
  const orig = button ? button.innerHTML : '';
  if (button) { button.disabled = true; button.innerHTML = '⏳ 测试中…'; }
  const box = document.getElementById('wa_test_result');
  box.innerHTML = `<div class="alert" style="background:#eff6ff;border-left:4px solid #0ea5e9;padding:12px">⏳ 向 graph.facebook.com 查询 Phone Number 信息…</div>`;
  try {
    const r = await api('/admin/wa/test', { method:'POST', body:'{}' });
    if (r.ok) {
      box.innerHTML = `<div class="alert" style="background:#ecfdf5;border-left:4px solid #10b981;padding:12px">
        <b style="color:#065f46">✓ 连通成功</b><br/>
        display_phone_number=<code>${esc(r.display_phone_number || '-')}</code><br/>
        verified_name=<code>${esc(r.verified_name || '-')}</code><br/>
        quality_rating=<code>${esc(r.quality_rating || '-')}</code>
      </div>`;
      gwToast('✓ Meta 连通成功', 'ok');
    } else {
      box.innerHTML = `<div class="alert" style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px">
        <b style="color:#991b1b">✗ 连通失败</b><br/>${esc(r.error || 'unknown')}
      </div>`;
      gwToast('✗ 连通失败', 'err');
    }
  } catch(e) {
    box.innerHTML = `<div style="color:#ef4444">请求失败：${esc(e.message)}</div>`;
  } finally {
    if (button) { button.disabled = false; button.innerHTML = orig; }
  }
};

window.openWaSendDialog = function() {
  const to = prompt('输入接收方 WhatsApp 手机号（含国家码，如 6591234567，不加 +）:');
  if (!to) return;
  const text = prompt('输入要发送的消息内容:', '👋 这是来自 AiCFO 的测试消息');
  if (!text) return;
  sendWaMessage(to.trim(), text);
};

async function sendWaMessage(to, text) {
  const box = document.getElementById('wa_test_result');
  box.innerHTML = `<div class="alert" style="background:#eff6ff;border-left:4px solid #0ea5e9;padding:12px">⏳ 向 ${esc(to)} 发送消息…</div>`;
  try {
    const r = await api('/admin/wa/send', { method:'POST', body: JSON.stringify({ to, text }) });
    if (r.ok) {
      box.innerHTML = `<div class="alert" style="background:#ecfdf5;border-left:4px solid #10b981;padding:12px">
        <b style="color:#065f46">✓ 发送成功</b><br/>
        wa_message_id=<code>${esc(r.wa_message_id || '-')}</code><br/>
        <span class="muted">请在 WhatsApp 手机端查看</span>
      </div>`;
      gwToast('✓ 消息已发送', 'ok');
    } else {
      box.innerHTML = `<div class="alert" style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px">
        <b style="color:#991b1b">✗ 发送失败</b><br/>${esc(r.error || 'unknown')}
      </div>`;
    }
  } catch(e) {
    box.innerHTML = `<div style="color:#ef4444">请求失败：${esc(e.message)}</div>`;
  }
}

// ============================================================================
// Upload Portal — 上传链接管理（方案 A）
// ============================================================================
async function uploadPortal() {
  const app = document.getElementById('av');
  if (!app) return;
  app.innerHTML = `<div class="card"><h3>🔗 上传链接管理</h3><p class="muted">加载中…</p></div>`;

  try {
    const res = await api('/admin/upload-portal/tokens?limit=200');
    const tokens = res.tokens || [];
    const activeCount = tokens.filter(t => t.status === 'active').length;
    const totalSubs = tokens.reduce((s, t) => s + (t.submission_count || 0), 0);

    app.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">🔗 上传链接管理 (Upload Portal)</h3>
          <button class="btn btn-primary" onclick="upCreateDialog()">+ 生成新链接</button>
        </div>
        <p class="muted" style="margin:0">给客户/员工发专属上传 URL，点开 → 拍照/拖拽 → AI 自动识别记账，无需账号。</p>
      </div>

      <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">链接总数</div><div style="font-size:24px;font-weight:700">${tokens.length}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">活跃</div><div style="font-size:24px;font-weight:700;color:#10b981">${activeCount}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">已撤销</div><div style="font-size:24px;font-weight:700;color:#ef4444">${tokens.length - activeCount}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">累计提交</div><div style="font-size:24px;font-weight:700;color:#2563eb">${totalSubs}</div></div>
      </div>

      <div class="card">
        <h3>全部链接</h3>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f8fafc;text-align:left">
            <th style="padding:8px">Token</th><th style="padding:8px">名称</th><th style="padding:8px">归属</th>
            <th style="padding:8px">状态</th><th style="padding:8px">使用</th><th style="padding:8px">提交</th>
            <th style="padding:8px">到期</th><th style="padding:8px">创建</th><th style="padding:8px">操作</th>
          </tr></thead>
          <tbody>
            ${tokens.map(t => `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:8px"><code style="background:#eef2f7;padding:2px 6px;border-radius:4px">${esc(t.token)}</code></td>
                <td style="padding:8px">${esc(t.label || '-')}</td>
                <td style="padding:8px;font-size:12px">${esc(t.company_name || t.user_name || t.email || '-')}</td>
                <td style="padding:8px">${t.status === 'active'
                  ? '<span style="color:#10b981">● active</span>'
                  : '<span style="color:#ef4444">● revoked</span>'}</td>
                <td style="padding:8px">${t.uploads_count || 0}${t.max_uploads > 0 ? ' / ' + t.max_uploads : ''}</td>
                <td style="padding:8px">${t.submission_count || 0}</td>
                <td style="padding:8px;font-size:12px">${t.expires_at ? esc(t.expires_at.slice(0,10)) : '永久'}</td>
                <td style="padding:8px;font-size:12px">${esc((t.created_at || '').slice(0,10))}</td>
                <td style="padding:8px">
                  <button class="btn btn-sm" onclick="upCopyUrl('${esc(t.token)}')">📋 复制</button>
                  <button class="btn btn-sm" onclick="upShowQr('${esc(t.token)}','${esc(t.label || '')}')">🔲 二维码</button>
                  ${t.status === 'active' ? `<button class="btn btn-sm" style="color:#ef4444" onclick="upRevoke('${esc(t.token)}')">✗ 撤销</button>` : ''}
                </td>
              </tr>
            `).join('') || '<tr><td colspan="9" style="padding:20px;text-align:center;color:#94a3b8">还没有上传链接，点右上角「生成新链接」开始。</td></tr>'}
          </tbody>
        </table></div>
      </div>

      <!-- 创建对话框容器 -->
      <div id="upModal"></div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>🔗 上传链接管理</h3><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
  }
}

window.upCreateDialog = function () {
  const m = document.getElementById('upModal');
  m.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;z-index:9999" onclick="if(event.target===this)this.remove()">
      <div class="card" style="width:480px;max-width:90vw">
        <h3 style="margin-top:0">+ 生成新上传链接</h3>
        <label class="lbl">归属用户 ID</label>
        <input id="up_user_id" value="usr_demo_001" onchange="upLoadCompanies()" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-top:4px">
        <label class="lbl">归属公司 <span style="color:#ef4444">*</span></label>
        <select id="up_company_id" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-top:4px">
          <option value="">— 加载中…（请先填上面的 user_id）—</option>
        </select>
        <div class="muted" style="font-size:11px;margin-top:4px">所有通过此链接上传的文件将归属到所选公司的档案库</div>
        <label class="lbl">链接名称</label>
        <input id="up_label" value="账单直传" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;margin-top:4px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <div><label class="lbl">有效天数 (0=永久)</label><input id="up_exp" value="30" type="number" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label class="lbl">最多次数 (0=不限)</label><input id="up_max" value="0" type="number" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn" onclick="this.parentElement.parentElement.parentElement.parentElement.remove()">取消</button>
          <button class="btn btn-primary" onclick="upDoCreate()">生成链接</button>
        </div>
      </div>
    </div>`;
  // 初始加载公司列表
  upLoadCompanies();
};

// 加载当前 user_id 的公司列表填充下拉
window.upLoadCompanies = async function () {
  const uid = document.getElementById('up_user_id')?.value?.trim();
  const sel = document.getElementById('up_company_id');
  if (!sel) return;
  if (!uid) { sel.innerHTML = '<option value="">请先填写用户 ID</option>'; return; }
  sel.innerHTML = '<option value="">加载中…</option>';
  try {
    const r = await fetch('/api/upload-portal/my-companies?user_id=' + encodeURIComponent(uid));
    const d = await r.json();
    if (!d.ok || !Array.isArray(d.companies) || !d.companies.length) {
      sel.innerHTML = '<option value="">该用户没有公司（请先创建企业）</option>';
      return;
    }
    sel.innerHTML = d.companies.map((c, i) =>
      `<option value="${esc(c.id)}"${i === 0 ? ' selected' : ''}>${esc(c.name)}${c.uen ? ' · ' + esc(c.uen) : ''} · ${esc(c.status || '')}</option>`
    ).join('');
  } catch (e) {
    sel.innerHTML = '<option value="">加载失败：' + esc(e.message) + '</option>';
  }
};

window.upDoCreate = async function () {
  const user_id    = document.getElementById('up_user_id').value.trim();
  const company_id = document.getElementById('up_company_id').value || null;
  const label      = document.getElementById('up_label').value.trim();
  const expires_days = +document.getElementById('up_exp').value || 0;
  const max_uploads  = +document.getElementById('up_max').value || 0;
  if (!user_id) return alert('user_id 必填');
  if (!company_id) return alert('请先选择归属公司');
  try {
    const r = await fetch('/api/upload-portal/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Public-Base': location.origin },
      body: JSON.stringify({ user_id, company_id, label, expires_days, max_uploads }),
    });
    const d = await r.json();
    if (!d.ok) { gwToast('生成失败: ' + (d.error || r.status), 'err'); return; }
    document.getElementById('upModal').innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;z-index:9999" onclick="if(event.target===this)this.remove()">
        <div class="card" style="width:480px;max-width:90vw;text-align:center">
          <h3 style="margin-top:0;color:#10b981">✓ 链接已生成</h3>
          <div style="background:#f0fdf4;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:13px;margin-bottom:12px">${esc(d.url)}</div>
          <img src="${d.qr_data_url}" style="width:220px;height:220px;border:1px solid #e2e8f0;border-radius:8px" alt="QR">
          <div class="muted" style="font-size:12px;margin-top:8px">手机扫码即可打开</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${esc(d.url)}').then(()=>gwToast('已复制 URL','ok'))">📋 复制链接</button>
            <button class="btn" onclick="document.getElementById('upModal').innerHTML='';anav('uploadPortal')">关闭</button>
          </div>
        </div>
      </div>`;
    gwToast('✓ 链接生成成功', 'ok');
  } catch (e) { gwToast('请求失败: ' + e.message, 'err'); }
};

window.upCopyUrl = function (token) {
  const url = location.origin + '/upload/' + token;
  navigator.clipboard.writeText(url).then(() => gwToast('已复制: ' + url, 'ok'));
};

window.upShowQr = async function (token, label) {
  // 用 API 临时重新生成一次 QR（其实 token 一样，URL 也一样）—— 也可 client 端 QR 库，这里复用 server
  const url = location.origin + '/upload/' + token;
  // 用 quickchart 当 fallback
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;
  const m = document.getElementById('upModal');
  m.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;z-index:9999" onclick="if(event.target===this)this.remove()">
      <div class="card" style="width:380px;text-align:center">
        <h3 style="margin-top:0">${esc(label || token)}</h3>
        <img src="${qrSrc}" style="width:260px;height:260px" alt="QR">
        <div style="background:#eef2f7;padding:10px;border-radius:6px;font-family:monospace;font-size:12px;margin-top:10px;word-break:break-all">${esc(url)}</div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${esc(url)}').then(()=>gwToast('已复制','ok'))">📋 复制 URL</button>
          <button class="btn" onclick="document.getElementById('upModal').innerHTML=''">关闭</button>
        </div>
      </div>
    </div>`;
};

window.upRevoke = async function (token) {
  if (!confirm('确认撤销 ' + token + ' ？此后该链接将无法使用。')) return;
  try {
    const r = await fetch(`/api/upload-portal/tokens/${token}/revoke`, { method: 'POST' });
    const d = await r.json();
    if (d.ok) { gwToast('✓ 已撤销', 'ok'); anav('uploadPortal'); }
    else       gwToast('撤销失败: ' + (d.error || r.status), 'err');
  } catch (e) { gwToast('请求失败: ' + e.message, 'err'); }
};

// ============================================================================
// Telegram Bot — 方案 C
// ============================================================================
async function tgConfig() {
  const app = document.getElementById('av');
  if (!app) return;
  app.innerHTML = `<div class="card"><h3>✈️ Telegram Bot</h3><p class="muted">加载中…</p></div>`;

  try {
    const [cfgRes, chRes] = await Promise.all([
      fetch('/api/admin/telegram/config').then(r => r.json()),
      fetch('/api/admin/telegram/channels').then(r => r.json()),
    ]);
    const cfg = cfgRes.config || {};
    const channels = chRes.channels || [];
    const webhookUrl = location.origin + '/api/telegram/webhook';

    app.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">✈️ Telegram Bot (方案 C)</h3>
          <span style="padding:4px 10px;border-radius:20px;background:${cfg.enabled ? '#dcfce7' : '#fee2e2'};color:${cfg.enabled ? '#166534' : '#991b1b'};font-size:12px">
            ${cfg.enabled ? '● 已启用' : '● 未启用'}
          </span>
        </div>
        <p class="muted" style="margin:8px 0 0">通过 BotFather 注册 Bot，用户在 Telegram 里搜 Bot 发消息/照片/PDF，AI 自动记账。国际/华人市场首选。</p>
      </div>

      <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">状态</div><div style="font-size:18px;font-weight:600;color:${cfg.configured ? '#10b981' : '#94a3b8'}">${cfg.configured ? '已配置' : '未配置'}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">Bot Token</div><div style="font-size:14px;font-weight:600">${cfg.bot_token_set ? '🔑 已设置' : '✗ 未设置'}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">绑定用户数</div><div style="font-size:24px;font-weight:700">${channels.length}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">自动回复</div><div style="font-size:14px;font-weight:600;color:${cfg.auto_reply ? '#10b981' : '#94a3b8'}">${cfg.auto_reply ? '开启' : '关闭'}</div></div>
      </div>

      <div class="card">
        <h3>📝 4 步激活指南</h3>
        <ol style="padding-left:20px;line-height:1.9;margin:0">
          <li>Telegram 搜 <code>@BotFather</code> → 发 <code>/newbot</code> → 按提示设置名称和 username（如 <code>AiCFO_Finance_Bot</code>）</li>
          <li>BotFather 会返回 <code>HTTP API token</code>（格式 <code>1234567890:AAxxxxxxxx...</code>），粘贴到下面「Bot Token」框</li>
          <li>点「💾 保存配置」→「🔌 挂 Webhook」（会自动把当前 sandbox URL 作为回调注册到 Telegram）</li>
          <li>在 Telegram 搜你的 Bot → 发 <code>/start FIN-XXXX</code>（FIN token 在「WhatsApp 渠道」页可见）→ 绑定成功后发图片/文字测试</li>
        </ol>
      </div>

      <div class="card">
        <h3>🔧 Bot 凭据</h3>
        <label class="lbl">Bot Token (BotFather 给的)</label>
        <input id="tg_token" value="${cfg.bot_token_set ? esc(cfg.bot_token) : ''}" placeholder="1234567890:AAE-xxxxxxxxxxxxxxxxxxxxxxxxxxx" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-family:monospace;margin-top:4px">

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div>
            <label class="lbl">Bot Username (不带 @)</label>
            <input id="tg_username" value="${esc(cfg.bot_username || '')}" placeholder="AiCFO_Finance_Bot" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px">
          </div>
          <div>
            <label class="lbl">Webhook Secret</label>
            <input id="tg_secret" value="${esc(cfg.webhook_secret || '')}" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-family:monospace">
          </div>
        </div>

        <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="tg_enabled" ${cfg.enabled ? 'checked' : ''}> 启用</label>
          <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="tg_autoreply" ${cfg.auto_reply ? 'checked' : ''}> 自动回复</label>
        </div>

        <div style="margin-top:10px;padding:10px;background:#eff6ff;border-radius:8px;font-size:13px">
          <b>📍 Webhook URL</b>（粘贴到 BotFather → <code>/setwebhook</code> 用，或点「挂 Webhook」按钮自动注册）<br>
          <code style="background:#fff;padding:4px 8px;border-radius:4px;display:inline-block;margin-top:4px">${webhookUrl}</code>
          <button class="btn btn-sm" style="margin-left:8px" onclick="navigator.clipboard.writeText('${webhookUrl}').then(()=>gwToast('已复制','ok'))">📋 复制</button>
        </div>

        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary" id="tg_save_btn" onclick="tgSave()">💾 保存配置</button>
          <button class="btn" id="tg_test_btn" onclick="tgTest()">🔗 测试连接 (getMe)</button>
          <button class="btn" id="tg_hook_set_btn" onclick="tgSetWebhook()">🔌 挂 Webhook</button>
          <button class="btn" onclick="tgDelWebhook()">🧹 取消 Webhook</button>
          <button class="btn" onclick="anav('tgConfig')">🔄 刷新</button>
        </div>
        <div id="tg_result" style="margin-top:12px"></div>
      </div>

      <div class="card">
        <h3>👥 已绑定 Telegram 用户 (${channels.length})</h3>
        ${channels.length === 0 ? '<p class="muted">尚无绑定，让用户发 <code>/start FIN-XXXX</code> 激活。</p>' :
          `<table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="background:#f8fafc;text-align:left">
              <th style="padding:8px">TG Chat ID</th><th style="padding:8px">TG 用户</th>
              <th style="padding:8px">归属</th><th style="padding:8px">消息数</th>
              <th style="padding:8px">最后消息</th><th style="padding:8px">绑定时间</th>
            </tr></thead>
            <tbody>${channels.map(c => `
              <tr style="border-bottom:1px solid #f1f5f9">
                <td style="padding:8px"><code>${esc(c.tg_chat_id)}</code></td>
                <td style="padding:8px">@${esc(c.tg_username || '-')}</td>
                <td style="padding:8px">${esc(c.user_name || c.email || c.user_id)}</td>
                <td style="padding:8px">${c.message_count || 0}</td>
                <td style="padding:8px;font-size:12px">${esc((c.last_message_at || '').slice(0,16))}</td>
                <td style="padding:8px;font-size:12px">${esc((c.linked_at || c.created_at || '').slice(0,16))}</td>
              </tr>`).join('')}</tbody>
          </table>`}
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>✈️ Telegram Bot</h3><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
  }
}

window.tgSave = async function () {
  const btn = document.getElementById('tg_save_btn');
  const box = document.getElementById('tg_result');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ 保存中…';
  try {
    const patch = {
      bot_username:   document.getElementById('tg_username').value.trim(),
      webhook_secret: document.getElementById('tg_secret').value.trim(),
      enabled:        document.getElementById('tg_enabled').checked,
      auto_reply:     document.getElementById('tg_autoreply').checked,
    };
    const t = document.getElementById('tg_token').value.trim();
    if (t && !/\*\*\*\*/.test(t)) patch.bot_token = t;  // 没改就不覆盖脱敏值
    const r = await fetch('/api/admin/telegram/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await r.json();
    if (d.ok) {
      btn.innerHTML = '✓ 已保存'; btn.style.background = '#10b981';
      gwToast('✓ 配置已保存', 'ok');
      box.innerHTML = `<div style="padding:10px;background:#ecfdf5;border-left:4px solid #10b981;border-radius:4px"><b style="color:#065f46">保存成功</b> · ${d.config.configured ? 'Bot 已配置' : '还需填 Bot Token'}</div>`;
      setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.disabled = false; }, 1200);
    } else {
      btn.innerHTML = '✗ 失败'; btn.style.background = '#ef4444';
      gwToast('保存失败: ' + (d.error || r.status), 'err');
      setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; btn.disabled = false; }, 1500);
    }
  } catch (e) {
    gwToast('请求失败: ' + e.message, 'err');
    btn.innerHTML = orig; btn.disabled = false;
  }
};

window.tgTest = async function () {
  const btn = document.getElementById('tg_test_btn');
  const box = document.getElementById('tg_result');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ 测试中…';
  box.innerHTML = `<div class="muted">正在调用 Telegram getMe API…</div>`;
  const t0 = Date.now();
  try {
    const r = await fetch('/api/admin/telegram/test', { method: 'POST' });
    const d = await r.json();
    const dur = Date.now() - t0;
    if (d.ok) {
      box.innerHTML = `<div style="padding:12px;background:#ecfdf5;border-left:4px solid #10b981;border-radius:4px">
        <b style="color:#065f46">✓ 连接成功 (${dur}ms)</b><br>
        Bot ID: <code>${d.bot_id}</code> · 用户名: <code>@${esc(d.bot_username || '-')}</code> · 名称: <b>${esc(d.bot_name || '')}</b><br>
        <span class="muted">去 Telegram 搜 <code>@${esc(d.bot_username)}</code> 即可对话</span>
      </div>`;
      gwToast('✓ Telegram 连通', 'ok');
    } else {
      box.innerHTML = `<div style="padding:12px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px">
        <b style="color:#991b1b">✗ 连接失败</b> (${dur}ms)<br>${esc(d.error || 'unknown')}<br>
        <span class="muted">常见原因：token 拼写错、被禁、未保存配置</span>
      </div>`;
    }
  } catch (e) {
    box.innerHTML = `<div style="color:#ef4444">请求失败：${esc(e.message)}</div>`;
  } finally {
    btn.innerHTML = orig; btn.disabled = false;
  }
};

window.tgSetWebhook = async function () {
  const btn = document.getElementById('tg_hook_set_btn');
  const box = document.getElementById('tg_result');
  const orig = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ 挂 webhook…';
  try {
    const r = await fetch('/api/admin/telegram/webhook/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_base: location.origin }),
    });
    const d = await r.json();
    if (d.ok) {
      box.innerHTML = `<div style="padding:12px;background:#ecfdf5;border-left:4px solid #10b981;border-radius:4px">
        <b style="color:#065f46">✓ Webhook 已注册</b><br>
        <code>${esc(d.webhook_url)}</code><br>
        <span class="muted">现在用户在 Telegram 发消息会立刻进后端 handler</span>
      </div>`;
      gwToast('✓ Webhook 已挂', 'ok');
    } else {
      box.innerHTML = `<div style="padding:12px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px">
        <b style="color:#991b1b">✗ 挂载失败</b><br>${esc(d.error || JSON.stringify(d.result || {}))}<br>
        <span class="muted">提示：Telegram 要求 webhook 必须是 HTTPS（sandbox URL 自动满足）</span>
      </div>`;
    }
  } catch (e) {
    box.innerHTML = `<div style="color:#ef4444">请求失败：${esc(e.message)}</div>`;
  } finally {
    btn.innerHTML = orig; btn.disabled = false;
  }
};

window.tgDelWebhook = async function () {
  if (!confirm('确认取消 Webhook？Bot 将停止接收消息。')) return;
  try {
    const r = await fetch('/api/admin/telegram/webhook/delete', { method: 'POST' });
    const d = await r.json();
    if (d.ok) { gwToast('✓ Webhook 已取消', 'ok'); anav('tgConfig'); }
    else      gwToast('取消失败: ' + (d.error || 'unknown'), 'err');
  } catch (e) { gwToast('请求失败: ' + e.message, 'err'); }
};

// ============================================================================
// Company Archive — 企业档案库（列表页）
// ============================================================================
async function companyArchive() {
  const app = document.getElementById('av');
  if (!app) return;
  app.innerHTML = `<div class="card"><h3>📚 企业档案库</h3><p class="muted">加载中…</p></div>`;
  try {
    const res = await fetch('/api/admin/archive/companies?limit=300').then(r => r.json());
    const cos = res.companies || [];
    const totalTxn = cos.reduce((s, c) => s + (c.stats?.transactions || 0), 0);
    const totalInv = cos.reduce((s, c) => s + (c.stats?.invoices || 0), 0);
    const totalRev = cos.reduce((s, c) => s + (c.stats?.revenue || 0), 0);
    const totalDocs = cos.reduce((s, c) => s + (c.stats?.documents || 0), 0);

    app.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">📚 企业档案库 (Company Archive)</h3>
          <span class="muted">每家企业一个独立档案 · 消费记录 / 报税 / 财报 / 历史记录 全聚合</span>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px">
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">档案数</div><div style="font-size:24px;font-weight:700">${cos.length}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">累计交易</div><div style="font-size:24px;font-weight:700;color:#2563eb">${totalTxn}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">累计发票</div><div style="font-size:24px;font-weight:700;color:#7c3aed">${totalInv}</div></div>
        <div class="card" style="padding:14px"><div class="muted" style="font-size:12px">累计营收</div><div style="font-size:20px;font-weight:700;color:#10b981">S$ ${(totalRev/1000).toFixed(1)}k</div></div>
      </div>

      <div class="card">
        <h3>全部企业档案 (${cos.length})</h3>
        <input id="arc_filter" placeholder="🔍 搜索公司名/UEN/状态…" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px" oninput="arcFilter(this.value)">

        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px" id="arc_table">
          <thead><tr style="background:#f8fafc;text-align:left">
            <th style="padding:10px">企业</th>
            <th style="padding:10px">UEN / 状态</th>
            <th style="padding:10px">交易</th>
            <th style="padding:10px">发票</th>
            <th style="padding:10px">营收</th>
            <th style="padding:10px">支出</th>
            <th style="padding:10px">文档</th>
            <th style="padding:10px">税务</th>
            <th style="padding:10px">上传</th>
            <th style="padding:10px">最后活动</th>
            <th style="padding:10px">操作</th>
          </tr></thead>
          <tbody>
            ${cos.map(c => `
              <tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" onclick="anav('companyArchiveDetail',{id:'${esc(c.id)}'})">
                <td style="padding:10px">
                  <div style="font-weight:600">${esc(c.name || '-')}</div>
                  <div class="muted" style="font-size:11px">${esc(c.segment || 'local_sg')} · ${esc(c.subscription_tier || 'basic')}</div>
                </td>
                <td style="padding:10px">
                  <div style="font-family:monospace;font-size:12px">${esc(c.uen || '—')}</div>
                  <div><span style="padding:2px 8px;border-radius:12px;background:${c.status === 'active' ? '#dcfce7' : '#fef3c7'};color:${c.status === 'active' ? '#166534' : '#92400e'};font-size:11px">${esc(c.status)}</span></div>
                </td>
                <td style="padding:10px">${c.stats.transactions}</td>
                <td style="padding:10px">${c.stats.invoices}</td>
                <td style="padding:10px;color:#10b981;font-weight:600">S$ ${(c.stats.revenue || 0).toFixed(0)}</td>
                <td style="padding:10px;color:#ef4444">S$ ${(c.stats.expense || 0).toFixed(0)}</td>
                <td style="padding:10px">${c.stats.documents}</td>
                <td style="padding:10px">${c.stats.tax_filings}</td>
                <td style="padding:10px">${c.stats.upload_submissions} <span class="muted" style="font-size:11px">/ ${c.stats.active_upload_tokens}link</span></td>
                <td style="padding:10px;font-size:11px" class="muted">${esc((c.last_activity_at || '').slice(0,16))}</td>
                <td style="padding:10px" onclick="event.stopPropagation()">
                  <button class="btn btn-sm btn-primary" onclick="anav('companyArchiveDetail',{id:'${esc(c.id)}'})">📂 查看档案</button>
                </td>
              </tr>`).join('') || `<tr><td colspan="11" style="padding:30px;text-align:center;color:#94a3b8">系统还没有任何企业档案</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>📚 企业档案库</h3><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
  }
}

window.arcFilter = function (q) {
  q = (q || '').toLowerCase().trim();
  document.querySelectorAll('#arc_table tbody tr').forEach(tr => {
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

// ============================================================================
// Company Archive Detail — 单家公司的完整档案详情页（带 tabs）
// ============================================================================
async function companyArchiveDetail(params) {
  const app = document.getElementById('av');
  if (!app) return;
  const id = params?.id;
  if (!id) { app.innerHTML = `<div class="card">缺少 company id <a onclick="anav('companyArchive')">返回列表</a></div>`; return; }

  app.innerHTML = `<div class="card"><h3>📂 加载企业档案…</h3><p class="muted">正在聚合交易、发票、税务、报表、历史记录…</p></div>`;

  try {
    const res = await fetch(`/api/admin/archive/company/${id}`).then(r => r.json());
    if (!res.ok) { app.innerHTML = `<div class="card"><p style="color:#ef4444">加载失败：${esc(res.error || '未找到')}</p><a onclick="anav('companyArchive')">← 返回列表</a></div>`; return; }
    const a = res.archive;
    const c = a.company;

    // 保存到全局便于 tab 切换
    window._currentArchive = a;

    app.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div>
            <a onclick="anav('companyArchive')" style="color:rgba(255,255,255,0.9);cursor:pointer;font-size:13px">← 返回企业列表</a>
            <h2 style="margin:6px 0 0">📂 ${esc(c.name)}</h2>
            <div style="font-size:13px;opacity:0.9;margin-top:4px">
              <code style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:4px">${esc(c.id)}</code>
              ${c.uen ? `· UEN <code style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:4px">${esc(c.uen)}</code>` : ''}
              · ${esc(c.segment || 'local_sg')} · ${esc(c.subscription_tier || 'basic')}
              · 创建于 ${esc((c.created_at || '').slice(0,10))}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3)" onclick="arcSnapshot('${esc(id)}')">📸 生成快照</button>
            <a class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);text-decoration:none" href="/api/admin/archive/company/${esc(id)}" target="_blank">⬇️ JSON</a>
            <a class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);text-decoration:none" href="/api/admin/archive/company/${esc(id)}/export.csv" target="_blank">📊 CSV</a>
            <a class="btn" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);text-decoration:none" href="/api/admin/archive/company/${esc(id)}/export.html" target="_blank">🖨️ PDF (HTML→打印)</a>
            <button class="btn" style="background:#fff;color:#2563eb" onclick="arcNewService('${esc(id)}')">🚀 发起新服务</button>
          </div>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(6,1fr);gap:10px;margin:14px 0">
        <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">交易</div><div style="font-size:22px;font-weight:700">${a.summary.stats.transactions}</div></div>
        <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">发票</div><div style="font-size:22px;font-weight:700">${a.summary.stats.invoices}</div></div>
        <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">营收</div><div style="font-size:18px;font-weight:700;color:#10b981">S$ ${(a.summary.stats.revenue||0).toFixed(0)}</div></div>
        <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">支出</div><div style="font-size:18px;font-weight:700;color:#ef4444">S$ ${(a.summary.stats.expense||0).toFixed(0)}</div></div>
        <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">文档</div><div style="font-size:22px;font-weight:700">${a.summary.stats.documents}</div></div>
        <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">税务</div><div style="font-size:22px;font-weight:700">${a.summary.stats.tax_filings}</div></div>
      </div>

      <div class="card" style="padding:0">
        <div style="display:flex;border-bottom:1px solid #e2e8f0;overflow-x:auto" id="arc_tabs">
          <div class="arc-tab active" data-tab="overview" onclick="arcTab('overview')">📊 概览</div>
          <div class="arc-tab" data-tab="analytics" onclick="arcTab('analytics')">📉 分析</div>
          <div class="arc-tab" data-tab="basic" onclick="arcTab('basic')">🏢 基础信息</div>
          <div class="arc-tab" data-tab="expenses" onclick="arcTab('expenses')">💰 消费记录</div>
          <div class="arc-tab" data-tab="tax" onclick="arcTab('tax')">🏛️ 报税信息</div>
          <div class="arc-tab" data-tab="reports" onclick="arcTab('reports')">📈 财报</div>
          <div class="arc-tab" data-tab="history" onclick="arcTab('history')">🕑 历史记录</div>
          <div class="arc-tab" data-tab="timeline" onclick="arcTab('timeline')">⏳ 时间线</div>
          <div class="arc-tab" data-tab="billing" onclick="arcTab('billing')">💳 订阅支付</div>
          <div class="arc-tab" data-tab="snapshots" onclick="arcTab('snapshots')">📸 快照历史</div>
        </div>
        <div id="arc_tab_body" style="padding:16px"></div>
      </div>

      <style>
        .arc-tab { padding:12px 18px; cursor:pointer; font-size:14px; white-space:nowrap; border-bottom:2px solid transparent; color:#64748b; transition:all .15s }
        .arc-tab:hover { color:#2563eb; background:#f8fafc }
        .arc-tab.active { color:#2563eb; border-bottom-color:#2563eb; background:#fff; font-weight:600 }
        .arc-list-item { padding:10px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:flex-start;gap:10px }
        .arc-list-item:last-child { border-bottom:none }
        .arc-ev-icon { font-size:18px;flex-shrink:0 }
        table.arc-tbl { width:100%;border-collapse:collapse;font-size:13px }
        table.arc-tbl th { background:#f8fafc;text-align:left;padding:8px }
        table.arc-tbl td { padding:8px;border-bottom:1px solid #f1f5f9 }
      </style>
    `;
    arcTab('overview');
  } catch (e) {
    app.innerHTML = `<div class="card"><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
  }
}

window.arcTab = function (tab) {
  document.querySelectorAll('.arc-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  const body = document.getElementById('arc_tab_body');
  const a = window._currentArchive;
  if (!a) return;
  if (tab === 'overview')   body.innerHTML = arcRenderOverview(a);
  if (tab === 'basic')      body.innerHTML = arcRenderBasic(a);
  if (tab === 'expenses')   body.innerHTML = arcRenderExpenses(a);
  if (tab === 'tax')        body.innerHTML = arcRenderTax(a);
  if (tab === 'reports')    body.innerHTML = arcRenderReports(a);
  if (tab === 'history')    body.innerHTML = arcRenderHistory(a);
  if (tab === 'timeline')   body.innerHTML = arcRenderTimeline(a);
  if (tab === 'billing')    body.innerHTML = arcRenderBilling(a);
  if (tab === 'analytics')  { body.innerHTML = '<p class="muted">加载分析数据…</p>'; arcLoadAnalytics(a.company.id); }
  if (tab === 'snapshots')  { body.innerHTML = '<p class="muted">加载快照列表…</p>'; arcLoadSnapshots(a.company.id); }
};

// ========== T: 档案分析（供应商/分类/月份/饼图） ==========
async function arcLoadAnalytics(company_id, year = null) {
  const body = document.getElementById('arc_tab_body');
  if (!body) return;
  const qs = year ? `?year=${encodeURIComponent(year)}` : '';
  try {
    const r = await fetch(`/api/admin/archive/company/${company_id}/analytics${qs}`).then(x => x.json());
    if (!r.ok) { body.innerHTML = `<p style="color:#ef4444">加载失败：${esc(r.error || '')}</p>`; return; }
    body.innerHTML = arcRenderAnalytics(company_id, r.data, year);
  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">请求失败：${esc(e.message)}</p>`;
  }
}

window.arcAnalyticsFilterYear = function (company_id, year) {
  arcLoadAnalytics(company_id, year || null);
};

function arcRenderAnalytics(company_id, d, currentYear) {
  const years = d.years_available || [];
  const t = d.totals || {};
  const vendors = d.by_vendor || [];
  const categories = d.by_category || [];
  const docKinds = d.by_doc_kind || [];
  const byMonth = d.by_month || [];

  // 饼图（纯 CSS conic-gradient）—— 按供应商
  const totalVendorAmt = vendors.reduce((a, v) => a + (v.total_amount || 0), 0) || 1;
  const palette = ['#2563eb','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6366f1'];
  let cumPct = 0;
  const vendorSegments = vendors.slice(0, 10).map((v, i) => {
    const pct = (v.total_amount || 0) / totalVendorAmt * 100;
    const seg = `${palette[i % palette.length]} ${cumPct.toFixed(2)}% ${(cumPct + pct).toFixed(2)}%`;
    cumPct += pct;
    return { seg, color: palette[i % palette.length], pct, vendor: v.vendor, amount: v.total_amount };
  });
  const vendorPie = vendorSegments.length ? `conic-gradient(${vendorSegments.map(s => s.seg).join(', ')})` : '#e2e8f0';

  // 饼图 —— 按分类
  const totalCat = categories.reduce((a, c) => a + (c.count || 0), 0) || 1;
  let cumPct2 = 0;
  const catSegments = categories.map((c, i) => {
    const pct = (c.count || 0) / totalCat * 100;
    const seg = `${palette[i % palette.length]} ${cumPct2.toFixed(2)}% ${(cumPct2 + pct).toFixed(2)}%`;
    cumPct2 += pct;
    return { seg, color: palette[i % palette.length], pct, category: c.category || '(未分类)', count: c.count };
  });
  const catPie = catSegments.length ? `conic-gradient(${catSegments.map(s => s.seg).join(', ')})` : '#e2e8f0';

  // 月度柱状图（发票金额 & 交易金额）
  const maxInv = Math.max(1, ...byMonth.map(m => m.inv_total || 0));
  const maxTxn = Math.max(1, ...byMonth.map(m => Math.abs(m.revenue || 0) + Math.abs(m.expense || 0)));

  return `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <label style="font-size:13px">年度筛选：</label>
      <select onchange="arcAnalyticsFilterYear('${esc(company_id)}', this.value)" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px">
        <option value="">全部年份</option>
        ${years.map(y => `<option value="${esc(y)}" ${currentYear === y ? 'selected' : ''}>${esc(y)}</option>`).join('')}
      </select>
      <span class="muted" style="font-size:12px">共 ${vendors.length} 个供应商 · 发票合计 S$ ${(t.invoice_total || 0).toFixed(2)} · GST S$ ${(t.gst_total || 0).toFixed(2)}</span>
    </div>

    <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:20px">
      <div class="card" style="padding:16px">
        <h4 style="margin:0 0 12px">🥧 按供应商分布（Top 10，按金额）</h4>
        <div style="display:flex;gap:16px;align-items:center">
          <div style="width:180px;height:180px;border-radius:50%;background:${vendorPie};flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05)"></div>
          <div style="flex:1;max-height:180px;overflow:auto">
            ${vendorSegments.map(s => `
              <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0">
                <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${s.color}"></span>
                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(s.vendor)}">${esc(s.vendor)}</span>
                <b>S$ ${(s.amount || 0).toFixed(2)}</b>
                <span class="muted">${s.pct.toFixed(1)}%</span>
              </div>`).join('') || '<p class="muted">暂无数据</p>'}
          </div>
        </div>
      </div>

      <div class="card" style="padding:16px">
        <h4 style="margin:0 0 12px">🥧 按消息分类分布（WA）</h4>
        <div style="display:flex;gap:16px;align-items:center">
          <div style="width:180px;height:180px;border-radius:50%;background:${catPie};flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05)"></div>
          <div style="flex:1">
            ${catSegments.map(s => `
              <div style="display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0">
                <span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${s.color}"></span>
                <span style="flex:1">${esc(s.category)}</span>
                <b>${s.count}</b>
                <span class="muted">${s.pct.toFixed(1)}%</span>
              </div>`).join('') || '<p class="muted">暂无数据</p>'}
          </div>
        </div>
        ${docKinds.length ? `
        <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #e2e8f0">
          <div class="muted" style="font-size:11px;margin-bottom:6px">文档类型 (documents.kind)</div>
          ${docKinds.map(k => `<span style="display:inline-block;background:#f1f5f9;padding:2px 8px;border-radius:10px;font-size:12px;margin:2px">${esc(k.kind)} · ${k.count}</span>`).join('')}
        </div>` : ''}
      </div>
    </div>

    <div class="card" style="padding:16px;margin-bottom:20px">
      <h4 style="margin:0 0 12px">📊 月度趋势</h4>
      ${byMonth.length ? `
      <div style="display:flex;gap:8px;align-items:flex-end;height:160px;padding:10px 0;border-bottom:1px solid #e2e8f0">
        ${byMonth.map(m => {
          const invH = (m.inv_total || 0) / maxInv * 120;
          const expH = Math.abs(m.expense || 0) / maxTxn * 120;
          const revH = Math.abs(m.revenue || 0) / maxTxn * 120;
          return `
          <div style="flex:1;text-align:center;min-width:40px">
            <div style="display:flex;justify-content:center;gap:2px;align-items:flex-end;height:130px">
              <div title="发票 S$ ${(m.inv_total||0).toFixed(2)}" style="width:14px;height:${invH}px;background:#2563eb;border-radius:2px 2px 0 0"></div>
              <div title="营收 S$ ${(m.revenue||0).toFixed(2)}" style="width:14px;height:${revH}px;background:#10b981;border-radius:2px 2px 0 0"></div>
              <div title="支出 S$ ${(m.expense||0).toFixed(2)}" style="width:14px;height:${expH}px;background:#ef4444;border-radius:2px 2px 0 0"></div>
            </div>
            <div style="font-size:10px;margin-top:4px;color:#64748b">${esc(m.ym)}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:16px;margin-top:8px;font-size:12px">
        <span><span style="display:inline-block;width:10px;height:10px;background:#2563eb;border-radius:2px"></span> 发票金额</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:#10b981;border-radius:2px"></span> 营收</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px"></span> 支出</span>
      </div>` : '<p class="muted">暂无月度数据</p>'}
    </div>

    <div class="card" style="padding:16px">
      <h4 style="margin:0 0 12px">🏪 供应商明细（共 ${vendors.length} 个）</h4>
      ${vendors.length ? `<table class="arc-tbl">
        <thead><tr><th>#</th><th>供应商</th><th style="text-align:right">次数</th><th style="text-align:right">合计金额</th><th style="text-align:right">合计 GST</th><th style="text-align:right">均单价</th><th>最近发票</th></tr></thead>
        <tbody>${vendors.map((v, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><b>${esc(v.vendor)}</b></td>
            <td style="text-align:right">${v.count}</td>
            <td style="text-align:right"><b>S$ ${(v.total_amount || 0).toFixed(2)}</b></td>
            <td style="text-align:right">S$ ${(v.total_gst || 0).toFixed(2)}</td>
            <td style="text-align:right">S$ ${(v.avg_amount || 0).toFixed(2)}</td>
            <td>${esc(v.last_invoice_date || '-')}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="muted">暂无供应商数据</p>'}
    </div>
  `;
}

// ========== U: 快照历史 + 对比 ==========
async function arcLoadSnapshots(company_id) {
  const body = document.getElementById('arc_tab_body');
  if (!body) return;
  try {
    const r = await fetch(`/api/admin/archive/company/${company_id}/snapshots`).then(x => x.json());
    if (!r.ok) { body.innerHTML = `<p style="color:#ef4444">加载失败：${esc(r.error || '')}</p>`; return; }
    body.innerHTML = arcRenderSnapshots(company_id, r.data || []);
  } catch (e) {
    body.innerHTML = `<p style="color:#ef4444">请求失败：${esc(e.message)}</p>`;
  }
}

function arcRenderSnapshots(company_id, snaps) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div>
        <h4 style="margin:0">📸 快照历史（共 ${snaps.length} 个）</h4>
        <p class="muted" style="margin:4px 0 0;font-size:12px">每个快照包含 JSON / CSV / HTML 三种格式，可选择两个快照对比关键指标变化</p>
      </div>
      <button class="btn" onclick="arcSnapshot('${esc(company_id)}', () => arcLoadSnapshots('${esc(company_id)}'))">📸 生成新快照</button>
    </div>

    ${snaps.length >= 2 ? `
    <div class="card" style="padding:12px;margin-bottom:14px;background:#f8fafc">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b>对比两个快照：</b>
        <select id="snap_a" style="padding:5px 8px;border:1px solid #e2e8f0;border-radius:5px">
          ${snaps.map((s, i) => `<option value="${esc(s.snapshot_id)}" ${i === 1 ? 'selected' : ''}>${esc(s.name)} (${esc((s.created_at || '').slice(0,19))})</option>`).join('')}
        </select>
        <span>→</span>
        <select id="snap_b" style="padding:5px 8px;border:1px solid #e2e8f0;border-radius:5px">
          ${snaps.map((s, i) => `<option value="${esc(s.snapshot_id)}" ${i === 0 ? 'selected' : ''}>${esc(s.name)} (${esc((s.created_at || '').slice(0,19))})</option>`).join('')}
        </select>
        <button class="btn" onclick="arcDiffSnapshots('${esc(company_id)}')">🔍 对比</button>
      </div>
      <div id="snap_diff_result" style="margin-top:10px"></div>
    </div>` : ''}

    ${snaps.length ? `<table class="arc-tbl">
      <thead><tr><th>快照名</th><th>时间</th><th style="text-align:right">交易</th><th style="text-align:right">发票</th><th style="text-align:right">发票额</th><th style="text-align:right">文档</th><th style="text-align:right">大小</th><th>下载</th></tr></thead>
      <tbody>${snaps.map(s => {
        const m = s.metrics || {};
        const sizeKB = ((s.json_bytes || 0) + (s.csv_bytes || 0) + (s.html_bytes || 0)) / 1024;
        const f = s.files || {};
        return `
        <tr>
          <td><b>${esc(s.name)}</b><br><code style="font-size:10px;color:#64748b">${esc(s.snapshot_id)}</code></td>
          <td>${esc((s.created_at || '').slice(0, 19).replace('T', ' '))}</td>
          <td style="text-align:right">${m.transactions || 0}</td>
          <td style="text-align:right">${m.invoice_count || 0}</td>
          <td style="text-align:right">S$ ${(m.invoice_total || 0).toFixed(2)}</td>
          <td style="text-align:right">${m.document_count || 0}</td>
          <td style="text-align:right">${sizeKB.toFixed(1)} KB</td>
          <td>
            ${f.json ? `<a href="${esc(f.json)}" target="_blank" style="margin-right:6px">JSON</a>` : ''}
            ${f.csv  ? `<a href="${esc(f.csv)}"  target="_blank" style="margin-right:6px">CSV</a>` : ''}
            ${f.html ? `<a href="${esc(f.html)}" target="_blank">HTML</a>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `
    <div class="card" style="padding:24px;text-align:center">
      <p class="muted">尚未生成任何快照</p>
      <button class="btn primary" onclick="arcSnapshot('${esc(company_id)}', () => arcLoadSnapshots('${esc(company_id)}'))">📸 立即生成第一个快照</button>
    </div>`}
  `;
}

window.arcDiffSnapshots = async function (company_id) {
  const a = document.getElementById('snap_a')?.value;
  const b = document.getElementById('snap_b')?.value;
  const out = document.getElementById('snap_diff_result');
  if (!a || !b) return;
  if (a === b) { out.innerHTML = '<p class="muted">请选择两个不同的快照</p>'; return; }
  out.innerHTML = '<p class="muted">对比中…</p>';
  try {
    const r = await fetch(`/api/admin/archive/company/${company_id}/snapshot/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<p style="color:#ef4444">对比失败：${esc(r.error || '')}</p>`; return; }
    out.innerHTML = `
      <div style="font-size:12px;margin-bottom:8px">
        <b>A:</b> ${esc(r.a.name)} <span class="muted">(${esc((r.a.created_at||'').slice(0,19))})</span> →
        <b>B:</b> ${esc(r.b.name)} <span class="muted">(${esc((r.b.created_at||'').slice(0,19))})</span>
      </div>
      <table class="arc-tbl">
        <thead><tr><th>指标</th><th style="text-align:right">A</th><th style="text-align:right">B</th><th style="text-align:right">变化</th></tr></thead>
        <tbody>${r.diff.map(d => {
          const color = d.delta > 0 ? '#10b981' : (d.delta < 0 ? '#ef4444' : '#64748b');
          const sign = d.delta > 0 ? '+' : '';
          const isMoney = d.metric.includes('total') || d.metric === 'revenue' || d.metric === 'expense';
          const fmt = v => isMoney ? `S$ ${(v || 0).toFixed(2)}` : String(v || 0);
          return `<tr>
            <td><b>${esc(d.metric)}</b></td>
            <td style="text-align:right">${fmt(d.a)}</td>
            <td style="text-align:right">${fmt(d.b)}</td>
            <td style="text-align:right;color:${color};font-weight:600">${sign}${fmt(d.delta)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    `;
  } catch (e) { out.innerHTML = `<p style="color:#ef4444">请求失败：${esc(e.message)}</p>`; }
};

function arcRenderOverview(a) {
  const c = a.company;
  const upcoming = a.tax?.upcoming_deadlines || [];
  const recentEvents = (a.timeline || []).slice(0, 15);
  return `
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
      <div>
        <h4>🏢 企业快照</h4>
        <table class="arc-tbl">
          <tr><td class="muted">公司名称</td><td><b>${esc(c.name)}</b></td></tr>
          <tr><td class="muted">UEN</td><td><code>${esc(c.uen || '—')}</code></td></tr>
          <tr><td class="muted">状态</td><td>${esc(c.status)}</td></tr>
          <tr><td class="muted">FYE</td><td>${esc(c.fye || '—')}</td></tr>
          <tr><td class="muted">SSIC</td><td>${esc(c.ssic_codes || '—')}</td></tr>
          <tr><td class="muted">注册资本</td><td>${esc(c.currency || 'SGD')} ${(c.paid_up_capital || 0).toLocaleString()}</td></tr>
          <tr><td class="muted">订阅</td><td>${esc(c.subscription_tier || 'basic')}</td></tr>
          <tr><td class="muted">板块</td><td>${esc(c.segment || 'local_sg')}</td></tr>
          <tr><td class="muted">法人/董事</td><td>${a.persons.length} 人</td></tr>
          <tr><td class="muted">银行账户</td><td>${a.bank_accounts.length} 个</td></tr>
          <tr><td class="muted">创建时间</td><td>${esc(c.created_at)}</td></tr>
        </table>
      </div>
      <div>
        <h4>⚠️ 即将到期 (${upcoming.length})</h4>
        ${upcoming.length ? upcoming.map(u => `
          <div class="arc-list-item" style="background:#fef3c7;border-radius:6px;margin-bottom:6px">
            <div>
              <div style="font-weight:600">${esc(u.kind)}</div>
              <div class="muted" style="font-size:12px">到期：${esc(u.due_date)}</div>
            </div>
            <span style="color:#92400e;font-size:12px">${esc(u.status)}</span>
          </div>`).join('') : `<p class="muted">30 天内无到期事项 ✓</p>`}

        <h4 style="margin-top:20px">⏳ 近期活动 (${recentEvents.length})</h4>
        ${recentEvents.length ? recentEvents.map(e => `
          <div class="arc-list-item">
            <span class="arc-ev-icon">${e.icon || '•'}</span>
            <div style="flex:1">
              <div style="font-weight:500">${esc(e.title)}</div>
              <div class="muted" style="font-size:12px">${esc(e.detail || '')}</div>
            </div>
            <span class="muted" style="font-size:11px;white-space:nowrap">${esc((e.ts || '').slice(0,16))}</span>
          </div>`).join('') : `<p class="muted">暂无活动</p>`}
      </div>
    </div>`;
}

function arcRenderBasic(a) {
  const c = a.company;
  return `
    <h4>🏢 公司信息</h4>
    <table class="arc-tbl">
      <tr><th>字段</th><th>值</th></tr>
      ${Object.entries(c).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v || '—'))}</td></tr>`).join('')}
    </table>

    <h4 style="margin-top:20px">👥 法人 / 董事 / 股东 (${a.persons.length})</h4>
    ${a.persons.length ? `<table class="arc-tbl">
      <thead><tr><th>姓名</th><th>角色</th><th>国籍</th><th>NRIC/Passport</th><th>持股%</th></tr></thead>
      <tbody>${a.persons.map(p => `<tr><td>${esc(p.name || '-')}</td><td>${esc(p.role || '-')}</td><td>${esc(p.nationality || '-')}</td><td>${esc(p.nric_passport || '-')}</td><td>${p.shareholding_percent || 0}%</td></tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无</p>`}

    <h4 style="margin-top:20px">🏦 银行账户 (${a.bank_accounts.length})</h4>
    ${a.bank_accounts.length ? `<table class="arc-tbl">
      <thead><tr><th>银行</th><th>账号</th><th>币种</th><th>余额</th><th>状态</th></tr></thead>
      <tbody>${a.bank_accounts.map(b => `<tr><td>${esc(b.bank_name || '-')}</td><td><code>${esc(b.account_number || '-')}</code></td><td>${esc(b.currency || 'SGD')}</td><td>${b.balance || 0}</td><td>${esc(b.status || '-')}</td></tr>`).join('')}</tbody>
    </table>` : `<p class="muted">尚未绑定银行账户</p>`}

    <h4 style="margin-top:20px">🪪 KYC 会话 (${a.kyc.length})</h4>
    ${a.kyc.length ? `<table class="arc-tbl">
      <thead><tr><th>ID</th><th>状态</th><th>创建时间</th></tr></thead>
      <tbody>${a.kyc.map(k => `<tr><td><code>${esc(k.id)}</code></td><td>${esc(k.status)}</td><td>${esc(k.created_at)}</td></tr>`).join('')}</tbody>
    </table>` : `<p class="muted">尚无 KYC 记录</p>`}

    <h4 style="margin-top:20px">📝 注册订单 (${a.registration_orders.length})</h4>
    ${a.registration_orders.length ? `<table class="arc-tbl">
      <thead><tr><th>ID</th><th>阶段</th><th>进度</th><th>价格</th><th>创建</th></tr></thead>
      <tbody>${a.registration_orders.map(r => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.stage)}</td><td>${Math.round((r.progress || 0)*100)}%</td><td>S$${r.price_sgd || 0}</td><td>${esc(r.created_at)}</td></tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无</p>`}
  `;
}

function arcRenderExpenses(a) {
  const s = a.expenses.summary;
  return `
    <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">总收入</div><div style="font-size:20px;font-weight:700;color:#10b981">S$ ${(s.total_income||0).toFixed(2)}</div></div>
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">总支出</div><div style="font-size:20px;font-weight:700;color:#ef4444">S$ ${(s.total_expense||0).toFixed(2)}</div></div>
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">净现金流</div><div style="font-size:20px;font-weight:700;color:${s.net_cashflow >= 0 ? '#10b981' : '#ef4444'}">S$ ${(s.net_cashflow||0).toFixed(2)}</div></div>
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">发票 GST</div><div style="font-size:20px;font-weight:700">S$ ${(s.total_gst||0).toFixed(2)}</div></div>
    </div>

    <h4>💸 交易流水 (${a.expenses.transactions.length})</h4>
    ${a.expenses.transactions.length ? `<table class="arc-tbl">
      <thead><tr><th>日期</th><th>金额</th><th>描述</th><th>对方</th><th>分类</th></tr></thead>
      <tbody>${a.expenses.transactions.slice(0, 100).map(t => `
        <tr>
          <td>${esc(t.transaction_date || '-')}</td>
          <td style="color:${t.amount >= 0 ? '#10b981' : '#ef4444'};font-weight:600">${t.amount >= 0 ? '+' : ''}${t.currency || 'SGD'} ${(t.amount || 0).toFixed(2)}</td>
          <td>${esc(t.description || '-')}</td>
          <td>${esc(t.counterparty || '-')}</td>
          <td>${esc(t.category || t.reference || '-')}</td>
        </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无交易</p>`}

    <h4 style="margin-top:20px">🧾 发票 (${a.expenses.invoices.length}) — 点缩略图查看原件</h4>
    ${a.expenses.invoices.length ? `<table class="arc-tbl">
      <thead><tr><th style="width:80px">原件</th><th>发票号</th><th>供应商</th><th>日期</th><th>金额</th><th>GST</th><th>状态</th><th>置信度</th></tr></thead>
      <tbody>${a.expenses.invoices.slice(0,100).map(i => `
        <tr>
          <td>${(typeof arcRenderFile==='function') ? arcRenderFile(i.image_url, 'image/*') : (i.image_url ? `<a href="${esc(i.image_url)}" target="_blank">查看</a>` : '<span class="muted">-</span>')}</td>
          <td><code>${esc(i.invoice_number || i.id.slice(-8))}</code></td>
          <td>${esc(i.vendor_name || '-')}</td>
          <td>${esc(i.issue_date || '-')}</td>
          <td>${esc(i.currency || 'SGD')} ${(i.total || 0).toFixed(2)}</td>
          <td>${(i.gst_amount || 0).toFixed(2)}</td>
          <td><span style="padding:2px 8px;border-radius:12px;background:${i.status === 'paid' ? '#dcfce7' : '#fef3c7'};font-size:11px">${esc(i.status)}</span></td>
          <td>${i.ocr_confidence != null ? (i.ocr_confidence * 100).toFixed(0) + '%' : '-'}</td>
        </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无发票</p>`}
  `;
}

function arcRenderTax(a) {
  return `
    <h4>🏛️ 税务申报 (${a.tax.filings.length})</h4>
    ${a.tax.filings.length ? `<table class="arc-tbl">
      <thead><tr><th>类型</th><th>期间</th><th>应纳税</th><th>已缴</th><th>状态</th><th>到期</th><th>提交</th></tr></thead>
      <tbody>${a.tax.filings.map(f => `
        <tr>
          <td><b>${esc(f.kind)}</b></td>
          <td>${esc(f.period || '-')}</td>
          <td>S$ ${(f.amount_due || 0).toFixed(2)}</td>
          <td>S$ ${(f.amount_paid || 0).toFixed(2)}</td>
          <td><span style="padding:2px 8px;border-radius:12px;background:${f.status === 'submitted' ? '#dcfce7' : '#fef3c7'};font-size:11px">${esc(f.status)}</span></td>
          <td>${esc(f.due_date || '-')}</td>
          <td>${esc(f.submitted_at || '-')}</td>
        </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">尚无税务申报记录（此档案还没有开始报税）</p>`}

    <h4 style="margin-top:20px">⚠️ 即将到期 (${a.tax.upcoming_deadlines.length})</h4>
    ${a.tax.upcoming_deadlines.length ? a.tax.upcoming_deadlines.map(u => `
      <div class="arc-list-item" style="background:#fef3c7;border-radius:6px;margin-bottom:6px">
        <div><b>${esc(u.kind)}</b> · ${esc(u.period || '')}<div class="muted" style="font-size:12px">到期 ${esc(u.due_date)}</div></div>
        <span>S$ ${(u.amount_due || 0).toFixed(2)}</span>
      </div>`).join('') : `<p class="muted">30 天内无到期 ✓</p>`}

    <h4 style="margin-top:20px">📒 会计分录 (${a.tax.journals.length})</h4>
    ${a.tax.journals.length ? `<table class="arc-tbl">
      <thead><tr><th>日期</th><th>描述</th><th>借方</th><th>贷方</th><th>状态</th></tr></thead>
      <tbody>${a.tax.journals.slice(0, 50).map(j => `
        <tr>
          <td>${esc(j.entry_date || '-')}</td>
          <td>${esc(j.description || '-')}</td>
          <td>${(j.debit_amount || 0).toFixed(2)}</td>
          <td>${(j.credit_amount || 0).toFixed(2)}</td>
          <td>${esc(j.status || 'posted')}</td>
        </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无分录</p>`}
  `;
}

function arcRenderReports(a) {
  const y = a.reports.yearly;
  const m = a.reports.monthly;
  return `
    <h4>📈 年度财报 (${y.length} 年)</h4>
    ${y.length ? `<table class="arc-tbl">
      <thead><tr><th>年度</th><th>交易数</th><th>营收</th><th>支出</th><th>净利润</th><th>利润率</th></tr></thead>
      <tbody>${y.map(r => {
        const margin = r.revenue > 0 ? ((r.net_profit / r.revenue) * 100).toFixed(1) : '—';
        return `<tr>
          <td><b>${esc(r.year)}</b></td>
          <td>${r.txn_count}</td>
          <td style="color:#10b981">S$ ${r.revenue.toFixed(2)}</td>
          <td style="color:#ef4444">S$ ${r.expense.toFixed(2)}</td>
          <td style="color:${r.net_profit >= 0 ? '#10b981' : '#ef4444'};font-weight:600">S$ ${r.net_profit.toFixed(2)}</td>
          <td>${margin}${margin !== '—' ? '%' : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : `<p class="muted">尚无交易数据，无法生成年度报表</p>`}

    <h4 style="margin-top:20px">📅 月度趋势（近 ${m.length} 个月）</h4>
    ${m.length ? `<table class="arc-tbl">
      <thead><tr><th>月份</th><th>交易数</th><th>营收</th><th>支出</th></tr></thead>
      <tbody>${m.map(r => `<tr>
        <td>${esc(r.month)}</td><td>${r.txn_count}</td>
        <td style="color:#10b981">S$ ${r.revenue.toFixed(2)}</td>
        <td style="color:#ef4444">S$ ${r.expense.toFixed(2)}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无数据</p>`}

    <h4 style="margin-top:20px">📄 已生成报表文件 (${a.reports.report_documents.length})</h4>
    ${a.reports.report_documents.length ? `<table class="arc-tbl">
      <thead><tr><th>类型</th><th>版本</th><th>生成时间</th><th>AI</th></tr></thead>
      <tbody>${a.reports.report_documents.map(d => `<tr>
        <td>${esc(d.kind)}</td><td>v${d.version || 1}</td>
        <td>${esc(d.created_at)}</td>
        <td>${d.generated_by_ai ? '🤖' : '👤'}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">尚未生成报表文件</p>`}
  `;
}

// 把 file_path / media_url 渲染成可点开的缩略图 / 下载链接
function arcRenderFile(url, mime) {
  if (!url) return '<span class="muted">-</span>';
  const u = String(url);
  const isImg = /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(u) || /^image\//.test(mime || '');
  const isPdf = /\.pdf$/i.test(u) || (mime || '').includes('pdf');
  const abs = u.startsWith('/') ? u : (u.startsWith('http') ? u : '');
  if (!abs) return `<code style="font-size:11px">${esc(u.slice(0, 40))}</code>`;
  if (isImg) {
    return `<a href="${abs}" target="_blank" title="点击查看原图">
      <img src="${abs}" style="width:56px;height:56px;object-fit:cover;border:1px solid #e5e7eb;border-radius:6px;vertical-align:middle" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span class=\\'muted\\' style=\\'font-size:11px\\'>(图片丢失)</span>')">
    </a>`;
  }
  const icon = isPdf ? '📄' : (mime || '').startsWith('video/') ? '🎬' : (mime || '').startsWith('audio/') ? '🎵' : '📎';
  return `<a href="${abs}" target="_blank" style="text-decoration:none">${icon} <span style="font-size:12px">${esc(u.split('/').pop().slice(0, 24))}</span></a>`;
}

// 从 linked_entity_ids 数组中拉出关联的发票/文档的实际 file_url（通过全量 archive 缓存查找）
function arcFindFileByLinkedId(a, eid) {
  if (!eid) return null;
  // 先找 invoices.image_url
  const inv = (a.expenses && a.expenses.invoices || []).find(x => x.id === eid);
  if (inv && inv.image_url) return inv.image_url;
  // 再找 documents.file_path
  const doc = (a.history && a.history.documents || []).find(x => x.id === eid);
  if (doc && doc.file_path) return doc.file_path;
  return null;
}

function arcRenderHistory(a) {
  // 预计算：关联到 uploads 里的 linked_entity_ids 第一个文件
  const uploadsWithFile = (a.history.uploads || []).map(u => {
    let ids = [];
    try { ids = JSON.parse(u.linked_entity_ids || '[]'); } catch (_) {}
    const firstFile = ids.map(id => arcFindFileByLinkedId(a, id)).find(Boolean);
    return { ...u, _preview: firstFile };
  });

  return `
    <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      <div class="card" style="padding:12px;text-align:center"><div class="muted" style="font-size:11px">文档</div><div style="font-size:22px;font-weight:700">${a.history.documents.length}</div></div>
      <div class="card" style="padding:12px;text-align:center"><div class="muted" style="font-size:11px">WhatsApp 消息</div><div style="font-size:22px;font-weight:700">${a.history.wa_messages.length}</div></div>
      <div class="card" style="padding:12px;text-align:center"><div class="muted" style="font-size:11px">上传提交</div><div style="font-size:22px;font-weight:700">${a.history.uploads.length}</div></div>
      <div class="card" style="padding:12px;text-align:center"><div class="muted" style="font-size:11px">AI 执行</div><div style="font-size:22px;font-weight:700">${a.history.agent_runs.length}</div></div>
    </div>

    <h4>📄 文档记录（含上传文件）</h4>
    ${a.history.documents.length ? `<table class="arc-tbl">
      <thead><tr><th style="width:80px">预览</th><th>类型</th><th>版本</th><th>文件路径</th><th>AI</th><th>创建</th></tr></thead>
      <tbody>${a.history.documents.slice(0,30).map(d => `<tr>
        <td>${arcRenderFile(d.file_path)}</td>
        <td><b>${esc(d.kind || '-')}</b></td><td>v${d.version || 1}</td>
        <td><code style="font-size:11px">${esc((d.file_path || '').slice(0,50))}</code></td>
        <td>${d.generated_by_ai ? '🤖' : '👤'}</td>
        <td>${esc((d.created_at || '').slice(0,16))}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无</p>`}

    <h4 style="margin-top:20px">📤 上传记录（点图预览原文件）</h4>
    ${uploadsWithFile.length ? `<table class="arc-tbl">
      <thead><tr><th style="width:80px">预览</th><th>链接</th><th>提交人</th><th>文件数</th><th>分类</th><th>关联单据</th><th>时间</th></tr></thead>
      <tbody>${uploadsWithFile.slice(0,30).map(u => `<tr>
        <td>${arcRenderFile(u._preview)}</td>
        <td><code style="font-size:11px">${esc(u.token_code || u.token || '-')}</code> ${esc(u.token_label || '')}</td>
        <td>${esc(u.submitter_name || '匿名')}</td>
        <td>${u.file_count || 0}</td>
        <td>${esc(u.classified_as || '-')}</td>
        <td style="font-size:11px">${esc((u.linked_entity_ids || '[]').replace(/[\[\]"]/g,'').slice(0,40))}</td>
        <td>${esc((u.created_at || '').slice(0,16))}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无上传</p>`}

    <h4 style="margin-top:20px">💬 WhatsApp / 上传消息（含图片原件）</h4>
    ${a.history.wa_messages.length ? `<table class="arc-tbl">
      <thead><tr><th style="width:80px">预览</th><th>方向</th><th>类型</th><th>内容</th><th>分类</th><th>置信度</th><th>时间</th></tr></thead>
      <tbody>${a.history.wa_messages.slice(0,30).map(m => `<tr>
        <td>${arcRenderFile(m.media_url, m.msg_type === 'image' ? 'image/*' : '')}</td>
        <td>${m.direction === 'in' ? '📥' : '📤'}</td>
        <td>${esc(m.msg_type || 'text')}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc((m.content || '').slice(0,80))}</td>
        <td>${esc(m.classified_as || '-')}</td>
        <td>${m.ai_confidence != null ? (m.ai_confidence * 100).toFixed(0) + '%' : '-'}</td>
        <td>${esc((m.received_at || '').slice(0,16))}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无</p>`}

    <h4 style="margin-top:20px">🤖 AI Agent 执行</h4>
    ${a.history.agent_runs.length ? `<table class="arc-tbl">
      <thead><tr><th>Agent</th><th>状态</th><th>延迟</th><th>开始</th></tr></thead>
      <tbody>${a.history.agent_runs.slice(0,30).map(r => `<tr>
        <td><b>${esc(r.agent_id)}</b></td>
        <td>${esc(r.status)}</td>
        <td>${r.latency_ms || '-'} ms</td>
        <td>${esc((r.created_at || r.started_at || '').slice(0,16))}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无</p>`}
  `;
}

function arcRenderTimeline(a) {
  const items = a.timeline || [];
  if (!items.length) return `<p class="muted">暂无活动</p>`;
  return `
    <h4>⏳ 统一时间线 (${items.length} 个事件)</h4>
    <div style="border-left:2px solid #e2e8f0;padding-left:16px;margin-left:8px">
      ${items.map(e => `
        <div style="position:relative;padding:10px 0;border-bottom:1px dashed #f1f5f9">
          <div style="position:absolute;left:-25px;top:14px;width:14px;height:14px;border-radius:50%;background:#fff;border:2px solid #2563eb"></div>
          <div style="display:flex;justify-content:space-between;gap:10px">
            <div>
              <span style="font-size:18px">${e.icon || '•'}</span>
              <b style="margin-left:6px">${esc(e.title)}</b>
              <span class="muted" style="font-size:12px;margin-left:8px">${esc(e.detail || '')}</span>
            </div>
            <span class="muted" style="font-size:11px;white-space:nowrap">${esc((e.ts || '').slice(0,19))}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function arcRenderBilling(a) {
  const b = a.billing;
  return `
    <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">已支付</div><div style="font-size:20px;font-weight:700;color:#10b981">S$ ${(b.summary.paid_sum||0).toFixed(2)}</div></div>
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">待支付</div><div style="font-size:20px;font-weight:700;color:#f59e0b">S$ ${(b.summary.pending_sum||0).toFixed(2)}</div></div>
      <div class="card" style="padding:12px"><div class="muted" style="font-size:11px">支付记录</div><div style="font-size:20px;font-weight:700">${b.summary.total||0}</div></div>
    </div>

    <h4>💳 支付记录 (${b.payments.length})</h4>
    ${b.payments.length ? `<table class="arc-tbl">
      <thead><tr><th>金额</th><th>币种</th><th>渠道</th><th>状态</th><th>用途</th><th>时间</th></tr></thead>
      <tbody>${b.payments.map(p => `<tr>
        <td><b>${(p.amount || 0).toFixed(2)}</b></td>
        <td>${esc(p.currency || 'SGD')}</td>
        <td>${esc(p.method || '-')}</td>
        <td><span style="padding:2px 8px;border-radius:12px;background:${p.status === 'success' || p.status === 'paid' ? '#dcfce7' : '#fef3c7'};font-size:11px">${esc(p.status)}</span></td>
        <td>${esc(p.purpose || '-')}</td>
        <td>${esc((p.created_at || '').slice(0,16))}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无支付</p>`}

    <h4 style="margin-top:20px">🔔 提醒 (${b.reminders.length})</h4>
    ${b.reminders.length ? `<table class="arc-tbl">
      <thead><tr><th>事项</th><th>到期</th><th>状态</th></tr></thead>
      <tbody>${b.reminders.map(r => `<tr>
        <td>${esc(r.title || r.kind || '-')}</td>
        <td>${esc(r.due_at || '-')}</td>
        <td>${esc(r.status || '-')}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p class="muted">暂无</p>`}
  `;
}

window.arcSnapshot = async function (id, onDone) {
  const name = prompt('快照命名：', `档案快照 ${new Date().toISOString().slice(0,10)}`);
  if (!name) return;
  try {
    const r = await fetch(`/api/admin/archive/company/${id}/snapshot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (d.ok) {
      const totalKB = ((d.size_bytes || 0) + (d.csv_bytes || 0) + (d.html_bytes || 0)) / 1024;
      gwToast(`✓ 快照已生成 · JSON+CSV+HTML · ${totalKB.toFixed(1)} KB`, 'ok');
      if (typeof onDone === 'function') onDone(d);
    } else {
      gwToast('失败: ' + (d.error || r.status), 'err');
    }
  } catch (e) { gwToast('请求失败: ' + e.message, 'err'); }
};

window.arcExport = function () {
  const a = window._currentArchive;
  if (!a) return;
  const blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `archive-${a.company.id}-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  gwToast('✓ 档案已导出', 'ok');
};

window.arcNewService = function (id) {
  const services = [
    { k: 'upload',      t: '🔗 生成专属上传链接',    fn: () => anav('uploadPortal') },
    { k: 'tax',         t: '🏛️ 新建税务申报 (ECI/GST)', fn: () => gwToast('→ 请到 Agent Studio 选择 tax_agent', 'info') },
    { k: 'report',      t: '📈 生成财务报表 (P&L/BS)',  fn: () => gwToast('→ 请到 Agent Studio 选择 audit_agent', 'info') },
    { k: 'registry',    t: '📝 新的注册申请',           fn: () => gwToast('→ 请到 Review Queue → 新增订单', 'info') },
    { k: 'snapshot',    t: '📸 生成档案快照',           fn: () => arcSnapshot(id) },
  ];
  const m = document.getElementById('upModal') || (() => { const d = document.createElement('div'); d.id = 'arcModal'; document.body.appendChild(d); return d; })();
  m.innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;z-index:9999" onclick="if(event.target===this)this.remove()">
      <div class="card" style="width:400px">
        <h3 style="margin-top:0">🚀 基于此档案发起新服务</h3>
        <p class="muted">以该企业档案为核心，一键发起常用服务流程：</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
          ${services.map((s, i) => `<button class="btn" style="text-align:left;justify-content:flex-start" onclick="this.parentElement.parentElement.parentElement.parentElement.remove();window._arcSvc${i}()">${s.t}</button>`).join('')}
        </div>
        <div style="text-align:right;margin-top:12px"><button class="btn" onclick="this.parentElement.parentElement.parentElement.remove()">取消</button></div>
      </div>
    </div>`;
  services.forEach((s, i) => { window[`_arcSvc${i}`] = s.fn; });
};
