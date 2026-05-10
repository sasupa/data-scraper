import { config } from '../config.js';
import { timingSafeCompare } from '../utils/secrets.js';

/**
 * Constant-time secret comparison lives in utils/secrets.js so /admin
 * Basic auth uses the exact same primitive. See its docstring.
 */
export function requireInternalToken(req, res, next) {
  const provided = req.header('X-Internal-Token');
  if (!provided) {
    return res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Missing X-Internal-Token' } });
  }
  if (!timingSafeCompare(provided, config.internalToken)) {
    return res.status(401).json({ error: { code: 'BAD_TOKEN', message: 'Invalid token' } });
  }
  next();
}

/**
 * Tenant context: every request after this middleware has req.tenantId.
 * Centralizing it means routes can never accidentally skip the check.
 */
export function requireTenant(req, res, next) {
  const tenantId = req.header('X-Tenant-Id');
  if (!tenantId || !/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)) {
    return res.status(400).json({
      error: { code: 'BAD_TENANT', message: 'Missing or invalid X-Tenant-Id header' },
    });
  }
  req.tenantId = tenantId;
  next();
}
