import cron from 'node-cron';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import * as nordnet from '../providers/nordnet.js';

/**
 * BEST PRACTICE: schedule all jobs in one place.
 *
 * If every provider registered its own cron in its own file, you'd have
 * to grep the codebase to know what's running. Centralized = obvious.
 *
 * Each job iterates over ALL tenants in the tenants table.
 * To add a new tenant: insert into tenants, restart (or hot-reload).
 */

const PROVIDERS = [nordnet];

export function startScheduler() {
  for (const provider of PROVIDERS) {
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
