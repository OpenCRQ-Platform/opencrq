import { RuleTester } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noPlainErrorClass } from './no-plain-error-class';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

describe('noPlainErrorClass', () => {
  it('flags class declarations that extend Error directly', () => {
    ruleTester.run('no-plain-error-class', noPlainErrorClass, {
      valid: [],
      invalid: [
        {
          code: 'class NonRetryableError extends Error {}',
          errors: [{ messageId: 'useStructuredError' }],
        },
        {
          code: 'export class AppError extends Error { constructor(msg: string) { super(msg); } }',
          errors: [{ messageId: 'useStructuredError' }],
        },
        {
          code: 'const MyError = class extends Error {}',
          errors: [{ messageId: 'useStructuredError' }],
        },
      ],
    });
  });

  it('does not flag classes that extend StructuredError or its subclasses', () => {
    ruleTester.run('no-plain-error-class', noPlainErrorClass, {
      valid: [
        { code: 'class NonRetryableError extends StructuredError {}' },
        { code: 'class LeaseLostError extends NonRetryableError {}' },
        { code: 'class StructuredError extends Error {}' },
        { code: 'const StructuredError = class StructuredError extends Error {}' },
      ],
      invalid: [],
    });
  });

  it('does not flag classes that do not extend anything', () => {
    ruleTester.run('no-plain-error-class', noPlainErrorClass, {
      valid: [
        { code: 'class Foo {}' },
        { code: 'class Bar extends Base {}' },
      ],
      invalid: [],
    });
  });
});
