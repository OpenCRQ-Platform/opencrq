import { i18n } from '@lingui/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatList } from './format-list';

beforeEach(() => {
  i18n.load({ en: {}, fr: {} });
  i18n.activate('en');
});

afterEach(() => {
  i18n.activate('en');
});

describe('formatList', () => {
  it('should join items as a sentence joins them', () => {
    expect(formatList(['a'])).toBe('a');
    expect(formatList(['a', 'b'])).toBe('a and b');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
  });

  it('should join items in the application language', () => {
    i18n.activate('fr');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b et c');
  });
});
