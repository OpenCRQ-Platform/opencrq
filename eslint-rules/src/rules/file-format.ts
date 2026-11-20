import type { Linter } from 'eslint';

export const fileFormat: Linter.RulesRecord = {
  'check-file/filename-naming-convention': [
    'error',
    { '**/src/**/*.{ts,tsx}': 'KEBAB_CASE' },
    { ignoreMiddleExtensions: true },
  ],
  'check-file/folder-naming-convention': [
    'error',
    { '**/src/**/': 'KEBAB_CASE' },
  ],
};
