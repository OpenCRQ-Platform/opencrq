import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noImplicitIndexNullsOrder } from './no-implicit-index-nulls-order';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

// RuleTester types `create` against ESLint's ESTree nodes, while this rule's structural context
// takes the TSESTree ones its parser produces.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const rule = noImplicitIndexNullsOrder as unknown as Rule.RuleModule;

describe('noImplicitIndexNullsOrder', () => {
  it('flags a descending index column with no nulls order', () => {
    ruleTester.run('no-implicit-index-nulls-order', rule, {
      valid: [],
      invalid: [
        {
          code: "index('runs_idx').on(table.scenarioId, table.createdAt.desc());",
          errors: [{ messageId: 'stateNullsOrder' }],
        },
        {
          // Each column states its own order.
          code: "index('runs_idx').on(table.scenarioId, table.createdAt.desc().nullsFirst(), table.id.desc());",
          errors: [{ messageId: 'stateNullsOrder' }],
        },
        {
          code: "uniqueIndex('jobs_idx').on(table.priority.desc(), table.runAfter.asc()).where(sql`queued`);",
          errors: [{ messageId: 'stateNullsOrder' }],
        },
        {
          // A column held in a constant before the index takes it.
          code: "const at = table.createdAt.desc();\nindex('runs_idx').on(table.scenarioId, at);",
          errors: [{ messageId: 'stateNullsOrder', line: 1 }],
        },
        {
          code: "index('names_idx').using('btree', table.name.desc());",
          errors: [{ messageId: 'stateNullsOrder' }],
        },
      ],
    });
  });

  it('accepts a stated nulls order, an ascending column and a query sort', () => {
    ruleTester.run('no-implicit-index-nulls-order', rule, {
      valid: [
        { code: "index('runs_idx').on(table.scenarioId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst());" },
        { code: "index('scores_idx').on(table.tenantId, table.score.desc().nullsLast());" },
        { code: "index('runs_idx').on(table.scenarioId, table.createdAt.asc(), table.id);" },
        { code: 'db.select().from(runs).orderBy(desc(runs.createdAt));' },
        { code: 'const at = runs.createdAt.desc();\ndb.select().from(runs).orderBy(at);' },
        { code: 'db.select().from(runs).orderBy(runs.createdAt.desc());' },
      ],
      invalid: [],
    });
  });
});
