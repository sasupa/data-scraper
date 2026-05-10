/**
 * Bootstrap a fresh DB:
 *   - creates a tenant
 *   - runs an initial refresh so /api/v1/portfolio has data immediately
 *
 * Usage:
 *   node scripts/seed.js sasu "Sasu's portfolio"
 */
import { db, nowIso } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import * as nordnet from '../server/providers/nordnet.js';
import { logger } from '../server/utils/logger.js';

migrate();

const [, , tenantId = 'sasu', tenantName = 'Default tenant'] = process.argv;

db.prepare(`
  INSERT INTO tenants (id, name, created_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`).run(tenantId, tenantName, nowIso(), nowIso());

logger.info({ tenantId }, 'Tenant ensured');

const result = await nordnet.refresh(tenantId);
logger.info({ result }, 'Initial Nordnet refresh complete');

process.exit(0);
