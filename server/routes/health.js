/**
 * GET /health
 *   No auth required. Used by PM2, monitoring, load balancers.
 *
 *   Returns process state + per-provider freshness.
 *   200 = healthy, 503 = something stale or DB unreachable.
 */
import { Router } from 'express';
import { db } from '../db/index.js';

export const healthRouter = Router();

healthRouter.get('/', (req, res) => {
  try {
    // Touch DB to verify it's responsive
    db.prepare('SELECT 1').get();

    // Per-provider last successful refresh
    const rows = db.prepare(`
      SELECT provider, MAX(finished_at) as lastSuccess
      FROM refresh_log
      WHERE status = 'ok'
      GROUP BY provider
    `).all();

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      pid: process.pid,
      providers: rows,
      now: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});
