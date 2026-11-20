import type { Linter } from 'eslint';

/**
 * A policy rule returning `undefined` adds no predicate, so a switch on the origin that forgets a
 * member reads the whole table for it. Exhaustiveness is what keeps a new origin fail-closed, which
 * is why a `default` branch must not satisfy the rule: it would let one silence a missing member.
 */
export const securityPolicyRules: Linter.RulesRecord = {
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
};
