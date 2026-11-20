import type { TSESTree } from '@typescript-eslint/utils';
import type { ScopeContext } from './const-bindings';
import { isBoundedByMarker } from './bounded-by-marker';
import { initializerOf, usesOf } from './const-bindings';

type Options = { historyTables?: Array<string> };

type RuleContext = {
  options: Array<Options>,
  sourceCode: ScopeContext['sourceCode'] & { getCommentsBefore: (node: TSESTree.Node) => Array<TSESTree.Comment> },
  report: (descriptor: { node: TSESTree.Node, messageId: string, data?: Record<string, string> }) => void,
};

const FUNCTIONS = new Set<string>(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration']);
/** What holds a function and carries its doc comment. */
const FUNCTION_HEADS = new Set<string>(['Property', 'MethodDefinition', 'PropertyDefinition', 'VariableDeclarator', 'VariableDeclaration', 'ExportNamedDeclaration']);
const MEMBERS = new Set<string>(['Property', 'MethodDefinition', 'PropertyDefinition']);
const SELECTS = new Set<string>(['select', 'selectDistinct', 'selectDistinctOn']);
/** A window numbering the rows of each key, which a caller then filters to the first rank or ranks. */
const RANKING_WINDOW = /\b(?:row_number|rank|dense_rank)\s*\(\s*\)\s*over\s*\(\s*partition\s+by\b/i;

/**
 * A `selectDistinctOn(...)` used as a subquery (its chain ends in `.as(...)`) is joined afterwards on
 * its key, which Postgres cannot push into it: the whole history is sorted on every call. Where the
 * subquery is restricted inside to what the page reads, it declares why:
 *
 *   // bounded-by: restricted inside to the tenant's CVE findings, the lateral loses tenant-wide
 *   const latest = db.selectDistinctOn([...], {...}).from(...).as('latest');
 *
 * Two shapes cost the same and are flagged with it: a ranking window `over (partition by …)` in a
 * subquery, whose partition key cannot be pushed in either, and a top-level `selectDistinctOn` over a
 * table listed in the `historyTables` option, which sorts the whole history it can see however few
 * keys the page shows. A subquery is a chain ending in `.as(...)` or a CTE (`db.$with(...).as(query)`).
 * A table, a window column or a `sql` fragment of the window held in a `const` is followed to where it
 * is read, and a table through `alias(...)`.
 *
 * The marker is a claim about the data rather than a silencer, so an empty one reports like none.
 */
export const noDistinctOnSubquery = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Flag a `selectDistinctOn(...)` subquery (a chain ending in `.as(...)`), which Postgres reads in full before the join narrows it, a ranking window partitioned in a subquery, and a top-level `selectDistinctOn` over a history table.',
    },
    messages: {
      useLateral: 'A `selectDistinctOn(...).as(...)` subquery joined on its key is sorted over every row it can see on every call, because Postgres cannot push the join key into it. Read the latest row per key with a per-row lateral instead: a `limit 1` subquery correlated on the key, joined with `innerJoinLateral` / `leftJoinLateral(..., LATERAL_ON)` and served by an index on the key and the column it orders by, as `latestEvidenceState` is by `asset_evidence_history_tenant_evidence_idx`. If this subquery is restricted inside to the rows the caller reads, say what bounds it with a `// bounded-by: <what bounds it>` comment directly above the statement that writes the subquery.',
      rankingWindow: 'A ranking window `over (partition by …)` in a subquery numbers every row the subquery can see on every call, because Postgres cannot push the key the caller filters on into it. Read the latest rows per key with a per-row lateral instead: a `limit n` subquery correlated on the key, joined with `innerJoinLateral` / `leftJoinLateral(..., LATERAL_ON)`. If the subquery is restricted inside to the rows the caller reads, or the caller reads every row anyway, say so with a `// bounded-by: <what bounds it>` comment directly above the statement that writes the subquery.',
      historyDistinctOn: 'This `selectDistinctOn` sorts the whole `{{table}}` history it can see on every call, so its cost grows with the history rather than with the keys the page shows. Read the latest row per key with a per-row lateral from the table holding the keys: a `limit 1` subquery correlated on the key, joined with `innerJoinLateral` / `leftJoinLateral(..., LATERAL_ON)`. If the read is restricted to a bounded set of keys, say what bounds it with a `// bounded-by: <what bounds it>` comment directly above the statement that writes it.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          historyTables: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context: RuleContext) {
    const historyTables = new Set(context.options[0]?.historyTables ?? []);
    return {
      'CallExpression[callee.type="MemberExpression"][callee.property.name="selectDistinctOn"]': (node: TSESTree.CallExpression) => {
        const subquery = endsInAlias(node);
        if (subquery !== undefined) {
          if (!hasMarkerAbove(context, subquery)) {
            context.report({ node: node.callee, messageId: 'useLateral' });
          }
          return;
        }
        const table = sourceTable(context, node);
        if (table !== undefined && historyTables.has(table) && !hasMarkerAbove(context, node)) {
          context.report({ node: node.callee, messageId: 'historyDistinctOn', data: { table } });
        }
      },
      TaggedTemplateExpression: (node: TSESTree.TaggedTemplateExpression) => {
        if (!isSql(node) || !RANKING_WINDOW.test(sqlText(context, node))) {
          return;
        }
        const direct = enclosingSelect(node);
        const selects = direct === undefined ? usesOf(context, node).map(enclosingSelect) : [direct];
        const unmarked = selects.some((select) => {
          const subquery = select === undefined ? undefined : endsInAlias(select);
          return subquery !== undefined && !hasMarkerAbove(context, subquery);
        });
        if (unmarked) {
          context.report({ node, messageId: 'rankingWindow' });
        }
      },
    };
  },
};

