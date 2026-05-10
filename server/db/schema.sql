-- dataScraper schema
-- Every table has tenant_id, created_at, updated_at.
-- Every "snapshot" table has a composite unique on (tenant_id, source_id, ...)
-- so we can upsert with INSERT OR REPLACE without duplicate rows.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;     -- WAL = better concurrent read performance

-- Tenants registry. Even with one tenant, we track it explicitly.
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,           -- e.g. "sasu", "metube-artist-1"
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generic refresh log: who refreshed what and when. Used by /health and freshness checks.
CREATE TABLE IF NOT EXISTS refresh_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  provider    TEXT NOT NULL,              -- "nordnet", "instagram", etc
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,              -- "running", "ok", "error"
  error       TEXT,
  rows_written INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_refresh_log_lookup ON refresh_log(tenant_id, provider, finished_at DESC);

-- Per-refresh artifacts: raw payload from the source + computed diff vs previous run.
-- Used by /admin to verify scrapers got it right. Retention is enforced inside
-- runRefresh (keep N latest per (tenant, provider)) — no separate cron.
CREATE TABLE IF NOT EXISTS refresh_artifacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  provider        TEXT NOT NULL,
  refresh_log_id  INTEGER,
  raw_payload     TEXT,                    -- JSON, exactly as the source returned it
  diff_json       TEXT,                    -- provider-computed diff vs previous artifact
  screenshot_path TEXT,                    -- optional path to a captured screenshot (scrape mode)
  captured_at     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (refresh_log_id) REFERENCES refresh_log(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_artifacts_lookup
  ON refresh_artifacts(tenant_id, provider, captured_at DESC);

-- =========================================================================
-- NORDNET / PORTFOLIO
-- =========================================================================

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  isin        TEXT,
  name        TEXT,
  quantity    REAL NOT NULL,
  avg_price   REAL,
  market_value REAL,
  currency    TEXT,
  market      TEXT,
  fetched_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, account_id, symbol)   -- enables upsert
);
CREATE INDEX IF NOT EXISTS idx_positions_tenant ON portfolio_positions(tenant_id);

-- Daily snapshots for chart history. Append-only (UPSERT per (tenant, date)).
-- Extra fields beyond total_value capture details that the Nordnet
-- holdings response carries but that don't fit cleanly into per-position rows:
--   cash_balance           — uninvested cash on the account
--   total_acquisition_cost — sum of cost basis across positions
--   total_return_monetary  — unrealized P/L in account currency
-- Older rows may have NULLs for these (added in a later migration).
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,            -- YYYY-MM-DD
  total_value REAL NOT NULL,
  currency    TEXT NOT NULL,
  positions_json TEXT NOT NULL,           -- full snapshot for time travel
  cash_balance           REAL,
  total_acquisition_cost REAL,
  total_return_monetary  REAL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_date ON portfolio_snapshots(tenant_id, snapshot_date DESC);

-- =========================================================================
-- SOCIAL: INSTAGRAM, YOUTUBE, TIKTOK
-- =========================================================================

CREATE TABLE IF NOT EXISTS social_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  platform    TEXT NOT NULL,              -- "instagram" | "youtube" | "tiktok"
  handle      TEXT NOT NULL,
  external_id TEXT,                       -- platform-side id when known
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, platform, handle)
);

CREATE TABLE IF NOT EXISTS social_metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  platform    TEXT NOT NULL,
  handle      TEXT NOT NULL,
  metric_date TEXT NOT NULL,              -- YYYY-MM-DD
  followers   INTEGER,
  following   INTEGER,
  posts       INTEGER,
  reach       INTEGER,
  impressions INTEGER,
  raw_json    TEXT,                       -- everything else the source returned
  fetched_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, platform, handle, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_social_metrics_lookup
  ON social_metrics(tenant_id, platform, handle, metric_date DESC);

-- =========================================================================
-- MARKET DATA
-- =========================================================================

CREATE TABLE IF NOT EXISTS market_quotes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,              -- quotes can be tenant-scoped or "global"
  symbol      TEXT NOT NULL,
  price       REAL NOT NULL,
  currency    TEXT NOT NULL,
  change_pct  REAL,
  volume      INTEGER,
  source      TEXT NOT NULL,
  fetched_at  TEXT NOT NULL,
  UNIQUE(tenant_id, symbol, fetched_at)
);
CREATE INDEX IF NOT EXISTS idx_quotes_lookup ON market_quotes(tenant_id, symbol, fetched_at DESC);
