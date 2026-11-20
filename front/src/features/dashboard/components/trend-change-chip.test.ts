import { i18n } from '@lingui/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { changeTitleSince, formatTenthsOfPointsChange } from './trend-change-chip';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('formatTenthsOfPointsChange', () => {
  afterEach(() => {
    i18n.activate('en');
  });

  it('signs a rise and a fall and keeps the tenth', () => {
    expect(formatTenthsOfPointsChange(0.0123)).toBe('+1.2 pts');
    expect(formatTenthsOfPointsChange(-0.0123)).toBe('−1.2 pts');
  });

  it('writes the tenth with the separator of the application language', () => {
    i18n.load('fr', {});
    i18n.activate('fr');
    expect(formatTenthsOfPointsChange(0.0123)).toBe('+1,2 pts');
  });
});

describe('changeTitleSince', () => {
  it('leaves the default window title to a series that opens on or before the first day', () => {
    expect(changeTitleSince('2025-10-06', '2025-10-06')).toBeUndefined();
    expect(changeTitleSince('2025-09-01', '2025-10-06')).toBeUndefined();
  });

  it('names the month the readings begin when the series opens after the first day', () => {
    expect(changeTitleSince('2026-10-02', '2025-10-06')).toBe('Change since Oct 2026');
  });

  it('has nothing to name without a reading', () => {
    expect(changeTitleSince(null, '2025-10-06')).toBeUndefined();
  });
});
