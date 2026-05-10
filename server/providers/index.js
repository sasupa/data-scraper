/**
 * Provider registry — explicit list, not a directory scan.
 *
 * Both the cron scheduler and the /admin UI iterate this array. Adding
 * a provider = one import + one append here. If a provider doesn't
 * export the contract documented in _interface.md, this file fails to
 * load — surfacing the breakage at boot rather than at first cron tick.
 */
import * as nordnet from './nordnet.js';

export const providers = [nordnet];

export function getProvider(name) {
  return providers.find((p) => p.name === name) ?? null;
}
