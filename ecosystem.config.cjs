/**
 * PM2 ecosystem file. Run with:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save                         # remember on reboot
 *
 * Note .cjs extension — PM2 doesn't support ESM ecosystem files yet.
 */
module.exports = {
  apps: [
    {
      name: 'datascraper',
      script: './server/index.js',
      instances: 1,                   // SQLite = single writer; don't cluster
      exec_mode: 'fork',
      max_memory_restart: '300M',     // restart if a leak balloons memory
      env: {
        NODE_ENV: 'production',
      },
      // Logs go to ~/.pm2/logs by default; override if you want app-local
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      merge_logs: true,
      time: true,                     // prepend timestamps
      kill_timeout: 5000,             // SIGTERM grace period before SIGKILL
    },
  ],
};
