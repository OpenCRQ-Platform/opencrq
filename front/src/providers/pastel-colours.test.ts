import { afterEach, describe, expect, it } from 'vitest';
import { applyPastelColours } from './theme-provider';

describe('applyPastelColours', () => {
  afterEach(() => {
    document.documentElement.classList.remove('pastel');
  });

  it('leaves the root without the pastel class by default (standard colours)', () => {
    applyPastelColours(false);
    expect(document.documentElement.classList.contains('pastel')).toBe(false);
  });

  it('adds the pastel class when the user opts in, and removes it when they opt out', () => {
    applyPastelColours(true);
    expect(document.documentElement.classList.contains('pastel')).toBe(true);
    applyPastelColours(false);
    expect(document.documentElement.classList.contains('pastel')).toBe(false);
  });
});
