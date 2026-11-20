import { describe, expect, it } from 'vitest';
import { InputsNotReadyError, isErrorRetryable, NonRetryableError } from './types';

describe('InputsNotReadyError', () => {
  it('is a NonRetryableError, so a caller that only knows refusals still reads it as one', () => {
    expect(new InputsNotReadyError('x')).toBeInstanceOf(NonRetryableError);
  });

  it('is not retryable', () => {
    expect(isErrorRetryable(new InputsNotReadyError('x'))).toBe(false);
  });

  it('is named after its class', () => {
    expect(new InputsNotReadyError('x').name).toBe('InputsNotReadyError');
  });
});
