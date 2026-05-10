import { logger } from '../utils/logger.js';
import { isProd } from '../config.js';

/**
 * BEST PRACTICE: one central error handler instead of try/catch in every route.
 *
 * Routes can throw or call `next(err)` and this handler:
 *  - logs the full error with request context
 *  - returns a clean JSON response
 *  - hides stack traces in production
 *
 * Express recognizes a middleware as an error handler by its 4-arg signature.
 * Don't remove the unused `next` parameter — Express checks `fn.length === 4`.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  logger.error(
    { err, path: req.path, method: req.method, tenantId: req.tenantId },
    'Request failed'
  );
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.publicMessage || (isProd ? 'Internal error' : err.message),
      ...(isProd ? {} : { stack: err.stack }),
    },
  });
}

/**
 * Helper for throwing structured errors from routes/providers.
 *   throw new ApiError('Not found', 404, 'NOT_FOUND')
 */
export class ApiError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
    this.publicMessage = message;
  }
}
