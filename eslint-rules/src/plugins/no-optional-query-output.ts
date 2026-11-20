import type { TSESTree } from '@typescript-eslint/utils';

// Minimal structural type covering only what the rule uses. See no-unused-endpoint.ts
// for why the full RuleContext from @typescript-eslint/utils is avoided here.
type RuleContext = {
  report: (descriptor: { node: TSESTree.Node, messageId: string }) => void,
};

/**
 * Custom ESLint rule: forbids `.optional()` in a tRPC `.output(...)` schema when the
 * procedure is a `.query(...)`.
 *
 * Rationale: a query whose resolver returns `undefined` crashes TanStack Query on the
 * client with "Query data cannot be undefined". `.optional()` lets `undefined` through
 * output validation; the correct pattern is `.nullable()` on the schema PLUS coalescing
 * the resolver result with `?? null`, so the wire value is `null` (which TanStack Query
 * accepts) instead of `undefined`.
 *
 * Mutations are intentionally NOT flagged — `useMutation` tolerates `undefined` results.
 *
 * Detection is limited to `.optional()` passed as a direct argument to `.output(...)`.
 * Deeper chains (e.g. `Schema.optional().describe(...)`) or `.optional()` on a field
 * inside an object schema (e.g. `z.object({ a: z.string().optional() })`) are NOT
 * flagged: only the top-level output value matters, and the codebase always writes
 * `Schema.optional()` directly. The fix is not auto-fixable because it also requires a
 * `?? null` in the resolver body.
 */
export const noOptionalQueryOutput = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Disallow .optional() in a tRPC query .output() schema — a query resolving to undefined crashes TanStack Query. Use .nullable() and coalesce the resolver result with ?? null.',
    },
    messages: {
      useNullable: 'Use .nullable() instead of .optional() in a query .output() schema, and coalesce the resolver result with `?? null`. A query resolving to `undefined` crashes TanStack Query ("Query data cannot be undefined").',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="optional"]': (node: TSESTree.CallExpression) => {
        // `node` is a `<schema>.optional()` call. Its parent must be the enclosing
        // `.output(...)` call, with this node as a direct argument.
        const outputCall = node.parent;
        if (
          outputCall?.type !== 'CallExpression'
          || outputCall.callee.type !== 'MemberExpression'
          || outputCall.callee.property.type !== 'Identifier'
          || outputCall.callee.property.name !== 'output'
          || !outputCall.arguments.includes(node)
        ) {
          return;
        }
        // Walk up the builder chain to the terminal resolver, stepping over
        // intermediate methods (e.g. `.meta(...)`) so that
        // `.output(X.optional()).meta(...).query(...)` is still caught. Only
        // `.query` is flagged — `.mutation`/`.subscription` tolerate `undefined`.
        let chainNode: TSESTree.Node = outputCall;
        for (;;) {
          const member: TSESTree.Node | undefined = chainNode.parent;
          if (
            member?.type !== 'MemberExpression'
            || member.object !== chainNode
            || member.property.type !== 'Identifier'
          ) {
            return;
          }
          const methodName = member.property.name;
          if (methodName === 'query') {
            context.report({ node, messageId: 'useNullable' });
            return;
          }
          if (methodName === 'mutation' || methodName === 'subscription') {
            return;
          }
          const call: TSESTree.Node | undefined = member.parent;
          if (call?.type !== 'CallExpression' || call.callee !== member) {
            return;
          }
          chainNode = call;
        }
      },
    };
  },
};
