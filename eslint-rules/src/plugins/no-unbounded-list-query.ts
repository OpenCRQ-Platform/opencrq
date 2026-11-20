import type { TSESTree } from '@typescript-eslint/utils';
import type { MarkerContext } from './bounded-by-marker';
import type { TypeInformationContext } from './type-information';
import { hasBoundedByMarker } from './bounded-by-marker';
import { typeReader } from './type-information';

type RuleContext = MarkerContext & {
  sourceCode: MarkerContext['sourceCode'] & TypeInformationContext['sourceCode'],
  report: (descriptor: { node: TSESTree.Node, messageId: string }) => void,
};

const PAGED_INPUT = 'pagedInput';

/**
 * A tRPC query returning an array must take a `pagedInput(...)`, or declare its bound:
 *
 *   // bounded-by: the ATT&CK catalogue, ~900 rows, one platform-wide copy
 *   getTechniques: procedure.output(z.array(TechniqueSchema)).query(...)
 *
 * With type information the resolver's return type decides, so a query declaring no `.output()`,
 * or one spelled through a variable, cannot escape by declaring less, and a type that says nothing
 * (`any`, `unknown`) reports like an array. Without it, an `.output(z.array(...))` still reports.
 * Only an array at the top of the response counts: one inside a returned object is not looked at,
 * since that would flag every detail read carrying a short list.
 * The marker is a claim about the data rather than a silencer, so an empty one reports like none.
 * Only `.query` is flagged: a mutation returning what it just wrote is bounded by its own input.
 */
export const noUnboundedListQuery = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Require a tRPC query returning an array to accept a paginated input, or to declare what bounds it with a `bounded-by:` comment.',
    },
    messages: {
      needsPagination: 'This query returns an array with no `pagedInput(...)`. A response sized on a tenant\'s data exhausts the HTTP process heap, which kills the process and its siblings. Take `pagedInput(...)` and return `pagedOutput(...)`, or, if the array is bounded by something else, say what with a `// bounded-by: <what bounds it>` comment above the procedure.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    const types = typeReader(context);
    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="query"]': (node: TSESTree.CallExpression) => {
        const [resolver] = node.arguments;
        if (resolver === undefined || node.callee.type !== 'MemberExpression') {
          return;
        }
        const chain = readChain(node.callee.object);
        if (chain.pagedInput || !(chain.arrayOutput || (types?.returnsArray(resolver) ?? false))) {
          return;
        }
        if (hasBoundedByMarker(context, node)) {
          return;
        }
        context.report({ node, messageId: 'needsPagination' });
      },
    };
  },
};

const isArraySchema = (schema: TSESTree.Node): boolean =>
  schema.type === 'CallExpression'
  && schema.callee.type === 'MemberExpression'
  && schema.callee.property.type === 'Identifier'
  && schema.callee.property.name === 'array';

/** Follows the builder chain a declaration may add on top: `pagedInput(KEYS).extend({...})`. */
const isPagedInputSchema = (schema: TSESTree.Node): boolean => {
  if (schema.type !== 'CallExpression') {
    return false;
  }
  if (schema.callee.type === 'Identifier') {
    return schema.callee.name === PAGED_INPUT;
  }
  return schema.callee.type === 'MemberExpression' && isPagedInputSchema(schema.callee.object);
};

/** The builder calls before `.query(...)`, wherever `.input(...)` and `.output(...)` sit among them. */
const readChain = (start: TSESTree.Node): { pagedInput: boolean, arrayOutput: boolean } => {
  let pagedInput = false;
  let arrayOutput = false;
  let call: TSESTree.Node = start;
  while (call.type === 'CallExpression' && call.callee.type === 'MemberExpression') {
    const [schema] = call.arguments;
    if (call.callee.property.type === 'Identifier' && schema !== undefined) {
      pagedInput ||= call.callee.property.name === 'input' && isPagedInputSchema(schema);
      arrayOutput ||= call.callee.property.name === 'output' && isArraySchema(schema);
    }
    call = call.callee.object;
  }
  return { pagedInput, arrayOutput };
};
