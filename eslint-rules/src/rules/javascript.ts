import type { Linter } from 'eslint';

export const javascriptRules: Linter.RulesRecord = {
  /** Enforce "for" loop update clause moving the counter in the right direction */
  'for-direction': 'error',
  /** Disallow using an async function as a Promise executor */
  'no-async-promise-executor': 'error',
  /** Disallow declarations in case clauses */
  'no-case-declarations': 'error',
  /** Disallow reassigning class members */
  'no-class-assign': 'error',
  /** Disallow comparing against -0 */
  'no-compare-neg-zero': 'error',
  /** Disallow assignment operators in conditional expressions */
  'no-cond-assign': 'error',
  /** Disallow expressions where the operation doesn't affect the value */
  'no-constant-binary-expression': 'error',
  /** Disallow control characters in regular expressions */
  'no-control-regex': 'error',
  /** Disallow the use of debugger */
  'no-debugger': 'error',
  /** Disallow deleting variables */
  'no-delete-var': 'error',
  /** Disallow duplicate else-if conditions */
  'no-dupe-else-if': 'error',
  /** Disallow duplicate case labels */
  'no-duplicate-case': 'error',
  /** Disallow empty character classes in regular expressions */
  'no-empty-character-class': 'error',
  /** Disallow empty destructuring patterns */
  'no-empty-pattern': 'error',
  /** Disallow empty static blocks */
  'no-empty-static-block': 'error',
  /** Disallow reassigning exceptions in catch clauses */
  'no-ex-assign': 'error',
  /** Disallow unnecessary boolean casts */
  'no-extra-boolean-cast': 'error',
  /** Disallow fallthrough of case statements */
  'no-fallthrough': 'error',
  /** Disallow reassigning native objects or read-only globals */
  'no-global-assign': 'error',
  /** Disallow invalid regular expression strings in RegExp constructors */
  'no-invalid-regexp': 'error',
  /** Disallow irregular whitespace */
  'no-irregular-whitespace': 'error',
  /** Disallow characters which are made with multiple code points in character class syntax */
  'no-misleading-character-class': 'error',
  /** Disallow \8 and \9 escape sequences in string literals */
  'no-nonoctal-decimal-escape': 'error',
  /** Disallow octal literals */
  'no-octal': 'error',
  /** Disallow multiple spaces in regular expressions */
  'no-regex-spaces': 'error',
  /** Disallow assignments where both sides are exactly the same */
  'no-self-assign': 'error',
  /** Disallow identifiers from shadowing restricted names */
  'no-shadow-restricted-names': 'error',
  /** Disallow sparse arrays */
  'no-sparse-arrays': 'error',
  /** Disallow throwing exceptions in finally blocks */
  'no-unsafe-finally': 'error',
  /** Disallow unsafe optional chaining */
  'no-unsafe-optional-chaining': 'error',
  /** Disallow unused labels */
  'no-unused-labels': 'error',
  /** Disallow unused private class members */
  'no-unused-private-class-members': 'error',
  /** Disallow useless backreferences in regular expressions */
  'no-useless-backreference': 'error',
  /** Disallow unnecessary catch clauses */
  'no-useless-catch': 'error',
  /** Disallow unnecessary escape characters */
  'no-useless-escape': 'error',
  /** Prefer let and const */
  'no-var': 'error',
  /** Disallow with statements */
  'no-with': 'error',
  /** Prefer const if never re-assigned */
  'prefer-const': 'error',
  /** Require generator functions to contain yield */
  'require-yield': 'error',
  /** Enforce the use of isNaN() when checking for NaN */
  'use-isnan': 'error',
  /** Enforce comparing typeof against valid strings */
  'valid-typeof': 'error',
  /** Disallow the use of console */
  'no-console': 'error',
};
