import { db, nowIso } from '../db/index.js';
import { logger } from './logger.js';

/**
 * Wraps a provider's refresh logic with bookkeeping:
 *  - inserts a "running" entry in refresh_log
 *  - runs the work
 *  - updates the entry to "ok" or "error"
 *  - never lets an exception escape into the cron scheduler
 *
 * Use it from every provider's `refresh()`:
 *
 *   export async function refresh(tenantId) {
 *     return runRefresh('nordnet', tenantId, async () => {
 *       const fresh = await fetchFresh(tenantId)
 *       const rowsWritten = writeToDb(fresh)
 *       return rowsWritten
 *     })
 *   }
 */

const insertStart = db.prepare(`
  INSERT INTO refresh_log (tenant_id, provider, started_at, status)
  VALUES (?, ?, ?, 'running')
`);

const updateFinish = db.prepare(`
  UPDATE refresh_log
  SET finished_at = ?, status = ?, error = ?, rows_written = ?
  WHERE id = ?
`);

export async function runRefresh(provider, tenantId, work) {
  const startedAt = nowIso();
  const { lastInsertRowid: logId } = insertStart.run(tenantId, provider, startedAt);

  try {
    const rowsWritten = (await work()) ?? 0;
    updateFinish.run(nowIso(), 'ok', null, rowsWritten, logId);
    logger.info({ provider, tenantId, rowsWritten }, 'Refresh ok');
    return { ok: true, rowsWritten };
  } catch (err) {
    updateFinish.run(nowIso(), 'error', err.message, 0, logId);
    logger.error({ err, provider, tenantId }, 'Refresh failed');
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch the most recent successful refresh for freshness checks.
 */
const getLastSuccess = db.prepare(`
  SELECT finished_at FROM refresh_log
  WHERE tenant_id = ? AND provider = ? AND status = 'ok'
  ORDER BY finished_at DESC LIMIT 1
`);

export function lastRefreshAt(tenantId, provider) {
  const row = getLastSuccess.get(tenantId, provider);
  return row?.finished_at ?? null;
}
