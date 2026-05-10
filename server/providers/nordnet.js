/**
 * Nordnet provider — portfolio positions and snapshots.
 *
 * Modes:
 *   mock     — synthetic positions, useful in dev. Cron runs.
 *   live     — RSA-authed External API v2. Not yet implemented.
 *   capture  — laptop-side Playwright session pushes data via
 *              POST /api/v1/ingest/nordnet/holdings (see capture/).
 *              Cron does NOT run for this mode (scheduler skips).
 *
 * Auth (live mode, future):
 *   Nordnet's External API v2 uses RSA challenge-response, not OAuth.
 *   1. POST /api/2/login/start → server returns a challenge
 *   2. Sign challenge with private key (RSA-SHA256)
 *   3. POST /api/2/login with signed response → session token
 *   4. Use token in Authorization header for subsequent calls
 *
 * Mock mode returns the same JSON shape as live, so meTube doesn't care.
 */
import { db, nowIso, todayIso } from '../db/index.js';
import { runRefresh, lastRefreshAt } from '../utils/refresh.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export const name = 'nordnet';
export const mode = config.providers.nordnet.mode;
export const schedule = '0 6 * * *'; // daily at 06:00 (scheduler skips in capture mode)

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
  INSERT INTO portfolio_snapshots
    (tenant_id, snapshot_date, total_value, currency, positions_json,
     cash_balance, total_acquisition_cost, total_return_monetary)
  VALUES
    (@tenant_id, @snapshot_date, @total_value, @currency, @positions_json,
     @cash_balance, @total_acquisition_cost, @total_return_monetary)
  ON CONFLICT(tenant_id, snapshot_date) DO UPDATE SET
    total_value = excluded.total_value,
    currency = excluded.currency,
    positions_json = excluded.positions_json,
    cash_balance = excluded.cash_balance,
    total_acquisition_cost = excluded.total_acquisition_cost,
    total_return_monetary = excluded.total_return_monetary
`);

const selectPositions = db.prepare(`
  SELECT account_id, symbol, isin, name, quantity, avg_price, market_value, currency, market, fetched_at
  FROM portfolio_positions
  WHERE tenant_id = ?
  ORDER BY market_value DESC
`);

const selectSnapshots = db.prepare(`
  SELECT snapshot_date, total_value, currency, cash_balance, total_acquisition_cost, total_return_monetary
  FROM portfolio_snapshots
  WHERE tenant_id = ?
  ORDER BY snapshot_date DESC
  LIMIT ?
`);

const selectTodaysArtifacts = db.prepare(`
  SELECT raw_payload FROM refresh_artifacts
  WHERE tenant_id = ? AND provider = ? AND date(captured_at) = ?
  ORDER BY captured_at ASC
