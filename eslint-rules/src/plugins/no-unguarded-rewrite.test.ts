import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noUnguardedRewrite } from './no-unguarded-rewrite';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

const typedRuleTester = new RuleTester({
  languageOptions: {
    parser: typescriptEslint.parser,
    parserOptions: {
      projectService: { allowDefaultProject: ['*.ts'] },
      tsconfigRootDir: import.meta.dirname,
    },
  },
});

/** A stand-in for the query builder, so the type of what `.values(...)` takes is all the checker sees. */
const builder = [
  'type Row = { id: string, name: string };',
  'declare const t: { id: string };',
  'declare const db: { insert: (table: unknown) => { values: (rows: Row | Array<Row>) => { onConflictDoUpdate: (config: object) => unknown } } };',
  '',
].join('\n');

// RuleTester types `create` against ESLint's ESTree nodes, while this rule's structural context
// takes the TSESTree ones its parser produces.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const rule = noUnguardedRewrite as unknown as Rule.RuleModule;

describe('noUnguardedRewrite', () => {
  it('flags a batch upsert moving updatedAt with no change guard', () => {
    ruleTester.run('no-unguarded-rewrite', rule, {
      valid: [
        // A person's save of one row.
        { code: 'const save = ({ db }, row) => db.insert(t).values([row]).onConflictDoUpdate({ target: t.id, set: { name: row.name, updatedAt: new Date() } });' },
        { code: 'const save = ({ db }, row) => db.insert(t).values({ id, name }).onConflictDoUpdate({ target: t.id, set: { name, updatedAt: new Date() } });' },
        { code: 'const sync = ({ db }, rows) => db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set: { name: sql`excluded.name`, updatedAt: new Date() }, setWhere: valuesChange(t, set) });' },
        { code: 'const sync = ({ db }, rows) => db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set: { name: sql`excluded.name`, updatedAt: updatedAtOnDataChange(t, set) } }).returning();' },
        { code: 'const sync = ({ db }, rows) => {\n  const set = { name: sql`excluded.name`, updatedAt: new Date() };\n  return db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set, setWhere: valuesChange(t, set) });\n};' },
        { code: 'const sync = ({ db }, rows) => {\n  const set = { name: sql`excluded.name`, updatedAt: updatedAtOnDataChange(t, { name: sql`excluded.name` }) };\n  return db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set });\n};' },
        // A `let` may be reassigned before the write, so its initializer says nothing.
        { code: 'const sync = ({ db }, rows) => {\n  let set = { updatedAt: new Date() };\n  set = { name: sql`excluded.name` };\n  return db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set });\n};' },
        // An identical rewrite that moves no clock leaves the row as it was, which the doorbell ignores.
        { code: 'const sync = ({ db }, rows) => db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set: { name: sql`excluded.name` } });' },
      ],
      invalid: [
        {
          code: 'const sync = ({ db }, rows) => db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set: { name: sql`excluded.name`, updatedAt: new Date() } });',
          errors: [{ messageId: 'guardUpsert' }],
        },
        {
          // Moving the `set` into a constant, or the whole config, changes nothing it writes.
          code: 'const sync = ({ db }, rows) => {\n  const set = { name: sql`excluded.name`, updatedAt: new Date() };\n  return db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set });\n};',
          errors: [{ messageId: 'guardUpsert' }],
        },
        {
          code: 'const fields = { updatedAt: new Date() };\nconst onConflict = { target: t.id, set: fields };\nconst sync = ({ db }, rows) => db.insert(t).values(rows).onConflictDoUpdate(onConflict);',
          errors: [{ messageId: 'guardUpsert' }],
        },
        {
          code: 'const sync = ({ db }, a, b) => db.insert(t).values([a, b]).onConflictDoUpdate({ target: t.id, set: { updatedAt: new Date() } });',
          errors: [{ messageId: 'guardUpsert' }],
        },
        {
          // A single spread element is a batch.
          code: 'const sync = ({ db }, rows) => db.insert(t).values([...rows]).onConflictDoUpdate({ target: t.id, set: { updatedAt: new Date() } });',
          errors: [{ messageId: 'guardUpsert' }],
        },
        {
          code: 'const sync = ({ db }, rows) => db.insert(t).values(rows.map(toRow)).onConflictDoUpdate({ target: t.id, set: { updatedAt: sql`excluded.updated_at` } }).returning();',
          errors: [{ messageId: 'guardUpsert' }],
        },
      ],
    });
  });

  it('flags a set deleted and inserted again in one function', () => {
    ruleTester.run('no-unguarded-rewrite', rule, {
      valid: [
        { code: 'const sync = async ({ db }, held, wanted) => {\n  const { stale, missing } = diffRows(held, wanted, key, key);\n  await db.delete(links).where(inArray(links.id, stale.map((row) => row.id)));\n  await db.insert(links).values(missing);\n};' },
        // Two functions of one repository, one table each.
        { code: 'const repo = defineRepository({\n  remove: ({ db }, id) => db.delete(links).where(eq(links.id, id)),\n  add: ({ db }, row) => db.insert(links).values(row),\n});' },
        { code: 'const move = async ({ db }, id, row) => {\n  await db.delete(oldLinks).where(eq(oldLinks.id, id));\n  await db.insert(newLinks).values(row);\n};' },
        // A `Set` is not a table.
        { code: 'const add = async ({ db }, seen, row) => {\n  seen.delete(links);\n  await db.insert(links).values(row);\n};' },
        // Each method of a repository passed as callbacks writes for itself.
        { code: 'const repo = wrap(\n  async ({ db }, id) => db.delete(links).where(eq(links.id, id)),\n  async ({ db }, row) => db.insert(links).values(row),\n);' },
        // One name, two bindings: each block writes its own table.
        { code: 'const move = async ({ db }, id, row) => {\n  {\n    const t = oldLinks;\n    await db.delete(t).where(eq(t.id, id));\n  }\n  {\n    const t = newLinks;\n    await db.insert(t).values(row);\n  }\n};' },
      ],
      invalid: [
        {
          code: 'const replace = async ({ db }, analysisId, rows) => {\n  await db.delete(children).where(eq(children.analysisId, analysisId));\n  if (rows.length > 0) {\n    await db.insert(children).values(rows);\n  }\n};',
          errors: [{ messageId: 'diffChildSet', data: { table: 'children' }, line: 2 }],
        },
        {
          // The table held in a constant on one side only.
          code: 'const replace = async ({ db }, id, rows) => {\n  const table = children;\n  await db.delete(table).where(eq(table.analysisId, id));\n  await db.insert(children).values(rows);\n};',
          errors: [{ messageId: 'diffChildSet', data: { table: 'children' } }],
        },
        {
          // The insert made in a callback writes for the method passing it.
          code: 'const replace = async ({ db }, id, rows) => {\n  await db.delete(children).where(eq(children.analysisId, id));\n  await Promise.all(rows.map((row) => db.insert(children).values(row)));\n};',
          errors: [{ messageId: 'diffChildSet', data: { table: 'children' } }],
        },
        {
          code: 'const replace = async ({ db, rawDb }, id, rows) => {\n  await db.delete(children).where(eq(children.analysisId, id));\n  const raw = rawDb();\n  await raw.transaction(async (tx) => {\n    await tx.insert(children).values(rows);\n  });\n};',
          errors: [{ messageId: 'diffChildSet', data: { table: 'children' } }],
        },
        {
          code: 'async function replace(rawDb, ids, rows) {\n  await rawDb().delete(links).where(inArray(links.parentId, ids));\n  await rawDb().insert(links).values(rows).onConflictDoNothing();\n}',
          errors: [{ messageId: 'diffChildSet', data: { table: 'links' } }],
        },
      ],
    });
  });

  it('tells a single row passed as a variable from a batch by its type', () => {
    typedRuleTester.run('no-unguarded-rewrite', rule, {
      valid: [
        { code: `${builder}export const save = (row: Row) => db.insert(t).values(row).onConflictDoUpdate({ target: t.id, set: { name: row.name, updatedAt: new Date() } });` },
      ],
      invalid: [
        {
          code: `${builder}export const sync = (rows: Array<Row>) => db.insert(t).values(rows).onConflictDoUpdate({ target: t.id, set: { updatedAt: new Date() } });`,
          errors: [{ messageId: 'guardUpsert' }],
        },
      ],
    });
  });
});
