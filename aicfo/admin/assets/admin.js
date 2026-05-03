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
  const routes = { overview, queue, agents, runs, playground, rag, training, retrieval, companies, users, archives, waChannels, llmGateway, waConfig };
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
  $('#av').innerHTML = `
    <h1 class="view-title">${t('admin.companies.title')}</h1>
    <p class="view-sub">${t('admin.companies.sub')}</p>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>UEN</th><th>${t('common.name')}</th><th>${t('common.status')}</th><th>${t('admin.companies.segment')}</th><th>FYE</th><th>${t('admin.companies.tier')}</th><th>${t('admin.companies.created')}</th></tr></thead>
        <tbody>${list.map(c => `
          <tr>
            <td class="mono small">${c.uen || '—'}</td>
            <td><strong>${esc(c.name)}</strong></td>
            <td><span class="badge badge-${c.status === 'active' ? 'success' : 'warning'}">${c.status}</span></td>
            <td>${c.segment}</td>
            <td>${c.fye}</td>
            <td>${c.subscription_tier}</td>
            <td class="small muted">${new Date(c.created_at).toLocaleDateString()}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
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
  app.innerHTML = `<div class="card"><h3>⚡ 模型网关 (Tokenhot.ai)</h3><p class="muted">加载中…</p></div>`;

  let cfg = {};
  let logsResp = { stats: {}, logs: [] };
  try {
    const r1 = await api('/admin/llm/config');
    cfg = r1.config || {};
    const r2 = await api('/admin/llm/logs?limit=30');
    logsResp = r2 || logsResp;
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>⚡ 模型网关</h3><p style="color:#ef4444">加载失败：${esc(e.message)}</p></div>`;
    return;
  }

  const stats = logsResp.stats || {};
  const logs  = logsResp.logs  || [];
  const models = cfg.models || {};
  const avail  = cfg.available_models || { reasoning: [], fast: [], default: [] };
  const tierMap = cfg.tier_by_purpose || {};

  function modelSelect(tier, selected) {
    const opts = (avail[tier] || []).map(m =>
      `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}</option>`
    ).join('');
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

  app.innerHTML = `
    <div class="card">
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
