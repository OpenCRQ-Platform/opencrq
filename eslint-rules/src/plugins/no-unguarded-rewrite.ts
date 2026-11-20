import type { TSESTree } from '@typescript-eslint/utils';
import type { ScopeContext } from './const-bindings';
import type { TypeInformationContext, TypeReader } from './type-information';
import { initializerOf } from './const-bindings';
import { typeReader } from './type-information';

type RuleContext = {
  sourceCode: TypeInformationContext['sourceCode'] & ScopeContext['sourceCode'] & { getText: (node: TSESTree.Node) => string },
  report: (descriptor: { node: TSESTree.Node, messageId: string, data?: Record<string, string> }) => void,
};

const FUNCTIONS = new Set<string>(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
/** The names a repository's database handle goes by; `rawDb()` is read as a call. */
const DATABASES = new Set<string>(['db', 'tx']);
type FunctionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration;

/**
 * The doorbell ignores an UPDATE that leaves the row as it was, and rings for every other write. Two
 * shapes ring for rows that did not change:
 *
 * - a batch upsert whose `set` moves `updatedAt` with neither a `setWhere` nor
 *   `updatedAtOnDataChange`: every row it touches is rewritten with a new clock;
 * - a `delete` and an `insert` on one table in one method: a child set replaced wholesale rings
 *   once per row deleted and once per row inserted, even when the set is the same. A method
 *   diffing the set with `diffRows` writes only what changed and is not reported. A callback, such
 *   as a `map` or a transaction's, writes for the function passing it, and only a write on `db`,
 *   `tx` or `rawDb()` counts.
 *
 * A single-row upsert is left out: it is a person's save, which changes what it writes. A row passed
 * as a variable is told from a batch by its type, and counts as a batch when the file is linted
 * without type information. A config, a `set` or a table held in a `const` is read through its
 * initializer.
 */
export const noUnguardedRewrite = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Flag a write that rewrites unchanged rows and rings the doorbell for them: a batch upsert moving `updatedAt` with no change guard, and a delete then insert of one table.',
    },
    messages: {
      guardUpsert: 'This batch upsert moves `updatedAt` on every row it touches, so an unchanged row is rewritten and rings the doorbell, waking every recompute reading the table. Skip the unchanged rows with `setWhere: valuesChange(table, set)`, or, when the method relies on `RETURNING`, write `updatedAt: updatedAtOnDataChange(table, set)` (`module/src/db/write-guards.ts`).',
      diffChildSet: 'This function deletes and inserts `{{table}}`: a set replaced wholesale rings the doorbell once per row deleted and once per row inserted, even when nothing changed. Write the difference with `diffRows` (`module/src/db/row-diff.ts`): delete the stale rows, insert the missing ones.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    const types = typeReader(context);
    const writes = new Map<FunctionNode, { deletes: Map<string, TSESTree.Node>, inserts: Set<string>, diffs: boolean }>();
    const writesOf = (fn: FunctionNode) => {
      const held = writes.get(fn) ?? { deletes: new Map<string, TSESTree.Node>(), inserts: new Set<string>(), diffs: false };
      writes.set(fn, held);
      return held;
    };

    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="onConflictDoUpdate"]': (node: TSESTree.CallExpression) => {
        const config = node.arguments[0] === undefined ? undefined : initializerOf(context, node.arguments[0]);
        if (config?.type !== 'ObjectExpression' || propertyOf(config, 'setWhere') !== undefined) {
          return;
        }
        const set = propertyOf(config, 'set');
        const setObject = set === undefined ? undefined : initializerOf(context, set);
        const updatedAt = setObject?.type === 'ObjectExpression' ? propertyOf(setObject, 'updatedAt') : undefined;
        if (updatedAt === undefined || isCallTo(updatedAt, 'updatedAtOnDataChange')) {
          return;
        }
        const values = valuesOf(node);
        if (values === undefined || isSingleRow(values, types)) {
          return;
        }
        context.report({ node: node.callee, messageId: 'guardUpsert' });
      },
      'CallExpression[callee.type="MemberExpression"][callee.property.name=/^(delete|insert)$/][arguments.length=1]': (node: TSESTree.CallExpression) => {
        const fn = enclosingMethod(node);
        if (fn === undefined || node.callee.type !== 'MemberExpression' || node.callee.property.type !== 'Identifier' || !isDatabase(initializerOf(context, node.callee.object))) {
          return;
        }
        const table = context.sourceCode.getText(initializerOf(context, node.arguments[0]));
        if (node.callee.property.name === 'delete') {
          writesOf(fn).deletes.set(table, node);
        } else {
          writesOf(fn).inserts.add(table);
        }
      },
      'CallExpression[callee.type="Identifier"][callee.name="diffRows"]': (node: TSESTree.CallExpression) => {
        const fn = enclosingMethod(node);
        if (fn !== undefined) {
          writesOf(fn).diffs = true;
        }
      },
      'Program:exit': () => {
        for (const { deletes, inserts, diffs } of writes.values()) {
          if (diffs) {
            continue;
          }
          for (const [table, node] of deletes) {
            if (inserts.has(table)) {
              context.report({ node, messageId: 'diffChildSet', data: { table } });
            }
          }
        }
      },
    };
  },
};

const propertyOf = (object: TSESTree.ObjectExpression, name: string): TSESTree.Node | undefined => {
  const property = object.properties.find((candidate) =>
    candidate.type === 'Property' && candidate.key.type === 'Identifier' && candidate.key.name === name);
  return property?.type === 'Property' ? property.value : undefined;
};

const isCallTo = (node: TSESTree.Node, name: string): boolean =>
  node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === name;

/** The argument of the `.values(...)` the upsert is chained on. */
const valuesOf = (upsert: TSESTree.CallExpression): TSESTree.Node | undefined => {
  for (let call: TSESTree.Node = upsert.callee.type === 'MemberExpression' ? upsert.callee.object : upsert; call.type === 'CallExpression' && call.callee.type === 'MemberExpression'; call = call.callee.object) {
    if (call.callee.property.type === 'Identifier' && call.callee.property.name === 'values') {
      return call.arguments[0];
    }
  }
  return undefined;
};

const isSingleRow = (values: TSESTree.Node, types: TypeReader | undefined): boolean => {
  if (values.type === 'ObjectExpression') {
    return true;
  }
  if (values.type === 'ArrayExpression') {
    return values.elements.length === 1 && values.elements[0]?.type !== 'SpreadElement';
  }
  return types !== undefined && !types.isArray(values);
};

const isFunction = (node: TSESTree.Node): node is FunctionNode => FUNCTIONS.has(node.type);

const isDatabase = (node: TSESTree.Node): boolean =>
  (node.type === 'Identifier' && DATABASES.has(node.name)) || isCallTo(node, 'rawDb');

/** The innermost function not passed as an argument, or else the outermost callback: a callback writes for the function passing it. */
const enclosingMethod = (node: TSESTree.Node): FunctionNode | undefined => {
  let callback: FunctionNode | undefined;
  for (let at: TSESTree.Node | undefined = node.parent; at !== undefined && at.type !== 'Program'; at = at.parent) {
    if (!isFunction(at)) {
      continue;
    }
    if (at.parent.type !== 'CallExpression' || !at.parent.arguments.some((argument) => argument === at)) {
      return at;
    }
    callback = at;
  }
  return callback;
};
