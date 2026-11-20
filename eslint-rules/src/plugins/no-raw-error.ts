import type { TSESTree } from '@typescript-eslint/utils';

type RuleContext = {
  report: (descriptor: { node: TSESTree.Node, messageId: string }) => void,
};

/**
 * Custom ESLint rule: forbids `new Error(...)` in module business logic.
 *
 * Rationale: `newError()` from `@app/utils` produces a `StructuredError` that
 * carries a stable `messageKey` and a typed `data` bag serialised into the message.
 * This makes errors searchable in logs and monitoring (e.g. Sentry) without relying
 * on fragile string matching against a human-readable message.
 *
 * `new Error()` is only acceptable in:
 * - Test fixtures and mocks (excluded via config ignores)
 * - Frontend context-hook guards (not covered by this rule's file scope)
 * - One-off generator scripts (excluded via config ignores)
 */
export const noRawError = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Forbid `new Error()` in module business logic — use `newError()` from @app/utils to produce structured, loggable errors.',
    },
    messages: {
      useNewError: 'Use newError() from @app/utils instead of new Error(). It produces a StructuredError with a stable messageKey and a typed data bag that logs and monitoring tools can index.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      'NewExpression[callee.name="Error"]': (node: TSESTree.NewExpression) => {
        context.report({ node, messageId: 'useNewError' });
      },
    };
  },
};
