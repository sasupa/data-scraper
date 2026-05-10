# dataScraper

Internal sidecar service that aggregates data from external sources (Nordnet, social platforms, market data, web scrapers) and serves a stable internal API to other Artmin apps (meTube, CRM, crypto-bot, future products).

## Philosophy

- **Lean**: Node + Express + better-sqlite3. No ORM, no framework magic.
- **Cache-first**: API never fetches live per request. Cron jobs update SQLite, API serves from SQLite.
- **Adapter pattern**: every external source has a provider with a stable interface. Swap mock → scrape → live without touching consumers.
- **Internal-only**: binds 127.0.0.1, never exposed via Apache. Shared-secret auth on top.
- **Tenant-aware from day one**: every table has `tenant_id`. Even when there's only one tenant.
- **Stable API contracts**: consumers like meTube depend on the JSON shape. Breaking changes require a version bump (`/api/v2/...`).

## Stack

- Node 20+, Express
- better-sqlite3 (synchronous, fast, single-file)
- node-cron for scheduled jobs
- pino for structured logging
- PM2 for process management
- Bound to 127.0.0.1:3030 (3001 is taken by docker-proxy on this host)

## Folder structure

```
server/
  index.js              # express app, port binding, middleware setup
  config.js             # env loading, validation
  db/
    schema.sql          # canonical schema
    migrate.js          # idempotent migration runner
    index.js            # better-sqlite3 instance + helpers
  middleware/
    auth.js             # X-Internal-Token check
    error.js            # central error handler
  providers/
    nordnet.js          # RSA auth + portfolio fetch
    instagram.js        # mock | scrape | live
    youtube.js          # Google API
    alphavantage.js     # market data + news
    _interface.md       # documents the provider contract
  routes/
    portfolio.js
    social.js
    market.js
    health.js
  jobs/
    scheduler.js        # registers all cron jobs
    portfolio.job.js
    social.job.js
  utils/
    cache.js            # last-updated checks, freshness logic
    logger.js
data/
  scraper.db            # SQLite file (gitignored)
logs/                   # gitignored
scripts/
  seed.js               # populate mock data for new tenants
  reset-db.js
```

## Provider contract

Every provider in `server/providers/` MUST export:

```js
export const name = 'instagram'           // unique id
export const mode = process.env.INSTAGRAM_MODE || 'mock'  // mock | scrape | live

export async function fetchFresh(tenantId, params)        // hits the source
export async function getCached(tenantId, params)         // reads SQLite
export async function refresh(tenantId)                   // called by cron
export const schedule = '0 */6 * * *'                     // cron expression
```

Routes only ever call `getCached`. Cron jobs call `refresh` (which internally calls `fetchFresh` and writes to DB).

## API conventions

- All responses: `{ data, meta: { lastUpdated, source, cached: true|false } }`
- Errors: `{ error: { code, message } }` with appropriate HTTP status
- All endpoints require `X-Internal-Token` header (except `/health`)
- Tenant scoping: `X-Tenant-Id` header, validated in middleware
- Optional `?fresh=true` triggers a refresh before responding (rate-limited)
- Versioned: `/api/v1/...`

## Database rules

- Every table: `id`, `tenant_id`, `created_at`, `updated_at`
- Use `INSERT OR REPLACE` with composite unique indexes for upserts
- All timestamps stored as ISO 8601 UTC strings
- Schema changes go in `schema.sql`; `migrate.js` runs on boot and is idempotent

## Adding a new provider — checklist

1. Create `server/providers/<name>.js` exporting the contract above
2. Add table(s) to `schema.sql`
3. Add route file in `server/routes/`
4. Wire route in `server/index.js`
5. Register cron in `server/jobs/scheduler.js`
6. Add env vars to `.env.example`
7. Document the JSON shape in a comment at the top of the route file

## Anti-patterns to avoid

- ❌ Calling `fetchFresh` from a route handler (causes timeouts, rate-limit blowups)
- ❌ Hardcoding tenant_id (always read from request context)
- ❌ Catching errors silently (always log via pino with context)
- ❌ Adding new endpoints without updating the consumer-facing JSON shape doc
- ❌ Adding port numbers without checking for free ports first (`ss -tlnp | grep <port>`)

## Deployment

- Host: `salikortti-4gb-hel1-1` (Hetzner). Project lives at `/var/www/data-scraper/`.
- Runs under PM2 as `datascraper` (see `ecosystem.config.cjs`)
- Apache does NOT proxy this service — internal-only, bound to 127.0.0.1
- Port **3030** (verify free before deploy: `ss -tlnp | grep 3030`).
  Used ports on this host as of init: 3000–3003, 3005, 3010, 3020, 3101.
- Logs go to `/var/www/data-scraper/logs/` (configured in `ecosystem.config.cjs`) and PM2's stdout (`pm2 logs datascraper`)
