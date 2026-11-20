import type { Linter } from 'eslint';

/**
 * Forbids calling `jsonb()` in Drizzle schema files.
 * Prefer separate relational tables over untyped JSON blobs to keep
 * data structured, queryable, and type-safe.
 *
 * Exceptions must be justified with:
 *   // eslint-disable-next-line no-restricted-syntax -- <reason>
 */
export const drizzleSchemaRules: Linter.RulesRecord = {
  'no-restricted-syntax': [
    'error',
    {
      selector: 'CallExpression[callee.name="jsonb"]',
      message:
        'jsonb() columns are forbidden in schema files. Use a separate relational table instead. If truly unavoidable, disable this rule with a justification comment.',
    },
  ],
};
