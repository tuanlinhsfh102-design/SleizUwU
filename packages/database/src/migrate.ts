/**
 * Migration runner (CLI entrypoint: `bun run db:migrate`).
 * The inline schema bootstrap in createDb() is the primary path; this script
 * is a convenience for re-running or initial setup from CI.
 */
import { createDb } from './index.js';

const db = createDb();
console.log('✓ Database schema ensured.');
console.log('  Path:', process.env.DATABASE_URL || './data/sleiz.db');
db.$client.close?.();
process.exit(0);
