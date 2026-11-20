import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { formatRevenueBand } from './format-revenue-band';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('formatRevenueBand', () => {
  it('should return dash for null', () => {
    expect(formatRevenueBand(null)).toBe('-');
  });

  it('should label every band', () => {
    expect(formatRevenueBand('under_10m')).toBe('< $10M');
    expect(formatRevenueBand('10m_100m')).toBe('$10M-$100M');
    expect(formatRevenueBand('100m_1b')).toBe('$100M-$1B');
    expect(formatRevenueBand('1b_10b')).toBe('$1B-$10B');
    expect(formatRevenueBand('10b_100b')).toBe('$10B-$100B');
    expect(formatRevenueBand('over_100b')).toBe('> $100B');
  });
});
