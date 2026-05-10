# dataScraper

Internal sidecar service for Artmin apps. Aggregates data from external sources (Nordnet, social platforms, market data) and serves a stable, cached internal API.

Other apps (meTube, CRM, crypto-bot) consume `http://127.0.0.1:3030/api/v1/...` instead of integrating each source directly. Adapter pattern means we can swap mock → scrape → live without changing consumers.

See `CLAUDE.md` for the full design contract.

## Quickstart

```bash
# 1. Install
npm install

# 2. Generate secrets & copy env
cp .env.example .env
openssl rand -hex 32                  # paste into INTERNAL_TOKEN
openssl rand -base64 24               # paste into ADMIN_PASSWORD

# 3. Bootstrap DB + first tenant
npm run seed -- sasu "Sasu personal"

# 4. Run
npm run dev                           # local dev with hot-reload
# or for production, see "Production deployment" below
```

## Production deployment

The service is private — internal Artmin apps reach it via loopback,
humans reach `/admin` over **Tailscale**. The public internet sees
nothing. See `CLAUDE.md` → Deployment for the full network model and
rationale.

```bash
# 1. Install + authenticate Tailscale (one-time, interactive)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                     # follow printed URL to authorize
tailscale ip -4                       # note the VPS's tailnet address

# 2. Configure env: set HOST=0.0.0.0, fill in both secrets
$EDITOR .env

# 3. Install + seed + start
npm ci
npm run seed -- <tenant-id> "<tenant name>"
pm2 start ecosystem.config.cjs
pm2 save

# 4. Open the firewall hole (Tailscale-only, idempotent)
sudo scripts/setup-firewall.sh 3030 datascraper

# 5. Verify from your laptop (joined to the same tailnet)
curl http://<vps-tailscale-ip>:3030/health
# browser → http://<vps-tailscale-ip>:3030/admin   (admin / ADMIN_PASSWORD)
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
- **Loopback for internal apps + Tailscale + ufw for /admin**: defense in depth. Apache doesn't proxy this. Token gates the API; separate Basic-auth password gates the admin UI.
- **Tenant-aware from day one**: schema migration to add tenant_id later is painful.