/**
 * A marker counts directly above the statement that writes the subquery, or anywhere between it and the
 * subquery. Through an expression-bodied function, that statement is the one declaring the function.
 * Going no higher keeps one marker from vouching for every subquery of a method, or of a repository.
 */
const hasMarkerAbove = (context: RuleContext, subquery: TSESTree.Node): boolean => {
  let inFunction = false;
  for (let node: TSESTree.Node | undefined = subquery; node !== undefined && node.type !== 'Program'; node = node.parent) {
    if (inFunction && !FUNCTION_HEADS.has(node.type)) {
      return false;
    }
    if (context.sourceCode.getCommentsBefore(node).some(isBoundedByMarker)) {
      return true;
    }
    if (writesSubquery(node) && node.parent?.type !== 'ExportNamedDeclaration') {
      return false;
    }
    inFunction ||= FUNCTIONS.has(node.type);
  }
  return false;
};

const writesSubquery = (node: TSESTree.Node): boolean =>
  node.type.endsWith('Statement') || node.type === 'VariableDeclaration' || MEMBERS.has(node.type);

const isSql = (node: TSESTree.Node): node is TSESTree.TaggedTemplateExpression =>
  node.type === 'TaggedTemplateExpression' && node.tag.type === 'Identifier' && node.tag.name === 'sql';

/** The text of a `sql` template, with the `sql` fragments it interpolates, held in a `const` or not, spelled out. */
const sqlText = (context: ScopeContext, template: TSESTree.TaggedTemplateExpression, seen = new Set<TSESTree.Node>([template])): string =>
  template.quasi.quasis.map((quasi, index) => {
    const expression = template.quasi.expressions[index];
    const fragment = expression === undefined ? undefined : initializerOf(context, expression);
    if (fragment === undefined || !isSql(fragment) || seen.has(fragment)) {
      return `${quasi.value.raw} `;
    }
    seen.add(fragment);
    return `${quasi.value.raw} ${sqlText(context, fragment, seen)} `;
  }).join('');

/** The `db.$with(...).as(...)` call taking the query as its CTE, directly or as a callback's result. */
const cteOf = (query: TSESTree.Node): TSESTree.CallExpression | undefined => {
  const held = query.parent?.type === 'ArrowFunctionExpression' && query.parent.body === query ? query.parent : query;
  const call = held.parent;
  return call?.type === 'CallExpression' && call.arguments[0] === held && call.callee.type === 'MemberExpression'
    && call.callee.property.type === 'Identifier' && call.callee.property.name === 'as'
    && call.callee.object.type === 'CallExpression' && call.callee.object.callee.type === 'MemberExpression'
    && call.callee.object.callee.property.type === 'Identifier' && call.callee.object.callee.property.name === '$with'
    ? call
    : undefined;
};

/**
 * The `.as(...)` call closing the builder chain the call starts, or the `$with(...).as(...)` taking the
 * chain as a CTE; undefined for a chain that is itself the query.
 */
const endsInAlias = (start: TSESTree.CallExpression): TSESTree.CallExpression | undefined => {
  let call = start;
  for (;;) {
    const member: TSESTree.Node | undefined = call.parent;
    if (member?.type !== 'MemberExpression' || member.object !== call || member.property.type !== 'Identifier') {
      return cteOf(call);
    }
    const next: TSESTree.Node | undefined = member.parent;
    if (next?.type !== 'CallExpression' || next.callee !== member) {
      return undefined;
    }
    if (member.property.name === 'as') {
      return next;
    }
    call = next;
  }
};

/** The table a builder chain reads `.from(...)`, by its `views.<name>` or bare name, through a `const` and an `alias(...)`; undefined for a subquery. */
const sourceTable = (context: ScopeContext, start: TSESTree.CallExpression): string | undefined => {
  for (let call = start; ;) {
    const member: TSESTree.Node | undefined = call.parent;
    if (member?.type !== 'MemberExpression' || member.object !== call || member.property.type !== 'Identifier') {
      return undefined;
    }
    const next: TSESTree.Node | undefined = member.parent;
    if (next?.type !== 'CallExpression' || next.callee !== member) {
      return undefined;
    }
    if (member.property.name === 'from') {
      const read = next.arguments[0] === undefined ? undefined : initializerOf(context, next.arguments[0]);
      const source = read?.type === 'CallExpression' && read.callee.type === 'Identifier' && read.callee.name === 'alias' && read.arguments[0] !== undefined
        ? initializerOf(context, read.arguments[0])
        : read;
      if (source?.type === 'MemberExpression' && source.property.type === 'Identifier') {
        return source.property.name;
      }
      return source?.type === 'Identifier' ? source.name : undefined;
    }
    call = next;
  }
};

/** The `select*(...)` call whose columns hold the node, stopping at the function writing it. */
const enclosingSelect = (start: TSESTree.Node): TSESTree.CallExpression | undefined => {
  for (let node: TSESTree.Node | undefined = start.parent; node !== undefined && node.type !== 'Program' && !FUNCTIONS.has(node.type); node = node.parent) {
    if (
      node.type === 'CallExpression'
      && node.callee.type === 'MemberExpression'
      && node.callee.property.type === 'Identifier'
      && SELECTS.has(node.callee.property.name)
    ) {
      return node;
    }
  }
  return undefined;
};
