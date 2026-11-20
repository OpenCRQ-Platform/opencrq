import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import { formatEventsPerYear } from './crq-tef-input-utils';

describe('formatEventsPerYear', () => {
  afterEach(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('writes the decimal separator of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatEventsPerYear(0.037)).toBe('0,037');
  });

  it('formats a number to 3 decimals', () => {
    expect(formatEventsPerYear(2)).toBe('2.000');
    expect(formatEventsPerYear(0.5)).toBe('0.500');
  });

  it('returns undefined while the value is not loaded yet', () => {
    expect(formatEventsPerYear(undefined)).toBeUndefined();
  });
});
