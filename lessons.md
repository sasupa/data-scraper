# Lessons learned

Running record of mistakes, dead-ends, and root-cause findings on this project.
Add new entries at the top. Each entry: what was assumed, what was actually true, why it matters.

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
