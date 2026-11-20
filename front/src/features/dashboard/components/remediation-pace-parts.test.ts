import { i18n } from '@lingui/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatRate } from './remediation-pace-parts';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  i18n.activate('en');
});

describe('formatRate', () => {
  it('keeps a decimal below ten and whole units from ten up', () => {
    expect(formatRate(3.14)).toBe('3.1');
    expect(formatRate(12.6)).toBe('13');
  });

  it('writes the decimal with the separator of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatRate(3.14)).toBe('3,1');
  });
});
