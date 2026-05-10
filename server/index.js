import express from 'express';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { migrate } from './db/migrate.js';
import { requireInternalToken, requireTenant } from './middleware/auth.js';
import { errorHandler } from './middleware/error.js';
import { healthRouter } from './routes/health.js';
import { portfolioRouter } from './routes/portfolio.js';
import { startScheduler } from './jobs/scheduler.js';

// 1. Run migrations FIRST. If schema is broken, fail before binding the port.
migrate();

const app = express();

// 2. Request logging — pino-http auto-creates per-request loggers with request IDs.
app.use(pinoHttp({ logger }));

app.use(express.json({ limit: '1mb' }));

// 3. Public routes (no auth)
app.use('/health', healthRouter);

// 4. Internal API — every /api route requires token + tenant
const api = express.Router();
api.use(requireInternalToken);
api.use(requireTenant);
api.use('/portfolio', portfolioRouter);

app.use('/api/v1', api);

// 5. Catch-all 404
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
});

// 6. Central error handler — must be LAST middleware
app.use(errorHandler);

// 7. Bind to 127.0.0.1 ONLY — not exposed to public internet
const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, env: config.env }, 'dataScraper listening');
  startScheduler();
});

// 8. Graceful shutdown — important for PM2 reload, prevents dropped requests
const shutdown = (signal) => {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // Hard exit if cleanup hangs
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
