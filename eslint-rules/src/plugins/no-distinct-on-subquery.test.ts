import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noDistinctOnSubquery } from './no-distinct-on-subquery';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

// RuleTester types `create` against ESLint's ESTree nodes and comments, while this rule's
// structural context takes the TSESTree ones its parser produces.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const rule = noDistinctOnSubquery as unknown as Rule.RuleModule;
const options = [{ historyTables: ['runs'] }];

describe('noDistinctOnSubquery', () => {
  it('flags a DISTINCT ON used as a subquery', () => {
    ruleTester.run('no-distinct-on-subquery', rule, {
      valid: [],
      invalid: [
        {
          code: "const latest = db.selectDistinctOn([h.evidenceId], { id: h.id }).from(h).orderBy(h.evidenceId, desc(h.at)).as('latest');",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          // The alias is a variable, and the query sits in a join rather than a declaration.
          code: 'function read() { return db.select().from(f).innerJoin(db.selectDistinctOn([h.evidenceId], { id: h.id }).from(h).as(alias), eq(f.id, x)); }',
          errors: [{ messageId: 'useLateral' }],
        },
        {
          // A marker with no reason is not a claim about the data.
          code: "// bounded-by:\nconst latest = db.selectDistinctOn([h.evidenceId], {}).from(h).as('latest');",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          // A marker above another statement is a claim about that statement.
          code: "// bounded-by: the tenant's rows\nconst scope = db.select().from(f).as('scope');\nconst latest = db.selectDistinctOn([h.id], {}).from(h).as('latest');",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          // A marker above the repository declaration is not a claim about the methods inside it.
          code: "// bounded-by: the tenant's rows\nexport const repo = defineRepository({\n  findLatest: ({ db }) =>\n    db.select().from(f).innerJoin(db.selectDistinctOn([h.id], {}).from(h).as('latest'), eq(f.id, x)),\n});",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          // A marker above one subquery of a method does not vouch for the next one.
          code: "const read = async () => {\n  // bounded-by: the review ids it filters by\n  const bounded = db.selectDistinctOn([h.id], {}).from(h).where(w).as('bounded');\n  const latest = db.selectDistinctOn([h.id], {}).from(h).as('latest');\n};",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          // A method's doc comment would vouch for every subquery its body writes.
          code: "export const repo = defineRepository({\n  /**\n   * bounded-by: the evidence ids of the tenant's entry openings\n   */\n  findOpenings: async ({ db }) => {\n    const latest = db.selectDistinctOn([h.id], {}).from(h).as('latest');\n    return db.select().from(f).innerJoin(latest, eq(f.id, latest.id));\n  },\n});",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          code: "const latest = db.$with('latest').as(db.selectDistinctOn([h.id], {}).from(h).orderBy(h.id, desc(h.at)));",
          errors: [{ messageId: 'useLateral' }],
        },
        {
          code: "const latest = db.$with('latest').as((qb) => qb.selectDistinctOn([h.id], {}).from(h));",
          errors: [{ messageId: 'useLateral' }],
        },
      ],
    });
  });

  it('accepts a top-level DISTINCT ON and a declared bound', () => {
    ruleTester.run('no-distinct-on-subquery', rule, {
      valid: [
        { code: 'const rows = await db.selectDistinctOn([h.evidenceId], { id: h.id }).from(h).orderBy(h.evidenceId);' },
        { code: 'function read() { return db.selectDistinctOn([h.kind], columns).from(h).where(w).limit(10); }' },
        { code: "const sq = db.select().from(h).as('sq');" },
        { code: "// bounded-by: restricted inside to the tenant's CVE findings\nconst latest = db.selectDistinctOn([h.cveId], {}).from(h).as('latest');" },
        { code: "export const latest = (db) =>\n  // bounded-by: the review ids it filters by\n  db.selectDistinctOn([h.id], {}).from(h).as('latest');" },
        { code: "export const repo = defineRepository({\n  findOpenings: async ({ db }) => {\n    // bounded-by: the evidence ids of the tenant's entry openings\n    const latest = db.selectDistinctOn([h.id], {}).from(h).as('latest');\n    return db.select().from(f).innerJoin(latest, eq(f.id, latest.id));\n  },\n});" },
        { code: "// bounded-by: the review ids it filters by\nconst latest = db.$with('latest').as(db.selectDistinctOn([h.id], {}).from(h).where(w));" },
        // A CTE of a plain select is not a latest row per key.
        { code: "const scoped = db.$with('scoped').as(db.select().from(h).where(w));" },
        { code: "/** bounded-by: the review ids it filters by */\nconst pricingRuns = (db, ids) => db\n  .selectDistinctOn([h.id], {})\n  .from(h)\n  .as('runs');" },
      ],
      invalid: [],
    });
  });

  it('flags a top-level DISTINCT ON over a history table', () => {
    ruleTester.run('no-distinct-on-subquery', rule, {
      valid: [
        { code: 'const rows = await db.selectDistinctOn([views.tags.id], {}).from(views.tags);', options },
        { code: '// bounded-by: the review ids it filters by\nconst rows = await db.selectDistinctOn([views.runs.scenarioId], {}).from(views.runs).where(inArray(views.runs.reviewId, ids));', options },
        // A table missing from the option is not reported.
        { code: 'const rows = await db.selectDistinctOn([views.runs.scenarioId], {}).from(views.runs);' },
      ],
      invalid: [
        {
          code: 'const rows = await db.selectDistinctOn([views.runs.scenarioId], {}).from(views.runs).orderBy(views.runs.scenarioId, desc(views.runs.createdAt));',
          options,
          errors: [{ messageId: 'historyDistinctOn', data: { table: 'runs' } }],
        },
        {
          code: 'function read() {\n  const history = views.runs;\n  return db.selectDistinctOn([history.scenarioId], {}).from(history);\n}',
          options,
          errors: [{ messageId: 'historyDistinctOn', data: { table: 'runs' } }],
        },
        {
          code: 'function read() { return db.selectDistinctOn([runs.scenarioId], {}).from(runs).where(w); }',
          options,
          errors: [{ messageId: 'historyDistinctOn', data: { table: 'runs' } }],
        },
        {
          code: "function read() {\n  const r = alias(runs, 'r');\n  return db.selectDistinctOn([r.scenarioId], {}).from(r);\n}",
          options,
          errors: [{ messageId: 'historyDistinctOn', data: { table: 'runs' } }],
        },
      ],
    });
  });

  it('flags a ranking window partitioned in a subquery', () => {
    ruleTester.run('no-distinct-on-subquery', rule, {
      valid: [
        // A top-level window is the query itself.
        { code: 'const rows = await db.select({ rank: sql<number>`row_number() over (partition by ${r.scenarioId} order by ${r.at} desc)`.as(\'rank\') }).from(r);' },
        // No partition: one ranking over the set, not the latest rows of each key.
        { code: 'const ranked = db.select({ rank: sql<number>`row_number() over (order by ${r.score} desc)`.as(\'rank\') }).from(r).as(\'ranked\');' },
        { code: 'const ranked = db.select({ previous: sql<number>`lag(${r.score}) over (partition by ${r.scenarioId} order by ${r.at})`.as(\'previous\') }).from(r).as(\'ranked\');' },
        // Only a `sql` template reaches the database.
        { code: 'const ranked = db.select({ label: msg`row_number() over (partition by ${r.scenarioId})` }).from(r).as(\'ranked\');' },
        { code: 'const rank = sql<number>`row_number() over (partition by ${r.scenarioId})`.as(\'rank\');\nconst rows = await db.select({ rank }).from(r);' },
        // A `let` may hold another column by the time the subquery reads it.
        { code: 'let rank = sql<number>`row_number() over (partition by ${r.scenarioId})`.as(\'rank\');\nrank = sql<number>`0`.as(\'rank\');\nconst ranked = db.select({ rank }).from(r).as(\'ranked\');' },
        // A fragment with no partition leaves the window ranking the whole set.
        { code: 'const order = sql`order by ${r.score} desc`;\nconst ranked = db.select({ rank: sql<number>`row_number() over (${order})`.as(\'rank\') }).from(r).as(\'ranked\');' },
        { code: '// bounded-by: the caller aggregates every row of the tenant\nconst ranked = db.select({ rank: sql<number>`row_number() over (partition by ${r.cell})`.as(\'rank\') }).from(r).as(\'ranked\');' },
      ],
      invalid: [
        {
          code: 'const ranked = db.select({ id: r.id, rank: sql<number>`row_number() over (partition by ${r.scenarioId} order by ${r.at} desc)`.as(\'rank\') }).from(r).as(\'ranked\');',
          errors: [{ messageId: 'rankingWindow' }],
        },
        {
          // The window held in a constant, read by the subquery's columns.
          code: 'const rank = sql<number>`row_number() over (partition by ${r.scenarioId} order by ${r.at} desc)`.as(\'rank\');\nconst ranked = db.select({ id: r.id, rank }).from(r).as(\'ranked\');',
          errors: [{ messageId: 'rankingWindow' }],
        },
        {
          code: 'const ranked = db.select({ rank: sql<number>`dense_rank() OVER ( PARTITION BY ${r.scenarioId} order by ${r.at})`.as(\'rank\') }).from(r).where(w).as(\'ranked\');',
          errors: [{ messageId: 'rankingWindow' }],
        },
        {
          code: "const ranked = db.$with('ranked').as(db.select({ rank: sql<number>`row_number() over (partition by ${r.scenarioId})`.as('rank') }).from(r));",
          errors: [{ messageId: 'rankingWindow' }],
        },
        {
          // The partition held in a fragment the window interpolates.
          code: 'const partition = sql`partition by ${r.scenarioId}`;\nconst ranked = db.select({ rank: sql<number>`row_number() over (${partition} order by ${r.at} desc)`.as(\'rank\') }).from(r).as(\'ranked\');',
          errors: [{ messageId: 'rankingWindow' }],
        },
        {
          // A fragment interpolating itself ends the walk.
          code: 'const loop = sql`${loop}`;\nconst ranked = db.select({ rank: sql<number>`row_number() over (partition by ${r.id}) ${loop}`.as(\'rank\') }).from(r).as(\'ranked\');',
          errors: [{ messageId: 'rankingWindow' }],
        },
      ],
    });
  });
});
