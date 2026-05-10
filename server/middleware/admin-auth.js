import { config } from '../config.js';
import { timingSafeCompare } from '../utils/secrets.js';

/**
 * HTTP Basic auth for the /admin UI.
 *
 * Username is hardcoded to "admin" — Basic auth usernames are visible to
 * anyone watching the wire and don't function as an auth factor. Making
 * them configurable adds zero security and breaks more often than it helps.
 *
 * Password is config.adminPassword (env: ADMIN_PASSWORD), distinct from
 * INTERNAL_TOKEN — server-to-server and human-browser scopes don't share
 * credentials. See utils/secrets.js for the constant-time comparison.
 */

const REALM = 'dataScraper admin';

export function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');

  if (scheme !== 'Basic' || !value) {
    res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    return res.status(401).type('text/plain').send('Authentication required');
  }

  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) {
    res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
    return res.status(401).type('text/plain').send('Malformed credentials');
  }

  const userOk = timingSafeCompare(decoded.slice(0, sep), 'admin');
  const passOk = timingSafeCompare(decoded.slice(sep + 1), config.adminPassword);
  // Always evaluate both checks before branching, so the response timing
  // doesn't reveal which half was wrong.
  if (!(userOk && passOk)) {
    res.set('WWW-Authenticate', `Basic realm="${REALM}"`);
    return res.status(401).type('text/plain').send('Invalid credentials');
  }

  next();
}
