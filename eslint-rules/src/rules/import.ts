import type { Linter } from 'eslint';

export const importRules: Linter.RulesRecord = {
  /** Reports any imports that come after non-import statements */
  'import/first': 'error',
  /** Enforce a blank line after the last import statement */
  'import/newline-after-import': 'error',
  /** No require() or module.exports */
  'import/no-commonjs': 'error',
  /** Reports if a resolved path is imported more than once */
  'import/no-duplicates': ['error', { 'prefer-inline': false }],
  /** Enforce alphabetical sorting of named members within an import declaration */
  'sort/import-members': ['error', { 'caseSensitive': false, 'natural': true }],
  /** Enforce a strict ordering and grouping of import statements */
  'import/order': [
    'error',
    {
      'named': true,
      'pathGroups': [{ 'pattern': '@/**', 'group': 'internal' }],
      groups: [
        ['builtin', 'external', 'internal', 'type'], 'parent', 'sibling', 'index', 'object',
      ],
    },
  ],
  /** Enforce top-level type imports */
  'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
};
