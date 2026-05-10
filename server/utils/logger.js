import pino from 'pino';
import { config, isProd } from '../config.js';

/**
 * BEST PRACTICE: structured logging from day one.
 *
 * console.log is fine for prototyping but terrible for production:
 *  - no levels (info vs warn vs error)
 *  - no context (which request? which tenant?)
 *  - hard to search and filter in log aggregators
 *
 * Pino outputs JSON, which is greppable, parseable, and ships
 * cleanly to log services (Loki, Datadog, etc) when you need them.
 */

export const logger = pino({
  level: config.logLevel,
  ...(isProd
    ? {} // raw JSON in production
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }),
});
