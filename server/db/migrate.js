import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './index.js';
import { logger } from '../utils/logger.js';

/**
 * BEST PRACTICE: idempotent migrations.
 *
 * schema.sql uses "CREATE TABLE IF NOT EXISTS" everywhere, so running it
 * repeatedly is safe. For more complex changes (column renames, drops),
 * graduate to numbered migration files (001_init.sql, 002_add_x.sql)
 * and a tracking table. For now, this is enough.
 *
 * The function is exported so server/index.js can run migrations on boot.
 * No "did you remember to migrate?" footguns.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export function migrate() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);
  logger.info('Schema migration applied');
}

// Allow running standalone: `node server/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  process.exit(0);
}
