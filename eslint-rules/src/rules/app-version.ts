import type { Linter } from 'eslint';

/**
 * The image version is read from `APP_VERSION` and `APP_COMMIT_TIME` by
 * `back/src/utils/platform-version.ts` alone, which the config exempts: a blank or unreadable variable
 * is no version there, while a direct read would seed, reset, report or fence on it as one. Covers
 * `env.APP_VERSION`, `env['APP_VERSION']` and their destructuring.
 */
export const appVersionRules: Linter.RulesRecord = {
  'no-restricted-properties': ['error', {
    property: 'APP_VERSION',
    message: 'Read it through imageVersion() or platformVersion() (back/src/utils/platform-version.ts).',
  }, {
    property: 'APP_COMMIT_TIME',
    message: 'Read it through imageRelease() (back/src/utils/platform-version.ts).',
  }],
};
