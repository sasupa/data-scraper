/**
 * POST /api/v1/ingest/nordnet/holdings
 *   Headers: X-Internal-Token
 *   Body:    {
 *     tenantId: string,         // tenant in DB; capture/tenants.json holds it
 *     accountUuid: string,      // Nordnet account UUID (request-side truth)
 *     accountLabel: string,     // human label, stored only in logs
 *     capturedAt: string,       // ISO 8601 UTC, when the browser captured this
 *     raw: object               // /holdings/portfolio-allocation/v1/historical-allocation-summary response
 *   }
 *
 * Response:
 *   { data: { rowsWritten }, meta: { source: 'capture', accountUuid } }
 *
 * Tenant comes from the BODY here, not X-Tenant-Id, because the capture
 * script naturally groups multiple per-account POSTs under one tenant
 * config (capture/tenants.json) and the body is the source of truth for
 * which account this payload belongs to. This route is mounted outside
 * requireTenant for that reason — it does its own validation.
 */
import { Router } from 'express';
import { db } from '../db/index.js';
import * as nordnet from '../providers/nordnet.js';

export const ingestRouter = Router();

const TENANT_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const tenantExists = db.prepare('SELECT 1 FROM tenants WHERE id = ?');

function badRequest(res, code, message) {
  return res.status(400).json({ error: { code, message } });
}

ingestRouter.post('/nordnet/holdings', async (req, res, next) => {
  const body = req.body ?? {};
  const { tenantId, accountUuid, accountLabel, capturedAt, raw } = body;

  if (typeof tenantId !== 'string' || !TENANT_PATTERN.test(tenantId)) {
    return badRequest(res, 'BAD_TENANT_ID', 'tenantId is missing or invalid');
  }
  if (!tenantExists.get(tenantId)) {
    return badRequest(res, 'UNKNOWN_TENANT', `tenant '${tenantId}' is not registered`);
  }
  if (typeof accountUuid !== 'string' || !UUID_PATTERN.test(accountUuid)) {
    return badRequest(res, 'BAD_ACCOUNT_UUID', 'accountUuid must be a UUID');
  }
  if (typeof accountLabel !== 'string' || accountLabel.length === 0 || accountLabel.length > 128) {
    return badRequest(res, 'BAD_ACCOUNT_LABEL', 'accountLabel is required (1..128 chars)');
  }
  if (typeof capturedAt !== 'string' || !ISO_PATTERN.test(capturedAt)) {
    return badRequest(res, 'BAD_CAPTURED_AT', 'capturedAt must be ISO 8601 UTC (e.g. 2026-05-10T12:34:56.000Z)');
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return badRequest(res, 'BAD_RAW', 'raw must be the Nordnet response object');
  }
  if (!Array.isArray(raw.positions)) {
    return badRequest(res, 'BAD_RAW_SHAPE', 'raw.positions must be an array');
  }

  try {
    const result = await nordnet.ingest(tenantId, { accountUuid, accountLabel, capturedAt, raw });
    if (!result.ok) {
      return res.status(500).json({ error: { code: 'INGEST_FAILED', message: result.error } });
    }
    res.json({
      data: { rowsWritten: result.rowsWritten },
      meta: { source: 'capture', accountUuid },
    });
  } catch (err) {
    next(err);
  }
});
