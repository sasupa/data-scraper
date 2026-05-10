# Lessons learned

Running record of mistakes, dead-ends, and root-cause findings on this project.
Add new entries at the top. Each entry: what was assumed, what was actually true, why it matters.

---

## 2026-05-10: Browser session capture is human-in-the-loop, not headless cron

**Assumption:** Any data source can eventually be reduced to a server-side
cron — log in once, store credentials, schedule the rest.

**Reality:** Some auth surfaces actively resist that. Nordnet's web app uses
short-lived Bearer tokens (~30s) minted client-side from a SPA-managed
session, gated by MFA, and there's no documented way to mint them from a
server. Trying to script the login headlessly is fragile, breaks on every
SPA change, and quietly degrades into "credentials in plaintext on the
VPS so it can re-login itself."

The correct shape is `mode='capture'`: the server provider exports an
`ingest(tenantId, body)` push entrypoint, the scheduler skips this provider,
and a workstation-side Playwright script runs in headed mode while the
human logs in. Tokens live in an ephemeral browser context; closing the
browser drops them. The script POSTs the captured payload to the VPS via
Tailscale.

**Why it matters:** Cron-shaped thinking ("just schedule it") leads to
storing credentials that didn't need to be stored. Push-from-laptop keeps
the secret-handling boundary at a place where MFA still applies, and the
human does the auth they were going to do anyway. Recognise this shape
*before* designing the provider — retrofitting capture mode into a
cron-shaped provider is more work than starting capture-shaped.

**Indicators a provider needs capture mode:**
- Auth tokens have lifetimes shorter than the cron interval
- Login is MFA-gated and the second factor isn't a TOTP secret you can store
- The vendor's TOS forbids headless / non-human access
- You'd need to ship the user's password to the server to make cron work

---

## 2026-05-10: PM2 injects NODE_ENV, .env does not override

**Assumption:** Service runs with NODE_ENV from .env file.

**Reality:** ecosystem.config.cjs sets `env: { NODE_ENV: 'production' }`,
and dotenv does not override pre-existing process.env values. So the PM2-managed
service is *always* in production regardless of .env. Only CLI scripts (npm run
seed, npm run migrate) that bypass PM2 see the .env NODE_ENV.

**Why it matters:** Confused a `pino-pretty` crash in CLI scripts as a server
problem. Spent time debugging the wrong layer. When a config issue appears, FIRST
check whether the service is PM2-managed — env precedence is different.

---

## 2026-05-10: 42 restarts came from missing DB tables, not from logger

**Assumption:** Restart loop was caused by pino-pretty missing in production.

**Reality:** Crash loop was `SqliteError: no such table: portfolio_positions`
— schema migrations weren't applied at boot before routes tried to query.
Fixed by applying schema on db import (commit c223dc8).

**Why it matters:** Always read err.log BEFORE forming a hypothesis. The error
message was right there. Story-fitting before evidence-gathering wastes time.

---

## 2026-05-10: pino-pretty belongs in devDependencies

**Assumption:** Hard to know if pino-pretty was a runtime requirement.

**Reality:** logger.js only loads pino-pretty when NODE_ENV !== 'production'.
Production logs as raw JSON without it. Therefore devDependencies, not dependencies.

**Why it matters:** Rule of thumb: if production code path imports it, it's a
dependency. If only dev/test/build/dev-logging paths, it's devDependencies.
Bloating production install hurts boot time and attack surface.
