import type { TSESTree } from '@typescript-eslint/utils';
import type { ScopeContext } from './const-bindings';
import { usesOf } from './const-bindings';

type RuleContext = ScopeContext & {
  report: (descriptor: { node: TSESTree.Node, messageId: string }) => void,
};

const INDEX_COLUMNS = new Set<string>(['on', 'onOnly', 'using']);

/**
 * Drizzle's index `.desc()` emits `DESC NULLS LAST`, while `orderBy(desc(col))` sorts `DESC NULLS
 * FIRST`, the Postgres default. Such a column serves neither `desc(col)` nor, scanned backwards,
 * `asc(col)`, even on a NOT NULL column, and nothing in the schema shows it. Stating the order is the
 * fix: `.nullsFirst()` for the reads written with `desc(...)`, `.nullsLast()` for the ones sorting
 * `desc nulls last`. A column held in a `const` is followed to the index that takes it.
 */
export const noImplicitIndexNullsOrder = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Require an explicit nulls order on a descending index column, since Drizzle\'s `.desc()` emits the NULLS LAST that `orderBy(desc(...))` cannot use.',
    },
    messages: {
      stateNullsOrder: 'State the nulls order of this descending index column. `.desc()` alone emits `DESC NULLS LAST`, which serves only a sort written `desc nulls last`: `orderBy(desc(col))` sorts `DESC NULLS FIRST`, and Postgres sorts its rows rather than walk this index, even on a NOT NULL column. Write `.desc().nullsFirst()` for reads ordered by `desc(...)`, or `.desc().nullsLast()` for reads ordered `desc nulls last`.',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="desc"][arguments.length=0]': (node: TSESTree.CallExpression) => {
        if (usesOf(context, node).some(isIndexColumn)) {
          context.report({ node, messageId: 'stateNullsOrder' });
        }
      },
    };
  },
};

/** Whether the node is a column passed to an index's `.on(...)`, `.onOnly(...)` or `.using(...)`. */
const isIndexColumn = (node: TSESTree.Node): boolean => {
  const columns = node.parent;
  return columns?.type === 'CallExpression'
    && columns.callee.type === 'MemberExpression'
    && columns.callee.property.type === 'Identifier'
    && INDEX_COLUMNS.has(columns.callee.property.name);
};
