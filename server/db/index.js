import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * BEST PRACTICE: better-sqlite3 over node-sqlite3.
 *  - synchronous API = simpler code, no callback hell
 *  - faster for most workloads
 *  - prepared statements are cached automatically
 *
 * For this scale (single VPS, single writer via cron), SQLite is perfect.
 * If you ever need multi-server writes, that's the Postgres switch signal.
 */

// Ensure data dir exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.dbPath);

// WAL mode = better concurrent read perf, safer for crashes
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

logger.info({ path: config.dbPath }, 'SQLite connected');

// Apply schema on import. Provider modules prepare statements at module-load
// time, so the schema must exist before any of them are loaded. Running it
// here guarantees that ordering — schema.sql is fully idempotent
// (CREATE TABLE IF NOT EXISTS).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
logger.info('Schema applied');

/**
 * Helper: run a function inside a transaction.
 * Auto-rollback on throw, auto-commit on success.
 *
 *   const result = transaction(() => {
 *     db.prepare('INSERT ...').run(...)
 *     db.prepare('UPDATE ...').run(...)
 *     return something
 *   })
 */
export function transaction(fn) {
  const wrapped = db.transaction(fn);
  return wrapped();
}

/**
 * Helper: now() in ISO 8601 UTC. Use this everywhere instead of
 * `new Date().toISOString()` so timestamps are consistent.
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * Helper: today's date as YYYY-MM-DD (UTC).
 * Used for daily snapshots / metric_date columns.
 */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
