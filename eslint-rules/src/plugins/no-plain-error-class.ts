import type { TSESTree } from '@typescript-eslint/utils';

type RuleContext = {
  report: (descriptor: { node: TSESTree.Node, messageId: string }) => void,
};

/**
 * Custom ESLint rule: forbids `class X extends Error` in module business logic.
 *
 * Custom error classes must extend `StructuredError` from `@app/utils` so they
 * inherit a stable `messageKey`, a typed `data` bag, and correct serialisation via
 * `errorToObject`. Extending `Error` directly bypasses all of that.
 *
 * The only exception is `StructuredError` itself (defined in `@app/utils`).
 */
export const noPlainErrorClass = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Forbid `class X extends Error` — custom error classes must extend StructuredError from @app/utils.',
    },
    messages: {
      useStructuredError: 'Custom error classes must extend StructuredError from @app/utils, not Error directly. This ensures a stable messageKey and a typed data bag for logging and monitoring.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    const check = (node: TSESTree.ClassDeclaration | TSESTree.ClassExpression) => {
      if (
        node.superClass?.type !== 'Identifier'
        || node.superClass.name !== 'Error'
      ) {
        return;
      }
      // StructuredError itself must extend Error — skip it.
      if (node.id?.name === 'StructuredError') {
        return;
      }
      context.report({ node: node.superClass, messageId: 'useStructuredError' });
    };

    return {
      ClassDeclaration: check,
      ClassExpression: check,
    };
  },
};
