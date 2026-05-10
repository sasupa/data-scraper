import cron from 'node-cron';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { providers } from '../providers/index.js';

/**
 * Schedule all jobs in one place. Provider list comes from the central
 * registry (providers/index.js) so /admin and the scheduler iterate the
 * same array — no risk of one knowing about a provider the other doesn't.
 *
 * Each job iterates over ALL tenants in the tenants table.
 * To add a new tenant: insert into tenants, restart (or hot-reload).
 */

export function startScheduler() {
  for (const provider of providers) {
    // Capture-mode providers receive data via push (POST /api/v1/ingest/...)
    // from a workstation script. There's no server-side fetch path, so cron
    // would only ever throw — skip registration entirely.
    if (provider.mode === 'capture') {
      logger.info({ provider: provider.name }, 'Capture mode — no cron registered (data arrives via push)');
      continue;
    }

    if (!cron.validate(provider.schedule)) {
      logger.error({ provider: provider.name }, 'Invalid cron schedule, skipping');
      continue;
    }

    cron.schedule(provider.schedule, async () => {
      const tenants = db.prepare('SELECT id FROM tenants').all();
      logger.info({ provider: provider.name, count: tenants.length }, 'Scheduled refresh');
      for (const { id } of tenants) {
        await provider.refresh(id); // runRefresh swallows exceptions, never crashes the cron
      }
    });

    logger.info({ provider: provider.name, schedule: provider.schedule }, 'Cron registered');
  }
}
