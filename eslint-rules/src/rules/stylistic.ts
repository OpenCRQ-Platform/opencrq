import type { Linter } from 'eslint';

export const stylisticRules: Linter.RulesRecord = {
  /** Enforce consistency of spacing after the start of a comment */
  '@stylistic/spaced-comment': 'error',
  /** Enforce consistent indentation (2 spaces) */
  '@stylistic/indent': ['error', 2],
  /** Enforce the consistent use of function expressions */
  'func-style': ['error', 'expression'],
  /** Require braces in arrow function body only when needed */
  'arrow-body-style': ['error', 'as-needed'],
  /** Enforce "One True Brace Style" (1tbs) for block statements */
  '@stylistic/brace-style': ['error', '1tbs', { 'allowSingleLine': false }],
  /** Require template literals instead of string concatenation */
  'prefer-template': ['error'],
  /** Require a newline at the end of files */
  '@stylistic/eol-last': ['error', 'always'],
  /** Disallow multiple empty lines (max 1 inner, 0 at start/end) */
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
  /** Require trailing commas for multiline, disallow for single line */
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  /** Require comma as member delimiter */
  '@stylistic/member-delimiter-style': ['error', {
    multiline: { delimiter: 'comma', requireLast: true },
    singleline: { delimiter: 'comma', requireLast: false },
  }],
  /** Require parentheses around arrow function arguments */
  '@stylistic/arrow-parens': ['error', 'always'],
  /** Enforce the consistent use of single quotes */
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  /** Enforce consistent spacing inside braces */
  '@stylistic/object-curly-spacing': ['error', 'always'],
  /** Disallow spacing inside template string placeholders */
  '@stylistic/template-curly-spacing': ['error', 'never'],
  /** Require curly braces around all control-flow bodies (if, else, for, while, do) */
  'curly': ['error', 'all'],
};
