import type { Linter } from 'eslint';

/** Javascript rules that could conflict with Typescript rules **/
export const javascriptOnlyRules: Linter.RulesRecord = {
  /** Warn about variable with identical names in the outer scope */
  'no-shadow': 'warn',
  /** Disallow literal numbers that lose precision */
  'no-loss-of-precision': 'error',
  /** Disallow constant expressions in conditions */
  'no-constant-condition': 'error',
  /** Bans the use of inline type-only markers for named imports */
  'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
};
