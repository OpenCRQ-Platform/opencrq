import { RuleTester } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noOptionalQueryOutput } from './no-optional-query-output';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

describe('noOptionalQueryOutput', () => {
  it('flags .optional() in a query .output() schema', () => {
    ruleTester.run('no-optional-query-output', noOptionalQueryOutput, {
      valid: [],
      invalid: [
        {
          code: 'p.output(z.string().optional()).query(() => null)',
          errors: [{ messageId: 'useNullable' }],
        },
        {
          // Real-world shape: .input().output().query()
          code: 'authProcedure.input(schema).output(MySchema.optional()).query(() => null)',
          errors: [{ messageId: 'useNullable' }],
        },
        {
          code: 'p.output(MySchema.optional()).meta({ x: 1 }).query(() => null)',
          errors: [{ messageId: 'useNullable' }],
        },
        {
          code: 'p.output(MySchema.optional()).meta({ x: 1 }).describe("d").query(() => null)',
          errors: [{ messageId: 'useNullable' }],
        },
      ],
    });
  });

  it('does not flag .nullable() outputs', () => {
    ruleTester.run('no-optional-query-output', noOptionalQueryOutput, {
      valid: [
        { code: 'p.output(z.string().nullable()).query(() => null)' },
        { code: 'p.output(MySchema).query(() => null)' },
      ],
      invalid: [],
    });
  });

  it('does not flag .optional() outputs on mutations (undefined is tolerated there)', () => {
    ruleTester.run('no-optional-query-output', noOptionalQueryOutput, {
      valid: [
        { code: 'p.output(z.void().optional()).mutation(() => undefined)' },
        { code: 'p.output(z.void().optional()).meta({ x: 1 }).mutation(() => undefined)' },
      ],
      invalid: [],
    });
  });

  it('does not flag .optional() that is not an argument to .output()', () => {
    ruleTester.run('no-optional-query-output', noOptionalQueryOutput, {
      valid: [
        // standalone schema definition
        { code: 'const s = z.string().optional();' },
        // optional field inside an object schema — the top-level output is still required
        { code: 'p.output(z.object({ a: z.string().optional() })).query(() => null)' },
        // optional on an input schema is unrelated to the query data constraint
        { code: 'p.input(z.string().optional()).output(MySchema).query(() => null)' },
      ],
      invalid: [],
    });
  });
});
