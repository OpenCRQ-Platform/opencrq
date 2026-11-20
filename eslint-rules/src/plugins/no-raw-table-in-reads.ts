type Node = {
  type: string,
  name?: string,
  property?: Node,
  object?: Node,
  key?: Node,
  callee?: Node,
  arguments?: Array<Node>,
  source?: { value: string },
  specifiers?: Array<{ local: { name: string } }>,
  parent?: Node,
};

type RuleContext = {
  report: (descriptor: { node: Node, messageId: string, data?: Record<string, string> }) => void,
  options: [{ globalTables?: Array<string> }] | [],
};

const isInsideRawDb = (node: Node): boolean => {
  let current = node.parent;
  while (current) {
    if (current.type === 'CallExpression' && current.callee) {
      const callee = current.callee;
      // rawDb() direct call
      if (callee.type === 'Identifier' && callee.name === 'rawDb') {
        return true;
      }
      // rawDb().insert/update/delete/select().from/where/set chain
      if (callee.type === 'MemberExpression') {
        let obj: Node | undefined = callee.object;
        while (obj) {
          if (obj.type === 'CallExpression') {
            if (obj.callee?.type === 'Identifier' && obj.callee.name === 'rawDb') {
              return true;
            }
            obj = obj.callee?.type === 'MemberExpression' ? obj.callee.object : undefined;
          } else {
            break;
          }
        }
      }
    }
    current = current.parent;
  }
  return false;
};

const isInTypeContext = (node: Node): boolean => {
  let current = node.parent;
  while (current) {
    if (current.type.startsWith('TS')) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const DATA_SOURCE_METHODS = new Set(['from', 'leftJoin', 'innerJoin', 'rightJoin', 'fullJoin']);

const isArgumentToDataSourceMethod = (node: Node): boolean => {
  const parent = node.parent;
  if (parent?.type !== 'CallExpression') {
    return false;
  }
  if (!parent.arguments?.some((arg: Node) => arg === node)) {
    return false;
  }
  const callee = parent.callee;
  if (callee?.type !== 'MemberExpression') {
    return false;
  }
  const methodName = callee.property?.name;
  return !!methodName && DATA_SOURCE_METHODS.has(methodName);
};

/**
 * Custom ESLint rule: flags raw table references used as data sources in Drizzle query methods.
 *
 * Only flags raw schema tables when passed as the first argument to `.from()` or join methods
 * (`.leftJoin()`, `.innerJoin()`, `.rightJoin()`, `.fullJoin()`). These are the contexts where
 * using `views.tableName` is required for row-level security filtering.
 *
 * Column access (`tableName.column`) in `select()`, `eq()`, `where()`, etc. is NOT flagged —
 * it only picks columns from already-accessible rows and has no security impact.
 *
 * Exceptions: inside writer/rawDb calls, TypeScript type annotations,
 * and configurable globalTables list.
 */
export const noRawTableInReads = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Disallow raw schema tables in from()/join() data sources. Use views.tableName for security-filtered reads.',
    },
    messages: {
      useViewTable: 'Use views.{{table}} instead of {{table}} in from()/join() — raw table access bypasses security policies.',
    },
    schema: [{
      type: 'object',
      properties: {
        globalTables: {
          type: 'array',
          items: { type: 'string' },
          description: 'Table names without security policies that are exempt from this rule.',
        },
      },
      additionalProperties: false,
    }],
  },
  create(context: RuleContext) {
    const schemaImports = new Set<string>();
    const globalTables = new Set<string>(context.options[0]?.globalTables ?? []);

    return {
      ImportDeclaration(node: Node) {
        const source = node.source?.value;
        if (!source || !source.startsWith('.')) {
          return;
        }
        // Skip registry and utility imports — they export functions/types, not tables
        if (source.includes('registry')) {
          return;
        }
        for (const specifier of node.specifiers ?? []) {
          const name = specifier.local.name;
          // Skip ALL_CAPS names (constants like CORE_ATTACK_OUTCOMES, ALL_CAPABILITY_IDS)
          if (name === name.toUpperCase() && name.length > 1) {
            continue;
          }
          if (!globalTables.has(name)) {
            schemaImports.add(name);
          }
        }
      },

      Identifier(node: Node) {
        const name = node.name;
        if (!name || !schemaImports.has(name)) {
          return;
        }

        // Skip if this Identifier is the object or property of a MemberExpression
        // (e.g., table.column or views.table — column access is not security-relevant)
        if (node.parent?.type === 'MemberExpression' && (node.parent.object === node || node.parent.property === node)) {
          return;
        }

        // Skip import specifiers
        if (node.parent?.type === 'ImportSpecifier' || node.parent?.type === 'ImportDefaultSpecifier') {
          return;
        }

        // Skip TypeScript type annotations (typeof table.$inferInsert, etc.)
        if (isInTypeContext(node)) {
          return;
        }

        // Skip inside rawDb() calls
        if (isInsideRawDb(node)) {
          return;
        }

        // Only flag when used as a direct argument to from() or join methods
        if (!isArgumentToDataSourceMethod(node)) {
          return;
        }

        context.report({
          node,
          messageId: 'useViewTable',
          data: { table: name },
        });
      },
    };
  },
};
