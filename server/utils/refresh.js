import { db, nowIso } from '../db/index.js';
import { logger } from './logger.js';

/**
 * Wraps a provider's refresh logic with bookkeeping:
 *  - inserts a "running" entry in refresh_log
 *  - calls work(previousRaw) so the provider can compute diff vs last run
 *  - persists raw payload + diff in refresh_artifacts (one transaction)
 *  - prunes artifacts to the latest ARTIFACT_RETENTION per (tenant, provider)
 *  - updates the entry to "ok" or "error"
 *  - never lets an exception escape into the cron scheduler
 *
 * Use it from every provider's `refresh()`:
 *
 *   export async function refresh(tenantId) {
 *     return runRefresh('nordnet', tenantId, async (previousRaw) => {
 *       const fresh = await fetchFresh(tenantId)
 *       const rowsWritten = writeToDb(fresh)
 *       const diff = diffPositions(previousRaw, fresh)
 *       return { rowsWritten, raw: fresh, diff }
 *     })
 *   }
 *
 * The work fn may return a number (rowsWritten only, no artifact) for
 * minimal use cases. Returning { raw, diff } enables /admin to show the
 * scrape result and how it differs from the last run.
 */

const ARTIFACT_RETENTION = 10;

const insertStart = db.prepare(`
  INSERT INTO refresh_log (tenant_id, provider, started_at, status)
  VALUES (?, ?, ?, 'running')
`);

const updateFinish = db.prepare(`
  UPDATE refresh_log
  SET finished_at = ?, status = ?, error = ?, rows_written = ?
  WHERE id = ?
`);

const getPreviousArtifact = db.prepare(`
  SELECT raw_payload FROM refresh_artifacts
  WHERE tenant_id = ? AND provider = ?
  ORDER BY captured_at DESC LIMIT 1
`);

const insertArtifact = db.prepare(`
  INSERT INTO refresh_artifacts
    (tenant_id, provider, refresh_log_id, raw_payload, diff_json, screenshot_path, captured_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const pruneArtifactsStmt = db.prepare(`
  DELETE FROM refresh_artifacts
  WHERE tenant_id = ? AND provider = ?
    AND id NOT IN (
      SELECT id FROM refresh_artifacts
      WHERE tenant_id = ? AND provider = ?
      ORDER BY captured_at DESC LIMIT ?
    )
`);

const persistArtifact = db.transaction((tenantId, provider, refreshLogId, raw, diff, screenshotPath) => {
  insertArtifact.run(
    tenantId,
    provider,
    refreshLogId,
    JSON.stringify(raw),
    diff == null ? null : JSON.stringify(diff),
    screenshotPath ?? null,
    nowIso(),
  );
  pruneArtifactsStmt.run(tenantId, provider, tenantId, provider, ARTIFACT_RETENTION);
});

export async function runRefresh(provider, tenantId, work) {
  const startedAt = nowIso();
  const { lastInsertRowid: logId } = insertStart.run(tenantId, provider, startedAt);

  let previousRaw = null;
  const prevRow = getPreviousArtifact.get(tenantId, provider);
  if (prevRow?.raw_payload) {
    try {
      previousRaw = JSON.parse(prevRow.raw_payload);
    } catch {
      previousRaw = null;
    }
  }

  try {
    const result = await work(previousRaw);
    const { rowsWritten, raw, diff, screenshotPath } = normalizeResult(result);

    if (raw !== undefined && raw !== null) {
      persistArtifact(tenantId, provider, logId, raw, diff, screenshotPath);
    }

    updateFinish.run(nowIso(), 'ok', null, rowsWritten, logId);
    logger.info({ provider, tenantId, rowsWritten, capturedArtifact: raw != null }, 'Refresh ok');
    return { ok: true, rowsWritten };
  } catch (err) {
    updateFinish.run(nowIso(), 'error', err.message, 0, logId);
    logger.error({ err, provider, tenantId }, 'Refresh failed');
    return { ok: false, error: err.message };
  }
}

function normalizeResult(result) {
  if (typeof result === 'number') return { rowsWritten: result };
  if (result && typeof result === 'object') {
    return {
      rowsWritten: result.rowsWritten ?? 0,
      raw: result.raw,
      diff: result.diff,
      screenshotPath: result.screenshotPath,
    };
  }
  return { rowsWritten: 0 };
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
