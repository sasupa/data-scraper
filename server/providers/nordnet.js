/**
 * Nordnet provider — portfolio positions and snapshots.
 *
 * Auth (live mode):
 *   Nordnet's External API v2 uses RSA challenge-response, not OAuth.
 *   1. POST /api/2/login/start → server returns a challenge
 *   2. Sign challenge with private key (RSA-SHA256)
 *   3. POST /api/2/login with signed response → session token
 *   4. Use token in Authorization header for subsequent calls
 *
 *   Get API key + register your public key with Nordnet Trading Support.
 *   Private key lives at NORDNET_PRIVATE_KEY_PATH (NEVER in git).
 *
 * Mock mode returns the same JSON shape as live, so meTube doesn't care.
 */
import { db, nowIso, todayIso } from '../db/index.js';
import { runRefresh, lastRefreshAt } from '../utils/refresh.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const name = 'nordnet';
export const mode = config.providers.nordnet.mode;
export const schedule = '0 6 * * *'; // daily at 06:00

// ---- Prepared statements ---------------------------------------------------
const upsertPosition = db.prepare(`
  INSERT INTO portfolio_positions
    (tenant_id, account_id, symbol, isin, name, quantity, avg_price, market_value, currency, market, fetched_at, updated_at)
  VALUES (@tenant_id, @account_id, @symbol, @isin, @name, @quantity, @avg_price, @market_value, @currency, @market, @fetched_at, @fetched_at)
  ON CONFLICT(tenant_id, account_id, symbol) DO UPDATE SET
    isin = excluded.isin,
    name = excluded.name,
    quantity = excluded.quantity,
    avg_price = excluded.avg_price,
    market_value = excluded.market_value,
    currency = excluded.currency,
    market = excluded.market,
    fetched_at = excluded.fetched_at,
    updated_at = excluded.updated_at
`);

const upsertSnapshot = db.prepare(`
  INSERT INTO portfolio_snapshots (tenant_id, snapshot_date, total_value, currency, positions_json)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(tenant_id, snapshot_date) DO UPDATE SET
    total_value = excluded.total_value,
    positions_json = excluded.positions_json
`);

const selectPositions = db.prepare(`
  SELECT account_id, symbol, isin, name, quantity, avg_price, market_value, currency, market, fetched_at
  FROM portfolio_positions
  WHERE tenant_id = ?
  ORDER BY market_value DESC
`);

const selectSnapshots = db.prepare(`
  SELECT snapshot_date, total_value, currency
  FROM portfolio_snapshots
  WHERE tenant_id = ?
  ORDER BY snapshot_date DESC
  LIMIT ?
`);

// ---- Mode implementations --------------------------------------------------

/**
 * Realistic mock data. Same shape as the live response.
 * Useful for demos and integration tests.
 */
async function fetchMock(tenantId) {
  return [
    { account_id: 'mock-001', symbol: 'XYL',    isin: 'US98419M1009', name: 'Xylem Inc',          quantity: 25,  avg_price: 130.10, market_value: 3382.50, currency: 'USD', market: 'NYSE' },
    { account_id: 'mock-001', symbol: 'NXT',    isin: 'US65290B1035', name: 'Nextracker Inc',     quantity: 40,  avg_price: 67.20,  market_value: 2950.00, currency: 'USD', market: 'NASDAQ' },
    { account_id: 'mock-001', symbol: 'NEX.PA', isin: 'FR0000044448', name: 'Nexans SA',          quantity: 15,  avg_price: 105.40, market_value: 1620.00, currency: 'EUR', market: 'EPA' },
    { account_id: 'mock-001', symbol: 'SU.PA',  isin: 'FR0000121972', name: 'Schneider Electric', quantity: 12,  avg_price: 215.30, market_value: 2730.00, currency: 'EUR', market: 'EPA' },
  ];
}

async function fetchLive(tenantId) {
  // TODO: implement RSA login + GET /api/2/accounts/{id}/positions
  // See: https://www.nordnet.fi/externalapi/docs/api
  logger.warn({ tenantId }, 'Nordnet live mode not yet implemented — falling back to mock');
  return fetchMock(tenantId);
}

// ---- Required exports ------------------------------------------------------

export async function fetchFresh(tenantId) {
  return mode === 'live' ? fetchLive(tenantId) : fetchMock(tenantId);
}

export async function getCached(tenantId) {
  const positions = selectPositions.all(tenantId);
  const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0);

  return {
    data: {
      positions,
      totalValue,
      // Snapshots used for charts in meTube
      history: selectSnapshots.all(tenantId, 90),
    },
    lastUpdated: lastRefreshAt(tenantId, name),
    source: mode,
  };
}

export async function refresh(tenantId) {
  return runRefresh(name, tenantId, async () => {
    const positions = await fetchFresh(tenantId);
    const fetchedAt = nowIso();

    // BEST PRACTICE: wrap multi-row writes in a transaction.
    // Without it, each .run() is its own fsync — orders of magnitude slower.
    const writeAll = db.transaction((rows) => {
      let count = 0;
      for (const p of rows) {
        upsertPosition.run({
          tenant_id: tenantId,
          account_id: p.account_id,
          symbol: p.symbol,
          isin: p.isin ?? null,
          name: p.name ?? null,
          quantity: p.quantity,
          avg_price: p.avg_price ?? null,
          market_value: p.market_value ?? null,
          currency: p.currency ?? null,
          market: p.market ?? null,
          fetched_at: fetchedAt,
        });
        count++;
      }
      return count;
    });

    const rowsWritten = writeAll(positions);

    // Daily snapshot for chart history
    const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0);
    const baseCurrency = positions[0]?.currency || 'EUR';
    upsertSnapshot.run(tenantId, todayIso(), totalValue, baseCurrency, JSON.stringify(positions));

    return rowsWritten;
  });
}
