import { RuleTester } from 'eslint';
import type { Rule } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noUnboundedListQuery } from './no-unbounded-list-query';

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

// RuleTester types `create` against ESLint's ESTree nodes and comments, while this rule's
// structural context takes the TSESTree ones its parser produces.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const rule = noUnboundedListQuery as unknown as Rule.RuleModule;

/** A stand-in for the tRPC builder, so the resolver's return type is all the checker sees. */
const builder = [
  'declare const pagedInput: (keys: Array<string>) => { extend: (shape: object) => object };',
  'declare const p: {',
  '  input: (schema: unknown) => typeof p,',
  '  output: (schema: unknown) => typeof p,',
  '  query: <T>(resolver: () => T) => T,',
  '  mutation: <T>(resolver: () => T) => T,',
  '};',
  'declare const router: (procedures: object) => object;',
  'declare const RowsSchema: unknown;',
  '',
].join('\n');

describe('noUnboundedListQuery', () => {
  it('flags an array query with no paginated input', () => {
    ruleTester.run('no-unbounded-list-query', rule, {
      valid: [],
      invalid: [
        {
          code: 'p.output(z.array(RowSchema)).query(() => [])',
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // An input that is not the paged contract bounds nothing.
          code: 'p.input(z.object({ frameworkId: z.uuid() })).output(z.array(RowSchema)).query(() => [])',
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          code: 'p.output(z.array(RowSchema)).meta({ x: 1 }).query(() => [])',
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // A marker with no reason is not a claim about the data.
          code: '// bounded-by:\np.output(z.array(RowSchema)).query(() => [])',
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // A sibling's marker vouches for that sibling only.
          code: [
            'router({',
            '  // bounded-by: the ATT&CK catalogue, ~900 rows',
            '  getTechniques: p.output(z.array(RowSchema)).query(() => []),',
            '  getFindings: p.output(z.array(RowSchema)).query(() => []),',
            '})',
          ].join('\n'),
          errors: [{ messageId: 'needsPagination', line: 4 }],
        },
        {
          // Nor does a marker on the router vouch for its procedures.
          code: '// bounded-by: the ATT&CK catalogue, ~900 rows\nexport const r = router({\n  get: p.output(z.array(RowSchema)).query(() => []),\n})',
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // Nor one above an enclosing statement.
          code: '// bounded-by: the ATT&CK catalogue, ~900 rows\nif (enabled) {\n  p.output(z.array(RowSchema)).query(() => []);\n}',
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // The paged contract paginates only as the input.
          code: 'p.meta(pagedInput(KEYS)).output(z.array(RowSchema)).query(() => [])',
          errors: [{ messageId: 'needsPagination' }],
        },
      ],
    });
  });

  it('accepts a paged input, a declared bound, and anything that is not an array query', () => {
    ruleTester.run('no-unbounded-list-query', rule, {
      valid: [
        { code: 'p.input(pagedInput(KEYS)).output(pagedOutput(RowSchema)).query(() => [])' },
        { code: 'p.input(pagedInput(KEYS).extend({ state: S })).output(z.array(RowSchema)).query(() => [])' },
        { code: 'p.output(z.array(RowSchema)).input(pagedInput(KEYS)).query(() => [])' },
        { code: '// bounded-by: the ATT&CK catalogue, ~900 rows\np.output(z.array(RowSchema)).query(() => [])' },
        { code: 'router({\n  /** Doc. */\n  // bounded-by: the ATT&CK catalogue, ~900 rows\n  get: p.input(I).output(z.array(RowSchema)).query(() => []),\n})' },
        { code: 'p.output(z.array(RowSchema)).mutation(() => [])' },
        { code: 'p.output(RowSchema).query(() => null)' },
        // An array the query takes is not an array it returns.
        { code: 'p.input(z.array(IdSchema)).output(CountSchema).query(() => 0)' },
        { code: '// bounded-by: the ATT&CK catalogue, ~900 rows\nexport const getAll = p.output(z.array(RowSchema)).query(() => [])' },
        // With no resolver there is no procedure, whatever the chain declares.
        { code: 'p.output(z.array(RowSchema)).query()' },
      ],
      invalid: [],
    });
  });

  it('reads the resolver\'s return type, whatever the query declares', () => {
    typedRuleTester.run('no-unbounded-list-query', rule, {
      valid: [
        { code: `${builder}p.query(() => ({ total: 3 }));` },
        // Only a top-level array counts, not one inside a returned object.
        { code: `${builder}p.query(async () => ({ items: ['a'], total: 1 }));` },
        { code: `${builder}p.input(pagedInput(['name'])).query(() => ['a']);` },
        { code: `${builder}// bounded-by: the tenant's roles, which a security manager creates by hand\np.query(() => ['a']);` },
        { code: `${builder}p.mutation(() => ['a']);` },
        // A tuple's length is fixed by its type.
        { code: `${builder}p.query((): [string, string] => ['a', 'b']);` },
      ],
      invalid: [
        {
          // No `.output()` at all: the shape comes from the resolver.
          code: `${builder}p.query(() => ['a', 'b']);`,
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          code: `${builder}p.query(async () => Promise.resolve([1, 2]));`,
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // An output schema spelled through a variable says nothing the syntax can read.
          code: `${builder}p.output(RowsSchema).query((): ReadonlyArray<string> => []);`,
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          code: `${builder}p.query((): Array<string> | null => null);`,
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          // A type that says nothing may hold an array.
          code: `${builder}p.query((): any => []);`,
          errors: [{ messageId: 'needsPagination' }],
        },
        {
          code: `${builder}p.query((): unknown => []);`,
          errors: [{ messageId: 'needsPagination' }],
        },
      ],
    });
  });
});
