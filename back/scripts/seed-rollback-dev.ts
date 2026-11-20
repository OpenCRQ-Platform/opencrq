/* eslint-disable no-console */
/**
 * Rolls back the platform seed setup for local dev:
 *   1. Removes the `platform_seed` block from `development.local.json`
 *   2. Optionally drops and recreates the dev database so the platform is truly
 *      blank again (otherwise the seeded admin user remains and the setup
 *      wizard never appears on next `yarn dev`).
 *
 * Usage:
 *   yarn seed:rollback-dev
 */
import { createInterface } from 'node:readline/promises';
import { removePlatformSeedBlock } from './dev-platform-seed';
import { dropAndRecreateDatabase, LOCAL_CONFIG_PATH, resolvePostgresConfig } from './dev-postgres';

const prompt = async (rl: ReturnType<typeof createInterface>, question: string) => (
  await rl.question(question)).trim().toLowerCase();

const main = async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const removed = removePlatformSeedBlock();
    console.log(removed
      ? `✓ Removed platform_seed block from ${LOCAL_CONFIG_PATH}`
      : `· No platform_seed block found in ${LOCAL_CONFIG_PATH} (skipped)`);

    const answer = await prompt(rl, '\nAlso drop and recreate the dev database to wipe seeded data? [y/N]: ');
    if (answer === 'y' || answer === 'yes') {
      await dropAndRecreateDatabase(resolvePostgresConfig());
      console.log('\n  Restart `yarn dev` — migrations will recreate the schema on a blank DB.');
      console.log('  The UI setup wizard will then prompt you to create the first admin.');
    } else {
      console.log('\n· Database left untouched. Seeded data remains.');
      console.log('  To get a fully blank platform later, re-run this script and answer "y".');
    }
  } finally {
    rl.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
