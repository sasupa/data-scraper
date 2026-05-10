/**
 * /admin — internal UI for inspecting providers, raw payloads,
 * normalized cache, diffs vs previous run, and refresh history.
 *
 * Auth: HTTP Basic (admin / ADMIN_PASSWORD). Mounted on its own router
 * so it never shares middleware with /api/v1 — the two endpoints evolve
 * independently.
 */
import express, { Router } from 'express';
import { db } from '../db/index.js';
import { providers, getProvider } from '../providers/index.js';
import { renderProvidersIndex, renderProvider, renderError } from '../views/admin.js';

export const adminRouter = Router();

// Form posts (Refresh now button). Scoped to this router only.
adminRouter.use(express.urlencoded({ extended: false }));

adminRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const selectTenants = db.prepare('SELECT id, name FROM tenants ORDER BY id');
const selectLastRun = db.prepare(`
  SELECT started_at, finished_at, status, error, rows_written
  FROM refresh_log
  WHERE tenant_id = ? AND provider = ?
  ORDER BY started_at DESC LIMIT 1
`);
const selectRefreshLog = db.prepare(`
  SELECT id, started_at, finished_at, status, error, rows_written
  FROM refresh_log
  WHERE tenant_id = ? AND provider = ?
  ORDER BY started_at DESC LIMIT 10
`);
const selectLatestArtifact = db.prepare(`
  SELECT raw_payload, diff_json, captured_at, screenshot_path
  FROM refresh_artifacts
  WHERE tenant_id = ? AND provider = ?
  ORDER BY captured_at DESC LIMIT 1
`);

function pickTenant(req, tenants) {
  if (!tenants.length) return null;
  const requested = req.query.tenant || req.body?.tenant;
  if (requested && tenants.some((t) => t.id === requested)) return requested;
  return tenants[0].id;
}

adminRouter.get('/', (req, res) => {
  const tenants = selectTenants.all();
  const currentTenant = pickTenant(req, tenants);

  const cards = providers.map((p) => ({
    name: p.name,
    mode: p.mode,
    schedule: p.schedule,
    last: currentTenant ? selectLastRun.get(currentTenant, p.name) : null,
  }));

  res.type('html').send(renderProvidersIndex({ cards, tenants, currentTenant }));
});

adminRouter.get('/providers/:name', async (req, res) => {
  const provider = getProvider(req.params.name);
  if (!provider) {
    return res.status(404).type('html').send(renderError(`Unknown provider: ${req.params.name}`));
  }

  const tenants = selectTenants.all();
  const currentTenant = pickTenant(req, tenants);
  if (!currentTenant) {
    return res.type('html').send(renderProvidersIndex({ cards: [], tenants, currentTenant }));
  }

  const latest = selectLatestArtifact.get(currentTenant, provider.name);
  const refreshLog = selectRefreshLog.all(currentTenant, provider.name);

  let normalized = null;
  try {
    normalized = await provider.getCached(currentTenant);
  } catch (err) {
    normalized = { error: err.message };
  }

  res.type('html').send(renderProvider({
    provider, tenants, currentTenant, latest, refreshLog, normalized,
  }));
});

adminRouter.post('/providers/:name/refresh', async (req, res, next) => {
  const provider = getProvider(req.params.name);
  if (!provider) {
    return res.status(404).type('html').send(renderError(`Unknown provider: ${req.params.name}`));
  }
  const tenants = selectTenants.all();
  const currentTenant = pickTenant(req, tenants);
  if (!currentTenant) {
    return res.status(400).type('html').send(renderError('No tenant available — run npm run seed first'));
  }

  try {
    await provider.refresh(currentTenant);
  } catch (err) {
    return next(err);
  }

  res.redirect(`/admin/providers/${encodeURIComponent(provider.name)}?tenant=${encodeURIComponent(currentTenant)}`);
});
