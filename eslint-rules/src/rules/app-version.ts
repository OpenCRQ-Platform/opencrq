import type { Linter } from 'eslint';

/**
 * The image version is read from `APP_VERSION` by `back/src/utils/platform-version.ts` alone, which
 * the config exempts: a blank variable is no version there, while a direct read would seed, reset or
 * report on it as one. Covers `env.APP_VERSION`, `env['APP_VERSION']` and its destructuring.
 */
export const appVersionRules: Linter.RulesRecord = {
  'no-restricted-properties': ['error', {
    property: 'APP_VERSION',
    message: 'Read it through imageVersion() or platformVersion() (back/src/utils/platform-version.ts).',
  }],
};
