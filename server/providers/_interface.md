# Provider Interface

Every file in `server/providers/` MUST export this shape:

```js
export const name = 'instagram';
export const mode = process.env.INSTAGRAM_MODE || 'mock'; // 'mock' | 'scrape' | 'live'

// Cron expression — when this provider auto-refreshes
export const schedule = '0 */6 * * *'; // every 6 hours

/**
 * Hits the actual source. Heavy operation.
 * MUST NOT be called from a route handler directly.
 *
 * Branches on `mode`:
 *   mock   → return realistic fake data
 *   scrape → headless browser / HTML parsing
 *   live   → official API call
 */
export async function fetchFresh(tenantId, params = {}) {
  // ...
}

/**
 * Reads from SQLite cache. Fast, safe to call per-request.
 * Returns { data, lastUpdated, source } or null if no cached data exists.
 */
export async function getCached(tenantId, params = {}) {
  // ...
}

/**
 * Called by the scheduler. Wraps fetchFresh + DB write + refresh_log entry.
 * Returns { rowsWritten } or throws.
 */
export async function refresh(tenantId) {
  // ...
}
```

## Rules

1. **No HTTP calls in `getCached`.** Ever. SQLite only.
2. **Always wrap `refresh` in a `refresh_log` entry.** Use the helper in `utils/refresh.js`.
3. **All writes to provider tables go through prepared statements.** No string concat.
4. **Mock data must have the same shape as live data.** Otherwise the adapter pattern breaks.
5. **Tenant ID is ALWAYS the first parameter.** No globals.

## Adding a new provider

1. Copy `_template.js` to `<name>.js`
2. Fill in `fetchFresh` for each mode
3. Add tables to `db/schema.sql` (with `tenant_id`)
4. Create a route in `routes/<name>.js` that only calls `getCached`
5. Register in `routes/index.js` and `jobs/scheduler.js`
6. Add env vars to `.env.example`
