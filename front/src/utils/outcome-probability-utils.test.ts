import { i18n } from '@lingui/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatOutcomeProbability } from './outcome-probability-utils';

beforeAll(() => {
  i18n.load({ en: {}, fr: {} });
});

afterEach(() => {
  i18n.activate('en');
});

describe('formatOutcomeProbability', () => {
  it('should keep a decimal just above the weighing threshold', () => {
    i18n.activate('en');
    expect(formatOutcomeProbability(0.503)).toBe('50.3%');
  });

  it('should keep a decimal just below the weighing threshold', () => {
    i18n.activate('en');
    expect(formatOutcomeProbability(0.496)).toBe('49.6%');
  });

  it('should write the threshold itself as a whole percent', () => {
    i18n.activate('en');
    expect(formatOutcomeProbability(0.5)).toBe('50%');
  });

  it('should round any other probability to a whole percent', () => {
    i18n.activate('en');
    expect(formatOutcomeProbability(0.62)).toBe('62%');
    expect(formatOutcomeProbability(0.004)).toBe('0%');
  });

  it('should follow the application language', () => {
    i18n.activate('fr');
    expect(formatOutcomeProbability(0.503)).toMatch(/^50,3\s%$/);
  });
});
