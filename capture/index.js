#!/usr/bin/env node
/**
 * Capture CLI orchestrator.
 *
 *   node capture/index.js nordnet
 *
 * Flow:
 *   1. Load capture/.env (DATASCRAPER_URL + INTERNAL_TOKEN).
 *   2. Load capture/tenants.json (tenant + account UUIDs + bootstrap URL).
 *   3. For each tenant: capture all accounts in memory (atomic — any
 *      failure aborts before any POST).
 *   4. Print a summary of what was captured (positions count, total).
 *   5. y/N confirmation prompt — show actual values, not "send?".
 *   6. Sequential POSTs; abort on first upload failure (re-run is
 *      idempotent because the server UPSERTs).
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load capture-side .env (overrides anything dotenv/config picked up from cwd).
const captureEnvPath = path.join(__dirname, '.env');
if (fs.existsSync(captureEnvPath)) {
  dotenv.config({ path: captureEnvPath, override: true });
}

const provider = process.argv[2];
if (provider !== 'nordnet') {
  console.error('Usage: node capture/index.js nordnet');
  process.exit(2);
}

const tenantsPath = path.join(__dirname, 'tenants.json');
if (!fs.existsSync(tenantsPath)) {
  console.error(`Missing ${tenantsPath}.`);
  console.error(`Copy capture/tenants.example.json and fill in real account UUIDs.`);
  process.exit(2);
}

let tenantsConfig;
try {
  tenantsConfig = JSON.parse(fs.readFileSync(tenantsPath, 'utf8'));
} catch (err) {
  console.error(`Failed to parse ${tenantsPath}: ${err.message}`);
  process.exit(2);
}

const datascraperUrl = process.env.DATASCRAPER_URL;
const internalToken = process.env.INTERNAL_TOKEN;
if (!datascraperUrl || datascraperUrl.includes('REPLACE_WITH')) {
  console.error('DATASCRAPER_URL is not set. See capture/.env.example.');
  process.exit(2);
}
if (!internalToken || internalToken.includes('REPLACE_WITH')) {
  console.error('INTERNAL_TOKEN is not set. See capture/.env.example.');
  process.exit(2);
}

if (!Array.isArray(tenantsConfig.tenants) || tenantsConfig.tenants.length === 0) {
  console.error('tenants.json must define tenants[]');
  process.exit(2);
}

const { captureNordnetHoldings } = await import('./nordnet/holdings.js');
const { uploadHoldings } = await import('./upload.js');

console.log(`Capture target: ${datascraperUrl}`);
console.log();

const allCaptures = [];
try {
  for (const tenant of tenantsConfig.tenants) {
    console.log(`→ Capturing tenant ${tenant.tenantId} (${tenant.label}) — ${tenant.accounts.length} accounts`);
    const captures = await captureNordnetHoldings(tenant);
    allCaptures.push({ tenant, captures });
  }
} catch (err) {
  console.error();
  console.error(`Capture failed: ${err.message}`);
  console.error('No data was sent to the server.');
  process.exit(1);
}

// Summary — actual values, not "send?"
console.log();
console.log('Capturoitu yhteensä:');
for (const { tenant, captures } of allCaptures) {
  console.log(`  ${tenant.label}:`);
  for (const c of captures) {
    const positions = c.raw.positions?.length ?? 0;
    const total = typeof c.raw.totalMarketValue === 'number'
      ? c.raw.totalMarketValue.toFixed(2)
      : '?';
    const cash = typeof c.raw.creditBalance === 'number'
      ? c.raw.creditBalance.toFixed(2)
      : (c.raw.accountBalances ?? []).reduce((s, ab) => s + (ab?.balance ?? 0), 0).toFixed(2);
    const currency = c.raw.currencyCode ?? '';
    console.log(`    ${c.account.label} — ${positions} positiota, total ${total} ${currency} (cash ${cash})`);
  }
}
console.log();

const rl = readline.createInterface({ input, output });
const answer = await rl.question(`Lähetetään VPS:lle (${datascraperUrl})? (y/N) `);
rl.close();

if (answer.trim().toLowerCase() !== 'y') {
  console.log('Aborted. No data sent.');
  process.exit(0);
}

console.log();
let uploaded = 0;
let total = 0;
for (const { tenant, captures } of allCaptures) {
  for (const c of captures) {
    total += 1;
    try {
      await uploadHoldings({
        url: datascraperUrl,
        token: internalToken,
        tenantId: tenant.tenantId,
        accountUuid: c.account.uuid,
        accountLabel: c.account.label,
        capturedAt: c.capturedAt,
        raw: c.raw,
      });
      uploaded += 1;
      console.log(`  ✓ ${c.account.label}`);
    } catch (err) {
      console.error(`  ✗ ${c.account.label}: ${err.message}`);
      console.error(`    Aborting. Uploaded ${uploaded}/${total}. Server has partial snapshot.`);
      console.error(`    Re-run when fixed — ingest is idempotent (UPSERT).`);
      process.exit(1);
    }
  }
}

console.log();
console.log(`Done. ${uploaded}/${total} accounts uploaded to ${datascraperUrl}.`);
