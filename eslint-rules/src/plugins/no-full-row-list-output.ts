import type { TSESTree } from '@typescript-eslint/utils';
import type { MarkerContext } from './bounded-by-marker';
import type { ScopeContext } from './const-bindings';
import type { TypeInformationContext } from './type-information';
import { hasMarker } from './bounded-by-marker';
import { initializerOf } from './const-bindings';
import { typeReader } from './type-information';

type RuleContext = MarkerContext & {
  sourceCode: MarkerContext['sourceCode'] & ScopeContext['sourceCode'] & TypeInformationContext['sourceCode'],
  report: (descriptor: { node: TSESTree.Node, messageId: string }) => void,
};

const FULL_ROW_MARKER = 'full-row:';

/**
 * A list query whose row schema is a table's `createSelectSchema(...)` ships every column, and a
 * column added to the table later joins every list response unseen. `.omit(...)` is a denylist with
 * the same flaw; `.pick(...)` and a hand-written `z.object(...)` are allowlists, and tRPC strips
 * every key the output schema does not list. The allowlist holds what every reader uses: the front, and
 * XTM One's OpenCRQ tools, which print fields of these responses. A list that renders every column
 * says why:
 *
 *   // full-row: the mitigations list renders every field, the description truncated
 *   getMitigations: procedure.output(z.array(MitigationSchema)).query(...)
 *
 * A list query declaring no `.output(...)` at all ships whatever the repository selects, so with type
 * information a query whose resolver returns an array of objects, or `any` or `unknown`, must declare one.
 *
 * The rows are read from `z.array(row)`, `row.array()`, `pagedOutput(row)` and from every list the
 * output holds, in an object (a hand-paginated `{ items, total }`), a union or a row. The walk fails
 * closed: a schema method keeps every column of the schema it is called on and of any schema or
 * `.shape` it is given, `.pick(...)` alone excepted, so a `.transform(...)` that drops columns needs
 * the marker. Schemas are followed through the `const` declarations in scope, aliases included; one
 * imported from another module is not looked into.
 */
export const noFullRowListOutput = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Flag a tRPC query whose array or paged output rows come from `createSelectSchema(...)` with no `.pick(...)`, so every column of the table ships, added ones included.',
    },
    messages: {
      declareOutput: 'This query returns an array of rows, or a type that says nothing (`any`, `unknown`), and declares no `.output(...)`, so it ships whatever the repository selects, every column of a row it reads whole included, and a column added to the table later joins it unseen. Declare the rows with `.output(z.array(...))`, picking the fields its readers use, the front and XTM One\'s OpenCRQ tools: tRPC strips every key the output schema does not list.',
      pickColumns: 'A list this query returns holds `createSelectSchema(...)` rows with no `.pick(...)`, so every column of the table ships in the response, and a column added to the table later joins it unseen. Pick the columns its readers use, the front and XTM One\'s OpenCRQ tools, with `.pick({ ... })`: tRPC strips every key the output schema does not list. If the list shows every column, say why with a `// full-row: <why>` comment directly above the procedure.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    const types = typeReader(context);
    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="query"]': (node: TSESTree.CallExpression) => {
        if (node.callee.type !== 'MemberExpression') {
          return;
        }
        const output = outputSchema(node.callee.object);
        const [resolver] = node.arguments;
        if (output === undefined && resolver !== undefined && (types?.returnsRows(resolver) ?? false)) {
          context.report({ node, messageId: 'declareOutput' });
          return;
        }
        const rows = output === undefined ? [] : listRows(context, output);
        if (!rows.some((row) => isFullRow(context, row)) || hasMarker(context, node, FULL_ROW_MARKER)) {
          return;
        }
        context.report({ node, messageId: 'pickColumns' });
      },
    };
  },
};

/** The schema passed to `.output(...)` among the builder calls before `.query(...)`. */
const outputSchema = (start: TSESTree.Node): TSESTree.Node | undefined => {
  for (let call: TSESTree.Node = start; call.type === 'CallExpression' && call.callee.type === 'MemberExpression'; call = call.callee.object) {
    if (call.callee.property.type === 'Identifier' && call.callee.property.name === 'output') {
      return call.arguments[0];
    }
  }
  return undefined;
};

