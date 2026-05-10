import crypto from 'node:crypto';

/**
 * Constant-time string comparison. Prevents timing oracles that leak
 * "first N characters were correct" — relevant for any secret check
 * (API tokens, admin passwords, HMAC tags, ...).
 *
 * Buffers must be the same length for timingSafeEqual to work. We
 * compare the safe buffer against itself when lengths differ so
 * the wall-clock cost is the same as the equal-length path.
 */
export function timingSafeCompare(a, b) {
  const ab = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}
