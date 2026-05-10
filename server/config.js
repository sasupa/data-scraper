import 'dotenv/config';

/**
 * Centralized config. Validates env at boot and fails fast.
 *
 * BEST PRACTICE: never read process.env directly outside this file.
 * Import `config` everywhere else. This makes env requirements
 * discoverable and prevents typos like process.env.INTRENAL_TOKEN
 * from silently being undefined.
 */

function required(key) {
  const v = process.env[key];
  if (!v || v.startsWith('replace-me')) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

function optional(key, fallback) {
  return process.env[key] ?? fallback;
}

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3030'), 10),
  host: optional('HOST', '127.0.0.1'),
  logLevel: optional('LOG_LEVEL', 'info'),
  internalToken: required('INTERNAL_TOKEN'),
  adminPassword: required('ADMIN_PASSWORD'),
  dbPath: optional('DB_PATH', './data/scraper.db'),
  providers: {
    nordnet: {
      mode: optional('NORDNET_MODE', 'mock'),
      apiKey: optional('NORDNET_API_KEY', ''),
      privateKeyPath: optional('NORDNET_PRIVATE_KEY_PATH', ''),
    },
    instagram: { mode: optional('INSTAGRAM_MODE', 'mock') },
    youtube: {
      mode: optional('YOUTUBE_MODE', 'mock'),
      apiKey: optional('YOUTUBE_API_KEY', ''),
    },
    alphavantage: {
      mode: optional('ALPHAVANTAGE_MODE', 'mock'),
      apiKey: optional('ALPHAVANTAGE_API_KEY', ''),
    },
  },
};

export const isProd = config.env === 'production';
