import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noFullRowListOutput } from './no-full-row-list-output';

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

/** A stand-in for the tRPC builder, so the resolver's return type is all the checker sees. */
const builder = [
  'type Row = { id: string, name: string };',
  'declare const p: {',
  '  output: (schema: unknown) => typeof p,',
  '  query: <T>(resolver: () => T) => T,',
  '  mutation: <T>(resolver: () => T) => T,',
  '};',
  'declare const RowsSchema: unknown;',
  '',
].join('\n');

// RuleTester types `create` against ESLint's ESTree nodes and comments, while this rule's
// structural context takes the TSESTree ones its parser produces.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const rule = noFullRowListOutput as unknown as Rule.RuleModule;

const router = (schemas: string, procedure: string): string =>
  `${schemas}\nexport const router = createRouter({\n${procedure}\n});`;

describe('noFullRowListOutput', () => {
  it('flags a list whose rows are a whole table row', () => {
    ruleTester.run('no-full-row-list-output', rule, {
      valid: [],
      invalid: [
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema)).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // `.omit` is a denylist: a column added later still ships.
          code: router('const RowSchema = createSelectSchema(risks).omit({ tenantId: true });\nconst ListRowSchema = RowSchema.extend({ owner: z.string() });', '  list: procedure.input(x).output(pagedOutput(ListRowSchema)).query(() => page),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('export const RowsSchema = z.array(createSelectSchema(risks)).nullable();', '  list: procedure.output(RowsSchema).query(() => null),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(RowSchema.array()).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // An alias of the list schema, and a schema declared inside the router function.
          code: router('const Rows = z.array(createSelectSchema(risks));\nconst Output = Rows;', '  list: procedure.output(Output).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A router-local constant shadowing a module-level one of the same name is another binding.
          code: 'const Rows = z.array(createSelectSchema(risks));\nconst Output = Rows;\nexport const risksRouter = (procedure) => {\n  const Rows = Output;\n  return createRouter({ list: procedure.output(Rows).query(() => []) });\n};',
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: 'export const risksRouter = (procedure) => {\n  const RowSchema = createSelectSchema(risks);\n  return createRouter({ list: procedure.output(z.array(RowSchema)).query(() => []) });\n};',
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A hand-paginated page holds its rows in a property.
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.object({ items: z.array(RowSchema), total: z.number() })).query(() => page),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A row rebuilt from a full row's shape keeps every column.
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(z.object({ ...RowSchema.shape, owner: z.string() }))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema.pick({ id: true }).extend(RowSchema.shape))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);\nconst Shape = { ...RowSchema.shape };', '  list: procedure.output(z.array(Base.merge(z.object(Shape)))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // Every method keeps the columns but `.pick`: the walk fails closed.
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema.safeExtend({ owner: z.string() }))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema.partial().required().brand())).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema.refine((risk) => risk.id !== null).catchall(z.string()))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A method on the list itself keeps its rows.
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema).min(1).default([])).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.union([z.array(RowSchema), z.null()])).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(z.strictObject({ ...RowSchema.shape }))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A list added to a picked page, a list inside a list row, and a full row inside one.
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(Page.extend({ items: z.array(RowSchema) })).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(z.object({ id: z.uuid(), children: z.array(RowSchema) }))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(z.object({ id: z.uuid(), risk: RowSchema }))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A `.pick(...)` keeping a list of whole rows keeps them whole.
          code: router('const MoveSchema = createSelectSchema(moves);\nconst PlanSchema = createSelectSchema(plans).extend({ moves: z.array(MoveSchema) });', '  list: procedure.output(z.array(PlanSchema.pick({ id: true, moves: true }))).query(() => []),'),
          errors: [{ messageId: 'pickColumns' }],
        },
        {
          // A marker with no reason, or above a sibling procedure, vouches for nothing here.
          code: router('const RowSchema = createSelectSchema(risks);', '  // full-row:\n  list: procedure.output(z.array(RowSchema)).query(() => []),\n  // full-row: the export renders every column\n  exportAll: procedure.output(z.array(RowSchema)).query(() => []),\n  other: procedure.output(z.array(RowSchema)).query(() => []),'),
          errors: [{ messageId: 'pickColumns', line: 4 }, { messageId: 'pickColumns', line: 7 }],
        },
      ],
    });
  });

  it('accepts an allowlist, a single row, a mutation and a declared full row', () => {
    ruleTester.run('no-full-row-list-output', rule, {
      valid: [
        { code: router('const RowSchema = createSelectSchema(risks).pick({ id: true, name: true });', '  list: procedure.output(z.array(RowSchema.extend({ owner: z.string() }))).query(() => []),') },
        { code: router('const RowSchema = z.object({ id: z.uuid(), name: z.string() });', '  list: procedure.output(z.array(RowSchema)).query(() => []),') },
        { code: router('const RowSchema = rowSchemaOf(risks);', '  list: procedure.output(pagedOutput(RowSchema.extend({ owner: z.string() }))).query(() => page),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  get: procedure.output(RowSchema.nullable()).query(() => null),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  create: procedure.output(z.array(RowSchema)).mutation(() => []),') },
        // A single row beside a list of picked ones, and a shape picked before it is spread.
        { code: router('const RowSchema = createSelectSchema(risks);', '  get: procedure.output(z.object({ risk: RowSchema, owners: z.array(RowSchema.pick({ id: true })) })).query(() => page),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(z.object({ ...RowSchema.pick({ id: true }).shape, owner: z.string() }))).query(() => []),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(z.object({ id: RowSchema.shape.id }))).query(() => []),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  list: procedure.output(z.array(RowSchema.safeExtend({ owner: z.string() }).pick({ id: true }))).query(() => []),') },
        { code: router('const A = z.object({ items: B });\nconst B = z.object({ items: A });', '  list: procedure.output(A).query(() => []),') },
        { code: router('import { RowSchema } from \'./schemas\';', '  list: procedure.output(z.array(RowSchema)).query(() => []),') },
        // Constants built from each other end the walk rather than loop.
        { code: router('const A = B.extend({});\nconst B = A.extend({});', '  list: procedure.output(z.array(A)).query(() => []),') },
        { code: router('const A = B.nullable();\nconst B = A.nullable();', '  list: procedure.output(A).query(() => []),') },
        { code: router('const A = B;\nconst B = A;', '  list: procedure.output(z.array(A)).query(() => []),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  // full-row: the mitigations list renders every field, the description truncated\n  list: procedure.output(z.array(RowSchema)).query(() => []),') },
        { code: router('const RowSchema = createSelectSchema(risks);', '  // bounded-by: the tenant\'s risks, a few dozen\n  // full-row: the export renders every column\n  list: procedure.output(z.array(RowSchema)).query(() => []),') },
      ],
      invalid: [],
    });
  });

  it('flags a list query that declares no output, from its return type', () => {
    typedRuleTester.run('no-full-row-list-output', rule, {
      valid: [
        { code: `${builder}export const list = p.output(RowsSchema).query((): Array<Row> => []);` },
        { code: `${builder}export const get = p.query((): Row | null => null);` },
        { code: `${builder}export const add = p.mutation((): Array<Row> => []);` },
        // A list of plain values has no columns to pick.
        { code: `${builder}export const names = p.query((): Array<string> => []);` },
      ],
      invalid: [
        {
          code: `${builder}export const list = p.query((): Array<Row> => []);`,
          errors: [{ messageId: 'declareOutput' }],
        },
        {
          code: `${builder}export const list = p.query(async (): Promise<Array<Row> | null> => null);`,
          errors: [{ messageId: 'declareOutput' }],
        },
        {
          code: `${builder}export const list = p.query((): Array<string | Row> => []);`,
          errors: [{ messageId: 'declareOutput' }],
        },
        {
          code: `${builder}export const list = p.query((): unknown => null);`,
          errors: [{ messageId: 'declareOutput' }],
        },
      ],
    });
  });

  it('cannot tell a list without type information', () => {
    ruleTester.run('no-full-row-list-output', rule, {
      valid: [{ code: 'export const list = p.query(() => rows);' }],
      invalid: [],
    });
  });
});
