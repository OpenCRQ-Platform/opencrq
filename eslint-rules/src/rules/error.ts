import type { Linter } from 'eslint';

/** Enforce structured error conventions: forbid `new Error()` and `class X extends Error` in module business logic */
export const noRawErrorRules: Linter.RulesRecord = {
  'app/no-raw-error': 'error',
  'app/no-plain-error-class': 'error',
};
