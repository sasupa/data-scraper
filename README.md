# dataScraper

Internal sidecar service for Artmin apps. Aggregates data from external sources (Nordnet, social platforms, market data) and serves a stable, cached internal API.

Other apps (meTube, CRM, crypto-bot) consume `http://127.0.0.1:3030/api/v1/...` instead of integrating each source directly. Adapter pattern means we can swap mock → scrape → live without changing consumers.

See `CLAUDE.md` for the full design contract.

## Quickstart

```bash
# 1. Install
npm install

# 2. Generate a token & copy env
cp .env.example .env
openssl rand -hex 32                  # paste into INTERNAL_TOKEN

# 3. Bootstrap DB + first tenant
npm run seed -- sasu "Sasu personal"

# 4. Run
npm run dev                           # local dev with hot-reload
# or
pm2 start ecosystem.config.cjs        # production
```

## Test it

```bash
TOKEN=$(grep INTERNAL_TOKEN .env | cut -d= -f2)

# Health (no auth)
curl http://127.0.0.1:3030/health | jq

# Portfolio (cached)
curl -H "X-Internal-Token: $TOKEN" \
     -H "X-Tenant-Id: sasu" \
     http://127.0.0.1:3030/api/v1/portfolio | jq

# Force refresh
curl -X POST \
     -H "X-Internal-Token: $TOKEN" \
     -H "X-Tenant-Id: sasu" \
     http://127.0.0.1:3030/api/v1/portfolio/refresh | jq
```

## Consuming from meTube

```js
// meTube/server/clients/datascraper.js
const BASE = 'http://127.0.0.1:3030/api/v1';
const TOKEN = process.env.DATASCRAPER_TOKEN;

export async function getPortfolio(tenantId) {
  const res = await fetch(`${BASE}/portfolio`, {
    headers: {
      'X-Internal-Token': TOKEN,
      'X-Tenant-Id': tenantId,
    },
  });
  if (!res.ok) throw new Error(`dataScraper ${res.status}`);
  return res.json();
}
```

## Adding a new provider

See `server/providers/_interface.md` and copy `_template.js`.

## Why these choices

- **better-sqlite3 over Postgres**: single VPS, single writer, lean ops. Switch when multi-server.
- **Cron in-process**: no separate worker. Add Redis/BullMQ when jobs need retries or queueing.
- **No ORM**: prepared statements are fast, transparent, and you learn SQL properly.
- **127.0.0.1 binding + token**: defense in depth. Apache doesn't proxy this.
- **Tenant-aware from day one**: schema migration to add tenant_id later is painful.
