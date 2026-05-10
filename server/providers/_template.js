/**
 * Provider template. Copy to <name>.js and replace TODOs.
 * See _interface.md for the full contract.
 */
import { db, nowIso } from '../db/index.js';
import { runRefresh, lastRefreshAt } from '../utils/refresh.js';

export const name = 'TEMPLATE';
export const mode = process.env.TEMPLATE_MODE || 'mock';
export const schedule = '0 */6 * * *'; // every 6h

// ---- DB statements (prepared once, reused) ---------------------------------
// const upsertRow = db.prepare(`INSERT OR REPLACE INTO ...`)
// const selectCached = db.prepare(`SELECT ... WHERE tenant_id = ?`)

// ---- Mode implementations --------------------------------------------------
async function fetchMock(tenantId, params) {
  // Return data with the EXACT shape the live API would return.
  return [];
}

async function fetchScrape(tenantId, params) {
  // Playwright / cheerio etc.
  throw new Error('scrape mode not implemented');
}

async function fetchLive(tenantId, params) {
  // Real API call.
  throw new Error('live mode not implemented');
}

// ---- Required exports ------------------------------------------------------
export async function fetchFresh(tenantId, params = {}) {
  switch (mode) {
    case 'live':   return fetchLive(tenantId, params);
    case 'scrape': return fetchScrape(tenantId, params);
    default:       return fetchMock(tenantId, params);
  }
}

export async function getCached(tenantId, params = {}) {
  // const rows = selectCached.all(tenantId)
  return {
    data: [],
    lastUpdated: lastRefreshAt(tenantId, name),
    source: mode,
  };
}

export async function refresh(tenantId) {
  return runRefresh(name, tenantId, async () => {
    const fresh = await fetchFresh(tenantId);
    // const txn = db.transaction((rows) => rows.forEach(r => upsertRow.run(...)))
    // txn(fresh)
    return fresh.length;
  });
}
