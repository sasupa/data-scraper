/**
 * Tiny server-rendered HTML for /admin. Two render functions + one
 * escape helper. If this file starts growing helpers (partial(),
 * layout(), if-helpers), STOP and switch to EJS or Nunjucks instead.
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

const STATUS_DOT = {
  ok: '<span class="dot dot-ok" title="ok"></span>',
  error: '<span class="dot dot-error" title="error"></span>',
  running: '<span class="dot dot-running" title="running"></span>',
};

const STYLES = `
  :root {
    --fg: #18181b; --bg: #fafaf9; --panel: #ffffff;
    --border: #e4e4e7; --muted: #71717a; --accent: #1f2937;
    --ok: #16a34a; --error: #dc2626; --warn: #d97706; --info: #2563eb;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--fg); background: var(--bg); margin: 0; line-height: 1.55; }
  header { background: var(--accent); color: #fafafa; padding: 0.7rem 1.5rem;
    display: flex; gap: 1.25rem; align-items: center; font-size: 0.92rem; }
  header h1 { font-size: 0.95rem; font-weight: 600; margin: 0; letter-spacing: 0.02em; }
  header h1 a { color: inherit; text-decoration: none; }
  header form { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
  header label { opacity: 0.7; font-size: 0.85rem; }
  header select { background: transparent; color: #fafafa; border: 1px solid #555;
    padding: 0.25rem 0.5rem; border-radius: 4px; font: inherit; }
  main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
  h2 { font-size: 1.4rem; font-weight: 600; margin: 0 0 0.5rem; }
  h3 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--muted); margin: 1.5rem 0 0.5rem; }
  .breadcrumb { color: var(--muted); font-size: 0.88rem; margin-bottom: 0.5rem; }
  .breadcrumb a { color: inherit; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.9rem; margin-top: 1rem; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    padding: 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .card-head { display: flex; align-items: center; gap: 0.5rem; }
  .card-name { font-weight: 600; font-size: 1rem; flex: 1; }
  .card-meta { color: var(--muted); font-size: 0.83rem; line-height: 1.6; }
  .card-meta dt { display: inline; font-weight: 500; color: var(--fg); }
  .card-meta dd { display: inline; margin: 0; }
  .card-meta dd::after { content: ""; display: block; }
  .card-actions { display: flex; gap: 0.5rem; margin-top: 0.4rem; }
  .badge { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px;
    background: #f4f4f5; color: var(--muted); font-size: 0.72rem; font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.04em; }
  .badge-mode-mock   { background: #fef3c7; color: #92400e; }
  .badge-mode-scrape { background: #dbeafe; color: #1e40af; }
  .badge-mode-live   { background: #dcfce7; color: #166534; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--muted); flex-shrink: 0; }
  .dot-ok { background: var(--ok); }
  .dot-error { background: var(--error); }
  .dot-running { background: var(--warn); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  button, .btn { font: inherit; cursor: pointer; padding: 0.4rem 0.85rem; border-radius: 6px;
    border: 1px solid var(--border); background: var(--panel); color: var(--fg);
    text-decoration: none; display: inline-block; }
  button:hover, .btn:hover { border-color: var(--muted); }
  .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
  .btn-primary:hover { background: #000; border-color: #000; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    margin-top: 1rem; overflow: hidden; }
  .panel-head { padding: 0.7rem 1rem; border-bottom: 1px solid var(--border);
    display: flex; gap: 0.75rem; align-items: baseline; background: #fbfbfb; }
  .panel-head h3 { margin: 0; }
  .panel-head .meta { color: var(--muted); font-size: 0.82rem; margin-left: auto; }
  .panel-body { padding: 0.5rem 1rem 1rem; }
  pre { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.82rem;
    background: #f8f8f7; border: 1px solid var(--border); border-radius: 6px;
    padding: 0.75rem; overflow-x: auto; max-height: 480px; line-height: 1.5;
    color: #18181b; margin: 0.5rem 0 0; }
  table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  th, td { padding: 0.45rem 0.6rem; text-align: left; border-bottom: 1px solid var(--border); }
  th { font-weight: 600; color: var(--muted); font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; }
  tr:last-child td { border-bottom: none; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { padding: 2rem; text-align: center; color: var(--muted);
    background: var(--panel); border: 1px dashed var(--border); border-radius: 8px; }
  .summary { display: flex; gap: 1.5rem; flex-wrap: wrap; padding: 0.5rem 0; }
  .summary span { color: var(--muted); }
  .summary strong { color: var(--fg); font-variant-numeric: tabular-nums; }
  .added strong { color: var(--ok); }
  .removed strong { color: var(--error); }
  .changed strong { color: var(--warn); }
  .err { color: var(--error); font-family: monospace; font-size: 0.85rem; }
`;

function tenantSelect(tenants, currentTenant, hidden = []) {
  if (!tenants || tenants.length <= 1) {
    if (currentTenant) return `<span style="opacity:0.7">tenant: ${esc(currentTenant)}</span>`;
    return '';
  }
  const options = tenants.map((t) =>
    `<option value="${esc(t.id)}"${t.id === currentTenant ? ' selected' : ''}>${esc(t.name || t.id)}</option>`,
  ).join('');
  const hiddenInputs = hidden.map((h) => `<input type="hidden" name="${esc(h.name)}" value="${esc(h.value)}">`).join('');
  return `
    <form method="get">
      ${hiddenInputs}
      <label for="tenant">tenant:</label>
      <select id="tenant" name="tenant" onchange="this.form.submit()">${options}</select>
    </form>
  `;
}

function shell(title, currentTenant, tenants, body, hidden = []) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · dataScraper admin</title>
  <style>${STYLES}</style>
</head>
<body>
  <header>
    <h1><a href="/admin">dataScraper admin</a></h1>
    ${tenantSelect(tenants, currentTenant, hidden)}
  </header>
  <main>${body}</main>
</body>
</html>`;
}

export function renderProvidersIndex({ cards, tenants, currentTenant }) {
  if (!tenants || tenants.length === 0) {
    return shell('No tenants', currentTenant, tenants, `
      <h2>Set up a tenant</h2>
      <div class="empty">
        No tenants exist yet. Run<br>
        <pre>npm run seed -- &lt;id&gt; &lt;name&gt;</pre>
        from the project root, then refresh this page.
      </div>
    `);
  }

  const cardHtml = cards.map((c) => {
    const dot = STATUS_DOT[c.last?.status] ?? '<span class="dot"></span>';
    const lastWhen = c.last ? relativeTime(c.last.finished_at || c.last.started_at) : 'never';
    const lastError = c.last?.status === 'error'
      ? `<dt>error:</dt> <dd class="err">${esc(c.last.error)}</dd>`
      : '';
    return `
      <div class="card">
        <div class="card-head">
          ${dot}
          <span class="card-name">${esc(c.name)}</span>
          <span class="badge badge-mode-${esc(c.mode)}">${esc(c.mode)}</span>
        </div>
        <dl class="card-meta">
          <dt>last:</dt> <dd>${esc(lastWhen)}</dd>
          <dt>rows:</dt> <dd>${esc(c.last?.rows_written ?? 0)}</dd>
          <dt>cron:</dt> <dd><code>${esc(c.schedule)}</code></dd>
          ${lastError}
        </dl>
        <div class="card-actions">
          <a class="btn" href="/admin/providers/${esc(c.name)}?tenant=${encodeURIComponent(currentTenant)}">View →</a>
          <form method="post" action="/admin/providers/${esc(c.name)}/refresh?tenant=${encodeURIComponent(currentTenant)}" style="display:inline">
            <button class="btn btn-primary" type="submit">Refresh</button>
          </form>
        </div>
      </div>
    `;
  }).join('');

  return shell('Providers', currentTenant, tenants, `
    <h2>Providers</h2>
    <p style="color:var(--muted);margin-top:0.25rem">Click a provider to inspect its raw payload, the normalized cache, and the diff vs the previous run.</p>
    <div class="grid">${cardHtml}</div>
  `);
}

export function renderProvider({ provider, tenants, currentTenant, latest, refreshLog, normalized }) {
  const diff = latest?.diff_json ? safeParse(latest.diff_json) : null;
  const raw = latest?.raw_payload ? safeParse(latest.raw_payload) : null;

  const summary = diff?.firstRun
    ? `<div class="summary"><span>First run — no previous artifact to diff against.</span></div>`
    : diff
      ? `<div class="summary">
          <span class="added">added <strong>${diff.added?.length ?? 0}</strong></span>
          <span class="removed">removed <strong>${diff.removed?.length ?? 0}</strong></span>
          <span class="changed">changed <strong>${diff.changed?.length ?? 0}</strong></span>
          <span>unchanged <strong>${diff.unchangedCount ?? 0}</strong></span>
        </div>`
      : '';

  const diffPanel = !latest
    ? `<div class="empty">No artifacts captured yet. Click <strong>Refresh now</strong>.</div>`
    : `<div class="panel">
        <div class="panel-head"><h3>Diff vs previous run</h3>
          <span class="meta">captured ${esc(fmtTime(latest.captured_at))}</span></div>
        <div class="panel-body">
          ${summary}
          ${diff && !diff.firstRun ? `<pre>${esc(JSON.stringify(diff, null, 2))}</pre>` : ''}
        </div>
      </div>`;

  const rawPanel = !latest
    ? ''
    : `<div class="panel">
        <div class="panel-head"><h3>Raw payload</h3>
          <span class="meta">latest capture</span></div>
        <div class="panel-body"><pre>${esc(JSON.stringify(raw, null, 2))}</pre></div>
      </div>`;

  const normPanel = !normalized
    ? ''
    : normalized.error
      ? `<div class="panel"><div class="panel-head"><h3>Normalized (cache)</h3></div>
          <div class="panel-body"><div class="err">${esc(normalized.error)}</div></div></div>`
      : `<div class="panel">
          <div class="panel-head"><h3>Normalized (cache)</h3>
            <span class="meta">last updated ${esc(fmtTime(normalized.lastUpdated))} · source: ${esc(normalized.source)}</span></div>
          <div class="panel-body"><pre>${esc(JSON.stringify(normalized.data, null, 2))}</pre></div>
        </div>`;

  const logRows = refreshLog.map((r) => {
    const dot = STATUS_DOT[r.status] ?? '';
    return `<tr>
      <td>${dot} ${esc(r.status)}</td>
      <td>${esc(fmtTime(r.started_at))}</td>
      <td>${esc(fmtTime(r.finished_at))}</td>
      <td class="num">${esc(r.rows_written ?? 0)}</td>
      <td class="err">${esc(r.error ?? '')}</td>
    </tr>`;
  }).join('');

  const logPanel = `<div class="panel">
    <div class="panel-head"><h3>Refresh log</h3>
      <span class="meta">last ${refreshLog.length}</span></div>
    <div class="panel-body" style="padding:0">
      ${refreshLog.length === 0
        ? '<div class="empty" style="border:none">No refreshes yet.</div>'
        : `<table>
            <thead><tr><th>Status</th><th>Started</th><th>Finished</th><th>Rows</th><th>Error</th></tr></thead>
            <tbody>${logRows}</tbody>
          </table>`}
    </div>
  </div>`;

  const body = `
    <div class="breadcrumb"><a href="/admin">← providers</a></div>
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      <h2 style="margin:0">${esc(provider.name)}</h2>
      <span class="badge badge-mode-${esc(provider.mode)}">${esc(provider.mode)}</span>
      <span style="color:var(--muted);font-size:0.88rem">cron <code>${esc(provider.schedule)}</code></span>
      <form method="post" action="/admin/providers/${esc(provider.name)}/refresh?tenant=${encodeURIComponent(currentTenant)}" style="margin-left:auto">
        <button class="btn btn-primary" type="submit">Refresh now</button>
      </form>
    </div>
    ${diffPanel}
    ${rawPanel}
    ${normPanel}
    ${logPanel}
  `;

  return shell(provider.name, currentTenant, tenants, body, [
    { name: 'redirect', value: `/admin/providers/${provider.name}` },
  ]);
}

export function renderError(message) {
  return shell('Error', null, null, `
    <h2>Error</h2>
    <div class="empty err">${esc(message)}</div>
    <p><a href="/admin">← back</a></p>
  `);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
