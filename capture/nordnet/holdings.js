/**
 * Nordnet holdings capture.
 *
 * Strategy:
 *   1. Launch headed Chromium with an ephemeral context (no userDataDir).
 *      Nothing about the session — cookies, localStorage, Bearer tokens —
 *      survives the browser closing. This is the secret-handling boundary.
 *   2. User logs in manually; CLI waits on Enter.
 *   3. A request listener captures the latest Authorization: Bearer ...
 *      header from any outgoing XHR. The token's lifetime is short
 *      (~30s) but the SPA refreshes it on its own, so we just keep
 *      overwriting the cached value.
 *   4. For each account, POST to api.prod.nntech.io directly with the
 *      cached token. On 401, navigate the page to trigger a fresh auth
 *      cycle and retry once.
 *   5. Return all captures from memory; closing the browser drops every
 *      cookie, token, and credential. The caller (capture/index.js)
 *      decides whether to upload them.
 *
 * Atomicity: any failure throws. Caller catches → no partial uploads.
 */
import { chromium } from 'playwright';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const HOLDINGS_API =
  'https://api.prod.nntech.io/holdings/portfolio-allocation/v1/historical-allocation-summary';
const NORDNET_HOME = 'https://www.nordnet.fi/';
const TOKEN_WAIT_MS = 15_000;
const TOKEN_POLL_MS = 200;

async function waitForToken(getToken, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(getToken())) return;
    await new Promise((r) => setTimeout(r, TOKEN_POLL_MS));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for Bearer token from Nordnet`);
}

export async function captureNordnetHoldings(tenant) {
  const browser = await chromium.launch({ headless: false });
  let context;
  let page;
  try {
    context = await browser.newContext();
    page = await context.newPage();

    let latestToken = null;
    page.on('request', (req) => {
      const auth = req.headers()['authorization'];
      if (auth?.startsWith('Bearer ')) {
        latestToken = auth.slice('Bearer '.length);
      }
    });

    await page.goto(NORDNET_HOME, { waitUntil: 'domcontentloaded' });

    const rl = readline.createInterface({ input, output });
    await rl.question('Kirjaudu Nordnetiin selaimessa, sitten paina Enter ja odota... ');
    rl.close();

    const bootstrapUrl =
      tenant.accounts[0]?.url ?? 'https://www.nordnet.fi/oversikt';
    await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' });
    await waitForToken(() => latestToken, (t) => t != null, TOKEN_WAIT_MS);

    const captures = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const account of tenant.accounts) {
      const body = { accountIds: [account.uuid], date: today };

      const post = () =>
        context.request.post(HOLDINGS_API, {
          headers: {
            Authorization: `Bearer ${latestToken}`,
            'Content-Type': 'application/json',
          },
          data: body,
        });

      let resp = await post();

      if (resp.status() === 401) {
        // Token expired mid-loop. Trigger a fresh auth cycle by re-navigating;
        // the SPA will issue a new Bearer-bearing request that the listener
        // catches. Wait until latestToken changes from what we just used.
        const expiredToken = latestToken;
        await page.goto(account.url, { waitUntil: 'domcontentloaded' });
        await waitForToken(
          () => latestToken,
          (t) => t != null && t !== expiredToken,
          TOKEN_WAIT_MS,
        );
        resp = await post();
      }

      if (!resp.ok()) {
        const text = await resp.text().catch(() => '');
        throw new Error(
          `Nordnet API ${resp.status()} for ${account.label}: ${text.slice(0, 240)}`,
        );
      }

      const raw = await resp.json();
      if (!Array.isArray(raw?.positions)) {
        throw new Error(
          `Unexpected response shape for ${account.label}: missing positions array`,
        );
      }

      captures.push({
        account,
        raw,
        capturedAt: new Date().toISOString(),
      });
    }

    return captures;
  } finally {
    // Always close — drops all in-memory session state (cookies, tokens).
    await browser.close().catch(() => {});
  }
}
