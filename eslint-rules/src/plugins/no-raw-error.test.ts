import { RuleTester } from 'eslint';
import typescriptEslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { noRawError } from './no-raw-error';

const ruleTester = new RuleTester({
  languageOptions: { parser: typescriptEslint.parser },
});

describe('noRawError', () => {
  it('flags new Error(...) with a message', () => {
    ruleTester.run('no-raw-error', noRawError, {
      valid: [],
      invalid: [
        {
          code: 'throw new Error("Something went wrong")',
          errors: [{ messageId: 'useNewError' }],
        },
        {
          code: 'throw new Error(`HTTP error ${status}`)',
          errors: [{ messageId: 'useNewError' }],
        },
        {
          code: 'const e = new Error()',
          errors: [{ messageId: 'useNewError' }],
        },
      ],
    });
  });

  it('does not flag other constructors', () => {
    ruleTester.run('no-raw-error', noRawError, {
      valid: [
        { code: 'throw new TypeError("boom")' },
        { code: 'throw new RangeError("out of range")' },
        { code: 'newError("structured")' },
      ],
      invalid: [],
    });
  });
});
