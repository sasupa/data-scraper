/**
 * GET /api/v1/portfolio
 *   Headers: X-Internal-Token, X-Tenant-Id
 *   Query:   ?fresh=true (optional, triggers refresh first)
 *
 * Response:
 *   {
 *     data: {
 *       positions: [{ symbol, name, quantity, avg_price, market_value, currency, ... }],
 *       totalValue: number,
 *       history: [{ snapshot_date, total_value, currency }]
 *     },
 *     meta: { lastUpdated, source, cached }
 *   }
 */
import { Router } from 'express';
import * as nordnet from '../providers/nordnet.js';

export const portfolioRouter = Router();

portfolioRouter.get('/', async (req, res, next) => {
  try {
    if (req.query.fresh === 'true') {
      await nordnet.refresh(req.tenantId);
    }
    const result = await nordnet.getCached(req.tenantId);
    res.json({
      data: result.data,
      meta: {
        lastUpdated: result.lastUpdated,
        source: result.source,
        cached: req.query.fresh !== 'true',
      },
    });
  } catch (err) {
    next(err); // central error handler
  }
});

/**
 * Manual refresh endpoint for ops/debugging.
 * POST /api/v1/portfolio/refresh
 */
portfolioRouter.post('/refresh', async (req, res, next) => {
  try {
    const result = await nordnet.refresh(req.tenantId);
    res.json({ data: result, meta: { source: nordnet.mode } });
  } catch (err) {
    next(err);
  }
});
