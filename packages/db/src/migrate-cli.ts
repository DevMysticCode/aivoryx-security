import { getConfig } from '@aivoryx/config';
import { runMigrations } from './migrate.js';

const config = getConfig();

runMigrations(config.database.url)
  .then(() => {
    console.log('[db] migrations applied successfully');
  })
  .catch((error: unknown) => {
    console.error('[db] migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
