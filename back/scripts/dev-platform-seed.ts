/* eslint-disable no-console */
/**
 * Read/write access to the `platform_seed` block of `development.local.json`, shared by the
 * local-dev scripts that turn demo data on and off.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { createInterface } from 'node:readline/promises';
import { LOCAL_CONFIG_PATH, readJson } from './dev-postgres';

const DEFAULT_ADMIN_EMAIL = 'admin@example.com';
const DEFAULT_ADMIN_PASSWORD = 'Admin1234!';

/** Where `yarn env:up` keeps the stack's XTM One administrator, at the root of the worktree. */
const INFRA_ENV_PATH = resolve(dirname(LOCAL_CONFIG_PATH), '..', '..', 'infra', 'local', '.env');

/** The stack's XTM One administrator, `undefined` before the first `yarn env:up` or outside a stack. */
const readStackXtmOneAdmin = (): { email: string, password: string } | undefined => {
  if (!existsSync(INFRA_ENV_PATH)) {
    return undefined;
  }
  const values = new Map<string, string>();
  for (const line of readFileSync(INFRA_ENV_PATH, 'utf-8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) {
      values.set(match[1], match[2].trim());
    }
  }
  const email = values.get('XTM_ONE_ADMIN_EMAIL');
  const password = values.get('XTM_ONE_ADMIN_PASSWORD');
  return email && password ? { email, password } : undefined;
};

type Prompter = ReturnType<typeof createInterface>;

export const isPlatformSeedEnabled = (): boolean => (
  Boolean(readJson(LOCAL_CONFIG_PATH).platform_seed?.enabled)
);

/** Returns false when there was no block to remove, so callers can report the no-op. */
export const removePlatformSeedBlock = (): boolean => {
  if (!existsSync(LOCAL_CONFIG_PATH)) {
    return false;
  }
  const local = readJson(LOCAL_CONFIG_PATH);
  if (!('platform_seed' in local)) {
    return false;
  }
  delete local.platform_seed;
  writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(local, null, 2)}\n`, 'utf-8');
  return true;
};

const prompt = async (rl: Prompter, question: string, fallback: string): Promise<string> => {
  const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
  return answer || fallback;
};

/**
 * Prompts for the admin credentials and writes the `platform_seed` block, preserving the rest of
 * `development.local.json`. The password is the seeded users' XTM One password, stored plain, which
 * is appropriate for local dev since the file never reaches the repo. For shared or staging
 * environments, source the password from a secret store and pass it through the
 * `PLATFORM_SEED__ADMIN__PASSWORD` env var instead.
 */
export const runPlatformSeedSetup = async (rl: Prompter): Promise<void> => {
  const email = await prompt(rl, 'Admin email', DEFAULT_ADMIN_EMAIL);
  const password = await prompt(rl, 'Admin password', DEFAULT_ADMIN_PASSWORD);

  const existing = readJson(LOCAL_CONFIG_PATH);
  // The seed signs in to the stack's XTM One with this pair: one configured by hand wins, else the
  // one `yarn env:up` generated, which it adds only to a block that already exists.
  const xtmOneAdmin = existing.platform_seed?.xtm_one_admin ?? readStackXtmOneAdmin();
  const next = {
    ...existing,
    platform_seed: {
      enabled: true,
      admin: { email, password },
      ...(xtmOneAdmin && { xtm_one_admin: xtmOneAdmin }),
    },
  };

  writeFileSync(LOCAL_CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  console.log(`\n✓ Wrote platform_seed block to ${LOCAL_CONFIG_PATH}`);
};
