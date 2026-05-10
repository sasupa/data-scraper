import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * BEST PRACTICE: constant-time comparison for secrets.
 *
 * If you do `if (token === config.internalToken)`, a clever attacker
 * can detect timing differences between "first character wrong" vs
 * "first ten characters right". `crypto.timingSafeEqual` always
 * takes the same time regardless of where strings differ.
 *
 * Overkill for an internal-only API? Yes. Free? Also yes.
 * Habit > convenience.
 */

export function requireInternalToken(req, res, next) {
  const provided = req.header('X-Internal-Token');
  if (!provided) {
    return res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Missing X-Internal-Token' } });
  }

  // Buffers must be the same length, else timingSafeEqual throws.
  const a = Buffer.from(provided);
  const b = Buffer.from(config.internalToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
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
