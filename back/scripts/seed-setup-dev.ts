/* eslint-disable no-console */
/**
 * Interactive bootstrap for the platform seed in local dev.
 *
 * Prompts for an admin email and password, then writes (or merges) the
 * `platform_seed` block into `back/config/development.local.json`
 * (gitignored).
 *
 * Usage:
 *   yarn seed:setup-dev
 *
 * Re-running overwrites the existing `platform_seed` block but preserves
 * the rest of `development.local.json`.
 */
import { createInterface } from 'node:readline/promises';
import { runPlatformSeedSetup } from './dev-platform-seed';

const main = async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runPlatformSeedSetup(rl);
    console.log('  Restart `yarn dev` to apply.');
  } finally {
    rl.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