const methodOf = (node: TSESTree.Node): string | undefined =>
  node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier'
    ? node.callee.property.name
    : undefined;

const isZ = (node: TSESTree.CallExpression, method: string): boolean =>
  isZConstructor(node) && methodOf(node) === method;

/** A `z.<schema>(...)` call, which builds a schema rather than deriving one from its receiver. */
const isZConstructor = (node: TSESTree.CallExpression): boolean =>
  node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'z';

/** What a call is given: its arguments, and the elements of an array argument (`z.union([...])`). */
const givenTo = (node: TSESTree.CallExpression): Array<TSESTree.Node> =>
  node.arguments.flatMap((argument): Array<TSESTree.Node> => (argument.type === 'ArrayExpression'
    ? argument.elements.filter((element): element is TSESTree.Expression => element !== null && element.type !== 'SpreadElement')
    : [argument]));

/** The row schemas of the lists the schema holds, wherever they sit in it: `z.array(row)`, `row.array()`, `pagedOutput(row)`, and the lists those rows hold in turn, a `.pick(...)` keeping one included. */
const listRows = (context: ScopeContext, schema: TSESTree.Node, seen = new Set<TSESTree.Node>()): Array<TSESTree.Node> => {
  const node = initializerOf(context, schema);
  const rowAndLists = (row: TSESTree.Node) => [row, ...listRows(context, row, seen)];
  if (node.type === 'ObjectExpression') {
    return node.properties.flatMap((property) => (property.type === 'Property' ? listRows(context, property.value, seen) : []));
  }
  if (node.type !== 'CallExpression' || seen.has(node)) {
    return [];
  }
  seen.add(node);
  const given = givenTo(node);
  if (node.callee.type !== 'MemberExpression') {
    return node.callee.type === 'Identifier' && node.callee.name === 'pagedOutput' ? given.flatMap(rowAndLists) : [];
  }
  if (isZ(node, 'array')) {
    return given.flatMap(rowAndLists);
  }
  if (isZConstructor(node)) {
    return given.flatMap((schemaGiven) => listRows(context, schemaGiven, seen));
  }
  if (methodOf(node) === 'array') {
    return rowAndLists(node.callee.object);
  }
  return [node.callee.object, ...given].flatMap((schemaGiven) => listRows(context, schemaGiven, seen));
};

/** Whether a shape holds every column of a full row: its `.shape`, an object spreading one or holding a full row, or a full row itself. */
const isFullShape = (context: ScopeContext, start: TSESTree.Node, seen: Set<TSESTree.Node>): boolean => {
  const shape = initializerOf(context, start);
  if (shape.type === 'MemberExpression') {
    return shape.property.type === 'Identifier' && shape.property.name === 'shape' && isFullRow(context, shape.object, seen);
  }
  if (shape.type === 'ObjectExpression') {
    return shape.properties.some((property) => (property.type === 'SpreadElement'
      ? isFullShape(context, property.argument, seen)
      : isFullRow(context, property.value, seen)));
  }
  return isFullRow(context, shape, seen);
};

/** Whether the schema keeps every column of a `createSelectSchema(...)`, followed through the constants in scope; a cycle of constants is none. */
const isFullRow = (context: ScopeContext, start: TSESTree.Node, seen = new Set<TSESTree.Node>()): boolean => {
  const schema = initializerOf(context, start);
  if (schema.type !== 'CallExpression' || seen.has(schema)) {
    return false;
  }
  if (schema.callee.type !== 'MemberExpression') {
    return schema.callee.type === 'Identifier' && schema.callee.name === 'createSelectSchema';
  }
  seen.add(schema);
  const fullGiven = () => givenTo(schema).some((schemaGiven) => isFullShape(context, schemaGiven, seen));
  if (isZConstructor(schema)) {
    return fullGiven();
  }
  return methodOf(schema) !== 'pick' && (isFullRow(context, schema.callee.object, seen) || fullGiven());
};
