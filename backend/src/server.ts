import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(config.port, () => {
    logger.info('server_started', { port: config.port, env: config.nodeEnv });
  });
}

main().catch((err) => {
  logger.error('startup_failed', { message: err instanceof Error ? err.message : 'unknown' });
  process.exit(1);
});
