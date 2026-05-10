/**
 * POST a single account's holdings to the dataScraper ingest endpoint.
 *
 * Throws on non-2xx so the caller (capture/index.js) can decide whether
 * to abort the rest or continue. The endpoint UPSERTs by
 * (tenant_id, account_id, symbol) — re-running this script after a
 * partial failure is safe and idempotent.
 */
export async function uploadHoldings({
  url,
  token,
  tenantId,
  accountUuid,
  accountLabel,
  capturedAt,
  raw,
}) {
  const endpoint = `${url.replace(/\/+$/, '')}/api/v1/ingest/nordnet/holdings`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'X-Internal-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tenantId, accountUuid, accountLabel, capturedAt, raw }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 240)}`);
  }

  return res.json();
}