`);

// ---- Holdings normalization ------------------------------------------------

/**
 * Map a Nordnet historical-allocation-summary response to our position rows.
 *
 * ISIN is used as `symbol` because Nordnet's `name` is the long fund/security
 * title and there's no ticker in this endpoint. (account_id, symbol) is the
 * UNIQUE key on portfolio_positions, so ISIN-as-symbol upserts cleanly.
 *
 * `accountUuid` comes from the request, not from p.accountId in the response —
 * the request is the source of truth for which account this capture is for.
 */
export function normalizeHoldings(raw, accountUuid) {
  return (raw?.positions ?? []).map((p) => ({
    account_id: accountUuid,
    symbol: p.isin,
    isin: p.isin ?? null,
    name: p.name ?? null,
    quantity: p.quantity,
    avg_price: p.averageAcquisitionCost ?? null,
    market_value: p.marketValue ?? null,
    currency: p.instrumentCurrency ?? null,
    market: null, // not present in this endpoint
  }));
}

/**
 * Aggregate today's snapshot across multiple per-account ingests.
 *
 * Each capture run pushes one POST per account. The portfolio_snapshots table
 * has UNIQUE(tenant_id, snapshot_date) — one row per tenant per day — so each
 * ingest re-aggregates from refresh_artifacts (which keeps per-account raw
 * payloads) and rewrites the daily row.
 *
 * Dedup by accountId so re-ingesting the same account same-day doesn't
 * double-count. Current ingest's raw is added first so it wins dedup.
 */
function aggregateForDay(tenantId, day, currentRaw) {
  let totalValue = 0;
  let totalCash = 0;
  let totalAcq = 0;
  let totalReturn = 0;
  let currency = null;
  const allPositions = [];
  const seen = new Set();

  const accumulate = (r) => {
    const accId = r?.positions?.[0]?.accountId;
    if (accId && seen.has(accId)) return;
    if (accId) seen.add(accId);
    totalValue += r?.totalMarketValue ?? 0;
    totalCash += (r?.accountBalances ?? []).reduce((s, ab) => s + (ab?.balance ?? 0), 0);
    totalAcq += r?.totalAcquisitionCost ?? 0;
    totalReturn += r?.totalReturnMonetary ?? 0;
    currency = currency ?? r?.currencyCode ?? null;
    if (Array.isArray(r?.positions)) allPositions.push(...r.positions);
  };

  accumulate(currentRaw);
  for (const row of selectTodaysArtifacts.all(tenantId, name, day)) {
    try {
      accumulate(JSON.parse(row.raw_payload));
    } catch {
      // skip malformed artifact, don't fail the whole ingest
    }
  }

  return {
    total_value: totalValue,
    cash_balance: totalCash,
    total_acquisition_cost: totalAcq,
    total_return_monetary: totalReturn,
    currency: currency ?? 'EUR',
    positions_json: JSON.stringify(allPositions),
  };
}

// ---- Mode implementations --------------------------------------------------

async function fetchMock(/* tenantId */) {
  return [
    { account_id: 'mock-001', symbol: 'XYL',    isin: 'US98419M1009', name: 'Xylem Inc',          quantity: 25,  avg_price: 130.10, market_value: 3382.50, currency: 'USD', market: 'NYSE' },
    { account_id: 'mock-001', symbol: 'NXT',    isin: 'US65290B1035', name: 'Nextracker Inc',     quantity: 40,  avg_price: 67.20,  market_value: 2950.00, currency: 'USD', market: 'NASDAQ' },
    { account_id: 'mock-001', symbol: 'NEX.PA', isin: 'FR0000044448', name: 'Nexans SA',          quantity: 15,  avg_price: 105.40, market_value: 1620.00, currency: 'EUR', market: 'EPA' },
    { account_id: 'mock-001', symbol: 'SU.PA',  isin: 'FR0000121972', name: 'Schneider Electric', quantity: 12,  avg_price: 215.30, market_value: 2730.00, currency: 'EUR', market: 'EPA' },
  ];
}

async function fetchLive(tenantId) {
  // TODO: implement RSA login + GET /api/2/accounts/{id}/positions
  logger.warn({ tenantId }, 'Nordnet live mode not yet implemented — falling back to mock');
  return fetchMock(tenantId);
}

async function fetchCapture() {
  throw new Error(
    `nordnet is in 'capture' mode: no server-side fetch path. ` +
    `Run 'npm run capture:nordnet' from a workstation to push data via /api/v1/ingest/nordnet/holdings.`,
  );
}

// ---- Required exports ------------------------------------------------------

export async function fetchFresh(tenantId) {
  if (mode === 'capture') return fetchCapture();
  if (mode === 'live') return fetchLive(tenantId);
  return fetchMock(tenantId);
}

export async function getCached(tenantId) {
  const positions = selectPositions.all(tenantId);
  const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0);

  return {
    data: {
      positions,
      totalValue,
      history: selectSnapshots.all(tenantId, 90),
    },
    lastUpdated: lastRefreshAt(tenantId, name),
    source: mode,
  };
}

export async function refresh(tenantId) {
  return runRefresh(name, tenantId, async (previousRaw) => {
    const positions = await fetchFresh(tenantId);
    const fetchedAt = nowIso();

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

    const totalValue = positions.reduce((sum, p) => sum + (p.market_value || 0), 0);
    const baseCurrency = positions[0]?.currency || 'EUR';
    upsertSnapshot.run({
      tenant_id: tenantId,
      snapshot_date: todayIso(),
      total_value: totalValue,
      currency: baseCurrency,
      positions_json: JSON.stringify(positions),
      cash_balance: null,
      total_acquisition_cost: null,
      total_return_monetary: null,
    });

    return {
      rowsWritten,
      raw: positions,
      diff: diffPositions(previousRaw, positions),
    };
  });
}

/**
 * Capture-mode entrypoint: push one account's holdings JSON.
 *
 * Reuses runRefresh so the ingest gets the same artifact + log treatment as
 * a cron refresh. The work fn:
 *   1. Normalizes raw → position rows, upserts portfolio_positions
 *   2. Re-aggregates today's portfolio_snapshots row across all accounts
 *      captured today (deduped by accountId via refresh_artifacts)
 *   3. Returns raw so the artifact preserves the exact Nordnet response
 */
export async function ingest(tenantId, { accountUuid, accountLabel, capturedAt, raw }) {
  return runRefresh(name, tenantId, async () => {
    const positions = normalizeHoldings(raw, accountUuid);
    const fetchedAt = capturedAt;

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

    const day = (capturedAt || nowIso()).slice(0, 10);
    const agg = aggregateForDay(tenantId, day, raw);
    upsertSnapshot.run({
      tenant_id: tenantId,
      snapshot_date: day,
      ...agg,
    });

    logger.info(
      { tenantId, accountUuid, accountLabel, positions: rowsWritten, totalValue: agg.total_value },
      'Nordnet capture ingested',
    );

    return {
      rowsWritten,
      raw,
      // Diff is suppressed in capture mode for now: previousRaw might be from
      // a different account in the same day, so position-level diffs would
      // be misleading. Per-account diffs are vaihe 2.
      diff: null,
    };
  });
}

/**
 * Position-level diff against the previous run, identified by
 * (account_id, symbol). Computed at refresh time so /admin only renders.
 */
function diffPositions(prev, curr) {
  if (!Array.isArray(prev)) return { firstRun: true };

  const keyOf = (p) => `${p.account_id}|${p.symbol}`;
  const prevMap = new Map(prev.map((p) => [keyOf(p), p]));
  const currMap = new Map(curr.map((p) => [keyOf(p), p]));

  const added = [];
  const removed = [];
  const changed = [];
  let unchangedCount = 0;

  for (const [k, c] of currMap) {
    const p = prevMap.get(k);
    if (!p) {
      added.push({ symbol: c.symbol, quantity: c.quantity, market_value: c.market_value });
    } else if (p.quantity !== c.quantity || p.market_value !== c.market_value) {
      changed.push({
        symbol: c.symbol,
        from: { quantity: p.quantity, market_value: p.market_value },
        to: { quantity: c.quantity, market_value: c.market_value },
      });
    } else {
      unchangedCount++;
    }
  }
  for (const [k, p] of prevMap) {
    if (!currMap.has(k)) {
      removed.push({ symbol: p.symbol, quantity: p.quantity, market_value: p.market_value });
    }
  }

  return { added, removed, changed, unchangedCount };
}
