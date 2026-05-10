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
- Default bind `127.0.0.1:3030` (port 3001 is taken by docker-proxy on this host). In production: `0.0.0.0:3030` with `ufw` allowing only the Tailscale interface. See Deployment.

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
- Process: PM2 as `datascraper` (see `ecosystem.config.cjs`).
- Apache does NOT proxy this service — it's a private internal API.
- Port **3030** (verify free before deploy: `ss -tlnp | grep 3030`).
  Used ports on this host as of init: 3000–3003, 3005, 3010, 3020, 3101.
- Logs: `/var/www/data-scraper/logs/` and `pm2 logs datascraper`.

### Network model

Two access paths, both gated; the public internet sees nothing:

1. **Internal-app traffic** (meTube, CRM, future Artmin apps on the same VPS)
   → `http://127.0.0.1:3030/api/v1/...` over loopback. Token-protected
   (`X-Internal-Token`).
2. **Browser access to `/admin`** (humans on the user's tailnet)
   → `http://<vps-tailscale-ip>:3030/admin`. Basic-auth-protected with a
   separate `ADMIN_PASSWORD` (different scope from `INTERNAL_TOKEN`).

How the public internet stays out:

- In production, bind `HOST=0.0.0.0` so the process listens on all
  interfaces (loopback + tailscale0 + eth0). Dev default stays `127.0.0.1`
  to avoid accidental exposure on a developer laptop.
- `ufw` is active with `default deny incoming`. Only explicit allows pass.
- The only allow for port 3030 is interface-scoped to `tailscale0`.
  The public Hetzner IP cannot reach 3030 even though the process binds to
  `0.0.0.0`.
- `scripts/setup-firewall.sh <port> <service>` is the idempotent helper
  that adds that rule. Run it manually for each new internal service —
  same shape every time, never auto-run from a deploy hook.

### Production deploy checklist

1. **Install Tailscale** (one-time, requires interactive login):
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up         # follow the printed URL to authorize the device
   tailscale ip -4           # note the VPS's tailnet address
   ```
2. **Configure env**:
   ```bash
   cp .env.example .env
   # set HOST=0.0.0.0
   # INTERNAL_TOKEN=$(openssl rand -hex 32)
   # ADMIN_PASSWORD=$(openssl rand -base64 24)
   ```
3. **Install + seed + start**:
   ```bash
   npm ci
   npm run seed -- <tenant-id> "<tenant name>"
   pm2 start ecosystem.config.cjs && pm2 save
   ```
4. **Open the firewall hole** (idempotent):
   ```bash
   sudo scripts/setup-firewall.sh 3030 datascraper
   ```
5. **Verify** from a laptop joined to the same tailnet:
   - `curl http://<vps-tailscale-ip>:3030/health` → `{ "status": "ok", ... }`
   - Browser: `http://<vps-tailscale-ip>:3030/admin` (user `admin`, password from `ADMIN_PASSWORD`).
