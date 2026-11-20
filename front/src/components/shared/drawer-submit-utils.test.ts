/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { isDeliberateSubmit } from './drawer-submit-utils';

const buttonWith = (type: string | null): Element => {
  const button = document.createElement('button');
  if (type !== null) {
    button.setAttribute('type', type);
  }
  return button;
};

describe('isDeliberateSubmit', () => {
  it('should accept the Enter key, which submits without a submitter', () => {
    expect(isDeliberateSubmit(null)).toBe(true);
  });

  it('should accept a button asking to submit', () => {
    expect(isDeliberateSubmit(buttonWith('submit'))).toBe(true);
  });

  it('should refuse a button that declares no type', () => {
    expect(isDeliberateSubmit(buttonWith(null))).toBe(false);
  });
});
