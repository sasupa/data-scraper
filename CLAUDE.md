# dataScraper

Internal sidecar service that aggregates data from external sources (Nordnet, social platforms, market data, web scrapers) and serves a stable internal API to other Artmin apps (meTube, CRM, crypto-bot, future products).

## Philosophy

- **Lean**: Node + Express + better-sqlite3. No ORM, no framework magic.
- **Cache-first**: API never fetches live per request. Cron jobs update SQLite, API serves from SQLite.
- **Adapter pattern**: every external source has a provider with a stable interface. Swap mock → scrape → live without touching consumers.
- **Internal-only**: binds 127.0.0.1, never exposed via Apache. Shared-secret auth on top.
- **Tenant-aware from day one**: every table has `tenant_id`. Even when there's only one tenant.
- **Stable API contracts**: consumers like meTube depend on the JSON shape. Breaking changes require a version bump (`/api/v2/...`).

## Lessons

See `lessons.md` for a running record of debugging dead-ends, wrong hypotheses,
and root-cause findings. **Read it before debugging anything that "feels familiar"** —
it might already be solved (or already a wrong-track that wasted time once).

When a debugging session uncovers a non-obvious finding, add an entry to lessons.md
in the same commit as the fix. The cost is two minutes; the payoff is not making
the same mistake twice.

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

## Capture mode (push, not pull)

Some providers can't be scraped headlessly from a server cron — Nordnet is
the canonical example. Their auth is short-lived (~30s Bearer tokens minted
client-side), MFA-gated, or otherwise resists "log in once and let cron
take it from there". For those, the provider runs in `mode='capture'`:

- The server-side provider exports `ingest(tenantId, body)` instead of
  doing its own fetching. `fetchFresh` throws — no scheduled refresh path.
- The scheduler **skips** capture-mode providers (`jobs/scheduler.js` checks
  `provider.mode === 'capture'` first).
- A workstation-side script in `capture/` opens a real browser, waits for
  the human to log in, harvests credentials in memory, and POSTs the result
  to `/api/v1/ingest/<provider>/<thing>`.
- The ingest endpoint reads `tenantId` from the **body**, not the
  `X-Tenant-Id` header — capture scripts naturally group multiple per-account
  POSTs under one tenants.json entry. `/ingest` mounts before
  `requireTenant` in `server/index.js` so the body-tenant path doesn't get
  caught by the header-tenant middleware.
- All session state (cookies, Bearer tokens) lives in an ephemeral browser
  context — closing the browser drops it. No persistence on the workstation
  beyond `capture/.env` (DATASCRAPER_URL + INTERNAL_TOKEN) and
  `capture/tenants.json` (account UUIDs + bootstrap URL).
- Capture is **atomic at the capture phase**: all accounts collected in
  memory, then a single y/N prompt with actual values (positions count,
  total, cash), then sequential POSTs. POST failures abort the rest, but
  the server UPSERTs — re-running the capture is safe and idempotent.

Run: `npm run capture:nordnet` (workstation only; playwright is in
`optionalDependencies` and lives in `node_modules` only when not skipped
via `--omit=optional`).

### Capture-side initial setup (laptop only, once per machine)

    npm install
    npm run capture:setup                                  # downloads Chromium binary (~170MB)
    cp capture/.env.example capture/.env                   # fill in DATASCRAPER_URL + INTERNAL_TOKEN
    cp capture/tenants.example.json capture/tenants.json   # fill in real account UUIDs

The `capture:setup` step is **separate from `npm install`** — Playwright's npm
package and the Chromium browser binary it controls are two different downloads.
See lessons.md entry from 2026-05-10 for the failure mode if you skip it.

## Anti-patterns to avoid

- ❌ Calling `fetchFresh` from a route handler (causes timeouts, rate-limit blowups)
- ❌ Hardcoding tenant_id (always read from request context)
- ❌ Catching errors silently (always log via pino with context)
- ❌ Adding new endpoints without updating the consumer-facing JSON shape doc
- ❌ Adding port numbers without checking for free ports first (`ss -tlnp | grep <port>`)
- ❌ Forming a hypothesis before reading the actual error log (`err.log`, `pm2 logs`)
- ❌ Assuming PM2-managed service uses `.env` NODE_ENV — it uses `ecosystem.config.cjs`'s `env` block
- ❌ Adding a debugging finding as a code fix without recording the *why* in `lessons.md`
- ❌ Trying to run a capture-mode provider headless from cron — capture is human-in-the-loop by design
- ❌ Persisting Bearer tokens or session cookies to disk in `capture/` — ephemeral context only, browser close drops everything

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
   # set NODE_ENV=production   (logger uses raw JSON; dev mode requires pino-pretty)
   # set HOST=0.0.0.0
   # set NORDNET_MODE=capture  (data arrives via push from a workstation;
   #                            cron is skipped server-side)
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
