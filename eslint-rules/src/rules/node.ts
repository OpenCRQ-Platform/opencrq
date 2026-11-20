import type  { Linter } from 'eslint';

export const nodeRules: Linter.RulesRecord = {
  /** Enforce usage of the `node:` prefix for builtin imports */
  'node/prefer-node-protocol': 'error',
};
